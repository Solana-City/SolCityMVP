#!/usr/bin/env node
/**
 * Shrinks UI art back to the pixel grid it was actually drawn on.
 *
 * The HUD icons ship as 64x64 PNGs, but every 2x2 block in them is a single
 * colour: the art is 32x32, exported at double size. That looks harmless and
 * is not, because the browser then scales a doubled image: at two thirds of
 * the file it samples the REAL pixels at one-and-a-half-pixel steps, so some
 * come through twice and some vanish. It is the same tearing as the canvas
 * had, one layer up, and it happens at sizes that look like they should be
 * safe.
 *
 * With the file on its true grid, a size is crisp exactly when it is a whole
 * multiple or a whole fraction of it — which is what ui/crispPixels assumes
 * and ui/useCrispPixelArt enforces at runtime.
 *
 * Lossless: a block is only collapsed when every pixel in it is identical, so
 * nothing is averaged or guessed. Idempotent, and safe to run after every art
 * drop.
 *
 *     node scripts/shrink-blown-up-art.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOTS = [path.join(HERE, "..", "public", "assets", "ui")];
const DRY = process.argv.includes("--dry");

/** The largest N where the image is made of uniform NxN blocks. */
function blockSize(png) {
  const { width: w, height: h, data } = png;
  for (const n of [4, 3, 2]) {
    if (w % n || h % n) continue;
    let uniform = true;
    for (let by = 0; by < h / n && uniform; by++) {
      for (let bx = 0; bx < w / n && uniform; bx++) {
        const a = ((w * (by * n)) + (bx * n)) << 2;
        for (let y = 0; y < n && uniform; y++) {
          for (let x = 0; x < n; x++) {
            const i = ((w * (by * n + y)) + (bx * n + x)) << 2;
            if (data[i] !== data[a] || data[i + 1] !== data[a + 1] ||
                data[i + 2] !== data[a + 2] || data[i + 3] !== data[a + 3]) {
              uniform = false;
              break;
            }
          }
        }
      }
    }
    if (uniform) return n;
  }
  return 1;
}

function shrink(png, n) {
  const out = new PNG({ width: png.width / n, height: png.height / n });
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const src = ((png.width * (y * n)) + (x * n)) << 2;
      const dst = ((out.width * y) + x) << 2;
      png.data.copy(out.data, dst, src, src + 4);
    }
  }
  return out;
}

const files = [];
for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      if (p.endsWith(".png")) files.push(p);
    }
  })(root);
}

let shrunk = 0;
for (const file of files.sort()) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const n = blockSize(png);
  if (n === 1) continue;
  const out = shrink(png, n);
  console.log(
    `${path.basename(file).padEnd(26)} ${png.width}x${png.height} -> ${out.width}x${out.height}` +
    `  (${n}x blow-up, ${(100 - 100 / (n * n)).toFixed(0)}% less memory)`,
  );
  if (!DRY) fs.writeFileSync(file, PNG.sync.write(out));
  shrunk++;
}

console.log(`\n${shrunk} file${shrunk === 1 ? "" : "s"} put back on their grid${DRY ? " (dry run)" : ""}.`);
