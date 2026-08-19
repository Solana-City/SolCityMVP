import { LayerCategory, LayerVariant, isFreeItem } from "./paperDoll";
import { progressionBus } from "@/game/progression/progressionBus";

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
  return getUnlockedSet(wallet).has(unlockKeyOf(category, variant.id));
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
