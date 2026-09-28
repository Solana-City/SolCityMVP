import { describe, expect, it } from "vitest";
import { BUFFS, formatBuffTime } from "./playerBuffs";

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
  it("runs three minutes at forty percent more speed", () => {
    const coffee = BUFFS["vietnamese-coffee"];
    expect(coffee.durationMs).toBe(180_000);
    expect(coffee.speedMultiplier).toBeCloseTo(1.4);
  });

  it("stays under the 1.5x the remote interpolator will draw as walking", () => {
    for (const buff of Object.values(BUFFS)) {
      expect(buff.speedMultiplier).toBeLessThan(1.5);
    }
  });
});
