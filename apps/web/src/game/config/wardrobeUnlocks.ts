import { LayerCategory, LayerVariant, isFreeItem, getBoosterPool } from "./paperDoll";
import { progressionBus } from "@/game/progression/progressionBus";
import { decodeUnlockState, unlockedIndices, BOOSTER_ONCHAIN } from "@/game/solana/program";

/**
 * Per-wallet unlock registry for paper-doll wardrobe items.
 *
 * A `LayerVariant` marked `locked` isn't equippable until its `category:id`
 * key is in the wallet's unlocked set. Sources that grant unlocks — quests,
 * NPC interactions, and (later) VRF boosters — all call `unlockItem`, so the
 * wardrobe gating is source-agnostic.
 *
 * Storage is localStorage keyed by wallet for now (mirrors QuestManager); the
 * `get*`/`isVariantUnlocked` readers are the seam to swap for an on-chain read
 * once unlocks live on the program.
 */

function storageKey(wallet: string): string {
  return `solcity:unlocks:${wallet}`;
}

export function unlockKeyOf(category: LayerCategory, id: string): string {
  return `${category}:${id}`;
}

export function getUnlockedSet(wallet: string | null): Set<string> {
  if (!wallet || typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(storageKey(wallet));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/**
 * True if the variant is free (starter/identity — see `isFreeItem`) or the
 * wallet has already unlocked it. A guest (no wallet) can equip only free items.
 */
export function isVariantUnlocked(
  wallet: string | null,
  category: LayerCategory,
  variant: LayerVariant,
): boolean {
  if (isFreeItem(category, variant.id)) return true;
  if (!wallet) return false;
  const key = unlockKeyOf(category, variant.id);
  // localStorage — quest/NPC grants (and the preview's client-side booster).
  if (getUnlockedSet(wallet).has(key)) return true;
  // On-chain booster unlocks (only when the VRF booster is live). No-op while
  // BOOSTER_ONCHAIN is false, so the current behavior is unchanged.
  if (BOOSTER_ONCHAIN && onchainUnlocks.get(wallet)?.has(key)) return true;
  return false;
}

// ── On-chain booster unlocks (read from the UnlockState PDA) ─────────────────
//
// The caller (which has the base RPC connection) fetches the UnlockState PDA and
// feeds its raw data here; we decode the bitset → keys once so isVariantUnlocked
// stays synchronous. RPC-free by design. Populated only when BOOSTER_ONCHAIN.
const onchainUnlocks = new Map<string, Set<string>>();

/** Decode + cache a wallet's on-chain unlock bitset. Pass the UnlockState
 *  account data, or null if the account doesn't exist yet. */
export function setOnChainUnlocks(wallet: string, data: Uint8Array | null): void {
  if (!data) { onchainUnlocks.set(wallet, new Set()); return; }
  const st = decodeUnlockState(data);
  if (!st) return;
  const pool = getBoosterPool();
  const keys = new Set<string>();
  for (const i of unlockedIndices(st.bits)) {
    const e = pool[i];
    if (e) keys.add(unlockKeyOf(e.category, e.variant.id));
  }
  onchainUnlocks.set(wallet, keys);
}

export function getOnChainUnlocks(wallet: string | null): Set<string> {
  return (wallet ? onchainUnlocks.get(wallet) : undefined) ?? new Set();
}

/**
 * Grant a locked item to a wallet. Returns true if it was NEWLY unlocked (so
 * callers can reward once). Fires a `progressionBus` "outfit-unlocked" event —
 * the ToastStack shows "Outfit unlocked" and the WardrobePanel re-renders —
 * unless `silent` is set (the booster grants 5 at once and shows its own reveal,
 * then emits a single summary event).
 */
export function unlockItem(
  wallet: string | null,
  category: LayerCategory,
  id: string,
  name?: string,
  silent = false,
): boolean {
  if (!wallet) return false;
  const set = getUnlockedSet(wallet);
  const key = unlockKeyOf(category, id);
  if (set.has(key)) return false;
  set.add(key);
  try {
    localStorage.setItem(storageKey(wallet), JSON.stringify([...set]));
  } catch { /* ignore quota / private-mode */ }
  if (!silent) {
    progressionBus.emit({ type: "outfit-unlocked", outfitId: key, outfitName: name ?? id });
  }
  return true;
}
