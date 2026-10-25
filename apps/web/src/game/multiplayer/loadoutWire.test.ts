import { describe, it, expect } from "vitest";
import { globalIndexOf, itemAtGlobalIndex } from "@/game/config/catalogIndex";

/**
 * The wardrobe wire is moving from variant ids to catalog indices, and the two
 * formats have to coexist: a service worker can keep an old build alive for
 * days, and a peer that cannot read the format renders a bald, naked avatar
 * rather than a person.
 *
 * `decodeLoadout` is private to OnChainMultiplayer, so what is pinned here is
 * the property the dual read depends on: that the two formats cannot be
 * confused for each other.
 */
describe("the loadout wire", () => {
  it("no variant id is all digits, so a number is always an index", () => {
    // This is the whole reason the decoder can accept both without a marker.
    // A variant called "7" would be read as catalog index 7 and silently put
    // the wrong thing on somebody's head.
    for (let i = 0; i < 20000; i++) {
      const entry = itemAtGlobalIndex(i);
      if (!entry) continue;
      expect(/^\d+$/.test(entry.variant.id), entry.variant.id).toBe(false);
    }
  });

  it("round-trips an item through its index", () => {
    const entry = itemAtGlobalIndex(globalIndexOf("hat", "hat_black"))!;
    expect(entry.variant.id).toBe("hat_black");
  });

  it("an unknown index decodes to nothing rather than to the wrong item", () => {
    // A peer on a future build naming an index this one has never heard of.
    // Dropping the slot is right; guessing is not.
    expect(itemAtGlobalIndex(60000)).toBeUndefined();
  });
});
