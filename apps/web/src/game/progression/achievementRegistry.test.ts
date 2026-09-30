import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS, TIER_COLORS } from "./achievementRegistry";
import { ACHIEVEMENT_ART } from "@/ui/PixelIcons";
import type { PlayerProfile } from "@/game/config/profileManager";

/**
 * The list is data, and data that grows every time the city gains something
 * to count. These tests guard the two mistakes that are expensive rather than
 * annoying: a duplicate id (the second one can never unlock) and a renamed id
 * (which takes the achievement away from everyone who earned it), plus the
 * small one — a new achievement with no picture, which silently falls back to
 * the trophy and reads as a bug.
 */

const EMPTY: PlayerProfile = {
  wallet: null,
  displayName: "Citizen",
  pfp: null,
  outfitId: "default",
  score: 0,
  swapCount: 0,
  transferCount: 0,
  bountyCount: 0,
  unlockedOutfits: ["default"],
  unlockedAchievements: [],
  visitedNPCs: [],
  discoveredZones: [],
  joinedAt: 0,
  lastActive: 0,
};

describe("achievement registry", () => {
  it("has no duplicate ids", () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the ids players already earned", () => {
    // Anything in this list has been in a shipped build. Renaming one is a
    // silent regression: the unlock stays in the profile pointing at nothing.
    const shipped = [
      "first-swap", "first-transfer", "streak-3", "met-sol",
      "met-everyone", "trader-10", "streak-7", "score-1000",
    ];
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
    for (const id of shipped) expect(ids.has(id)).toBe(true);
  });

  it("gives every achievement a tier with a colour", () => {
    for (const ach of ACHIEVEMENTS) {
      expect(TIER_COLORS[ach.tier]).toBeTruthy();
    }
  });

  it("gives every achievement its own art", () => {
    for (const ach of ACHIEVEMENTS) {
      expect(ACHIEVEMENT_ART[ach.id], ach.id).toBeTruthy();
    }
  });

  it("awards nothing to a profile that has done nothing", () => {
    for (const ach of ACHIEVEMENTS) {
      expect(ach.check(EMPTY), ach.id).toBe(false);
    }
  });

  it("reads tallies off the counters bag", () => {
    const withKicks: PlayerProfile = { ...EMPTY, counters: { "ball-kicks": 25 } };
    const ball = ACHIEVEMENTS.filter((a) => a.id.startsWith("ball-"));
    expect(ball.length).toBeGreaterThan(1);
    expect(ball.find((a) => a.id === "ball-1")!.check(withKicks)).toBe(true);
    expect(ball.find((a) => a.id === "ball-25")!.check(withKicks)).toBe(true);
    expect(ball.find((a) => a.id === "ball-100")!.check(withKicks)).toBe(false);
  });
});
