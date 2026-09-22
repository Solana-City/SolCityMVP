// Builds the PWA icons (public/icons/icon-192.png, icon-512.png) from the
// branding art.
//
//   node apps/web/scripts/make-pwa-icons.mjs
//
// The manifest declares these icons "any maskable", so Android may crop them to
// a circle. A maskable icon must keep its content inside the central 80% circle;
// the art is therefore placed at 75% on a navy canvas matching its own
// background. The source is pixel art on a 4px grid, and 75% turns each 4px
// block into exactly 3px, so the 512 icon uses nearest neighbour and stays crisp.
// The 192 icon is a fractional ratio and uses bicubic to keep pixels even.
//
// After changing the icons, bump the ?v= query in manifest.json and layout.tsx
// and the sc-shell cache name in next.config.js, or installed clients keep the
// old ones for up to a year.

import { Jimp, ResizeStrategy } from "jimp";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "../public/assets/branding/icon.png");
const OUT = join(here, "../public/icons");

const ART_SCALE = 0.75;

const src = await Jimp.read(SRC);
const bg = src.getPixelColor(0, 0);

for (const size of [192, 512]) {
  const artPx = Math.round(size * ART_SCALE);
  // Output pixels per 4px source block; a whole number keeps pixel art square.
  const whole = Number.isInteger((artPx * 4) / src.width);
  const art = src.clone().resize({
    w: artPx,
    h: artPx,
    mode: whole ? ResizeStrategy.NEAREST_NEIGHBOR : ResizeStrategy.BICUBIC,
  });
  const icon = new Jimp({ width: size, height: size, color: bg });
  icon.composite(art, Math.round((size - artPx) / 2), Math.round((size - artPx) / 2));
  await icon.write(join(OUT, `icon-${size}.png`));
  console.log(`icon-${size}.png  art ${artPx}px ${whole ? "nearest" : "bicubic"}`);
}
