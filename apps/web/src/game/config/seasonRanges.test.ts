import { describe, it, expect } from "vitest";
import { getBoosterPool, isFreeInShippedGame } from "./paperDoll";
import { globalIndexOf, BOOSTER_BLOCK_START } from "./catalogIndex";
import { rarityOf, seasonOf } from "./packs";
import { RARITY_ORDER, SEASONS, type Rarity } from "@/game/collections/seasons";

/**
 * The invariant `PackConfig.SeasonRanges` rests on, and the fact that it does
 * not hold yet.
 *
 * `open_booster` snapshots four `(start, len)` pairs per season, one per
 * rarity, and the VRF callback draws an index out of one of them. Four pairs
 * can only describe a rarity that occupies a CONTIGUOUS run of catalog
 * indices. The booster pool is not ordered that way: season 1's eighteen
 * pack items form TWELVE runs, because rarity was assigned by name in
 * `packs.ts` long after the pool order was fixed.
 *
 * So one of two things has to happen before the redeploy, and only before:
 *
 *   - the booster pool is reordered so rarity is contiguous, which renumbers
 *     those eighteen indices and is free exactly until the first grant is
 *     written to chain, or
 *   - the program stops using ranges and carries a rarity per index instead,
 *     which costs bytes on the config and removes the ordering constraint.
 *
 * Reordering contradicts the append-only rule in `catalogIndex.ts` as that
 * rule is written. The rule exists because an index already in somebody's
 * wallet cannot move; none are, since `BOOSTER_ONCHAIN` is false and the
 * redeploy has not happened. That is a decision to take deliberately, not a
 * detail to fix in passing, which is why the contiguity test below is skipped
 * rather than left red.
 *
 * `currentRuns` is active and pins today's layout, so an accidental reorder
 * shows up as a diff rather than as a silently wrong pack.
 */

interface Run { rarity: Rarity; start: number; len: number }

/** Every pack-eligible item of a season, by catalog index. */
function seasonItems(season: number): { index: number; rarity: Rarity }[] {
  return getBoosterPool()
    .filter((p) => !isFreeInShippedGame(p.category, p.variant.id))
    .filter((p) => seasonOf(p.variant) === season)
    .map((p) => ({
      index: globalIndexOf(p.category, p.variant.id),
      rarity: rarityOf(p.category, p.variant.id),
    }))
    .sort((a, b) => a.index - b.index);
}

/** The runs of equal rarity in index order. One per rarity iff contiguous. */
function rarityRuns(season: number): Run[] {
  const runs: Run[] = [];
  for (const { index, rarity } of seasonItems(season)) {
    const last = runs[runs.length - 1];
    if (last && last.rarity === rarity && last.start + last.len === index) {
      last.len++;
    } else {
      runs.push({ rarity, start: index, len: 1 });
    }
  }
  return runs;
}

describe("season rarity ranges", () => {
  it("season 1 holds pack items at all", () => {
    // The guard that caught this file lying: SeasonDef names the number `n`,
    // and reading `id` made every season undefined, every filter empty, and
    // every assertion below pass over nothing.
    expect(SEASONS.map((s) => s.n)).toEqual([1]);
    expect(seasonItems(1).length).toBe(18);
  });

  it("every pack item sits in the enforced block", () => {
    // What `upsert_season` refuses on chain: a range below ENFORCED_FROM would
    // name a free or quest index.
    for (const { index } of seasonItems(1)) {
      expect(index).toBeGreaterThanOrEqual(BOOSTER_BLOCK_START);
    }
  });

  it("pins the pool's current rarity layout", () => {
    expect(rarityRuns(1).map((r) => [r.rarity, r.start, r.len])).toEqual([
      ["common", 192, 4],
      ["uncommon", 196, 1],
      ["rare", 197, 2],
      ["common", 199, 2],
      ["legendary", 201, 1],
      ["uncommon", 202, 1],
      ["rare", 203, 1],
      ["legendary", 204, 1],
      ["rare", 205, 1],
      ["uncommon", 206, 1],
      ["rare", 207, 1],
      ["common", 208, 2],
    ]);
  });

  // Un-skip this, and delete the pin above, once the ordering decision is
  // taken. Green here is the condition for seeding a season on chain: it is
  // what makes the four pairs `upsert_season` is called with describe the pool
  // they claim to describe.
  it.skip("each rarity is one contiguous run, per season", () => {
    for (const { n } of SEASONS) {
      const seen = rarityRuns(n).map((r) => r.rarity);
      expect(new Set(seen).size).toBe(seen.length);
    }
  });

  it.skip("the ranges each season would be seeded with", () => {
    const table = SEASONS.map(({ n }) => {
      const runs = rarityRuns(n);
      return {
        season: n,
        start: RARITY_ORDER.map((r) => runs.find((x) => x.rarity === r)?.start ?? 0),
        len: RARITY_ORDER.map((r) => runs.find((x) => x.rarity === r)?.len ?? 0),
      };
    });
    expect(table).toEqual([
      { season: 1, start: [192, 0, 0, 0], len: [18, 0, 0, 0] },
    ]);
  });
});
