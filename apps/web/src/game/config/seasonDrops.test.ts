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
    expect(RARITY_ORDER.reduce((n, r) => n + counts[r], 0)).toBe(104);
  });

  it("pins what season 1 would seed, per rarity", () => {
    expect(seasonDropLists(1)).toEqual({
      common: [
        5632, 5633, 5634, 5635, 5636, 5640, 5641, 5642, 5643, 5644, 5646, 5647,
        5648, 5649, 5650, 5651, 5652, 5653, 5654, 5655, 5656, 5657, 5658,
        7680, 7681, 7682, 7683, 7684, 7685, 7686, 7687, 7688, 7689, 7690, 7691,
        7692, 7693, 7694, 7695, 7696, 7697, 7698, 7699, 7701, 7702,
        9729, 9730, 9734, 9735, 9736, 9737,
        11776, 11778, 11779, 11780, 11782,
        15880, 15883, 15884, 15885, 15886, 15887, 15888, 15889, 15890, 15893,
      ],
      uncommon: [
        5637, 5638,
        7700, 7703, 7704, 7706, 7707, 7708,
        9738, 9739, 9740,
        11777, 11781, 11783, 11785,
        15872, 15873, 15874, 15878, 15891,
      ],
      rare: [
        7705, 7709,
        9728, 9731, 9732,
        11784,
        15875, 15876, 15877, 15879,
      ],
      legendary: [5639, 5645, 7710, 9733, 11786, 15881, 15882, 15892],
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
