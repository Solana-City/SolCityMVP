import { describe, expect, it } from "vitest";
import {
  PACKS, RARITY_ORDER, CURRENT_SEASON, rollPack, rarityOf, seasonRarityCounts, seasonOf,
} from "./packs";
import { getBoosterPool } from "./paperDoll";

/**
 * The draw is the thing the program will have to mirror instruction for
 * instruction, so its rules are worth pinning down before the odds are even
 * decided: a pack always hands over what it promised, never the same item
 * twice, and never an item from another season.
 */
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

  it("reads an unlisted item as common", () => {
    expect(rarityOf("hat", "Crown")).toBe("legendary");
    expect(rarityOf("hat", "not-an-item")).toBe("common");
  });
});
