import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { buildExpireRoundIx } from "@/game/solana/instructions";
import { decodeHuntState, deriveHuntPDA } from "@/game/solana/program";
import { resilientBaseFetch, BASE_RPC_PRIMARY } from "@/game/solana/baseRpc";
import { lock } from "@/lib/kv";

/**
 * Keeping the global "Find Someone" round moving, from the server.
 *
 * The round only advances when somebody sends `claim_find` (a player found the
 * citizen) or `expire_round` (five minutes passed and nobody did). Both used to
 * come exclusively from players' browsers, which makes the city-wide hunt as
 * reliable as whoever happens to be standing in it: with nobody connected, or
 * with nobody whose wallet is connected, the deadline slides into the past and
 * the same citizen stays hunted forever. That is exactly how round 952 sat
 * expired for over an hour on 2026-10-02.
 *
 * So the server cranks it too. `expire_round` takes any signer as `cranker` —
 * the program only checks that the round matches and the deadline has passed —
 * so this needs nothing but a funded devnet keypair, and it can never do
 * anything else: it cannot claim a find, pick a winner, or touch a player.
 *
 * There is no cron. The crank rides requests that already happen (the hunt
 * board read the game and the dev panel make), which means the city is kept
 * alive exactly while somebody is looking at it and costs nothing when nobody
 * is. A lock in the key-value store keeps concurrent instances to one send.
 */

/**
 * The crank keypair, from HUNT_CRANK_SECRET: the JSON byte array that
 * `solana-keygen new -o hunt-cranker.json` writes, pasted whole.
 *
 * Only that form, because nothing in this app decodes base58 (the one helper
 * here encodes), and a crank key is not worth a dependency. The key needs no
 * authority over anything: give it a little devnet SOL and nothing else.
 */
function crankKeypair(): Keypair | null {
  const raw = process.env.HUNT_CRANK_SECRET?.trim();
  if (!raw || !raw.startsWith("[")) return null;
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
  } catch {
    return null;
  }
}

function connection(): Connection {
  return new Connection(BASE_RPC_PRIMARY, { commitment: "confirmed", fetch: resilientBaseFetch });
}

export interface HuntStatus {
  /** Null when the hunt account does not exist yet. */
  round: number | null;
  winner: string | null;
  deadline: number | null;
  /** Seconds the current citizen is overdue; 0 while it is still running. */
  expiredFor: number;
  /** Whether a crank keypair is configured at all. */
  armed: boolean;
  cranker: string | null;
}

/** Reads the hunt without touching it. */
export async function readHunt(): Promise<HuntStatus> {
  const keypair = crankKeypair();
  const base: HuntStatus = {
    round: null, winner: null, deadline: null, expiredFor: 0,
    armed: !!keypair, cranker: keypair?.publicKey.toBase58() ?? null,
  };
  try {
    const [pda] = deriveHuntPDA();
    const info = await connection().getAccountInfo(pda);
    if (!info) return base;
    const hunt = decodeHuntState(info.data);
    if (!hunt) return base;
    const now = Math.floor(Date.now() / 1000);
    return {
      ...base,
      round: hunt.round,
      winner: hunt.winner.equals(PublicKey.default) ? null : hunt.winner.toBase58(),
      deadline: hunt.deadline,
      expiredFor: Math.max(0, now - hunt.deadline),
    };
  } catch {
    return base;
  }
}

/** How overdue a citizen must be before the server steps in. */
const GRACE_SECS = 12;
/**
 * How often the server looks at all, across every instance.
 *
 * The check is one account read, but it hangs off a request every player makes
 * on a timer, so without this a full room would multiply it by the room. One
 * look every ten seconds is far more often than a five-minute round needs, and
 * it doubles as the retry interval when a send is lost.
 */
const CHECK_SECS = 10;

export interface CrankResult {
  cranked: boolean;
  /** Why not, when it did not. */
  reason?: "no-key" | "no-hunt" | "not-expired" | "checked-recently" | "send-failed";
  round?: number;
  signature?: string;
}

/**
 * Advances the round if it is overdue. Safe to call on any request: it reads
 * first, does nothing in the common case, and never throws.
 *
 * The grace period is there because players crank too, and theirs should win:
 * a server that fired the instant a deadline passed would race every client in
 * the city for the same no-op.
 */
export async function crankHuntIfExpired(force = false): Promise<CrankResult> {
  const keypair = crankKeypair();
  if (!keypair) return { cranked: false, reason: "no-key" };

  // Taken BEFORE the chain read, so the throttle covers the read too and a busy
  // room costs one account read every CHECK_SECS rather than one per player.
  // The host's button passes `force` and skips it.
  if (!force && !(await lock("hunt:crank:check", CHECK_SECS).catch(() => false))) {
    return { cranked: false, reason: "checked-recently" };
  }

  const status = await readHunt();
  if (status.round === null) return { cranked: false, reason: "no-hunt" };
  if (status.expiredFor < GRACE_SECS) return { cranked: false, reason: "not-expired", round: status.round };

  try {
    const conn = connection();
    const tx = new Transaction().add(buildExpireRoundIx(keypair.publicKey, status.round));
    tx.feePayer = keypair.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    tx.sign(keypair);
    // Preflight on: a rejected send tells us why here, where a dropped one
    // would otherwise be invisible — the failure mode this whole file exists
    // to end.
    const signature = await conn.sendRawTransaction(tx.serialize());
    return { cranked: true, round: status.round, signature };
  } catch (err) {
    console.warn("[hunt] server crank failed:", (err as Error).message);
    return { cranked: false, reason: "send-failed", round: status.round };
  }
}
