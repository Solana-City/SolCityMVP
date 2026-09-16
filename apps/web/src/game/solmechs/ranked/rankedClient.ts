/**
 * Sol Mechs — the ranked season, client side.
 *
 * Everything here talks to the BASE layer: the season, the player's ladder
 * entry (rating + energy), the matchmaking queue and the match room. Only the
 * battle itself runs on the rollup (see pvp/chain/ChainTransport), so a ranked
 * match is two halves:
 *
 *   base   join the queue, get paired into a room, report the result
 *   rollup play the battle that the room authorises
 *
 * Pairing mirrors `pair_from_queue` in the program: the client proposes the
 * cheapest opponent it can see, and the program recomputes that cost and
 * rejects anything that is not the best pairing available. So this module can
 * only ever ask for what the rules already allow — it cannot pick a friend.
 */
import {
  ComputeBudgetProgram, Connection, PublicKey, Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { BASE_RPC_PRIMARY, resilientBaseFetch } from "@/game/solana/baseRpc";
import { SEASON_ID, SOLMECHS_PROGRAM_ID, isPvpChainConfigured } from "../pvp/chain/config";
import * as P from "../pvp/chain/mechProgram";
import { sleep } from "../pvp/types";
import { MATCHMAKING, RATING } from "../season/config";
import { tolerance } from "../season/matchmaking";

export type SignTransaction = (tx: Transaction) => Promise<Transaction>;

const POLL_MS = 2_000;
/** Energy the client shows before the program has rolled the daily grant. */
const DAY_SECONDS = 86_400;

export interface RankedSnapshot {
  season: P.SeasonAccount | null;
  entry: P.LadderEntryAccount | null;
  /** Energy after the daily grant the next write will apply. */
  energy: number;
  /** Seconds until the season closes, or null when there is no season. */
  endsIn: number | null;
}

export interface PairedRoom {
  roomId: bigint;
  opponent: PublicKey;
}

/** Ranked is unavailable until the program is deployed and a season is open. */
export class RankedUnavailable extends Error {}

export class RankedClient {
  private readonly program: PublicKey;
  private readonly base: Connection;

  constructor(
    private readonly wallet: PublicKey,
    private readonly signTransaction: SignTransaction,
    private readonly season = SEASON_ID,
  ) {
    if (!isPvpChainConfigured() || !SOLMECHS_PROGRAM_ID) {
      throw new RankedUnavailable("Ranked needs the Sol Mechs program. It is not configured yet.");
    }
    this.program = SOLMECHS_PROGRAM_ID;
    this.base = new Connection(BASE_RPC_PRIMARY, {
      commitment: "confirmed",
      fetch: resilientBaseFetch as unknown as typeof fetch,
    });
  }

  // ── Reads ───────────────────────────────────────────────────────────────

  async load(): Promise<RankedSnapshot> {
    const [season, entry] = await Promise.all([this.readSeason(), this.readEntry()]);
    return {
      season,
      entry,
      energy: entry ? effectiveEnergy(entry) : 0,
      endsIn: season ? season.endsAt - Math.floor(Date.now() / 1000) : null,
    };
  }

  async readSeason(): Promise<P.SeasonAccount | null> {
    return this.read(P.seasonPda(this.program, this.season), P.decodeSeason);
  }

  async readEntry(wallet: PublicKey = this.wallet): Promise<P.LadderEntryAccount | null> {
    return this.read(P.entryPda(this.program, this.season, wallet), P.decodeLadderEntry);
  }

  async readQueue(): Promise<P.MatchQueueAccount | null> {
    return this.read(P.queuePda(this.program, this.season), P.decodeMatchQueue);
  }

  async readRoom(roomId: bigint): Promise<P.MatchRoomAccount | null> {
    return this.read(P.roomPda(this.program, this.season, roomId), P.decodeMatchRoom);
  }

  /**
   * Every entry in this season, best rating first. One `getProgramAccounts`
   * filtered by account size and season, so the whole ladder arrives in a
   * single request.
   */
  async leaderboard(limit = 50): Promise<P.LadderEntryAccount[]> {
    const seasonBytes = new Uint8Array(2);
    new DataView(seasonBytes.buffer).setUint16(0, this.season, true);
    const accounts = await this.base.getProgramAccounts(this.program, {
      filters: [
        { dataSize: 620 },
        { memcmp: { offset: 40, bytes: base58(seasonBytes) } },
      ],
    });
    return accounts
      .map((a) => P.decodeLadderEntry(new Uint8Array(a.account.data)))
      .filter((e): e is P.LadderEntryAccount => e !== null)
      .sort((a, b) => b.rating - a.rating || a.wins + a.losses - (b.wins + b.losses))
      .slice(0, limit);
  }

  // ── Writes ──────────────────────────────────────────────────────────────

  /** Creates the ladder entry on first ranked play. One wallet approval. */
  async ensureEntry(): Promise<P.LadderEntryAccount> {
    const existing = await this.readEntry();
    if (existing) return existing;
    const season = await this.readSeason();
    if (!season) throw new RankedUnavailable("No ranked season is open yet.");
    await this.send([P.initLadderEntryIx(this.program, this.season, this.wallet)]);
    const entry = await this.pollUntil(
      () => this.readEntry(),
      () => true,
      20_000,
      "Your ladder entry did not appear. Try again in a moment.",
    );
    return entry;
  }

  async joinQueue(): Promise<void> {
    await this.send([P.joinQueueIx(this.program, this.season, this.wallet)]);
  }

  async cancelQueue(): Promise<void> {
    await this.send([P.cancelQueueIx(this.program, this.season, this.wallet)]).catch(() => undefined);
  }

  async buyEnergy(): Promise<void> {
    const season = await this.readSeason();
    if (!season) throw new RankedUnavailable("No ranked season is open yet.");
    await this.send([P.buyEnergyPackIx(this.program, this.season, this.wallet, season.treasury)]);
  }

  async reportResult(roomId: bigint, opponent: PublicKey, won: boolean): Promise<void> {
    await this.send([
      P.reportResultIx(this.program, this.season, this.wallet, opponent, roomId, won),
    ]);
  }

  /** After the timeout, take the result when the opponent never reported. */
  async forceSettle(roomId: bigint, opponent: PublicKey): Promise<void> {
    await this.send([
      P.forceSettleIx(this.program, this.season, this.wallet, opponent, roomId),
    ]);
  }

  // ── Matchmaking ─────────────────────────────────────────────────────────

  /**
   * Waits in the queue until paired.
   *
   * Two ways a match starts: the other player pairs with us (our entry gains a
   * room), or we find an acceptable candidate and pair with them. The cost
   * rule and the widening tolerance are the same ones the program enforces, so
   * a proposal the rules would reject is never sent.
   */
  async waitForPairing(
    signal: AbortSignal,
    onStatus?: (detail: string) => void,
  ): Promise<PairedRoom> {
    const startedAt = Date.now();
    for (;;) {
      if (signal.aborted) throw new Error("Aborted");

      const entry = await this.readEntry();
      if (entry && entry.roomId !== BigInt(0) && entry.opponent) {
        return { roomId: entry.roomId, opponent: entry.opponent };
      }

      const [queue, season] = await Promise.all([this.readQueue(), this.readSeason()]);
      if (queue && season && entry) {
        const mine = queue.tickets.find((t) => t.authority.equals(this.wallet));
        const others = queue.tickets.filter((t) => !t.authority.equals(this.wallet));
        onStatus?.(others.length === 0
          ? "Waiting for another pilot to queue"
          : `${others.length} pilot${others.length === 1 ? "" : "s"} in the queue`);

        const best = bestCandidate(entry, others);
        if (best && mine) {
          const waitedMs = Math.max(Date.now() - mine.enqueuedAt * 1000, Date.now() - best.ticket.enqueuedAt * 1000);
          const limit = waitedMs >= MATCHMAKING.MAX_WAIT_MS ? Infinity : tolerance(waitedMs);
          if (best.cost <= limit) {
            try {
              await this.send([
                P.pairFromQueueIx(
                  this.program, this.season, this.wallet, best.ticket.authority, season.nextRoomId,
                ),
              ]);
              return { roomId: season.nextRoomId, opponent: best.ticket.authority };
            } catch {
              // Someone paired first, or the room id moved on. The next loop
              // either finds us already in a room or tries again.
            }
          }
        }
      }

      const waited = Math.floor((Date.now() - startedAt) / 1000);
      if (!onStatus && waited > 0) { /* status is optional */ }
      await sleep(POLL_MS, signal);
    }
  }

  // ── Plumbing ────────────────────────────────────────────────────────────

  private async read<T>(pda: PublicKey, decode: (raw: Uint8Array) => T | null): Promise<T | null> {
    const info = await this.base.getAccountInfo(pda);
    if (!info || !info.owner.equals(this.program)) return null;
    return decode(new Uint8Array(info.data));
  }

  private async pollUntil<T>(
    read: () => Promise<T | null>,
    done: (value: T) => boolean,
    timeoutMs: number,
    failure: string,
  ): Promise<T> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const value = await read().catch(() => null);
      if (value !== null && done(value)) return value;
      if (Date.now() > until) throw new Error(failure);
      await sleep(POLL_MS);
    }
  }

  private async send(ixs: TransactionInstruction[]): Promise<string> {
    const { blockhash, lastValidBlockHeight } = await this.base.getLatestBlockhash();
    const tx = new Transaction({ feePayer: this.wallet, recentBlockhash: blockhash })
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs);
    const signed = await this.signTransaction(tx);
    const sig = await this.base.sendRawTransaction(signed.serialize(), { skipPreflight: false });
    const result = await this.base.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      "confirmed",
    );
    if (result.value.err) throw new Error(`Transaction failed: ${JSON.stringify(result.value.err)}`);
    return sig;
  }
}

