import { describe, it, expect } from "vitest";
import { HALLOWEEN_ENDS_AT, isHalloweenOn, CARVING_BOARD } from "./event";
import { questById } from "@/game/quests/questRegistry";
import { NPC_REGISTRY } from "@/game/config/npcRegistry";

/**
 * The event's window, tested against injected instants rather than the clock.
 *
 * A date in code is the one thing here that cannot be checked by playing: by
 * the time it is wrong it is too late, and off by one day or one timezone
 * looks identical until the day it does not. `isHalloweenOn` takes `now` for
 * exactly this.
 */
describe("the Halloween window", () => {
  const at = (iso: string) => Date.parse(iso);

  it("ends at midnight UTC on 2 November 2026", () => {
    expect(new Date(HALLOWEEN_ENDS_AT).toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  it("runs through the whole of 1 November", () => {
    expect(isHalloweenOn(at("2026-11-01T00:00:00Z"))).toBe(true);
    // The last minute of the last day still counts.
    expect(isHalloweenOn(at("2026-11-01T23:59:59Z"))).toBe(true);
  });

  it("is off from the first instant of 2 November", () => {
    expect(isHalloweenOn(HALLOWEEN_ENDS_AT)).toBe(false);
    expect(isHalloweenOn(at("2026-11-02T00:00:00Z"))).toBe(false);
    expect(isHalloweenOn(at("2026-11-09T12:00:00Z"))).toBe(false);
  });

  it("is on during the week the event was announced for", () => {
    expect(isHalloweenOn(at("2026-10-25T00:00:00Z"))).toBe(true);
    expect(isHalloweenOn(at("2026-10-31T18:00:00Z"))).toBe(true);
  });

  it("gates the things that are the event, and nothing else", () => {
    // The quest asks the window itself, so it cannot drift from the NPC.
    expect(questById("halloween-pumpkin")?.available).toBe(isHalloweenOn);
    // The NPC carries the window as a resolved boolean, since the registry is
    // static data read once. True today; this test is about it being wired.
    const jack = NPC_REGISTRY.find((n) => n.id === "jack-o-lantern");
    expect(jack?.enabled).toBe(isHalloweenOn());
  });

  it("names the board the carving screen and the reconciliation share", () => {
    // One string, because the hat is re-granted from this board and a second
    // copy is a silent way for the two to stop agreeing.
    expect(CARVING_BOARD).toBe("game:pumpkin-carving");
  });
});
