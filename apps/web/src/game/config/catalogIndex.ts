import {
  LayerCategory,
  LayerVariant,
  LAYER_ORDER,
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
 * ── The layout ────────────────────────────────────────────────────────────
 *
 *   [0, FREE_ITEM_COUNT)                       free, never checked
 *   [FREE_ITEM_COUNT, BOOSTER_BLOCK_START)     quest and NPC rewards
 *   [BOOSTER_BLOCK_START, ...)                 booster pool
 *
 * Each block is then cut into LANES, one per layer category, and an item sits
 * in its own category's lane. Every one of these is a reserved SIZE and the
 * table is mostly holes, which is the point rather than waste.
 *
 * **Why lanes, and not one list per block.** The blocks used to be filled in
 * LAYER_ORDER, so an item's index depended on how many items every EARLIER
 * category had. Adding one accessory moved every hair and every hat after it,
 * in all three blocks at once. That is survivable while nothing is on chain
 * and fatal afterwards, and the plan is a lot more accessories. With lanes,
 * appending to a category touches only that category, and a brand new
 * category takes a spare lane and touches nothing at all.
 *
 * Holes cost nothing. `UnlockState.owned` is a LIST of what a wallet has, not
 * a bitset over what exists, so an empty slot is a number nobody stores. The
 * only real ceiling is the u16 the loadout carries, and the whole table ends
 * around 34,000 of 65,535.
 *
 * ── The rules, which are not style ────────────────────────────────────────
 *
 * Append only, inside each category's lane. An index that has been written to
 * chain names a cosmetic in somebody's wallet; moving it relabels what they
 * own. Lanes make this a per-category promise instead of a whole-catalog one,
 * which is the difference between a rule that can be kept and one that cannot.
 *
 * Reordering LAYER_ORDER is now a renumbering too: an item's lane is its
 * position there. `catalogIndex.test.ts` pins the order for that reason.
 *
 * `enabled: false` does NOT free a slot. The builders here read
 * `LAYER_VARIANTS` directly rather than the enabled-filtered views, so
 * disabling an item hides it without renumbering anything after it. The draw
 * still uses the filtered pool, so a disabled item cannot drop.
 *
 * `catalogIndex.test.ts` pins the whole table. If a change here is meant, the
 * snapshot in that test has to be updated in the same commit, on purpose.
 */

/**
 * How many LANES each block is divided into: one per layer category, with
 * room for categories that do not exist yet.
 *
 * Sixteen rather than the eight categories there are today, so that adding a
 * whole new kind of cosmetic - gloves, shoes, wings - takes the next free
 * lane instead of pushing every category after it to a new index.
 */
export const CATEGORY_LANES = 16;

/**
 * How many indices one category gets inside each block.
 *
 * Sized for what grows. Free items barely do: skins, faces and hairstyles are
 * close to complete. Quest items grow with the NPCs. The booster block is
 * where seasons land, a few hundred items a season across the categories, so
 * two thousand a lane is something like fifty seasons.
 */
export const LANE_SIZE = { free: 32, quest: 64, booster: 2048 } as const;

/** Mirrors FREE_ITEM_COUNT in the program. A reserved size, not a count. */
export const FREE_ITEM_COUNT = CATEGORY_LANES * LANE_SIZE.free;

/** Mirrors QUEST_FREE_SLOTS in the program. Also a reserved size. */
export const QUEST_FREE_SLOTS = CATEGORY_LANES * LANE_SIZE.quest;

/** First index of the quest and NPC block. */
export const QUEST_BLOCK_START = FREE_ITEM_COUNT;

/**
 * First index of the booster block, and the floor the program enforces from:
 * `ENFORCED_FROM` in lib.rs is this number, and `append_season_drops` refuses
 * any index below it.
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
/**
 * Lays one block's items out, each in its own category's lane.
 *
 * Throws rather than wrapping or dropping. A lane that overflows would put two
 * cosmetics on one index, and an index is what a wallet owns: two items
 * sharing one means granting either grants both, on chain, permanently. A
 * white screen in development is the cheap failure here, and the tests reach
 * it first.
 */
function placeLane(
  table: (CatalogEntry | undefined)[],
  rows: { category: LayerCategory; variant: LayerVariant }[],
  blockStart: number,
  laneSize: number,
  block: CatalogEntry["block"],
): void {
  const filled = new Map<LayerCategory, number>();
  for (const { category, variant } of rows) {
    const lane = LAYER_ORDER.indexOf(category);
    if (lane < 0) {
      throw new Error(`catalogIndex: "${category}" is not in LAYER_ORDER`);
    }
    if (lane >= CATEGORY_LANES) {
      throw new Error(
        `catalogIndex: LAYER_ORDER has more than ${CATEGORY_LANES} categories`,
      );
    }
    const slot = filled.get(category) ?? 0;
    if (slot >= laneSize) {
      throw new Error(
        `catalogIndex: the ${block} lane for "${category}" holds only ${laneSize}`,
      );
    }
    filled.set(category, slot + 1);
    table[blockStart + lane * laneSize + slot] = { category, variant, block };
  }
}

function buildTable(): (CatalogEntry | undefined)[] {
  const table: (CatalogEntry | undefined)[] = [];
  placeLane(table, getChainFreeItems(), 0, LANE_SIZE.free, "free");
  placeLane(table, getQuestItems(), QUEST_BLOCK_START, LANE_SIZE.quest, "quest");
  placeLane(table, getBoosterPool(), BOOSTER_BLOCK_START, LANE_SIZE.booster, "booster");
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
