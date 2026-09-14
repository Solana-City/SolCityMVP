/**
 * Sol Mechs — ranked matchmaking.
 *
 * The server assigns opponents from a live queue. A player never names, picks
 * or invites one: that property is what the ladder's integrity rests on, so it
 * is a property of this module rather than of the rating formula.
 *
 * Pairing minimises a cost per candidate pair:
 *
 *   cost = |ratingGap| + REMATCH_PENALTY * priorMeetings
 *
 * and accepts a pair only while `cost <= tolerance(waited)`, which widens with
 * time in queue. Rating proximity and opponent variety therefore trade off
 * against each other automatically: in a busy queue you face someone close to
 * your rating whom you have not met, and in a thin one the band opens until
 * something is playable.
 *
 * Pure. `rand` is injected so pairing is reproducible under test and seeded in
 * simulation; it exists so that among equally-good candidates the choice is
 * not deterministic, which would let a client predict its opponent by timing
 * its entry.
 */
import { MATCHMAKING } from "./config";

export interface Ticket {
  wallet: string;
  rating: number;
  /** Unix ms the player entered the queue. */
  enqueuedAt: number;
  /**
   * Most recent opponents, newest first, capped at
   * `MATCHMAKING.RECENT_OPPONENTS`. A bounded ring buffer rather than a full
   * history: the ticket has to carry everything the pairing needs, since a
   * program cannot read every queued player's ladder account in one
   * transaction.
   */
  recent: string[];
}

export interface Pairing {
  a: Ticket;
  b: Ticket;
  ratingGap: number;
  /** Meetings visible in the recent-opponents window. */
  priorMeetings: number;
}

export interface PairResult {
  pairs: Pairing[];
  /** Still queued — nothing acceptable was available this tick. */
  waiting: Ticket[];
}

/** Cost ceiling for a pairing, widening with time waited. */
export function tolerance(waitedMs: number): number {
  const widened = MATCHMAKING.BASE_TOLERANCE
    + (waitedMs / 1000) * MATCHMAKING.WIDEN_PER_SECOND;
  return Math.min(MATCHMAKING.MAX_TOLERANCE, widened);
}

/** Meetings between two tickets, as far back as the window reaches. */
export function recentMeetings(a: Ticket, b: Ticket): number {
  let n = 0;
  for (const w of a.recent) if (w === b.wallet) n++;
  return n;
}

function pairCost(a: Ticket, b: Ticket): number {
  return Math.abs(a.rating - b.rating)
    + MATCHMAKING.REMATCH_PENALTY * recentMeetings(a, b);
}

/**
 * Pair everyone who can be paired this tick.
 *
 * Longest-waiting first, so a player in a sparse rating band is served before
 * a newcomer in a crowded one; without that ordering the tails of the ladder
 * starve while the middle churns.
 *
 * Greedy rather than a globally optimal matching: optimal weighted matching is
 * O(n^3) and the gain does not survive the queue changing between ticks.
 */
export function pairQueue(
  tickets: Ticket[],
  now: number,
  rand: () => number = Math.random,
): PairResult {
  const byWait = [...tickets].sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  const taken = new Set<string>();
  const pairs: Pairing[] = [];

  for (const a of byWait) {
    if (taken.has(a.wallet)) continue;
    const waited = now - a.enqueuedAt;
    const limit = waited >= MATCHMAKING.MAX_WAIT_MS ? Infinity : tolerance(waited);

    let best: { t: Ticket; cost: number }[] = [];
    for (const b of byWait) {
      if (b.wallet === a.wallet || taken.has(b.wallet)) continue;
      const cost = pairCost(a, b);
      if (cost > limit) continue;
      if (best.length === 0 || cost < best[0].cost) best = [{ t: b, cost }];
      else if (cost === best[0].cost) best.push({ t: b, cost });
    }
    if (best.length === 0) continue;

    // Break ties randomly so entry timing cannot select an opponent.
    const chosen = best[Math.floor(rand() * best.length) % best.length];
    taken.add(a.wallet);
    taken.add(chosen.t.wallet);
    pairs.push({
      a,
      b: chosen.t,
      ratingGap: Math.abs(a.rating - chosen.t.rating),
      priorMeetings: recentMeetings(a, chosen.t),
    });
  }

  return { pairs, waiting: byWait.filter((t) => !taken.has(t.wallet)) };
}

/** Push an opponent onto a recent-opponents window, dropping the oldest. */
export function pushRecent(recent: string[], opponent: string): string[] {
  return [opponent, ...recent].slice(0, MATCHMAKING.RECENT_OPPONENTS);
}
