import { beforeEach, describe, expect, it } from "vitest";
import { clockSkewMs, learnClockSkew, resetClockSkew, serverNow } from "./clockSkew";

/**
 * The case that actually happened: a machine 63 seconds behind, against a
 * server that refuses a signature more than 60 seconds old. Every check-in
 * was rejected, for eight days, with "CHECKING IN..." on screen the whole
 * time.
 */
describe("clock skew", () => {
  beforeEach(() => resetClockSkew());

  it("signs with the local clock when nothing says otherwise", () => {
    expect(Math.abs(serverNow() - Date.now())).toBeLessThan(50);
    expect(clockSkewMs()).toBe(0);
  });

  it("carries a machine that is a minute behind back inside the window", () => {
    const BEHIND_MS = 63_000;
    const received = Date.now();
    learnClockSkew(received + BEHIND_MS, received);

    // What the server would measure of our next signature.
    const ageAtServer = Math.abs((Date.now() + BEHIND_MS) - serverNow());
    expect(ageAtServer).toBeLessThan(60_000);
    expect(clockSkewMs()).toBeCloseTo(BEHIND_MS, -2);
  });

  it("carries one that is ahead, too", () => {
    const received = Date.now();
    learnClockSkew(received - 90_000, received);
    expect(serverNow()).toBeLessThan(Date.now());
  });

  it("ignores a server timestamp that is not one", () => {
    learnClockSkew(NaN);
    expect(clockSkewMs()).toBe(0);
    learnClockSkew(0);
    expect(clockSkewMs()).toBe(0);
  });
});
