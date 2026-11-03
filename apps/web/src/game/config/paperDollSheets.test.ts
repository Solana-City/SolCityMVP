import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LAYER_ORDER, SPRITE_COLS, SPRITE_FRAME_WIDTH, getEnabledVariants } from "./paperDoll";
import type { LayerCategory } from "./paperDoll";

/**
 * A sheet wider than one walk cycle must declare its `effect`.
 *
 * The walk animation finds a facing at row * SPRITE_COLS. On a 48-cell sheet
 * row 1 starts at cell 48, not cell 4, so an animated sheet declared flat
 * shows the wrong facing from the side and the back, and never animates. It
 * happened to the hourglass, then to three more items in the same drop.
 */
const PAPERDOLL = join(process.cwd(), "public", "assets", "sprites", "paperdoll");

/** A PNG's width sits at bytes 16..19 of the IHDR chunk. */
const pngWidth = (file: string) => readFileSync(join(PAPERDOLL, file)).readUInt32BE(16);

describe("paper doll sheets", () => {
  for (const category of LAYER_ORDER as readonly LayerCategory[]) {
    for (const v of getEnabledVariants(category)) {
      it(`${category}/${v.id} declares the cells its sheet has`, () => {
        const cells = pngWidth(v.file) / SPRITE_FRAME_WIDTH;
        expect(cells).toBe(v.effect ? v.effect.frames : SPRITE_COLS);
      });
    }
  }
});
