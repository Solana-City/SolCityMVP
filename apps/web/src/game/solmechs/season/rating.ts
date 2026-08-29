/**
 * Sol Mechs — season rating.
 *
 * Standard Elo plus a decay on repeated pairings: a win over a much weaker
 * account is worth nearly nothing, and the same pairing is worth
 * exponentially less each time it recurs.
 *
 * Pure — no clock, storage or network — so a verifier can reproduce it
 * exactly. Same constraint as BattleEngine.
 */
import { RATING, ELIGIBILITY } from "./config";
import {
  type LadderEntry, type Standing, matchesPlayed, distinctOpponents,
} from "./types";

/**
 * Probability `a` beats `b` under Elo's logistic curve.
 *
 * The 400 is Elo's own scale constant, not a tunable: it defines what a rating
 * point MEANS (a 400-point gap is 10:1 odds). Changing it would silently
 * rescale every other constant in `RATING`.
 */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/** How hard a single result moves this player. */
export function kFactor(entry: LadderEntry): number {
  if (matchesPlayed(entry) < RATING.PROVISIONAL_MATCHES) return RATING.K_PROVISIONAL;
  if (entry.rating >= RATING.K_TIGHTEN_ABOVE) return RATING.K_TIGHT;
  return RATING.K_ESTABLISHED;
}

/**
 * Multiplier for the Nth meeting between the same two accounts this season:
 * full value for the first `repeatPairingFree`, then halving every
 * `repeatPairingHalfLife`.
 */
export function repeatPairingWeight(priorMeetings: number): number {
  const over = priorMeetings - RATING.repeatPairingFree;
  if (over <= 0) return 1;
  const w = Math.pow(0.5, over / RATING.repeatPairingHalfLife);
  return Math.max(RATING.repeatPairingFloor, w);
}

export interface RatingUpdate {
  winnerRating: number;
  loserRating: number;
  /** The repeat-pairing multiplier that was applied. */
  weight: number;
  /** Rating the winner banked, after repeat-pairing decay. */
  winnerGain: number;
}

/**
 * Score one match and return both new ratings.
 *
 * Both sides are computed against the PRE-match ratings, so the result does
 * not depend on which player is updated first. Sequential updates would make
 * the pair's rating sum drift and hand a tiny edge to whoever the server
 * happened to process second.
 */
export function rateMatch(winner: LadderEntry, loser: LadderEntry): RatingUpdate {
  const priorMeetings = winner.meetings[loser.wallet] ?? 0;
  const weight = repeatPairingWeight(priorMeetings);

  const expectedWinner = expectedScore(winner.rating, loser.rating);
  const expectedLoser = 1 - expectedWinner;

  const winnerGain = kFactor(winner) * weight * (1 - expectedWinner);
  const loserDelta = kFactor(loser) * weight * (0 - expectedLoser);

  return {
    winnerRating: Math.max(RATING.FLOOR, Math.round(winner.rating + winnerGain)),
    loserRating: Math.max(RATING.FLOOR, Math.round(loser.rating + loserDelta)),
    weight,
    winnerGain,
  };
}

/**
 * Apply a result to both entries, returning new ones.
 *
 * Immutable so a caller can compute a projected standing ("what happens if I
 * win this?") without touching stored state.
 */
export function applyMatch(
  winner: LadderEntry,
  loser: LadderEntry,
  settledAt: number,
): { winner: LadderEntry; loser: LadderEntry; update: RatingUpdate } {
  const update = rateMatch(winner, loser);
  return {
    winner: {
      ...winner,
      rating: update.winnerRating,
      wins: winner.wins + 1,
      meetings: { ...winner.meetings, [loser.wallet]: (winner.meetings[loser.wallet] ?? 0) + 1 },
      lastMatchAt: settledAt,
    },
    loser: {
      ...loser,
      rating: update.loserRating,
      losses: loser.losses + 1,
      meetings: { ...loser.meetings, [winner.wallet]: (loser.meetings[winner.wallet] ?? 0) + 1 },
      lastMatchAt: settledAt,
    },
    update,
  };
}

/** Why this entry cannot hold a paying place, or null if it can. */
export function ineligibleReason(e: LadderEntry): Standing["ineligibleReason"] {
  if (matchesPlayed(e) < ELIGIBILITY.MIN_MATCHES) return "matches";
  if (distinctOpponents(e) < ELIGIBILITY.MIN_DISTINCT_OPPONENTS) return "opponents";
  return null;
}

/**
 * Final standings. Everyone is listed; only eligible entries get a `place`,
 * and places are numbered over eligible entries alone.
 *
 * Ties break on fewer matches, then earlier last match, then wallet: the order
 * must be total and reproducible, since a payout reads it.
 */
export function standings(entries: LadderEntry[]): Standing[] {
  const sorted = [...entries].sort((a, b) =>
    b.rating - a.rating
    || matchesPlayed(a) - matchesPlayed(b)
    || a.lastMatchAt - b.lastMatchAt
    || (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));

  let place = 0;
  return sorted.map((e) => {
    const reason = ineligibleReason(e);
    return {
      wallet: e.wallet,
      rating: e.rating,
      wins: e.wins,
      losses: e.losses,
      distinctOpponents: distinctOpponents(e),
      place: reason === null ? ++place : null,
      ineligibleReason: reason,
    };
  });
}

/** Rating carried into the next season. See RATING.SOFT_RESET. */
export function softReset(rating: number): number {
  return Math.round(RATING.START + (rating - RATING.START) * RATING.SOFT_RESET);
}
