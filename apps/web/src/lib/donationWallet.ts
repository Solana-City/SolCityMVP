/**
 * The project team's donation wallet, and nothing else.
 *
 * Its own module because both sides need it: the panel in the browser shows
 * the address, and lib/donations reads the chain for it on the server. That
 * module pulls in the name store, which is server-only, so the client cannot
 * import it, and a second copy of an address money is sent to is the kind of
 * duplication that goes wrong quietly.
 *
 * Money sent here is a donation to the people building the city. It buys
 * nothing: no item, no outfit, no advantage, no entitlement. Nothing in the
 * game may read this balance and hand anything back, or it stops being a
 * donation and becomes a sale, with everything that follows from that.
 */
export const DONATION_WALLET = "FSej8rHNsJhDBqJ7Ugi5uqmzFcw4fyXGBAvPW97vUExm";

export const LAMPORTS_PER_SOL = 1_000_000_000;

/** A lamport total as a short SOL string for a board row. */
export function formatSol(lamports: number): string {
  const amount = lamports / LAMPORTS_PER_SOL;
  if (amount === 0) return "0";
  // Below a thousandth there is nothing readable left to show, and rounding
  // it to "0.000" would read as nothing given at all.
  if (amount < 0.001) return "<0.001";
  return amount.toFixed(amount < 1 ? 3 : 2);
}

/** A wallet as it appears on the board when it has no nickname. */
export function shortWallet(wallet: string): string {
  return `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
}
