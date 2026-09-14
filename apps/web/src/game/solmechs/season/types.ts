/**
 * Sol Mechs — season ladder types.
 *
 * Shaped after the `LadderEntry` PDA sketched in ONCHAIN.md so that moving
 * this on-chain later is a change of storage, not of meaning. The one
 * deliberate divergence: the PDA holds a fixed ring buffer of recent
 * opponents because account space is finite, while off-chain we can keep the
 * full meeting count per opponent — which makes repeat-pairing decay exact
 * instead of approximate.
 */

/** Which side of a resolved match a wallet was on. */
export type MatchOutcome = "win" | "loss";

export interface LadderEntry {
  wallet: string;
  rating: number;
  wins: number;
  losses: number;
  /** Opponent wallet → matches played against them THIS season. */
  meetings: Record<string, number>;
  /** Unix ms of the last ranked match, for display and tie-breaking. */
  lastMatchAt: number;
}

export function newEntry(wallet: string, rating: number): LadderEntry {
  return { wallet, rating, wins: 0, losses: 0, meetings: {}, lastMatchAt: 0 };
}

export function matchesPlayed(e: LadderEntry): number {
  return e.wins + e.losses;
}

export function distinctOpponents(e: LadderEntry): number {
  return Object.keys(e.meetings).length;
}

/**
 * One settled ranked match.
 *
 * `actions` is kept because it is what makes the result checkable: two builds
 * plus an ordered action list determine exactly one winner, so the server —
 * and later a program — can re-run `replay()` rather than trust the client.
 */
export interface RankedMatch {
  id: string;
  season: number;
  winner: string;
  loser: string;
  /** Unix ms when the match settled. */
  settledAt: number;
  /** Ratings before the update, for auditability. */
  winnerRatingBefore: number;
  loserRatingBefore: number;
  winnerRatingAfter: number;
  loserRatingAfter: number;
  /** How much this match counted, after repeat-pairing decay. */
  weight: number;
}

/** A wallet's standing once the season is scored. */
export interface Standing {
  wallet: string;
  rating: number;
  wins: number;
  losses: number;
  distinctOpponents: number;
  /** 1-based. `null` when the entry is not eligible for a paying place. */
  place: number | null;
  /** Why it is not placeable, for the UI to explain rather than just hide. */
  ineligibleReason: "matches" | "opponents" | null;
}
