import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import {
  HAIR_COLORS, STYLE_DEFAULT_COLOR, buildHairSwaps, hairColorOf,
  isDefaultHairColor, recolorHair,
} from "./hairPalette";
import { getEnabledVariants } from "./paperDoll";

/**
 * The palette's whole claim is that a hairstyle plus a colour reproduces, to
 * the pixel, a sheet that used to be its own file. Three wardrobe entries were
 * deleted on the strength of it, so it is checked against the real art rather
 * than against a fixture that could drift away from it.
 */

const DIR = path.join(process.cwd(), "public/assets/sprites/paperdoll/hair");
const CHROMA = [215, 123, 186];
const CHROMA_TOL = 30;

/** The sheet as the GAME holds it: chroma background already cleared to alpha 0. */
function loadSheet(file: string): Uint8ClampedArray {
  const png = PNG.sync.read(fs.readFileSync(path.join(DIR, file)));
  const data = new Uint8ClampedArray(png.data);
  for (let i = 0; i < data.length; i += 4) {
    if (
      Math.abs(data[i] - CHROMA[0]) <= CHROMA_TOL &&
      Math.abs(data[i + 1] - CHROMA[1]) <= CHROMA_TOL &&
      Math.abs(data[i + 2] - CHROMA[2]) <= CHROMA_TOL
    ) data[i + 3] = 0;
  }
  return data;
}

/** Where the two differ, counted only on pixels either one actually draws. */
function diffOpaque(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    const aOn = a[i + 3] >= 16, bOn = b[i + 3] >= 16;
    if (aOn !== bOn) { n++; continue; }
    if (!aOn) continue;
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
  }
  return n;
}

describe("hair palette", () => {
  // The three entries deleted from the wardrobe, and what now stands in for
  // each. If one of these ever drifts, a player's saved hair changes colour.
  const COLLAPSED: [string, string, string][] = [
    ["Black_hair.png", "brown", "Brown_hair.png"],
    ["Magawk_blue.png", "green", "Magawk_green.png"],
    ["Magawk_blue.png", "red", "Magawk_red.png"],
  ];

  it.each(COLLAPSED)("recolours %s in %s into exactly %s", (from, color, to) => {
    const got = loadSheet(from);
    recolorHair(got, color);
    expect(diffOpaque(got, loadSheet(to))).toBe(0);
  });

  it("leaves a style alone in the colour it was drawn in", () => {
    // The no-op case is what keeps the common loadout from allocating a single
    // derived texture, so it is worth pinning rather than assuming.
    for (const [style, color] of Object.entries(STYLE_DEFAULT_COLOR)) {
      const variant = getEnabledVariants("hair").find((v) => v.id === style);
      if (!variant) continue; // style retired; the default is harmless
      const data = loadSheet(path.basename(variant.file));
      expect(buildHairSwaps(data, hairColorOf(color)), style).toEqual([]);
      expect(isDefaultHairColor(style, color), style).toBe(true);
    }
  });

  it("gives every shipped hairstyle a default colour", () => {
    for (const v of getEnabledVariants("hair")) {
      expect(STYLE_DEFAULT_COLOR, v.id).toHaveProperty(v.id);
    }
  });

  it("offers twenty swatches, each with a stable unique id", () => {
    expect(HAIR_COLORS).toHaveLength(20);
    expect(new Set(HAIR_COLORS.map((c) => c.id)).size).toBe(20);
    for (const c of HAIR_COLORS) {
      for (const stop of [c.main, c.highlight, c.shadow]) {
        expect(stop, `${c.id} ${stop}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("actually repaints every style it is given", () => {
    // Every style must respond to every swatch: a sheet the scanner bails on
    // would silently stay its original colour in the wardrobe.
    for (const v of getEnabledVariants("hair")) {
      const data = loadSheet(path.basename(v.file));
      for (const c of HAIR_COLORS) {
        if (c.id === STYLE_DEFAULT_COLOR[v.id]) continue;
        expect(buildHairSwaps(data, c).length, `${v.id} / ${c.id}`).toBeGreaterThan(0);
      }
    }
  });
});
