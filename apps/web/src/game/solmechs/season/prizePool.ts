/**
 * Sol Mechs — prize pool accrual and payout.
 *
 * Pool = a fixed floor plus a share of each purchase. Kept as a ledger of
 * sources rather than a running total, so the figure can be reconciled against
 * the balance of the wallet that holds the pool.
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

/** Share weights by place: `1 / rank^steepness`, normalised. */
export function payoutWeights(places: number = PRIZE.PAYOUT_PLACES, steepness: number = PRIZE.PAYOUT_STEEPNESS): number[] {
  const raw = Array.from({ length: places }, (_, i) => 1 / Math.pow(i + 1, steepness));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / sum);
}

/**
 * Split the pool into whole lamports, one entry per paying place.
 *
 * Largest-remainder, not rounding: the shares must sum to the pool exactly or
 * the final transfer overdraws (or funds are stranded). Stable under
 * recomputation.
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
 * What each placed wallet is owed. Takes standings, so eligibility is already
 * applied.
 *
 * The table is cut to the number of wallets that actually placed, not to
 * `PAYOUT_PLACES` — otherwise a thin ladder leaves most shares unassigned and
 * the payout does not sum to the pool.
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
