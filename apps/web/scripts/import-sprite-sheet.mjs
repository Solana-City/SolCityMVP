// Brings a character sheet from the artist into the game, with its background
// colour knocked out.
//
//   node apps/web/scripts/import-sprite-sheet.mjs <source.png> "<Sprite Key>"
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

import { Jimp, intToRGBA } from "jimp";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [source, key] = process.argv.slice(2);
if (!source || !key) {
  console.error('usage: import-sprite-sheet.mjs <source.png> "<Sprite Key>"');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../public/assets/sprites", `${key}.png`);

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
console.log(`${key}.png  ${img.width}x${img.height}`);
console.log(`background ${hex} cleared on ${pct}% of the sheet`);
if (img.width % 64 === 0 && img.height % 64 === 0) {
  console.log(`grid ${img.width / 64} x ${img.height / 64} frames of 64px`);
} else {
  console.log("note: not a whole number of 64px frames, so it needs spriteAnimation in the registry");
}
