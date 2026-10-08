import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

import { mainnetConnection } from "@/game/solana/mainnetRpc";
import { namesFor } from "@/lib/names/nameStore";
import { DONATION_WALLET } from "@/lib/donationWallet";

export { DONATION_WALLET };

/**
 * Donations are counted in SOL, on mainnet.
 *
 * Only native SOL: a board that mixed SOL with USDC and BONK would need a
 * price feed to rank them, and a wrong price would put the wrong person on
 * top. Other tokens are still welcome at the same address, they simply do not
 * appear on the board, and the panel says so rather than letting someone
 * wonder where their name went.
 */
export interface DonorRow {
  wallet: string;
  /** Nickname when the wallet has one. */
  name: string | null;
  /** Total donated, in lamports, so the sum stays exact. */
  lamports: number;
  /** How many separate donations this wallet has made. */
  count: number;
  /** Unix ms of their most recent one. */
  last: number;
}

export interface DonationBoard {
  /** Everything ever received, in lamports. */
  totalLamports: number;
  donorCount: number;
  rows: DonorRow[];
  /** When this was read from the chain, Unix ms. */
  updatedAt: number;
  /** True when the chain could not be reached and these numbers are stale. */
  stale: boolean;
}

/** How far back the board looks. One signature is one transaction. */
const MAX_SIGNATURES = 1000;
/** getParsedTransactions takes at most 100 signatures at a time. */
const CHUNK = 100;
/** How long a reading is served before the chain is asked again. */
const TTL_MS = 5 * 60_000;

export function solFromLamports(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

let cache: DonationBoard | null = null;
let inFlight: Promise<DonationBoard> | null = null;

/**
 * The donation board, cached.
 *
 * Reading it means walking the wallet's transaction history, which is a
 * handful of RPC calls, so it is cached for five minutes and concurrent
 * callers share one read rather than each starting their own. On an RPC
 * failure the last good board is served with `stale` set, because an empty
 * board would read as "nobody has donated" and that is a different claim.
 */
export async function readDonations(limit = 10): Promise<DonationBoard> {
  const fresh = cache && Date.now() - cache.updatedAt < TTL_MS;
  if (fresh) return trim(cache!, limit);
  if (inFlight) return trim(await inFlight, limit);

  inFlight = loadFromChain()
    .then((board) => { cache = board; return board; })
    .catch(() => {
      // Keep the last good numbers rather than claiming nobody has given.
      const fallback: DonationBoard = cache
        ? { ...cache, stale: true }
        : { totalLamports: 0, donorCount: 0, rows: [], updatedAt: Date.now(), stale: true };
      return fallback;
    })
    .finally(() => { inFlight = null; });

  return trim(await inFlight, limit);
}

function trim(board: DonationBoard, limit: number): DonationBoard {
  return { ...board, rows: board.rows.slice(0, Math.min(50, Math.max(1, limit))) };
}

async function loadFromChain(): Promise<DonationBoard> {
  const connection = mainnetConnection();
  const target = new PublicKey(DONATION_WALLET);

  const signatures = await connection.getSignaturesForAddress(target, { limit: MAX_SIGNATURES });
  const confirmed = signatures.filter((s) => !s.err).map((s) => s.signature);

  const totals = new Map<string, { lamports: number; count: number; last: number }>();
  let totalLamports = 0;

  for (let i = 0; i < confirmed.length; i += CHUNK) {
    const batch = await connection.getParsedTransactions(confirmed.slice(i, i + CHUNK), {
      maxSupportedTransactionVersion: 0,
    });

    for (const tx of batch) {
      if (!tx || tx.meta?.err) continue;

      const keys = tx.transaction.message.accountKeys;
      const index = keys.findIndex((k) => k.pubkey.toBase58() === DONATION_WALLET);
      if (index < 0) continue;

      // The balance delta, not the instruction list: it catches a plain
      // transfer, a transfer bundled with other instructions, and anything a
      // wallet wraps around one, without having to recognise each shape.
      const delta = (tx.meta?.postBalances?.[index] ?? 0) - (tx.meta?.preBalances?.[index] ?? 0);
      if (delta <= 0) continue;

      // The fee payer is whoever signed and paid, which is the donor. A
      // transaction the wallet sent to itself is not a donation.
      const donor = keys[0]?.pubkey.toBase58();
      if (!donor || donor === DONATION_WALLET) continue;

      const at = (tx.blockTime ?? 0) * 1000;
      const row = totals.get(donor) ?? { lamports: 0, count: 0, last: 0 };
      row.lamports += delta;
      row.count += 1;
      row.last = Math.max(row.last, at);
      totals.set(donor, row);
      totalLamports += delta;
    }
  }

  const ranked = [...totals.entries()]
    .map(([wallet, r]) => ({ wallet, name: null as string | null, ...r }))
    .sort((a, b) => b.lamports - a.lamports || b.last - a.last);

  // Nicknames for the top of the board only: the rest are never shown, and
  // the name store is the same quota-limited one the other boards share.
  const top = ranked.slice(0, 50);
  const names = await namesFor(top.map((r) => r.wallet)).catch(() => ({} as Record<string, string>));
  for (const row of top) row.name = names[row.wallet] ?? null;

  return {
    totalLamports,
    donorCount: ranked.length,
    rows: top,
    updatedAt: Date.now(),
    stale: false,
  };
}
