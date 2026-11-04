import { clusterKey } from "./clusterStorage";

/**
 * The wallet playing right now, for the stores that cache a player's things
 * in this browser.
 *
 * Those caches used to be one slot per browser, so a second wallet on the
 * same browser (testers keep several wallets on one seed phrase) inherited
 * the first one's mechs, buffs, best scores and position. Owner rule,
 * 2026-11-05: nothing of one account carries into another. The source of
 * truth for a player is the chain; what stays in the browser is keyed by
 * wallet through clusterKeyForWallet.
 */
let current: string | null = null;
const listeners = new Set<() => void>();

/** Set by CityScene on every login. Listeners reload their per-wallet state. */
export function setCurrentWallet(wallet: string | null): void {
  if (wallet === current) return;
  current = wallet;
  for (const fn of listeners) fn();
}

export function currentWallet(): string | null {
  return current;
}

export function onCurrentWalletChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * The cluster-namespaced key for `base`, for the wallet playing now. With no
 * wallet yet, the bare key: a guest's own slot, which no wallet ever reads.
 */
export function clusterKeyForWallet(base: string): string {
  return clusterKey(current ? `${base}:${current}` : `${base}:guest`);
}
