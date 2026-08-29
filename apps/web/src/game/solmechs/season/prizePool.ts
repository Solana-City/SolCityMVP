/**
 * Sol Mechs — prize pool accrual and payout.
 *
 * The pool is a guaranteed floor plus a share of every Sol Mechs purchase, so
 * it grows as the competition does. Two properties matter more than the
 * arithmetic:
 *
 * **It must be publishable.** A pool that grows with sales is the best
 * conversion tool this design has, but only if the number is verifiable — a
 * public wallet anyone can check, not a figure in a database. `accrue` is
 * therefore written as a ledger of sources rather than a running total, so
 * what the page claims can always be reconciled against what the wallet holds.
 *
 * **The payout curve is the anti-camping lever.** Rank at season close is what
 * pays, which normally rewards climbing early and then refusing to play. We
 * deliberately have no minimum-activity rule — a dynamic ladder passes a
 * frozen rating on its own, and an activity window would punish a player who
 * earned their place and then had a life. A STEEP curve does the same job for
 * free: when 1st is worth much more than 3rd, sitting on 3rd is irrational.
 */
import { PRIZE } from "./config";

export type PurchaseSource = "pass" | "energy" | "royalty";

export interface Purchase {
  source: PurchaseSource;
  lamports: number;
  at: number;
  /** Buyer, for auditing the ledger against on-chain transfers. */
  wallet?: string;
}

const SHARE: Record<PurchaseSource, number> = {
  pass: PRIZE.POOL_SHARE_OF_PASS_SALE,
  energy: PRIZE.POOL_SHARE_OF_ENERGY,
  royalty: PRIZE.POOL_SHARE_OF_ROYALTIES,
};

/** Lamports one purchase contributes. Floored — never over-promise the pool. */
export function contribution(p: Purchase): number {
  return Math.floor(p.lamports * SHARE[p.source]);
}

export interface PoolBreakdown {
  guaranteed: number;
  fromPasses: number;
  fromEnergy: number;
  fromRoyalties: number;
  total: number;
}

export function poolBreakdown(purchases: Purchase[]): PoolBreakdown {
  let fromPasses = 0, fromEnergy = 0, fromRoyalties = 0;
  for (const p of purchases) {
    const c = contribution(p);
    if (p.source === "pass") fromPasses += c;
    else if (p.source === "energy") fromEnergy += c;
    else fromRoyalties += c;
  }
  const guaranteed = PRIZE.GUARANTEED_LAMPORTS;
  return {
    guaranteed,
    fromPasses,
    fromEnergy,
    fromRoyalties,
    total: guaranteed + fromPasses + fromEnergy + fromRoyalties,
  };
}

/**
 * Share weights by place: `1 / rank^steepness`, normalised.
 *
 * Exposed on its own so the curve can be shown to buyers before the season —
 * "what does 7th pay?" is a question the sale page should answer, and the
 * answer has to come from the same function that pays out.
 */
export function payoutWeights(places: number = PRIZE.PAYOUT_PLACES, steepness: number = PRIZE.PAYOUT_STEEPNESS): number[] {
  const raw = Array.from({ length: places }, (_, i) => 1 / Math.pow(i + 1, steepness));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / sum);
}

/**
 * Split the pool into whole lamports, one entry per paying place.
 *
 * Largest-remainder rather than plain rounding, because the shares MUST sum to
 * the pool exactly: paying out more than was collected fails at the last
 * transfer, and paying out less silently strands funds. The leftover from
 * flooring is handed to the places with the largest fractional part, which is
 * both the standard apportionment method and stable under recomputation.
 */
export function payoutTable(poolLamports: number, places: number = PRIZE.PAYOUT_PLACES): number[] {
  if (poolLamports <= 0 || places <= 0) return [];
  const weights = payoutWeights(places);

  const exact = weights.map((w) => poolLamports * w);
  const floors = exact.map(Math.floor);
  let remainder = poolLamports - floors.reduce((a, b) => a + b, 0);

  const byFraction = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const out = [...floors];
  for (let k = 0; remainder > 0; k++, remainder--) out[byFraction[k % places].i] += 1;
  return out;
}

/**
 * What each placed wallet is owed.
 *
 * Takes standings rather than raw entries so eligibility has already been
 * applied — an account short of the distinct-opponent floor must not consume
 * a paying place.
 *
 * The table is cut to the number of wallets that ACTUALLY placed, not to
 * `PAYOUT_PLACES`. Splitting a pool 50 ways when only four players cleared the
 * eligibility floor would strand the other 46 shares: the season would end
 * with most of the prize money unpaid and unaccounted for. Scaling the curve
 * to the real field keeps the payout summing to the pool no matter how thin
 * the ladder turns out to be.
 */
export function payouts(
  placed: Array<{ wallet: string; place: number }>,
  poolLamports: number,
): Array<{ wallet: string; place: number; lamports: number }> {
  const ranked = placed
    .filter((p) => p.place >= 1)
    .sort((a, b) => a.place - b.place)
    .slice(0, PRIZE.PAYOUT_PLACES);
  if (ranked.length === 0) return [];

  const table = payoutTable(poolLamports, ranked.length);
  return ranked.map((p, i) => ({ wallet: p.wallet, place: p.place, lamports: table[i] }));
}
