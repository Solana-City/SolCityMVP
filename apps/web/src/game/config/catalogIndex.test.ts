import { describe, it, expect } from "vitest";
import {
  CATEGORY_LANES,
  LANE_SIZE,
  FREE_ITEM_COUNT,
  QUEST_FREE_SLOTS,
  QUEST_BLOCK_START,
  BOOSTER_BLOCK_START,
  globalIndexOf,
  itemAtGlobalIndex,
  assignedIndices,
  catalogLength,
} from "./catalogIndex";
import {
  LAYER_ORDER, getChainFreeItems, getQuestItems, getBoosterPool,
} from "./paperDoll";

/**
 * These are not taste. A catalog index is what a wallet owns on chain, so an
 * index that moves relabels a cosmetic somebody already has.
 */
describe("the global catalog index", () => {
  it("mirrors the program's block constants", () => {
    expect(FREE_ITEM_COUNT).toBe(512);
    expect(QUEST_FREE_SLOTS).toBe(1024);
    expect(QUEST_BLOCK_START).toBe(FREE_ITEM_COUNT);
    expect(BOOSTER_BLOCK_START).toBe(FREE_ITEM_COUNT + QUEST_FREE_SLOTS);
    expect(BOOSTER_BLOCK_START).toBe(1536);
  });

  it("pins LAYER_ORDER, because a category's position IS its lane", () => {
    // Reordering this renumbers every item of every category that moved, in
    // all three blocks at once. Appending a new category is the safe change:
    // it takes the next lane and touches nothing.
    expect(LAYER_ORDER).toEqual([
      "skin", "eyesFace", "pants", "tshirt", "back", "accessory", "hair", "hat",
    ]);
    expect(LAYER_ORDER.length).toBeLessThanOrEqual(CATEGORY_LANES);
  });

  /**
   * The property the whole layout exists for.
   *
   * Each category's items run from its own lane start, so an item's index
   * depends on its category and on how many items THAT category already had.
   * Nothing else. Append an accessory and no hair moves; add a whole new
   * category and nothing moves at all.
   *
   * Before lanes, a block was filled in LAYER_ORDER and one new accessory
   * pushed every hair and every hat after it.
   */
  it("gives every category its own lane, filled from the start", () => {
    const blocks = [
      { rows: getChainFreeItems(), start: 0, size: LANE_SIZE.free },
      { rows: getQuestItems(), start: QUEST_BLOCK_START, size: LANE_SIZE.quest },
      { rows: getBoosterPool(), start: BOOSTER_BLOCK_START, size: LANE_SIZE.booster },
    ];
    for (const { rows, start, size } of blocks) {
      const seen = new Map<string, number>();
      for (const { category, variant } of rows) {
        const lane = LAYER_ORDER.indexOf(category);
        const slot = seen.get(category) ?? 0;
        seen.set(category, slot + 1);
        expect(globalIndexOf(category, variant.id), variant.id)
          .toBe(start + lane * size + slot);
        expect(slot, `${category} lane overflow`).toBeLessThan(size);
      }
    }
  });

  it("keeps each block inside the size reserved for it", () => {
    // Per lane now, not per block: a block can hold far more than it used to,
    // but one category still cannot spill into the next one's numbers.
    const perLane = (rows: { category: string }[]) => {
      const n = new Map<string, number>();
      for (const r of rows) n.set(r.category, (n.get(r.category) ?? 0) + 1);
      return [...n.values()];
    };
    for (const n of perLane(getChainFreeItems())) expect(n).toBeLessThan(LANE_SIZE.free);
    for (const n of perLane(getQuestItems())) expect(n).toBeLessThan(LANE_SIZE.quest);
    for (const n of perLane(getBoosterPool())) expect(n).toBeLessThan(LANE_SIZE.booster);
  });

  it("fits the u16 a loadout carries", () => {
    // The real and only ceiling, now that UnlockState keeps a LIST of what a
    // wallet owns rather than a bitset over what exists. Holes are free.
    expect(catalogLength() - 1).toBeLessThanOrEqual(65_535);
  });

  it("round-trips every assigned index", () => {
    for (const i of assignedIndices()) {
      const e = itemAtGlobalIndex(i)!;
      expect(globalIndexOf(e.category, e.variant.id), `index ${i}`).toBe(i);
    }
  });

  it("never puts two items on one index", () => {
    // The failure lanes are meant to prevent, stated directly: one index that
    // two cosmetics share means granting either grants both, permanently.
    const indices = assignedIndices();
    expect(new Set(indices).size).toBe(indices.length);
    const items = indices.map((i) => {
      const e = itemAtGlobalIndex(i)!;
      return `${e.category}:${e.variant.id}`;
    });
    expect(new Set(items).size).toBe(items.length);
  });

  it("gives an unknown item -1 rather than throwing", () => {
    expect(globalIndexOf("hat", "no_such_hat")).toBe(-1);
  });

  it("keeps the blocks apart", () => {
    for (const i of assignedIndices()) {
      const e = itemAtGlobalIndex(i)!;
      if (e.block === "free") expect(i).toBeLessThan(FREE_ITEM_COUNT);
      if (e.block === "quest") {
        expect(i).toBeGreaterThanOrEqual(QUEST_BLOCK_START);
        expect(i).toBeLessThan(BOOSTER_BLOCK_START);
      }
      // What the program enforces against: append_season_drops refuses any
      // index below BOOSTER_BLOCK_START.
      if (e.block === "booster") expect(i).toBeGreaterThanOrEqual(BOOSTER_BLOCK_START);
    }
  });

  it("pins the free block, index by index", () => {
    expect(assigned("free")).toEqual([
      [0, "skin:Light"], [1, "skin:Feyan"], [2, "skin:Laovai"], [3, "skin:Pinki"],
      [4, "skin:Radio"], [5, "skin:Brown"], [6, "skin:Dark_brown"],
      [32, "eyesFace:Happy"], [33, "eyesFace:Terminator"], [34, "eyesFace:Normal_blue"],
      [35, "eyesFace:Normal_green"], [36, "eyesFace:Normal_grey"],
      [37, "eyesFace:Normal_orange"], [38, "eyesFace:Normal_red"],
      [64, "pants:Blue_pants"], [65, "pants:Grey_pants"],
      [96, "tshirt:Blue_tshirt"], [97, "tshirt:White_tshirt"],
      // Every hairstyle is free, decided 2026-10-20 and again 2026-10-25.
      [192, "hair:Avatar"], [193, "hair:Black_hair"], [194, "hair:Afro"],
      [195, "hair:Anime"], [196, "hair:Magawk_blue"], [197, "hair:black_long"],
      [198, "hair:brown_beard"],
      // The only free hat. The rest are what packs and quests give.
      [224, "hat:hat_black"],
    ]);
  });

  it("pins the quest block, index by index", () => {
    expect(assigned("quest")).toEqual([
      [704, "tshirt:STB_shirt"], [705, "tshirt:Brazilian_shirt"],
      [706, "tshirt:Shirt_Solana"], [707, "tshirt:Tshirt_solana_city"],
      [768, "back:Seeker_backpack"],
      [832, "accessory:Trader_shades"],
      [960, "hat:Cap_Sol"], [961, "hat:city_cap"],
      [962, "hat:turkish_head"], [963, "hat:STB_cap"],
      [964, "hat:Seeker_hat"], [965, "hat:Pumpkin_head"],
      [966, "hat:Miner_hat"], [967, "hat:Halo"], [968, "hat:Royal_crown"],
    ]);
  });

  it("pins the booster block, index by index", () => {
    expect(assigned("booster")).toEqual([
      [5632, "pants:Red_short_pants"], [5633, "pants:Grey_short_pants"],
      [5634, "pants:Pants_black"], [5635, "pants:Pants_black_belt"],
      [5636, "pants:Pants_green"], [5637, "pants:Pants_chess_red"],
      [5638, "pants:Pants_chess_white"], [5639, "pants:Pants_golden"],
      [7680, "tshirt:Longsleeve_black"], [7681, "tshirt:Longsleeve_brown"],
      [7682, "tshirt:Longsleeve_dark_blue"],
      [7683, "tshirt:Longsleeve_dark_grey"],
      [7684, "tshirt:Longsleeve_green"],
      [7685, "tshirt:Longsleeve_light_blue"],
      [7686, "tshirt:Longsleeve_light_grey"],
      [7687, "tshirt:Longsleeve_orange"], [7688, "tshirt:Longsleeve_red"],
      [7689, "tshirt:Longsleeve_white"], [7690, "tshirt:Longsleeve_yellow"],
      [7691, "tshirt:Tshirt_black"], [7692, "tshirt:Tshirt_dark_grey"],
      [7693, "tshirt:Tshirt_light_grey"], [7694, "tshirt:Tshirt_orange"],
      [7695, "tshirt:Tshirt_yellow"], [7696, "tshirt:Tshirt_green"],
      [7697, "tshirt:Tshirt_red"], [7698, "tshirt:Longsleeve_acid"],
      [7699, "tshirt:Longsleeve_neon"], [7700, "tshirt:Longsleeve_chess"],
      [7701, "tshirt:Longsleeve_indies"], [7702, "tshirt:Tshirt_acid"],
      [7703, "tshirt:Tshirt_neon"], [7704, "tshirt:Tshirt_chess"],
      [7705, "tshirt:Tshirt_solana_white"], [7706, "tshirt:Tshirt_dragon"],
      [7707, "tshirt:Coat_doc"], [7708, "tshirt:Coat_dude"],
      [7709, "tshirt:Coat_red"], [7710, "tshirt:Suit_black"],
      [7711, "tshirt:Suit_golden"],
      [9728, "back:Jetpack"], [9729, "back:backpack_brown"],
      [9730, "back:backpack_red"], [9731, "back:Wings_angel"],
      [9732, "back:Wings_demon"],
      [11776, "accessory:Golden_ring"], [11777, "accessory:Pirate"],
      [11778, "accessory:Ring_bronze"], [11779, "accessory:Ring_silver"],
      [11780, "accessory:Glasses_round"],
      [11781, "accessory:Glasses_steampunk"],
      [11782, "accessory:Ring_brilliant"],
      [11783, "accessory:Glasses_thug"],
      [11784, "accessory:Blindfold_demon"],
      [11785, "accessory:Visor_cyber"],
      [15872, "hat:Cap_blue"], [15873, "hat:Cap_kid"], [15874, "hat:Crown"],
      [15875, "hat:Cylinder"], [15876, "hat:Viking_hat"],
      [15877, "hat:Ninja"], [15878, "hat:Pirate"], [15879, "hat:Straw_hat"],
      [15880, "hat:Vizard_hat"], [15881, "hat:hat_red"],
      [15882, "hat:red_belt"], [15883, "hat:Cap_black"],
      [15884, "hat:Cap_blue_plain"], [15885, "hat:Cap_brown"],
      [15886, "hat:Cap_dark_grey"], [15887, "hat:Cap_green"],
      [15888, "hat:Cap_light_grey"], [15889, "hat:Cap_orange"],
      [15890, "hat:Cap_red"],
    ]);
  });
});

function assigned(block: "free" | "quest" | "booster"): [number, string][] {
  return assignedIndices()
    .map((i) => [i, itemAtGlobalIndex(i)!] as const)
    .filter(([, e]) => e.block === block)
    .map(([i, e]) => [i, `${e.category}:${e.variant.id}`]);
}
