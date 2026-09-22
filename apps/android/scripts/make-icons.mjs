// Builds the adaptive launcher icon foregrounds from the branding art.
//
//   node apps/android/scripts/make-icons.mjs
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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "../../web/public/assets/branding/icon.png");
const RES = join(here, "../app/src/main/res");

const ART_DP = 64;
const LAYER_DP = 108;
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const src = await Jimp.read(SRC);
const bg = src.getPixelColor(0, 0);

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
