import { describe, expect, it } from "vitest";
import {
  PLAYER_CUT_LOOSE_MS, PLAYER_CUT_TIGHT_MS, cutBackfireChance, exposureFromLineLength,
  playerCutDurationMs, scoreRatePerSecond,
} from "./constants";

describe("player cut timing", () => {
  it("saws faster through a rival flying on a looser line", () => {
    expect(playerCutDurationMs(0)).toBe(PLAYER_CUT_TIGHT_MS);
    expect(playerCutDurationMs(1)).toBe(PLAYER_CUT_LOOSE_MS);
    expect(playerCutDurationMs(0.5)).toBeLessThan(playerCutDurationMs(0.2));
  });

  it("never takes longer than the tight case or less than the loose one", () => {
    for (const e of [0, 0.25, 0.5, 0.75, 1]) {
      const ms = playerCutDurationMs(e);
      expect(ms).toBeLessThanOrEqual(PLAYER_CUT_TIGHT_MS);
      expect(ms).toBeGreaterThanOrEqual(PLAYER_CUT_LOOSE_MS);
    }
  });
});

describe("risk and reward stay tied to line length", () => {
  it("charges more backfire risk the more line you have out", () => {
    expect(cutBackfireChance(0)).toBeLessThan(cutBackfireChance(1));
    expect(cutBackfireChance(0)).toBeGreaterThan(0);
    expect(cutBackfireChance(1)).toBeLessThanOrEqual(0.3);
  });

  it("pays more points the more line you have out", () => {
    expect(scoreRatePerSecond(1)).toBeGreaterThan(scoreRatePerSecond(0));
  });

  it("maps line length to exposure between 0 and 1", () => {
    expect(exposureFromLineLength(10)).toBe(0);
    expect(exposureFromLineLength(100)).toBe(1);
    expect(exposureFromLineLength(1000)).toBe(1);
  });
});