// ── Pure helpers (shared with the UI) ──────────────────────────────────────

/** Energy including the daily grant the next write will credit. */
export function effectiveEnergy(entry: P.LadderEntryAccount): number {
  const today = Math.floor(Date.now() / 1000 / DAY_SECONDS);
  if (today === entry.energyDay) return entry.energy;
  return Math.min(entry.energy + 5, 10);
}

function bestCandidate(
  entry: P.LadderEntryAccount,
  tickets: P.QueueTicket[],
): { ticket: P.QueueTicket; cost: number } | null {
  let best: { ticket: P.QueueTicket; cost: number } | null = null;
  for (const t of tickets) {
    const meetings = entry.recent.filter((r) => r.equals(t.authority)).length;
    const cost = Math.abs(entry.rating - t.rating) + MATCHMAKING.REMATCH_PENALTY * meetings;
    if (!best || cost < best.cost) best = { ticket: t, cost };
  }
  return best;
}

/** Rating tiers, for the badge and the leaderboard. */
export const TIERS = [
  { name: "Scrap", min: 0 },
  { name: "Iron", min: 900 },
  { name: "Steel", min: 1100 },
  { name: "Plasma", min: 1300 },
  { name: "Solar", min: 1500 },
  { name: "Singularity", min: 1700 },
] as const;

