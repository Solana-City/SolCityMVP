import { describe, it, expect } from "vitest";
import { PUMPKINS_PER_HUNT, SPAWN_POOL, spotsFor } from "./pumpkinHunt";

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
      const spots = spotsFor(w);
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
      const spots = spotsFor(w);
      expect(new Set(spots).size, w).toBe(spots.length);
    }
  });

  it("is the same every time, so a reload does not move them", () => {
    for (const w of wallets) {
      expect(spotsFor(w)).toEqual(spotsFor(w));
    }
  });

  it("sends different wallets to different places", () => {
    const [a, b] = wallets;
    expect(spotsFor(a)).not.toEqual(spotsFor(b));
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
