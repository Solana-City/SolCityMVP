import { describe, it, expect } from "vitest";
import { effectCell, SPRITE_COLS } from "./paperDoll";

/**
 * The three ways an effect sheet can be read. They share one function so the
 * game, the wardrobe tile and the large preview cannot drift apart, which
 * makes it worth pinning what each one actually returns.
 */
const FPS = 1000 / 150;
const at = (ms: number) => ms;

describe("effectCell", () => {
  const halo = { frames: 24, fps: FPS };
  const crown = { frames: 48, fps: FPS, steady: true };
  const trousers = { frames: 48, fps: FPS, walkSynced: true };

  it("walks every cell of a plain effect, one per 150 ms", () => {
    expect(effectCell(halo, at(0))).toBe(0);
    expect(effectCell(halo, at(149))).toBe(0);
    expect(effectCell(halo, at(150))).toBe(1);
    expect(effectCell(halo, at(150 * 23))).toBe(23);
    // 24 cells at 150 ms is a 3.6 s loop.
    expect(effectCell(halo, at(3600))).toBe(0);
  });

  it("plays only the first cell of each group when steady", () => {
    // The artist drew a bob into each group; a crown sits on a head that does
    // not bob, so it takes cell 0 of group 0, then cell 0 of group 1.
    expect(effectCell(crown, at(0))).toBe(0);
    expect(effectCell(crown, at(150))).toBe(SPRITE_COLS);
    expect(effectCell(crown, at(300))).toBe(SPRITE_COLS * 2);
    // 48 cells is 12 groups, so the loop is 1.8 s.
    expect(effectCell(crown, at(1800))).toBe(0);
  });

  it("keeps the walk column and steps the group when walkSynced", () => {
    // This is the whole point: the leg the player sees decides the column, so
    // a garment cannot slide out of step with the body under it.
    for (let col = 0; col < SPRITE_COLS; col++) {
      expect(effectCell(trousers, at(0), col)).toBe(col);
      expect(effectCell(trousers, at(150), col)).toBe(SPRITE_COLS + col);
    }
    expect(effectCell(trousers, at(150 * 11), 3)).toBe(SPRITE_COLS * 11 + 3);
    expect(effectCell(trousers, at(1800), 3)).toBe(3);
  });

  it("falls back to the standing pose where there is no walk to read", () => {
    // The wardrobe tile and the preview pass no column, so a garment reads
    // exactly as a steady effect does rather than freezing mid-stride.
    expect(effectCell(trousers, at(0))).toBe(effectCell(crown, at(0)));
    expect(effectCell(trousers, at(450))).toBe(effectCell(crown, at(450)));
  });

  it("never leaves the sheet", () => {
    for (const fx of [halo, crown, trousers]) {
      for (let ms = 0; ms < 4000; ms += 37) {
        for (let col = 0; col < SPRITE_COLS; col++) {
          const cell = effectCell(fx, ms, col);
          expect(cell).toBeGreaterThanOrEqual(0);
          expect(cell).toBeLessThan(fx.frames);
        }
      }
    }
  });
});
