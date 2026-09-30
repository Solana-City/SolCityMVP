import { LayerCategory, getBoosterPool } from "./paperDoll";

/**
 * The index space the client and the program share for wardrobe items.
 *
 * The DRAW itself lives in ./packs.ts, with the packs, the rarities and the
 * season it draws from. This file is only the table that turns an item into
 * the number the program stores, and back.
 */

// ── Canonical index table (client ⇄ program) ────────────────────────────────
//
// The on-chain UnlockState stores a bitset; index i = position in getBoosterPool()
// order. This order MUST match the program's view of the pool. Rule: APPEND-ONLY
// — never reorder or remove a booster item, or every index shifts. Bump
// POOL_VERSION and keep both sides in sync when the pool changes.
export const POOL_VERSION = 1;

/** The booster pool as an ordered, index-stable list (index = on-chain bit). */
export function boosterIndexTable(): { category: LayerCategory; id: string; name: string; file: string }[] {
  return getBoosterPool().map(({ category, variant }) => ({
    category, id: variant.id, name: variant.name, file: variant.file,
  }));
}

/** Pool length — passed to open_booster as `pool_count` (the draw's index space). */
export function boosterPoolCount(): number {
  return getBoosterPool().length;
}

export function boosterIndexOf(category: LayerCategory, id: string): number {
  return boosterIndexTable().findIndex(e => e.category === category && e.id === id);
}

export function itemAtIndex(i: number): { category: LayerCategory; id: string; name: string; file: string } | undefined {
  return boosterIndexTable()[i];
}

/**
 * The pack draw used to live here as `rollBooster`, a single five-item pack
 * drawn uniformly. It moved to ./packs.ts when packs gained categories,
 * rarities and a season — one draw, in one place, because it is the thing the
 * program has to mirror exactly.
 */
