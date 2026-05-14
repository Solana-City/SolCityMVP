/**
 * Generates PWA icons (192x192 and 512x512) from SCLogoIcon.png
 * Uses the @vercel/og / satori approach via sharp if available,
 * otherwise creates a minimal placeholder PNG.
 *
 * Run: node scripts/generate-icons.mjs
 */

import { createCanvas, loadImage } from 'canvas';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const sizes = [192, 512];
const src = resolve('public/assets/tilesets/SCLogoIcon.png');
const outDir = resolve('public/icons');

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const img = await loadImage(src);

for (const size of sizes) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#060a1e';
  ctx.fillRect(0, 0, size, size);

  // Logo centered, 75% of canvas
  const logoSize = Math.floor(size * 0.75);
  const offset = Math.floor((size - logoSize) / 2);
  ctx.drawImage(img, offset, offset, logoSize, logoSize);

  const out = resolve(outDir, `icon-${size}.png`);
  writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(`✓ icon-${size}.png`);
}