export function tierOf(rating: number): { name: string; min: number; next: number | null } {
  let index = 0;
  for (let i = 0; i < TIERS.length; i++) if (rating >= TIERS[i].min) index = i;
  return {
    name: TIERS[index].name,
    min: TIERS[index].min,
    next: index + 1 < TIERS.length ? TIERS[index + 1].min : null,
  };
}

/**
 * What a win and a loss would be worth against this opponent.
 *
 * A preview only: the program computes the real numbers, and its table-based
 * Elo can differ by a point. Shown so the queue is not a black box.
 */
export function ratingPreview(
  myRating: number,
  myMatches: number,
  opponentRating: number,
): { win: number; loss: number } {
  const expected = 1 / (1 + Math.pow(10, (opponentRating - myRating) / 400));
  const k = myMatches < RATING.PROVISIONAL_MATCHES
    ? RATING.K_PROVISIONAL
    : myRating >= RATING.K_TIGHTEN_ABOVE ? RATING.K_TIGHT : RATING.K_ESTABLISHED;
  return {
    win: Math.round(k * (1 - expected)),
    loss: -Math.round(k * expected),
  };
}

function base58(bytes: Uint8Array): string {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const BASE = BigInt(58);
  let value = BigInt(0);
  for (const b of bytes) value = value * BigInt(256) + BigInt(b);
  let out = "";
  while (value > BigInt(0)) {
    out = ALPHABET[Number(value % BASE)] + out;
    value /= BASE;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out || "1";
}
