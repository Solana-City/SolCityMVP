/**
 * Sol Mechs — season economy constants.
 *
 * One block, for the same reason `BALANCE` in BattleEngine.ts is one block:
 * ONCHAIN.md warns that a client/verifier disagreement about these values
 * "does not fail loudly — it produces a verifier that rejects honest results".
 * Every rating, energy and payout number the product depends on lives here.
 *
 * Money is in **lamports** throughout. Floats and SOL-denominated decimals are
 * for display only; anything that decides a payout stays integral.
 */

export const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * SOL/USD used ONLY to size USD-denominated budgets into SOL constants.
 *
 * A written-down assumption rather than a live oracle: nothing here needs a
 * price at runtime, and a stale guess buried in a `* 20` is far worse than a
 * stated one. **Set this to the real rate before the sale** — every USD figure
 * below scales off it, and getting it wrong misprices the prize floor by the
 * same ratio.
 */
export const ASSUMED_SOL_USD = 165;

/** 0.1 SOL — the Genesis pass price. */
export const PASS_PRICE_LAMPORTS = LAMPORTS_PER_SOL / 10;

export const SUPPLY = {
  /** Hard ceiling. Anything unsold is never minted, then burned for the record. */
  TOTAL: 1_111,
  /** Offered publicly. */
  PUBLIC: 1_000,
  /** Team, streamers, partners, future actions. Disclosed before the sale. */
  RESERVED: 111,
  /**
   * Per-WALLET mint cap.
   *
   * Not a per-person cap — a person can hold many wallets, and pretending
   * otherwise is how ladders get farmed. The real defence against multi-wallet
   * play is the MATCHMAKER — opponents must not be choosable — backed by
   * `repeatPairingHalfLife` making a repeated pairing worth almost nothing.
   * This cap only stops one buyer sweeping the public tranche in a single
   * transaction and starving the player count the alpha needs.
   */
  PER_WALLET: 10,
} as const;

export const ENERGY = {
  /** Matches granted free each day. */
  DAILY_FREE: 5,
  /** Ceiling on banked energy, so skipping days doesn't compound into a burst. */
  MAX_BANKED: 10,
  /** Energy spent to enter one ranked match. */
  COST_PER_MATCH: 1,
  /** What one purchasable pack grants. */
  PACK_SIZE: 5,
  PACK_PRICE_LAMPORTS: LAMPORTS_PER_SOL / 100, // 0.01 SOL
  /**
   * Packs buyable per day, per wallet.
   *
   * This is the single constant that keeps the ladder from becoming an
   * auction. Without it, rank is a function of spend and the prize pool is
   * something you buy a share of rather than win.
   */
  PACKS_PER_DAY: 1,
} as const;

export const RATING = {
  /** Everyone starts here. */
  START: 1_000,
  /**
   * K-factor while a player is still being placed. High K means a new account
   * converges on its real strength in a handful of matches instead of a
   * hundred — which matters when a season is short and someone who buys on
   * day 20 still needs a real shot at climbing.
   */
  K_PROVISIONAL: 48,
  /** Matches before a player leaves provisional. */
  PROVISIONAL_MATCHES: 10,
  K_ESTABLISHED: 24,
  /** Above this rating K tightens again, so the top of the ladder is stable. */
  K_TIGHTEN_ABOVE: 1_600,
  K_TIGHT: 12,
  /** Ratings never go below this, so a bad run can't bury an account forever. */
  FLOOR: 100,
  /**
   * Halving distance for repeated pairings, in matches.
   *
   * The Nth meeting between the same two accounts in a season is worth
   * `0.5 ^ ((N - free) / halfLife)` of normal. This is the anti-collusion
   * mechanism ONCHAIN.md calls for: two wallets trading wins hit steep
   * diminishing returns without anyone having to detect intent.
   */
  repeatPairingFree: 2,
  repeatPairingHalfLife: 2,
  /** Never fully zero — a legitimate rematch in a small pool still counts. */
  repeatPairingFloor: 0.05,
  //
  // A per-opponent CEILING on rating gain was tried here and removed: see the
  // conclusion in simulate.ts. It made collusion easier, not harder, because a
  // farmer buys fresh wallets with full headroom while an honest player faces
  // the same pool repeatedly and hits the cap. Measured: 10 feeders reached
  // 1st with the ceiling, 3rd without it, and honest skill correlation fell
  // from 0.79 to 0.76.
  //
  /**
   * Carried into the next season as `START + (final - START) * SOFT_RESET`.
   * A full wipe makes every season's opening week noise; carrying everything
   * makes a new player's climb hopeless.
   */
  SOFT_RESET: 0.5,
} as const;

export const ELIGIBILITY = {
  /**
   * Matches required before an account can hold a paying place.
   *
   * Deliberately NOT a "must play in the final week" rule. A dynamic ladder
   * corrects camping on its own — a frozen rating is passed by anyone still
   * climbing — and an activity window would punish a player who earned their
   * place and then went away for a week.
   */
  MIN_MATCHES: 20,
  /**
   * Distinct opponents required. This is the collusion floor: a ring of three
   * wallets farming each other cannot reach it without playing the field.
   */
  MIN_DISTINCT_OPPONENTS: 10,
} as const;

export const PRIZE = {
  /**
   * The floor the project commits to regardless of sales.
   *
   * Must be coverable in the WORST sales case, not the expected one — at a
   * 300-pass season most of the floor comes out of treasury rather than
   * revenue, so this is a marketing spend and is meant to be sized like one.
   *
   * Derived from a USD figure through an EXPLICIT price assumption rather
   * than hardcoded, because the two are decided by different people for
   * different reasons: the budget is a treasury decision, the SOL amount is
   * whatever that buys on the day. Announce the SOL number, not the dollar
   * one — the pool is held and paid in SOL, and promising a dollar figure
   * would leave the project owing the difference if SOL falls during the
   * season.
   */
  GUARANTEED_USD: 500,
  GUARANTEED_LAMPORTS: Math.round((500 / ASSUMED_SOL_USD) * LAMPORTS_PER_SOL),
  /**
   * Share of every Sol Mechs purchase that sweeps into the pool.
   *
   * Kept apart per source because "a % of all purchases" reads broadly to a
   * buyer and the scope has to be exact before it is announced. Secondary
   * royalties are deliberately NOT included: committing the long-term revenue
   * line to a single season's pool is a decision to take explicitly, not by
   * letting a loose phrase decide it.
   */
  POOL_SHARE_OF_PASS_SALE: 0.30,
  POOL_SHARE_OF_ENERGY: 0.30,
  POOL_SHARE_OF_ROYALTIES: 0,
  /** Places that pay. */
  PAYOUT_PLACES: 50,
  /**
   * Steepness of the payout curve: share of place `r` ∝ `1 / r^steepness`.
   *
   * This is the anti-camping lever, and it is free. A flat curve makes holding
   * 3rd nearly as good as taking 1st, so the rational play is to stop
   * competing; a steep one makes the top place worth risking rating for. It
   * replaces the activity requirement rather than sitting beside it.
   */
  PAYOUT_STEEPNESS: 1.3,
} as const;

/** A season's fixed parameters. Dates are unix ms. */
export interface SeasonConfig {
  id: number;
  name: string;
  startsAt: number;
  /** Rank at this instant is what pays. */
  endsAt: number;
}
