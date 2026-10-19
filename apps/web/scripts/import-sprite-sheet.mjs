// Brings a character sheet from the artist into the game, with its background
// colour knocked out.
//
//   node apps/web/scripts/import-sprite-sheet.mjs <source.png> "<Sprite Key>"
//   node apps/web/scripts/import-sprite-sheet.mjs <source.png> paperdoll/hat/Seeker_hat
//
// Sheets arrive on a flat colour (the artist's canvas) which has to become
// transparent, and under a name that says nothing (seeker.png). The file lands
// at public/assets/sprites/<Sprite Key>.png, which is exactly where BootScene
// looks: it loads every spriteKey in the NPC registry by that name, so nothing
// else needs changing once the registry points at the key.
//
// The background colour is sampled from the top-left pixel. Pixel art has no
// anti-aliasing, so an exact match is normally right; the small tolerance below
// catches a sheet that was saved through a lossy step on the way here.
//
// NOT for paperdoll skin sheets. The chroma key (215,123,186) can equal a pink
// skin tone, and the flat pass below would punch holes through the character.
// Those need the flood fill in scripts/key-sprite-sheets.mjs, which is also
// what the runtime does for them.

import { Jimp, intToRGBA } from "jimp";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [source, name] = process.argv.slice(2);
if (!source || !name) {
  console.error('usage: import-sprite-sheet.mjs <source.png> "<Sprite Key>" | <sub/folder/name>');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../public/assets/sprites", `${name}.png`);
mkdirSync(dirname(out), { recursive: true });

/** How far a pixel may sit from the background colour and still be knocked out. */
const TOLERANCE = 12;

const img = await Jimp.read(source);
const bg = intToRGBA(img.getPixelColor(0, 0));

let cleared = 0;
for (let y = 0; y < img.height; y++) {
  for (let x = 0; x < img.width; x++) {
    const p = intToRGBA(img.getPixelColor(x, y));
    const near =
      Math.abs(p.r - bg.r) <= TOLERANCE &&
      Math.abs(p.g - bg.g) <= TOLERANCE &&
      Math.abs(p.b - bg.b) <= TOLERANCE;
    if (near) {
      img.setPixelColor(0x00000000, x, y);
      cleared++;
    }
  }
}

await img.write(out);

const hex = `#${[bg.r, bg.g, bg.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const pct = ((100 * cleared) / (img.width * img.height)).toFixed(1);
console.log(`${name}.png  ${img.width}x${img.height}`);
console.log(`background ${hex} cleared on ${pct}% of the sheet`);
if (img.width % 64 === 0 && img.height % 64 === 0) {
  console.log(`grid ${img.width / 64} x ${img.height / 64} frames of 64px`);
  checkGrid();
} else {
  console.log("note: not a whole number of 64px frames, so it needs spriteAnimation in the registry");
}

/**
 * Nothing above moves a frame: the sheet is read exactly as the artist drew
 * it. Art whose rows sit a few pixels off the 64px grid therefore imports
 * without a complaint and renders with a slice of one frame showing inside
 * its neighbour, which is a miserable thing to work backwards from in the
 * game (the Pumpkin Head arrived with its last two rows 3px high, so the top
 * of a pumpkin turned up at the character's feet).
 *
 * The bands are runs of rows, or columns, that carry any ink at all. A band
 * that crosses a frame edge means either art drawn off the grid or art that
 * fills its frame edge to edge and has merged with the next one. Both are
 * worth a human look, and neither can be told apart from here, so this warns
 * and leaves the file alone.
 */
function checkGrid() {
  const { data } = img.bitmap;
  const bandsAlong = (axis) => {
    const n = axis === "row" ? img.height : img.width;
    const m = axis === "row" ? img.width : img.height;
    const bands = [];
    let start = -1;
    for (let i = 0; i < n; i++) {
      let inked = false;
      for (let j = 0; j < m && !inked; j++) {
        const x = axis === "row" ? j : i;
        const y = axis === "row" ? i : j;
        if (data[(y * img.width + x) * 4 + 3] > 10) inked = true;
      }
      if (inked && start < 0) start = i;
      else if (!inked && start >= 0) { bands.push([start, i - 1]); start = -1; }
    }
    if (start >= 0) bands.push([start, n - 1]);
    return bands;
  };

  let crossings = 0;
  for (const axis of ["row", "column"]) {
    for (const [s, e] of bandsAlong(axis)) {
      if (Math.floor(s / 64) === Math.floor(e / 64)) continue;
      crossings++;
      console.warn(`warning: ink ${axis}s ${s}..${e} cross the frame edge at ${(Math.floor(s / 64) + 1) * 64}`);
    }
  }
  if (crossings > 0) {
    console.warn("The art is not inside its frames. Re-grid the source and import it again:");
    console.warn("importing it as it stands puts part of every frame into the one before it.");
    return;
  }
  const tops = bandsAlong("row").map(([s]) => s % 64);
  console.log(`ink starts at y ${tops.join(", ")} of each frame row (hat/ sheets start at 5)`);
}
