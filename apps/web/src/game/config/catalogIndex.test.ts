import { describe, it, expect } from "vitest";
import {
  FREE_ITEM_COUNT,
  QUEST_FREE_SLOTS,
  QUEST_BLOCK_START,
  BOOSTER_BLOCK_START,
  globalIndexOf,
  itemAtGlobalIndex,
  assignedIndices,
  catalogLength,
} from "./catalogIndex";
import { getChainFreeItems, getQuestItems, getBoosterPool } from "./paperDoll";
import { boosterIndexTable } from "./boosterPool";

/**
 * These are not taste. A catalog index becomes a bit in an on-chain bitset, so
 * an index that moves relabels a cosmetic somebody already owns.
 */
describe("the global catalog index", () => {
  it("mirrors the program's block constants", () => {
    expect(FREE_ITEM_COUNT).toBe(64);
    expect(QUEST_FREE_SLOTS).toBe(128);
    expect(QUEST_BLOCK_START).toBe(FREE_ITEM_COUNT);
    expect(BOOSTER_BLOCK_START).toBe(FREE_ITEM_COUNT + QUEST_FREE_SLOTS);
  });

  it("keeps each block inside the size reserved for it", () => {
    expect(getChainFreeItems().length).toBeLessThanOrEqual(FREE_ITEM_COUNT);
    expect(getQuestItems().length).toBeLessThanOrEqual(QUEST_FREE_SLOTS);
  });

  it("leaves slack at the end of each reserved block", () => {
    // Both blocks are reserved SIZES, not populations: the slack is where
    // future free items and future NPC rewards go. Spending it is appending;
    // moving an item between blocks is not, because an index that has been
    // written to chain names a cosmetic in somebody's wallet.
    const free = getChainFreeItems().length;
    const quest = getQuestItems().length;
    expect(free).toBeLessThan(FREE_ITEM_COUNT);
    expect(quest).toBeLessThan(QUEST_FREE_SLOTS);
    // The first unused slot of each block really is empty.
    expect(itemAtGlobalIndex(free)).toBeUndefined();
    expect(itemAtGlobalIndex(QUEST_BLOCK_START + quest)).toBeUndefined();
  });

  it("round-trips every assigned index", () => {
    for (const i of assignedIndices()) {
      const e = itemAtGlobalIndex(i)!;
      expect(globalIndexOf(e.category, e.variant.id), `index ${i}`).toBe(i);
    }
  });

  it("gives an unknown item -1 rather than throwing", () => {
    expect(globalIndexOf("hat", "no_such_hat")).toBe(-1);
  });

  it("places the booster block where the program's bit maths expects it", () => {
    // callback_open_booster sets bit QUEST_FREE_SLOTS + poolIndex, and the
    // program reads bit b as catalog index FREE_ITEM_COUNT + b. So pool index
    // p must land at FREE_ITEM_COUNT + QUEST_FREE_SLOTS + p.
    getBoosterPool().forEach(({ category, variant }, p) => {
      const bit = QUEST_FREE_SLOTS + p;
      expect(globalIndexOf(category, variant.id), variant.id).toBe(FREE_ITEM_COUNT + bit);
    });
  });

  it("agrees with the booster index table, entry for entry", () => {
    boosterIndexTable().forEach((e, p) => {
      expect(globalIndexOf(e.category, e.id), e.id).toBe(BOOSTER_BLOCK_START + p);
    });
  });

  it("fits the unlock bitset", () => {
    // UNLOCK_BITS is 32 bytes, so the highest representable bit is 255 and the
    // highest catalog index is FREE_ITEM_COUNT + 255.
    expect(catalogLength() - 1).toBeLessThanOrEqual(FREE_ITEM_COUNT + 255);
  });

  it("pins the quest block, slot by slot", () => {
    // Frozen. Each of these is a bit the program will one day set, so a
    // reorder here hands somebody a different outfit. Appending is fine while
    // slots remain; inserting is not.
    expect(getQuestItems().map((e) => `${e.category}:${e.variant.id}`)).toEqual([
      "tshirt:STB_shirt",
      "tshirt:Brazilian_shirt",
      "tshirt:Shirt_Solana",
      "back:Seeker_backpack",
      "accessory:Trader_shades",
      "hat:Cap_Sol",
      "hat:city_cap",
      "hat:turkish_head",
      "hat:STB_cap",
      "hat:Seeker_hat",
      "hat:Pumpkin_head",
      "hat:Miner_hat",
      "hat:Halo",
    ]);
  });

  it("pins the free block, slot by slot", () => {
    expect(getChainFreeItems().map((e) => `${e.category}:${e.variant.id}`)).toEqual([
      "skin:Light", "skin:Feyan", "skin:Laovai", "skin:Pinki",
      "skin:Radio", "skin:Brown", "skin:Dark_brown",
      "eyesFace:Happy", "eyesFace:Terminator", "eyesFace:Normal_blue",
      "eyesFace:Normal_green", "eyesFace:Normal_grey", "eyesFace:Normal_orange",
      "eyesFace:Normal_red",
      "pants:Blue_pants", "pants:Grey_pants",
      "tshirt:Blue_tshirt", "tshirt:White_tshirt",
      "hair:Avatar", "hair:Black_hair", "hair:Afro", "hair:Anime",
      "hair:Magawk_blue", "hair:black_long", "hair:brown_beard",
      "hat:hat_black",
    ]);
  });
});
