/**
 * Sol Mechs — season economy constants.
 *
 * One block, like `BALANCE` in BattleEngine.ts: any server or program that
 * scores matches must be built against these exact values. A mismatch fails
 * silently, by rejecting honest results rather than erroring.
 *
 * Money is in lamports. SOL-denominated decimals are for display only.
 */

export const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * SOL/USD, used only to convert USD budget figures into the SOL constants
 * below. Never read at runtime. Set to the real rate before launch.
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
  /** Per-wallet mint cap. Not a per-person cap — wallets are free to create. */
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
  /** Packs buyable per day, per wallet. Bounds paid matches per day. */
  PACKS_PER_DAY: 1,
} as const;

export const RATING = {
  /** Everyone starts here. */
  START: 1_000,
  /** K while placing. High, so a new account converges within ~10 matches. */
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
   * The Nth meeting between the same two accounts is worth
   * `0.5 ^ ((N - free) / halfLife)` of normal.
   */
  repeatPairingFree: 2,
  repeatPairingHalfLife: 2,
  /** Never fully zero — a legitimate rematch in a small pool still counts. */
  repeatPairingFloor: 0.05,
  // A per-opponent ceiling on rating gain was tried and reverted: it binds on
  // accounts that face the same pool repeatedly, and dropped rank/skill
  // correlation from 0.79 to 0.76. Re-measure before re-adding.
  /** Carried forward as `START + (final - START) * SOFT_RESET`. */
  SOFT_RESET: 0.5,
} as const;

export const ELIGIBILITY = {
  /** Matches required before an account can hold a paying place. */
  MIN_MATCHES: 20,
  /** Distinct opponents required, so a small ring cannot qualify. */
  MIN_DISTINCT_OPPONENTS: 10,
} as const;

export const PRIZE = {
  /** Pool floor, independent of sales. Sized in USD; held and paid in SOL. */
  GUARANTEED_USD: 500,
  GUARANTEED_LAMPORTS: Math.round((500 / ASSUMED_SOL_USD) * LAMPORTS_PER_SOL),
  /** Share of each purchase swept into the pool, kept separate per source. */
  POOL_SHARE_OF_PASS_SALE: 0.30,
  POOL_SHARE_OF_ENERGY: 0.30,
  POOL_SHARE_OF_ROYALTIES: 0,
  /** Places that pay. */
  PAYOUT_PLACES: 50,
  /** Payout curve: the share of place `r` is proportional to `1 / r^steepness`. */
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
