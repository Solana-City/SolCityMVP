import { describe, it, expect } from "vitest";
import {
  AFK_AFTER_MS, HIDE_AFTER_MS, DIR_LEFT, PresenceTracker, activityKey, presenceFor, type Activity,
} from "./presence";

/**
 * Presence is what everybody else sees: active, faded as AFK, or gone. These
 * pin when each happens and what wakes a player up again.
 */
const base: Activity = { x: 100, y: 200, facing: 0, left: false, expressionAt: 0, messageAt: 0, loadout: "H=1" };
const key = (over: Partial<Activity> = {}) => activityKey({ ...base, ...over });

describe("presence by idle time", () => {
  it("is active, then afk, then hidden", () => {
    expect(presenceFor(0)).toBe("active");
    expect(presenceFor(AFK_AFTER_MS - 1)).toBe("active");
    expect(presenceFor(AFK_AFTER_MS)).toBe("afk");
    expect(presenceFor(HIDE_AFTER_MS)).toBe("hidden");
  });

  it("uses the top bit of the direction byte, clear of facing, walking and buff", () => {
    expect(DIR_LEFT & 0b0111_1111).toBe(0);
  });
});

describe("the tracker", () => {
  it("does not wake a player with a heartbeat: the same state again", () => {
    const t = new PresenceTracker();
    t.sight("A", key(), 1, 0);
    t.sight("A", key(), 2, AFK_AFTER_MS - 10);
    expect(t.tick(AFK_AFTER_MS)).toEqual([{ wallet: "A", state: "afk" }]);
  });

  it("counts a move, a chat, an expression or an outfit as activity", () => {
    for (const change of [{ x: 101 }, { messageAt: 9 }, { expressionAt: 9 }, { loadout: "H=2" }, { facing: 2 }]) {
      const t = new PresenceTracker();
      t.sight("A", key(), 1, 0);
      t.sight("A", key(change), 2, AFK_AFTER_MS - 10);
      expect(t.tick(AFK_AFTER_MS)).toEqual([]);
    }
  });

  it("reports each change of presence once", () => {
    const t = new PresenceTracker();
    t.sight("A", key(), 1, 0);
    expect(t.tick(AFK_AFTER_MS)).toEqual([{ wallet: "A", state: "afk" }]);
    expect(t.tick(AFK_AFTER_MS + 1000)).toEqual([]);
    expect(t.tick(HIDE_AFTER_MS)).toEqual([{ wallet: "A", state: "hidden" }]);
  });

  it("brings an afk player back to active when they move", () => {
    const t = new PresenceTracker();
    t.sight("A", key(), 1, 0);
    t.tick(AFK_AFTER_MS);
    t.sight("A", key({ x: 150 }), 2, AFK_AFTER_MS + 500);
    expect(t.tick(AFK_AFTER_MS + 600)).toEqual([{ wallet: "A", state: "active" }]);
  });

  it("keeps a dormant player out until their account changes", () => {
    const t = new PresenceTracker();
    t.sight("A", key(), 10, 0);
    t.sleep("A", key(), 10);
    expect(t.sight("A", key(), 11, 1000)).toBe("ignore");
    expect(t.sight("A", key({ x: 300 }), 12, 2000)).toBe("ok");
    expect(t.isDormant("A")).toBe(false);
  });

  it("wakes a logged-out player when they log back in, even on the same spot", () => {
    const t = new PresenceTracker();
    t.sleep("A", key({ left: true }), 10);
    expect(t.sight("A", key({ left: true }), 10, 0)).toBe("ignore");
    expect(t.sight("A", key(), 50, 1000)).toBe("ok");
  });

  it("wakes a player hidden as AFK who logs out and back in on the same spot", () => {
    const t = new PresenceTracker();
    t.sight("A", key(), 10, 0);
    t.sleep("A");                              // hidden for being AFK
    t.sleep("A", key({ left: true }), 20);     // then logged out
    expect(t.sight("A", key(), 30, 1000)).toBe("ok");
  });

  it("ignores an older copy that arrives after the logout", () => {
    const t = new PresenceTracker();
    t.sleep("A", key({ left: true }), 10);
    expect(t.sight("A", key(), 9, 0)).toBe("ignore");
  });

  it("remembers who is asleep across our own reconnect", () => {
    const t = new PresenceTracker();
    t.sleep("A", key(), 10);
    t.clearSeen();
    expect(t.sight("A", key(), 11, 0)).toBe("ignore");
  });
});
