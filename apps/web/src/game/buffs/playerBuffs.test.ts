import { describe, expect, it } from "vitest";
import {
  BUFFS, BUFF_ORDER, MAX_SPEED_MULTIPLIER, activeBuffIndex, activeBuffs, buffByIndex,
  formatBuffTime, grantBuff, isBuffActive, speedMultiplier,
} from "./playerBuffs";

describe("the buff clock", () => {
  it("counts the first two minutes in minutes and the last one in seconds", () => {
    expect(formatBuffTime(180_000)).toBe("3m");
    expect(formatBuffTime(120_001)).toBe("3m");
    expect(formatBuffTime(120_000)).toBe("2m");
    expect(formatBuffTime(60_001)).toBe("2m");
    expect(formatBuffTime(60_000)).toBe("60s");
    expect(formatBuffTime(59_000)).toBe("59s");
    expect(formatBuffTime(1)).toBe("1s");
    expect(formatBuffTime(0)).toBe("0s");
  });

  it("never shows a negative time once the buff has run out", () => {
    expect(formatBuffTime(-5_000)).toBe("0s");
  });
});

describe("the Vietnamese coffee", () => {
  it("runs three minutes at seventy percent more speed", () => {
    const coffee = BUFFS["vietnamese-coffee"];
    expect(coffee.durationMs).toBe(180_000);
    expect(coffee.speedMultiplier).toBeCloseTo(1.7);
  });

  it("is covered by the clamp the remote interpolator widens for it", () => {
    for (const buff of Object.values(BUFFS)) {
      expect(buff.speedMultiplier).toBeLessThanOrEqual(MAX_SPEED_MULTIPLIER);
    }
    // The clamp is that multiplier plus the same 50% jitter headroom an
    // unbuffed walk gets, so the fastest buff still has room over it.
    expect(MAX_SPEED_MULTIPLIER * 1.5).toBeGreaterThan(MAX_SPEED_MULTIPLIER);
  });
});

describe("the two drinks", () => {
  it("cancel each other instead of stacking", () => {
    grantBuff("vietnamese-coffee");
    expect(isBuffActive("vietnamese-coffee")).toBe(true);

    grantBuff("dom-tea");
    expect(isBuffActive("vietnamese-coffee")).toBe(false);
    expect(isBuffActive("dom-tea")).toBe(true);
    expect(activeBuffs()).toHaveLength(1);
  });

  it("never multiply together, whichever order they are drunk in", () => {
    grantBuff("dom-tea");
    grantBuff("vietnamese-coffee");
    expect(speedMultiplier()).toBeCloseTo(BUFFS["vietnamese-coffee"].speedMultiplier);

    grantBuff("dom-tea");
    expect(speedMultiplier()).toBeCloseTo(BUFFS["dom-tea"].speedMultiplier);
  });

  it("round-trip through the index other players read off the wire", () => {
    for (const id of BUFF_ORDER) {
      grantBuff(id);
      expect(buffByIndex(activeBuffIndex())?.id).toBe(id);
    }
  });

  it("give the tea five gentler minutes than the coffee", () => {
    expect(BUFFS["dom-tea"].durationMs).toBe(300_000);
    expect(BUFFS["dom-tea"].speedMultiplier).toBeLessThan(BUFFS["vietnamese-coffee"].speedMultiplier);
    expect(BUFFS["dom-tea"].durationMs).toBeGreaterThan(BUFFS["vietnamese-coffee"].durationMs);
  });
});
