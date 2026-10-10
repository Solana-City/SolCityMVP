// Turns a long animation strip from the artist into a sheet a GPU will accept.
//
//   node apps/web/scripts/pack-animation-sheet.mjs <source.png> <out/name> [frameWidth]
//
// Artists export an animation as one row: 87 frames side by side is 16704px
// wide, and WebGL refuses a texture wider than MAX_TEXTURE_SIZE, which is
// 16384 on a good desktop GPU and 8192 or 4096 on plenty of phones. A strip
// like that does not render slowly, it does not render at all.
//
// So the strip is trimmed and repacked:
//
//   - every frame is cropped to the box the art actually occupies, which is
//     checked to be identical across frames first, so cropping cannot shift
//     the animation. The offset is printed, because placing the sprite needs
//     it to land where the uncropped art would have;
//   - the frames are laid out in a grid instead of a line;
//   - the chroma background is knocked out, the same key the rest of the
//     pipeline uses.
//
// Frame width defaults to the image height, which is right for the square
// frames these strips use; pass it when that is not true.

import { Jimp, intToRGBA } from "jimp";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [source, name, frameWidthArg] = process.argv.slice(2);
if (!source || !name) {
  console.error("usage: pack-animation-sheet.mjs <source.png> <out/name> [frameWidth]");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../public/assets/sprites", `${name}.png`);
mkdirSync(dirname(out), { recursive: true });

/** Keeps both sides of the packed sheet well under any MAX_TEXTURE_SIZE. */
const MAX_SIDE = 2048;
const TOLERANCE = 12;

const src = await Jimp.read(source);
const bg = intToRGBA(src.getPixelColor(0, 0));
const FH = src.height;
const FW = Number(frameWidthArg) || FH;
const count = Math.floor(src.width / FW);
if (count < 1) {
  console.error(`a frame of ${FW}px does not fit in a ${src.width}px strip`);
  process.exit(1);
}

const isBackground = (x, y) => {
  const p = intToRGBA(src.getPixelColor(x, y));
  return (
    Math.abs(p.r - bg.r) <= TOLERANCE &&
    Math.abs(p.g - bg.g) <= TOLERANCE &&
    Math.abs(p.b - bg.b) <= TOLERANCE
  );
};

// The content box of each frame, and whether they all agree.
let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
const boxes = new Set();
for (let f = 0; f < count; f++) {
  let fx0 = Infinity, fy0 = Infinity, fx1 = -1, fy1 = -1;
  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < FW; x++) {
      if (isBackground(f * FW + x, y)) continue;
      if (x < fx0) fx0 = x;
      if (x > fx1) fx1 = x;
      if (y < fy0) fy0 = y;
      if (y > fy1) fy1 = y;
    }
  }
  boxes.add(`${fx0},${fy0},${fx1},${fy1}`);
  x0 = Math.min(x0, fx0); y0 = Math.min(y0, fy0);
  x1 = Math.max(x1, fx1); y1 = Math.max(y1, fy1);
}

const cw = x1 - x0 + 1;
const ch = y1 - y0 + 1;
const cols = Math.max(1, Math.floor(MAX_SIDE / cw));
const rows = Math.ceil(count / cols);

const packed = new Jimp({ width: cols * cw, height: rows * ch, color: 0x00000000 });
for (let f = 0; f < count; f++) {
  const dx = (f % cols) * cw;
  const dy = Math.floor(f / cols) * ch;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const sx = f * FW + x0 + x;
      const sy = y0 + y;
      if (!isBackground(sx, sy)) packed.setPixelColor(src.getPixelColor(sx, sy), dx + x, dy + y);
    }
  }
}
await packed.write(out);

const mb = (w, h) => ((w * h * 4) / 1048576).toFixed(1);
console.log(`${name}.png`);
console.log(`  source      ${src.width}x${src.height}, ${count} frames of ${FW}x${FH}`);
console.log(`  content box ${cw}x${ch} at (${x0}, ${y0}), identical in ${boxes.size === 1 ? "every frame" : `${boxes.size} variants (CROPPING WOULD SHIFT THE ART)`}`);
console.log(`  packed      ${packed.width}x${packed.height}, ${cols} x ${rows} grid`);
console.log(`  texture     ${mb(src.width, src.height)} MB -> ${mb(packed.width, packed.height)} MB`);
console.log("");
console.log(`  frameWidth: ${cw}, frameHeight: ${ch}, frameCount: ${count}`);
console.log(`  draw offset inside the original frame: x ${x0}, y ${y0}`);
