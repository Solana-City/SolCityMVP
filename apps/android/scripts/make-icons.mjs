// Builds the adaptive launcher icon foregrounds from the branding art.
//
//   node apps/android/scripts/make-icons.mjs                    (the shipped icon)
//   node apps/android/scripts/make-icons.mjs art/logo_test4.png  (a candidate)
//   node apps/android/scripts/make-icons.mjs art/logo_test4.png 76  (and bigger)
//
// The source is the branding icon unless one is named, which is how a launcher
// icon gets A/B tested: point it at a candidate, build, look at the phone, and
// run it again with no argument to go back.
//
// Source: apps/web/public/assets/branding/icon.png, a 512x512 image that is
// pixel art drawn on a 4px grid (128x128 logical) on a solid navy background.
// Each density's art is resized straight from the 512 source: nearest neighbour
// when the ratio is a whole number, which keeps every pixel square, and bicubic
// when it is not, since nearest at a fractional ratio makes pixels uneven.
//
// An adaptive icon layer is 108dp with a 66dp safe circle. The art is placed at
// 64dp, which puts the glyph at about 52dp, inside the safe zone, and the navy
// border blends into the navy background layer defined in colors.xml.

import { Jimp, ResizeStrategy } from "jimp";
import { mkdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const arg = process.argv[2];
const SRC = arg
  ? (isAbsolute(arg) ? arg : join(here, "..", arg))
  : join(here, "../../web/public/assets/branding/icon.png");
const RES = join(here, "../app/src/main/res");

/**
 * How much of the 108dp layer the art fills. 64 suits a logo that is mostly
 * its own shape; a character with a face reads better larger, and there is
 * room, because what has to stay inside the 66dp safe circle is the figure and
 * not the square it is drawn on. The corners are flat background and lose
 * nothing when the launcher masks them.
 */
const ART_DP = Number(process.argv[3]) || 64;
const LAYER_DP = 108;
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const src = await Jimp.read(SRC);
const bg = src.getPixelColor(0, 0);
console.log(`source ${basename(SRC)}  ${src.width}x${src.height}`);

for (const [bucket, d] of Object.entries(DENSITIES)) {
  const size = Math.round(LAYER_DP * d);
  const artPx = Math.round(ART_DP * d);
  const whole = Number.isInteger(src.width / artPx);
  const art = src.clone().resize({
    w: artPx,
    h: artPx,
    mode: whole ? ResizeStrategy.NEAREST_NEIGHBOR : ResizeStrategy.BICUBIC,
  });
  const layer = new Jimp({ width: size, height: size, color: bg });
  layer.composite(art, Math.round((size - art.width) / 2), Math.round((size - art.height) / 2));
  const out = join(RES, `mipmap-${bucket}`, "ic_launcher_foreground.png");
  mkdirSync(dirname(out), { recursive: true });
  await layer.write(out);
  console.log(`${bucket.padEnd(8)} ${size}x${size}  art ${artPx}px ${whole ? "nearest" : "bicubic"}`);
}
