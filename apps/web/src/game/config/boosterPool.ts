import { LayerCategory, getBoosterPool } from "./paperDoll";
import { getUnlockedSet, unlockKeyOf } from "./wardrobeUnlocks";

/**
 * Booster pack draw.
 *
 * A pack yields 5 DISTINCT items drawn uniformly at random from the booster
 * pool (all non-free, non-quest/NPC wardrobe items), preferring items the
 * wallet doesn't own yet — duplicates only fill in when the un-owned pool is
 * smaller than the pack.
 *
 * PREVIEW NOTE: randomness here is client-side `Math.random`, standing in for
 * MagicBlock VRF. The POOL and the DRAW rules are exactly what the on-chain
 * version will use — only the entropy source (and the grant, localStorage →
 * on-chain PDA) change. See BOOSTER_SPEC.md.
 */

export const PACK_SIZE = 5;

export interface BoosterDrop {
  category: LayerCategory;
  id: string;
  name: string;
  file: string;
  /** Already owned before this pack (a duplicate). */
  owned: boolean;
}

function shuffle<T>(input: T[]): T[] {
  const a = [...input];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function rollBooster(wallet: string | null, count = PACK_SIZE): BoosterDrop[] {
  const owned = getUnlockedSet(wallet);
  const isOwned = (c: LayerCategory, id: string) => owned.has(unlockKeyOf(c, id));

  const pool = getBoosterPool();
  const unowned = pool.filter(p => !isOwned(p.category, p.variant.id));
  const dupes = pool.filter(p => isOwned(p.category, p.variant.id));

  // Un-owned first, then duplicates to top up a pack larger than what's left.
  const picked = [...shuffle(unowned), ...shuffle(dupes)].slice(0, count);

  return picked.map(({ category, variant }) => ({
    category,
    id: variant.id,
    name: variant.name,
    file: variant.file,
    owned: isOwned(category, variant.id),
  }));
}
