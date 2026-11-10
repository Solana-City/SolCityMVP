import { describe, expect, it } from "vitest";
import {
  PACKS, RARITY_ORDER, CURRENT_SEASON, rarityOf, seasonRarityCounts, seasonOf, isPackItem,
} from "./packs";
import { getBoosterPool, isFreeInShippedGame } from "./paperDoll";
import { boosterIndexTable } from "./boosterPool";
import { SEASONS, CURRENT_SEASON as OPEN_SEASON, seasonLabel } from "@/game/collections/seasons";

/**
 * The packs, their odds and the season stock they draw from. The draw itself
 * is on chain (callback_open_booster) and its rules are pinned by the Rust
 * tests: every roll independent, repeats normal, every copy minted.
 */
describe("the season calendar", () => {
  it("has exactly one season open", () => {
    expect(SEASONS.filter((s) => s.status === "open")).toHaveLength(1);
    expect(OPEN_SEASON).toBe(CURRENT_SEASON);
  });

  it("never reuses a season number", () => {
    expect(new Set(SEASONS.map((s) => s.n)).size).toBe(SEASONS.length);
  });

  it("names a season it knows, and still labels one it does not", () => {
    expect(seasonLabel(1)).toContain("SEASON 1");
    expect(seasonLabel(99)).toBe("SEASON 99");
  });
});

describe("outfit packs", () => {
  it("has three packs whose odds add up", () => {
    expect(PACKS).toHaveLength(3);
    for (const pack of PACKS) {
      const total = RARITY_ORDER.reduce((sum, r) => sum + pack.odds[r], 0);
      expect(total, pack.id).toBe(100);
    }
  });

  it("gives every pack a distinct id and its own art", () => {
    expect(new Set(PACKS.map((p) => p.id)).size).toBe(PACKS.length);
    expect(new Set(PACKS.map((p) => p.art.file)).size).toBe(PACKS.length);
  });

  it("keeps enough in every rarity for a pack to be worth opening", () => {
    // Not a rule, a warning: odds are meaningless if a bucket is empty, and
    // the fallback would quietly hand out commons instead.
    const counts = seasonRarityCounts();
    for (const rarity of RARITY_ORDER) {
      expect(counts[rarity], rarity).toBeGreaterThan(0);
    }
  });

  it("counts nothing in a season that has no items yet", () => {
    // Season 2 exists the moment somebody writes it down, and holds nothing
    // until the art lands. Its table must read EMPTY rather than quietly
    // borrowing season 1 stock: that would make a "new collection" sell old
    // items.
    expect(seasonRarityCounts(2)).toEqual({ common: 0, uncommon: 0, rare: 0, legendary: 0 });
  });

  it("keeps the on-chain index of every item that already shipped", () => {
    // The pool order IS the index space the program stores as bits. Adding a
    // season appends; it must never renumber what a wallet already owns.
    // This named hat:Crown until the plain Crown was dropped on purpose, which
    // is the one thing that gets a name out of this list: the Royal Crown took
    // its place and is what ships.
    const shipped = ["back:backpack_brown", "hat:Royal_crown", "accessory:Golden_ring"];
    const table = boosterIndexTable().map((e) => `${e.category}:${e.id}`);
    for (const key of shipped) expect(table, key).toContain(key);
    expect(table.indexOf("back:backpack_brown")).toBeLessThan(table.indexOf("hat:Royal_crown"));
  });

  it("reads an unlisted item as common", () => {
    expect(rarityOf("hat", "Royal_crown")).toBe("legendary");
    expect(rarityOf("hat", "not-an-item")).toBe("common");
  });

  it("only marks as a pack item what a pack can actually hand over", () => {
    // The wardrobe draws a rarity frame on whatever isPackItem() says drops.
    // getBoosterPool() is frozen at POOL_V1_FREE for on-chain index stability,
    // so it still lists items that have become free since — and every one of
    // those would show the player a rarity they can never open.
    for (const { category, variant } of getBoosterPool()) {
      if (!isFreeInShippedGame(category, variant.id)) continue;
      expect(isPackItem(category, variant.id), `${category}:${variant.id}`).toBe(false);
    }
  });

  it("keeps hair out of the pool entirely, not just out of the draw", () => {
    // Hair used to sit in the pool and be skipped at draw time, which left
    // every hairstyle holding an unlock bit and therefore mintable as an
    // asset. The owner ruled on 2026-10-20 that items which arrive unlocked
    // are never pack items, so hair moved into the chain's free block and the
    // pool no longer contains any.
    for (const { category, variant } of getBoosterPool()) {
      expect(category, variant.id).not.toBe("hair");
    }
  });
});
