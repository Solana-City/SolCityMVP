/**
 * Server-side reads for the developer panel: who is in the city right now, and
 * what state the Sol Mechs program is in.
 *
 * Deliberately independent of the game client. The panel must work when the
 * game does not, which is exactly when it is needed, so nothing here imports
 * scene or React code.
 */
import { Connection, PublicKey } from "@solana/web3.js";

const HELIUS_DEVNET =
  process.env.NEXT_PUBLIC_HELIUS_DEVNET
  ?? "https://devnet.helius-rpc.com/?api-key=92175bf8-4484-4c09-a60a-4d08ee821058";
const ER_ENDPOINT = "https://devnet.magicblock.app";

const CITY_PROGRAM = new PublicKey(
  process.env.NEXT_PUBLIC_SOL_CITY_PROGRAM_ID || "HPvDFVnruSXHwKKP44eUvRh8oYqBaHCeQbK1sKWT1aU2",
);
const MECHS_PROGRAM = process.env.NEXT_PUBLIC_SOLMECHS_PROGRAM || "";

/**
 * Wallets whose balance the team needs to watch.
 *
 * The devnet stock exchange pays sellers out of its own treasury, so when it
 * runs dry every sell fails ("the devnet exchange is low on SOL"). Its address
 * is derived from a public seed in game/solana/devnetStocks.ts.
 */
export const WATCHED_WALLETS = [
  { id: "stocks", label: "Devnet stock exchange", address: "B7g2euoDoD5ewVMZUgSoPGuctZXCjhn1jtZM8ZYrsK4e", low: 0.5 },
  { id: "game", label: "Game wallet (treasury, deploys)", address: "9592QS34mPUwqA7sPAkug1kcuFddjn59QPQMzzCgKhEp", low: 1 },
] as const;

export interface WalletBalance {
  id: string;
  label: string;
  address: string;
  sol: number | null;
  /** Below the level where it stops being able to do its job. */
  low: boolean;
}

export async function walletBalances(): Promise<WalletBalance[]> {
  const conn = new Connection(HELIUS_DEVNET, "confirmed");
  return Promise.all(WATCHED_WALLETS.map(async (w) => {
    try {
      const sol = (await conn.getBalance(new PublicKey(w.address))) / 1e9;
      return { id: w.id, label: w.label, address: w.address, sol, low: sol < w.low };
    } catch {
      return { id: w.id, label: w.label, address: w.address, sol: null, low: false };
    }
  }));
}

/** The current PlayerState layout; shorter accounts are stale pre-v2 PDAs. */
const PLAYER_MIN_LEN = 200;

export interface OnlinePlayer {
  wallet: string;
  /** The name stored on-chain, which is the wallet short form unless changed. */
  displayName: string;
  x: number;
  y: number;
  score: number;
  /** Unix seconds. */
  lastActive: number;
}

/**
 * Decodes the fields the panel shows. Layout mirrors PlayerState in
 * programs/sol-city/src/lib.rs: discriminator, authority, optional session
 * key, then the name as a borsh string.
 */
function decodePlayer(data: Uint8Array): OnlinePlayer | null {
  try {
    const buf = Buffer.from(data);
    if (buf.length < PLAYER_MIN_LEN) return null;
    let at = 8;
    const wallet = new PublicKey(buf.subarray(at, at + 32)).toBase58();
    at += 32;
    at += 1 + (buf.readUInt8(at) === 1 ? 32 : 0); // session_authority: Option<Pubkey>
    const nameLen = Math.min(buf.readUInt32LE(at), 20);
    at += 4;
    const displayName = buf.subarray(at, at + nameLen).toString("utf8");
    at += nameLen;
    const x = buf.readUInt32LE(at); at += 4;
    const y = buf.readUInt32LE(at); at += 4;
    at += 1 + 1; // direction, outfit_id
    const score = buf.readUInt32LE(at); at += 4;
    at += 2 + 2 + 2; // swap, transfer, bounty counts
    const lastActive = Number(buf.readBigInt64LE(at));
    return { wallet, displayName, x, y, score, lastActive };
  } catch {
    return null;
  }
}

/**
 * Players delegated to the rollup — the live roster. The base copy of a
 * delegated account is frozen at spawn, so it cannot answer "who is online".
 */
export async function onlinePlayers(): Promise<{ players: OnlinePlayer[]; error?: string }> {
  try {
    const er = new Connection(ER_ENDPOINT, "confirmed");
    const accounts = await er.getProgramAccounts(CITY_PROGRAM, { commitment: "confirmed" });
    const players = accounts
      .map(({ account }) => decodePlayer(new Uint8Array(account.data)))
      .filter((p): p is OnlinePlayer => p !== null)
      .sort((a, b) => b.lastActive - a.lastActive);
    return { players };
  } catch (err) {
    return { players: [], error: (err as Error).message };
  }
}

export interface MechsStatus {
  configured: boolean;
  programId: string | null;
  deployed: boolean;
  /** Duelist accounts delegated to the rollup right now. */
  duelists: number;
  seasonOpen: boolean;
  queueOpen: boolean;
  poolOpen: boolean;
  error?: string;
}

function pda(program: PublicKey, seed: string, season: number): PublicKey {
  const id = new Uint8Array(2);
  new DataView(id.buffer).setUint16(0, season, true);
  return PublicKey.findProgramAddressSync([new TextEncoder().encode(seed), id], program)[0];
}

export async function mechsStatus(season = 1): Promise<MechsStatus> {
  if (!MECHS_PROGRAM) {
    return {
      configured: false, programId: null, deployed: false,
      duelists: 0, seasonOpen: false, queueOpen: false, poolOpen: false,
    };
  }
  const program = new PublicKey(MECHS_PROGRAM);
  const base = new Connection(HELIUS_DEVNET, "confirmed");
  try {
    const [info, season_, queue, pool] = await Promise.all([
      base.getAccountInfo(program),
      base.getAccountInfo(pda(program, "mech_season", season)),
      base.getAccountInfo(pda(program, "mech_queue", season)),
      base.getAccountInfo(pda(program, "mech_pool", season)),
    ]);
    let duelists = 0;
    try {
      const er = new Connection(ER_ENDPOINT, "confirmed");
      const accounts = await er.getProgramAccounts(program, { commitment: "confirmed" });
      duelists = accounts.filter(({ account }) => account.data.length > 200).length;
    } catch { /* the rollup may not serve getProgramAccounts; not fatal */ }
    return {
      configured: true,
      programId: MECHS_PROGRAM,
      deployed: !!info?.executable,
      duelists,
      seasonOpen: !!season_,
      queueOpen: !!queue,
      poolOpen: !!pool,
    };
  } catch (err) {
    return {
      configured: true, programId: MECHS_PROGRAM, deployed: false,
      duelists: 0, seasonOpen: false, queueOpen: false, poolOpen: false,
      error: (err as Error).message,
    };
  }
}
