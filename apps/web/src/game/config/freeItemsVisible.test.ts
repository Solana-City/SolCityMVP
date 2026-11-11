import { describe, it, expect } from "vitest";
import { getAllLayerVariants, isFreeItem } from "./paperDoll";
import { globalIndexOf, BOOSTER_BLOCK_START } from "./catalogIndex";

/**
 * A free item must be one OTHER players can see.
 *
 * The program checks every look against the wearer's on-chain list from
 * BOOSTER_BLOCK_START up, and encodeLoadout drops a pack-block item that list
 * lacks. So a pack item made free on the client is seen by its wearer and by
 * nobody else: Halo and Royal_crown, legendary pack items, sat in a "free for
 * testing" list on the belief that they were quest items (devnet, 2026-11-11).
 */
describe("free items", () => {
  it("are never in the pack block", () => {
    const wrong = (getAllLayerVariants() as { category: string; variant: { id: string } }[])
      .filter(({ category, variant }) => isFreeItem(category as never, variant.id))
      .filter(({ category, variant }) => globalIndexOf(category as never, variant.id) >= BOOSTER_BLOCK_START)
      .map(({ category, variant }) => `${category}:${variant.id}`);
    expect(wrong).toEqual([]);
  });
});
