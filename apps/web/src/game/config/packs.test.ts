import { describe, expect, it } from "vitest";
import {
  PACKS, RARITY_ORDER, CURRENT_SEASON, rollPack, rarityOf, seasonRarityCounts, seasonOf, isPackItem,
} from "./packs";
import { getBoosterPool, isFreeInShippedGame } from "./paperDoll";
import { boosterIndexTable } from "./boosterPool";
import { SEASONS, CURRENT_SEASON as OPEN_SEASON, seasonLabel } from "@/game/collections/seasons";

/**
 * The draw is the thing the program will have to mirror instruction for
 * instruction, so its rules are worth pinning down before the odds are even
 * decided: a pack always hands over what it promised, never the same item
 * twice, and never an item from another season.
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

  it("draws the promised number of pieces, none of them twice", () => {
    for (const pack of PACKS) {
      const drops = rollPack("test-wallet", pack);
      expect(drops.length, pack.id).toBe(pack.size);
      const keys = drops.map((d) => `${d.category}:${d.id}`);
      expect(new Set(keys).size, pack.id).toBe(keys.length);
    }
  });

  it("falls down the ladder rather than coming up short", () => {
    // A pack that rolls nothing but legendaries, in a season that holds two
    // of them: it still hands over five pieces.
    const allLegendary = {
      ...PACKS[0],
      odds: { common: 0, uncommon: 0, rare: 0, legendary: 100 },
    };
    const drops = rollPack("test-wallet", allLegendary);
    expect(drops).toHaveLength(allLegendary.size);
  });

  it("never draws an item from another season", () => {
    for (const pack of PACKS) {
      for (const drop of rollPack("test-wallet", pack)) {
        const variant = getBoosterPool()
          .find((p) => p.category === drop.category && p.variant.id === drop.id)!.variant;
        expect(seasonOf(variant)).toBe(CURRENT_SEASON);
      }
    }
  });

  it("keeps enough in every rarity for a pack to be worth opening", () => {
    // Not a rule, a warning: odds are meaningless if a bucket is empty, and
    // the fallback would quietly hand out commons instead.
    const counts = seasonRarityCounts();
    for (const rarity of RARITY_ORDER) {
      expect(counts[rarity], rarity).toBeGreaterThan(0);
    }
  });

  it("draws nothing at all from a season that has no items yet", () => {
    // Season 2 exists the moment somebody writes it down, and holds nothing
    // until the art lands. A pack pointed at it must come back EMPTY rather
    // than quietly falling back to season 1 stock — that fallback would be
    // the bug that makes a "new collection" sell old items.
    expect(rollPack("test-wallet", PACKS[0], 2)).toHaveLength(0);
    expect(seasonRarityCounts(2)).toEqual({ common: 0, uncommon: 0, rare: 0, legendary: 0 });
  });

  it("keeps the on-chain index of every item that already shipped", () => {
    // The pool order IS the index space the program stores as bits. Adding a
    // season appends; it must never renumber what a wallet already owns.
    const shipped = ["back:backpack_brown", "hat:Crown", "accessory:Golden_ring"];
    const table = boosterIndexTable().map((e) => `${e.category}:${e.id}`);
    for (const key of shipped) expect(table, key).toContain(key);
    expect(table.indexOf("back:backpack_brown")).toBeLessThan(table.indexOf("hat:Crown"));
  });

  it("reads an unlisted item as common", () => {
    expect(rarityOf("hat", "Crown")).toBe("legendary");
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

  it("gives no hairstyle a rarity: hair is free, like the bases and faces", () => {
    for (const { category, variant } of getBoosterPool()) {
      if (category !== "hair") continue;
      expect(isPackItem(category, variant.id), variant.id).toBe(false);
      expect(rarityOf(category, variant.id), variant.id).toBe("common");
    }
  });
});
