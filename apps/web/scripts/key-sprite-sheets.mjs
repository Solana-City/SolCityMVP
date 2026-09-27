#!/usr/bin/env node
/**
 * Clears the pink chroma key out of the sprite sheets, once, in the files.
 *
 * The game keys the pink (215,123,186) out at load time, inside Phaser. That
 * covers everything Phaser draws — and nothing else. Every preview drawn by
 * the DOM loads the raw PNG instead: the dialogue highlight cards, the
 * tutorial flow nodes, the city guide, the pixel icons. Sheets the artist
 * exported with transparency looked right there; sheets that still carried
 * the key showed a pink square, which is what the 2026-09-27 playtest saw.
 *
 * So the files get keyed here, with the SAME rules BootScene applies, and the
 * runtime pass then finds nothing left to do (it already skips a sheet whose
 * top-left pixel is not the key colour).
 *
 * The rules, from BootScene.applyChromaKey:
 *   - flood fill from each frame's borders for paperdoll SKIN sheets only,
 *     because the key colour can equal a pink skin tone and a flat pass
 *     punches holes in a pink-skinned character;
 *   - flat everywhere else, which also clears pockets the art encloses (the
 *     Kite Pro kite, the gap under a cap's brim) that a fill cannot reach.
 *
 * Idempotent: a second run finds nothing and rewrites nothing.
 *
 *     node scripts/key-sprite-sheets.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPRITES = path.join(HERE, "..", "public", "assets", "sprites");
const DRY = process.argv.includes("--dry");

const CHROMA = [215, 123, 186];
const TOLERANCE = 30;
const FRAME = 64;

const isKey = (d, a) =>
  Math.abs(d[a] - CHROMA[0]) <= TOLERANCE &&
  Math.abs(d[a + 1] - CHROMA[1]) <= TOLERANCE &&
  Math.abs(d[a + 2] - CHROMA[2]) <= TOLERANCE;

/** Every matching pixel, pockets included. */
function flat(png) {
  const d = png.data;
  let cleared = 0;
  for (let a = 0; a < d.length; a += 4) {
    if (d[a + 3] !== 0 && isKey(d, a)) { d[a + 3] = 0; cleared++; }
  }
  return cleared;
}

/** Only what is reachable from each frame's border. */
function flood(png) {
  const d = png.data;
  const w = png.width, h = png.height;
  let cleared = 0;
  const stack = [];
  const tryClear = (i) => {
    const a = i * 4;
    if (d[a + 3] === 0) return;
    if (isKey(d, a)) { d[a + 3] = 0; cleared++; stack.push(i); }
  };
  const cols = Math.max(1, Math.floor(w / FRAME));
  const rows = Math.max(1, Math.floor(h / FRAME));
  for (let fr = 0; fr < rows; fr++) {
    for (let fc = 0; fc < cols; fc++) {
      const x0 = fc * FRAME, y0 = fr * FRAME;
      const x1 = Math.min(x0 + FRAME, w), y1 = Math.min(y0 + FRAME, h);
      for (let x = x0; x < x1; x++) { tryClear(y0 * w + x); tryClear((y1 - 1) * w + x); }
      for (let y = y0; y < y1; y++) { tryClear(y * w + x0); tryClear(y * w + (x1 - 1)); }
      while (stack.length) {
        const i = stack.pop();
        const px = i % w;
        const py = (i - px) / w;
        if (px > x0) tryClear(i - 1);
        if (px < x1 - 1) tryClear(i + 1);
        if (py > y0) tryClear(i - w);
        if (py < y1 - 1) tryClear(i + w);
      }
    }
  }
  return cleared;
}

const files = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) { walk(p); continue; }
    if (p.endsWith(".png")) files.push(p);
  }
})(SPRITES);

let touched = 0;
let keptPink = 0;
for (const file of files.sort()) {
  const rel = path.relative(SPRITES, file).replace(/\\/g, "/");
  const png = PNG.sync.read(fs.readFileSync(file));

  // Only a sheet whose frame corner IS the key needs the pass — the same test
  // BootScene uses, so this never touches art the artist exported clean.
  if (!(png.data[3] !== 0 && isKey(png.data, 0))) continue;

  const skin = rel.startsWith("paperdoll/skin/");
  const cleared = skin ? flood(png) : flat(png);
  const left = (() => {
    let n = 0;
    for (let a = 0; a < png.data.length; a += 4) if (png.data[a + 3] !== 0 && isKey(png.data, a)) n++;
    return n;
  })();
  keptPink += left;

  console.log(
    `${rel.padEnd(38)} ${skin ? "flood" : "flat "} cleared ${String(cleared).padStart(6)}` +
    (left ? `  kept ${left} pink pixels of art` : ""),
  );
  if (!DRY) fs.writeFileSync(file, PNG.sync.write(png));
  touched++;
}

console.log(`\n${touched} sheet${touched === 1 ? "" : "s"} keyed${DRY ? " (dry run, nothing written)" : ""}.`);
if (keptPink) console.log(`${keptPink} pink pixels kept, which is pink art (skin) the flood fill protected.`);
