import { describe, it, expect } from "vitest";
import { GAME_SLOTS, GAME_SLOT_CAP, gameSlotOf, gameInSlot } from "./slots";

/**
 * The slot table addresses scores that are already on chain, on accounts
 * nobody can rewrite. Reordering it does not break a build, it re-labels
 * history: every Kite Clash record silently becomes a Food Cart record.
 *
 * So the order is pinned here by value. A test that only checked "the ids are
 * unique" would pass through exactly the edit that does the damage.
 */
describe("the mini-game slot table", () => {
  it("has not been reordered", () => {
    expect(GAME_SLOTS[0]).toBe("food-cart");
    expect(GAME_SLOTS[1]).toBe("kite-clash");
    expect(GAME_SLOTS[2]).toBe("sol-mechs");
    expect(GAME_SLOTS[3]).toBe("hair-specialist");
    expect(GAME_SLOTS[4]).toBe("pumpkin-carving");
  });

  it("fits the array the program reserves", () => {
    // Widening game_bests is a struct change and a redeploy, so running out
    // of slots is a program problem, not a client one.
    expect(GAME_SLOTS.length).toBeLessThanOrEqual(GAME_SLOT_CAP);
  });

  it("names no game twice, which would make one slot unreachable", () => {
    expect(new Set(GAME_SLOTS).size).toBe(GAME_SLOTS.length);
  });

  it("answers -1 for a game with no slot, never 0", () => {
    // 0 is Food Cart. Defaulting an unknown game to it would file a stranger's
    // score on Food Cart's board, which is worse than recording nothing.
    expect(gameSlotOf("not-a-game")).toBe(-1);
    expect(gameSlotOf("")).toBe(-1);
  });

  it("round-trips a slot back to its id", () => {
    GAME_SLOTS.forEach((id, i) => {
      expect(gameSlotOf(id)).toBe(i);
      expect(gameInSlot(i)).toBe(id);
    });
    expect(gameInSlot(GAME_SLOT_CAP - 1)).toBeNull();
  });
});
