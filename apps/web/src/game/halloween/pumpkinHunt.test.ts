import { describe, it, expect } from "vitest";
import { PUMPKINS_PER_HUNT, SPAWN_POOL, spotsFor } from "./pumpkinHunt";

/** Halloween, in the shape QuestManager.todayKey writes (month 0-based). */
const DAY = "2026-9-31";
/** The day after, for the reset. */
const NEXT_DAY = "2026-10-1";

/**
 * The pick is the only part of the hunt that is pure, and it is the part that
 * would be expensive to get wrong: a repeat means a player can never find five,
 * and an unstable pick moves the pumpkins under someone mid-search.
 */
describe("pumpkinHunt.spotsFor", () => {
  const wallets = [
    "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T",
    "So11111111111111111111111111111111111111112",
  ];

  it("gives five spots that exist in the pool", () => {
    for (const w of wallets) {
      const spots = spotsFor(w, DAY);
      expect(spots, w).toHaveLength(PUMPKINS_PER_HUNT);
      for (const s of spots) {
        expect(Number.isInteger(s), `${w} -> ${s}`).toBe(true);
        expect(s, w).toBeGreaterThanOrEqual(0);
        expect(s, w).toBeLessThan(SPAWN_POOL.length);
      }
    }
  });

  it("never gives the same spot twice", () => {
    for (const w of wallets) {
      const spots = spotsFor(w, DAY);
      expect(new Set(spots).size, w).toBe(spots.length);
    }
  });

  it("is the same every time, so a reload does not move them", () => {
    for (const w of wallets) {
      expect(spotsFor(w, DAY)).toEqual(spotsFor(w, DAY));
    }
  });

  it("sends different wallets to different places", () => {
    const [a, b] = wallets;
    expect(spotsFor(a, DAY)).not.toEqual(spotsFor(b, DAY));
  });

  it("moves them to new places the next day", () => {
    // The whole point of the daily reset: a player who learned today's five
    // has to hunt again tomorrow rather than walk a memorised round.
    for (const w of wallets) {
      expect(spotsFor(w, DAY), w).not.toEqual(spotsFor(w, NEXT_DAY));
    }
  });

  it("has a pool big enough for the pick to be worth making", () => {
    // With a pool this size the five are a search rather than a tour, and
    // Fisher-Yates below PUMPKINS_PER_HUNT has room to move.
    expect(SPAWN_POOL.length).toBeGreaterThan(PUMPKINS_PER_HUNT * 2);
  });

  it("hides them in distinct places", () => {
    const seen = new Set(SPAWN_POOL.map(([x, y]) => `${x},${y}`));
    expect(seen.size).toBe(SPAWN_POOL.length);
  });
});
