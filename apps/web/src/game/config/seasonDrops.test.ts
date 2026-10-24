import { describe, it, expect } from "vitest";
import { seasonDropLists, seasonDropCounts } from "./seasonDrops";
import { BOOSTER_BLOCK_START } from "./catalogIndex";
import { RARITY_ORDER, SEASONS } from "@/game/collections/seasons";

/**
 * Pins the lists `append_season_drops` is called with, because writing them to
 * chain is a one-way door: a season's drop table stops being writable the
 * moment the season opens, and the indices in it name cosmetics that land in
 * wallets.
 *
 * This replaced a test of the four-range model, which asserted that each
 * rarity occupied a contiguous run of catalog indices. It does not, and more
 * to the point it never could: the items are still being drawn and named, so
 * nobody knows how many of each rarity a season will hold. The program now
 * holds a list per rarity and the ordering constraint is gone.
 *
 * That earlier test also passed over nothing on its first run. SeasonDef names
 * the season `n`, the filter read `id`, and so every season came back
 * undefined and every list came back empty. The first test here is the guard
 * against that returning.
 */
describe("season drop lists", () => {
  it("season 1 is the open one and holds pack items", () => {
    expect(SEASONS.map((s) => s.n)).toEqual([1]);
    const counts = seasonDropCounts(1);
    expect(RARITY_ORDER.reduce((n, r) => n + counts[r], 0)).toBe(18);
  });

  it("pins what season 1 would seed, per rarity", () => {
    expect(seasonDropLists(1)).toEqual({
      common: [192, 193, 194, 195, 199, 200, 208, 209],
      uncommon: [196, 202, 206],
      rare: [197, 198, 203, 205, 207],
      legendary: [201, 204],
    });
  });

  it("every index sits in the enforced block, which the program requires", () => {
    const lists = seasonDropLists(1);
    for (const r of RARITY_ORDER) {
      for (const index of lists[r]) {
        expect(index).toBeGreaterThanOrEqual(BOOSTER_BLOCK_START);
      }
    }
  });

  it("no index appears in two rarities", () => {
    const lists = seasonDropLists(1);
    const all = RARITY_ORDER.flatMap((r) => lists[r]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("each list is sorted, matching how the program stores it", () => {
    const lists = seasonDropLists(1);
    for (const r of RARITY_ORDER) {
      expect(lists[r]).toEqual([...lists[r]].sort((a, b) => a - b));
    }
  });
});
