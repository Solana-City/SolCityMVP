import {
  LayerCategory,
  LayerVariant,
  getChainFreeItems,
  getQuestItems,
  getBoosterPool,
} from "./paperDoll";

/**
 * The global catalog index: the one table that turns a wardrobe item into the
 * number the program stores, and back.
 *
 * `WARDROBE_ONCHAIN.md` calls this Phase 2 and it had never been built, which
 * is why `update_look_session` currently enforces nothing: the program parses
 * each loadout value as a u16 while `encodeLoadout` still sends variant ids.
 * This file is the missing half. Nothing sends indices yet — flipping the wire
 * format is a separate, deliberate step.
 *
 * ── The layout, and why it has holes ──────────────────────────────────────
 *
 *   [0, FREE_ITEM_COUNT)                       free, never checked
 *   [FREE_ITEM_COUNT, BOOSTER_BLOCK_START)     quest and NPC rewards
 *   [BOOSTER_BLOCK_START, ...)                 booster pool
 *
 * **Both of the first two are reserved SIZES, not populations.** The quest
 * block has sixteen slots and eleven items; the free block has twenty slots
 * and nineteen items, because `POOL_V1_FREE` still names `Brown_hair`, which
 * stopped existing when hair colour became its own axis.
 *
 * Leaving index 19 empty is deliberate. The alternative was to drop
 * `FREE_ITEM_COUNT` to 19, which moves the start of every later block and so
 * renumbers every booster item: exactly the shift the append-only rule exists
 * to prevent. An unused index inside the free block is harmless, because the
 * program treats that range as permissive and never checks it.
 *
 * ── The rules, which are not style ────────────────────────────────────────
 *
 * Append only, inside each block. An index that has been written to chain
 * names a cosmetic in somebody's wallet; moving it relabels what they own.
 *
 * `enabled: false` does NOT free a slot. The builders here read
 * `LAYER_VARIANTS` directly rather than the enabled-filtered views, so
 * disabling an item hides it without renumbering anything after it. The draw
 * still uses the filtered pool, so a disabled item cannot drop.
 *
 * `catalogIndex.test.ts` pins the whole table. If a change here is meant, the
 * snapshot in that test has to be updated in the same commit, on purpose.
 */

/** Mirrors FREE_ITEM_COUNT in the program. A reserved size, not a count. */
export const FREE_ITEM_COUNT = 20;

/** Mirrors QUEST_FREE_SLOTS in the program. Also a reserved size. */
export const QUEST_FREE_SLOTS = 16;

/** First index of the quest and NPC block. */
export const QUEST_BLOCK_START = FREE_ITEM_COUNT;

/**
 * First index of the booster block, and the number the program adds to a pool
 * index when it grants one: `callback_open_booster` sets bit
 * `QUEST_FREE_SLOTS + poolIndex`, and bit `b` is catalog index
 * `FREE_ITEM_COUNT + b`.
 */
export const BOOSTER_BLOCK_START = FREE_ITEM_COUNT + QUEST_FREE_SLOTS;

export interface CatalogEntry {
  category: LayerCategory;
  variant: LayerVariant;
  /** Which block it came from, for anything that needs to reason about tiers. */
  block: "free" | "quest" | "booster";
}

/**
 * The table, as a sparse array: `table[i]` is the item at catalog index `i`,
 * and a hole is a reserved slot nothing occupies yet.
 */
function buildTable(): (CatalogEntry | undefined)[] {
  const table: (CatalogEntry | undefined)[] = [];

  getChainFreeItems().forEach(({ category, variant }, i) => {
    table[i] = { category, variant, block: "free" };
  });

  getQuestItems().forEach(({ category, variant }, i) => {
    table[QUEST_BLOCK_START + i] = { category, variant, block: "quest" };
  });

  getBoosterPool().forEach(({ category, variant }, i) => {
    table[BOOSTER_BLOCK_START + i] = { category, variant, block: "booster" };
  });

  return table;
}

// Built once. The inputs are module-level constants, so rebuilding per call
// would only burn time: `globalIndexOf` is called for every slot of every
// loadout write.
let cached: (CatalogEntry | undefined)[] | null = null;

function table(): (CatalogEntry | undefined)[] {
  if (!cached) cached = buildTable();
  return cached;
}

let lookup: Map<string, number> | null = null;

function keyOf(category: LayerCategory, id: string): string {
  return `${category}:${id}`;
}

/**
 * The catalog index of an item, or -1 when it has none.
 *
 * -1 rather than a throw: a loadout can name an item that no longer exists,
 * from a profile saved before it was removed, and the caller's job is to drop
 * that slot rather than to fail the whole outfit.
 */
export function globalIndexOf(category: LayerCategory, id: string): number {
  if (!lookup) {
    lookup = new Map();
    table().forEach((e, i) => {
      if (e) lookup!.set(keyOf(e.category, e.variant.id), i);
    });
  }
  return lookup.get(keyOf(category, id)) ?? -1;
}

/** The item at a catalog index, or undefined for a reserved or unused slot. */
export function itemAtGlobalIndex(i: number): CatalogEntry | undefined {
  return table()[i];
}

/** Every assigned index, ascending. Reserved holes are skipped. */
export function assignedIndices(): number[] {
  const out: number[] = [];
  table().forEach((e, i) => { if (e) out.push(i); });
  return out;
}

/**
 * How many indices the table spans, holes included. This is what bounds the
 * unlock bitset: the program's UNLOCK_BITS is 32 bytes, so the highest index
 * it can represent is FREE_ITEM_COUNT + 255.
 */
export function catalogLength(): number {
  return table().length;
}

/** Only for tests, which need to rebuild after stubbing the catalog. */
export function resetCatalogIndexCache(): void {
  cached = null;
  lookup = null;
}
