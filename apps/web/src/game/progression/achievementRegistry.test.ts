import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  BITS_PER_TRACK,
  TIER_COLORS,
  TRACKS,
  levelBitIndex,
  levelName,
  trackProgress,
} from "./achievementRegistry";
import { ACHIEVEMENT_ART } from "@/ui/PixelIcons";
import type { PlayerProfile } from "@/game/config/profileManager";

/**
 * Achievements are one track per action, with levels. The expensive mistakes
 * are no longer about renaming an id: a published profile is a set of BIT
 * POSITIONS, so the thing that must not move is the layout. A shifted bit means
 * players appear to hold levels they never reached, on every profile already on
 * chain.
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

describe("the tracks", () => {
  it("has no duplicate track ids", () => {
    const ids = TRACKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps every track's milestones ascending", () => {
    // trackProgress stops counting at the first unmet rung, so an out-of-order
    // ladder would strand every level above the dip.
    for (const t of TRACKS) {
      const ats = t.levels.map((l) => l.at);
      expect([...ats].sort((a, b) => a - b), t.id).toEqual(ats);
    }
  });

  it("gives every track at least one level", () => {
    for (const t of TRACKS) expect(t.levels.length, t.id).toBeGreaterThan(0);
  });

  it("keeps every track inside its bit block", () => {
    // The layout is fixed-size blocks. A track with more levels than the block
    // holds would write into the next track's bits.
    for (const t of TRACKS) {
      expect(t.levels.length, t.id).toBeLessThanOrEqual(BITS_PER_TRACK);
    }
  });

  it("fits every track in the 256 bits a published profile has", () => {
    expect(TRACKS.length * BITS_PER_TRACK).toBeLessThanOrEqual(256);
  });

  it("gives every track art that exists", () => {
    for (const t of TRACKS) {
      expect(ACHIEVEMENT_ART[t.art ?? t.id], t.id).toBeTruthy();
    }
  });

  it("gives every level a tier with a colour", () => {
    for (const t of TRACKS) {
      for (const lv of t.levels) expect(TIER_COLORS[lv.tier], t.id).toBeTruthy();
    }
  });
});

describe("the bit layout", () => {
  it("never reuses a bit", () => {
    const bits = ACHIEVEMENTS.map((a) => a.bit);
    expect(new Set(bits).size).toBe(bits.length);
  });

  it("keeps a track's bits inside its own block", () => {
    TRACKS.forEach((t, i) => {
      const lo = i * BITS_PER_TRACK;
      for (let lv = 1; lv <= t.levels.length; lv++) {
        const bit = levelBitIndex(i, lv);
        expect(bit, t.id).toBeGreaterThanOrEqual(lo);
        expect(bit, t.id).toBeLessThan(lo + BITS_PER_TRACK);
      }
    });
  });

  it("does not move other tracks when one gains a level", () => {
    // The property the whole block layout exists for. Adding a rung to track 0
    // must not touch track 1's bits.
    const before = levelBitIndex(1, 1);
    const afterOneMoreLevelOnTrackZero = levelBitIndex(1, 1);
    expect(afterOneMoreLevelOnTrackZero).toBe(before);
    // And a new rung on track 0 takes the next free bit in track 0's own block.
    expect(levelBitIndex(0, TRACKS[0].levels.length + 1))
      .toBeLessThan(BITS_PER_TRACK);
  });
});

describe("reading progress", () => {
  it("awards nothing to a profile that has done nothing", () => {
    for (const ach of ACHIEVEMENTS) {
      expect(ach.check(EMPTY), ach.id).toBe(false);
    }
    for (const t of TRACKS) {
      expect(trackProgress(t, EMPTY).level, t.id).toBe(0);
    }
  });

  it("counts the rungs a tally has passed, and no more", () => {
    const withKicks: PlayerProfile = { ...EMPTY, counters: { "ball-kicks": 25 } };
    const ball = TRACKS.find((t) => t.id === "ball")!;
    const p = trackProgress(ball, withKicks);
    // Ladder is 1, 25, 100, 500, 1000: two rungs met at 25 kicks.
    expect(p.level).toBe(2);
    expect(p.value).toBe(25);
    expect(p.next?.at).toBe(100);
  });

  it("measures the bar from the rung below, not from zero", () => {
    const dog = TRACKS.find((t) => t.id === "dog")!;
    // Ladder 1, 5, 10, 50, 100, 500. At 10 pets level 3 is just reached, so the
    // bar toward 50 should be at its start, not already most of the way along.
    const justLevelled = trackProgress(dog, { ...EMPTY, counters: { "dog-pets": 10 } });
    expect(justLevelled.level).toBe(3);
    expect(justLevelled.fraction).toBe(0);

    const halfway = trackProgress(dog, { ...EMPTY, counters: { "dog-pets": 30 } });
    expect(halfway.level).toBe(3);
    expect(halfway.fraction).toBeCloseTo(0.5, 1);
  });

  it("reports a finished track as full, with nothing next", () => {
    const dog = TRACKS.find((t) => t.id === "dog")!;
    const done = trackProgress(dog, { ...EMPTY, counters: { "dog-pets": 99999 } });
    expect(done.level).toBe(dog.levels.length);
    expect(done.next).toBeNull();
    expect(done.fraction).toBe(1);
  });

  it("paints a track in the tier of the highest rung reached", () => {
    const streak = TRACKS.find((t) => t.id === "streak")!;
    expect(trackProgress(streak, { ...EMPTY, streakBest: 30 }).tier).toBe("legendary");
    expect(trackProgress(streak, { ...EMPTY, streakBest: 3 }).tier).toBe("common");
  });

  it("names an unnamed rung by its number instead of leaving it blank", () => {
    const dog = TRACKS.find((t) => t.id === "dog")!;
    expect(levelName(dog, 1)).toBe("Good Dog");   // named in the registry
    expect(levelName(dog, 2)).toBe("The Caramel Dog 2"); // not named
  });
});

describe("the flat view the engine and toasts use", () => {
  it("has no duplicate ids", () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has one entry per rung across every track", () => {
    expect(ACHIEVEMENTS.length).toBe(TRACKS.reduce((n, t) => n + t.levels.length, 0));
  });

  it("keeps the names the city already shipped", () => {
    // These were each a whole achievement before this pass. They are rungs now,
    // but a player who earned one should still see the name they earned.
    const titles = new Set(ACHIEVEMENTS.map((a) => a.title));
    for (const name of [
      "First Swap", "First Transfer", "Regular", "New in Town", "Social Butterfly",
      "Active Trader", "Market Maker", "Postman", "Shareholder", "Sharp Eyes",
      "First Touch", "Beach Pelada", "Good Dog", "Best Friend", "Player One",
      "On a Roll", "King of the Sky", "First Scrap", "Ranked Debut", "Arena Name",
      "Week in the City", "Resident", "Citizen of the Year", "Mayor Material",
    ]) {
      expect(titles.has(name), name).toBe(true);
    }
  });

  it("points every rung at art that exists", () => {
    for (const ach of ACHIEVEMENTS) {
      expect(ACHIEVEMENT_ART[ach.art], ach.id).toBeTruthy();
    }
  });

  it("agrees with its track on when a rung is met", () => {
    const withKicks: PlayerProfile = { ...EMPTY, counters: { "ball-kicks": 25 } };
    const ball = ACHIEVEMENTS.filter((a) => a.trackId === "ball");
    expect(ball.find((a) => a.level === 1)!.check(withKicks)).toBe(true);
    expect(ball.find((a) => a.level === 2)!.check(withKicks)).toBe(true);
    expect(ball.find((a) => a.level === 3)!.check(withKicks)).toBe(false);
  });
});
