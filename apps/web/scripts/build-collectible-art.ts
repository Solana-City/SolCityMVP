/**
 * Sol City - render every collectible as the picture a marketplace will show.
 *
 *   npx tsx scripts/build-collectible-art.ts \
 *     --out apps/web/public/collectibles \
 *     --base https://solanacity.io/collectibles/
 *
 *   npx tsx scripts/build-collectible-art.ts \
 *     --base https://solanacity.io/collectibles/ \
 *     --image-base https://arweave.net/<manifest-txid>/
 *
 *   npx tsx scripts/build-collectible-art.ts --only hat/Cap_Sol --scale 8
 *
 * ── What comes out ─────────────────────────────────────────────────────
 *
 * Per item, named by its CATALOG INDEX, because that is the only name the
 * chain knows: `mint_unlock` builds `<base_uri><index>.json` and nothing on
 * chain stores a filename.
 *
 *   <index>.gif    the animated card, four frames on a 400ms loop
 *   <index>.png    its first frame, for anything that will not animate
 *   <index>.json   the Metaplex metadata, pointing at the gif
 *
 * And per pack, because a SEALED pack is an asset too and the program builds
 * its URL the same way, from `<base_uri>pack-<id>.json`:
 *
 *   pack-<id>.gif / .png / .json
 *
 * A pack gets no rarity frame. It has no rarity: what is inside it has not
 * been decided yet, and that is the product.
 *
 * ── Why the GIF and not the MP4 the artist also sent ───────────────────
 *
 * The three exports from the artist are the same four cells. Only the sheet
 * can be composed with, because composing means drawing the item over cell N,
 * and the other two are already-flattened playback. The GIF is then generated
 * here WITH the item in it, which is the thing that goes on Arweave; video
 * would only ever be an `animation_url`, which most marketplaces ignore while
 * still demanding an `image`.
 *
 * ── Two bases, not one ─────────────────────────────────────────────────
 *
 * `--base` is where the JSON will be SERVED, and it has to match the
 * program's `base_uri` exactly, because the program builds its URLs from that
 * string and nothing else.
 *
 * `--image-base` is where the pictures live, and it defaults to the same
 * place. They are separate because on mainnet they will not be the same
 * place: the JSON is served from a host we control, so the catalog can keep
 * growing, while the picture it points at is a permanent Arweave URL. See
 * PACK_RULES for why a raw Arweave manifest cannot be `base_uri` itself.
 *
 * Absolute, both of them. A relative `image` resolves differently in every
 * wallet that reads it, and some do not resolve it at all.
 *
 * ── The one number to watch ────────────────────────────────────────────
 *
 * `--scale` is how many output pixels a frame pixel becomes. The item gets
 * its own integer factor, the largest that fits FRAME_GEOMETRY.fill of the
 * window, so both stay crisp and the item's pixels end up slightly larger
 * than the frame's. That is intentional and matches the reference art.
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { PNG } from "pngjs";
import { GifFrame, GifUtil, GifCodec, BitmapImage } from "gifwrap";
import { LAYER_ORDER, DIRECTION_ROW, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT, getEnabledVariants } from "../src/game/config/paperDoll";
import { tileKindOf, PACKS } from "../src/game/config/packs";
import { globalIndexOf } from "../src/game/config/catalogIndex";
import { FRAME_GEOMETRY, FRAME_SHEET, RARITY_LABEL, CURRENT_SEASON } from "../src/game/collections/seasons";
import type { LayerCategory } from "../src/game/config/paperDoll";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "public");

/** The magenta the sheets are keyed on, and the tolerance the runtime uses. */
const CHROMA = { r: 215, g: 123, b: 186, tol: 30 };

interface Bitmap { w: number; h: number; px: Buffer }

function readPng(path: string): Bitmap {
  const png = PNG.sync.read(readFileSync(path));
  return { w: png.width, h: png.height, px: Buffer.from(png.data) };
}

/**
 * Drops the magenta, but only from a sheet that still carries it.
 *
 * The same judgement the runtime makes, by the same test: a transparent
 * top-left pixel means the sheet was exported with alpha and has nothing to
 * key. Keying it anyway would take the Pinki skin's shadow tone with it.
 */
function removeChroma(b: Bitmap): Bitmap {
  if (b.px[3] === 0) return b;
  for (let i = 0; i < b.px.length; i += 4) {
    if (Math.abs(b.px[i] - CHROMA.r) <= CHROMA.tol
      && Math.abs(b.px[i + 1] - CHROMA.g) <= CHROMA.tol
      && Math.abs(b.px[i + 2] - CHROMA.b) <= CHROMA.tol) b.px[i + 3] = 0;
  }
  return b;
}

/** The item's own ink inside one cell. A shirt is 31x17 of a 64x64 cell. */
function inkBox(b: Bitmap, cellX: number, cellY: number) {
  let x0 = SPRITE_FRAME_WIDTH, y0 = SPRITE_FRAME_HEIGHT, x1 = -1, y1 = -1;
  for (let y = 0; y < SPRITE_FRAME_HEIGHT; y++) {
    for (let x = 0; x < SPRITE_FRAME_WIDTH; x++) {
      if (b.px[((cellY + y) * b.w + cellX + x) * 4 + 3] < 16) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Nearest-neighbour, integer only, alpha over. No resampling anywhere. */
function drawScaled(
  dst: Bitmap, src: Bitmap,
  sx: number, sy: number, sw: number, sh: number,
  dx: number, dy: number, k: number,
) {
  for (let y = 0; y < sh * k; y++) {
    for (let x = 0; x < sw * k; x++) {
      const s = ((sy + (y / k | 0)) * src.w + sx + (x / k | 0)) * 4;
      const a = src.px[s + 3];
      if (a === 0) continue;
      const X = dx + x, Y = dy + y;
      if (X < 0 || Y < 0 || X >= dst.w || Y >= dst.h) continue;
      const d = (Y * dst.w + X) * 4;
      if (a === 255) {
        src.px.copy(dst.px, d, s, s + 4);
      } else {
        for (let c = 0; c < 3; c++) {
          dst.px[d + c] = (src.px[s + c] * a + dst.px[d + c] * (255 - a)) / 255 | 0;
        }
        dst.px[d + 3] = 255;
      }
    }
  }
}

/** One cell of the card: the frame at `scale`, the item fitted to its window. */
function composeCell(frame: Bitmap, cell: number, item: Bitmap, rowY: number, scale: number): Bitmap {
  const { cell: C, window: win, fill } = FRAME_GEOMETRY;
  const side = C * scale;
  const out: Bitmap = { w: side, h: side, px: Buffer.alloc(side * side * 4) };
  drawScaled(out, frame, cell * C, 0, C, C, 0, 0, scale);

  const ink = inkBox(item, 0, rowY);
  if (ink) {
    const availW = Math.floor(win.w * scale * fill);
    const availH = Math.floor(win.h * scale * fill);
    // The largest INTEGER magnification that still fits. Integer because a
    // fractional one resamples, and resampled pixel art stops being pixel art.
    const k = Math.max(1, Math.min(Math.floor(availW / ink.w), Math.floor(availH / ink.h)));
    const dx = win.x * scale + Math.floor((win.w * scale - ink.w * k) / 2);
    const dy = win.y * scale + Math.floor((win.h * scale - ink.h * k) / 2);
    drawScaled(out, item, ink.x, rowY + ink.y, ink.w, ink.h, dx, dy, k);
  }
  return out;
}

function writePng(path: string, b: Bitmap) {
  const png = new PNG({ width: b.w, height: b.h });
  b.px.copy(png.data);
  writeFileSync(path, PNG.sync.write(png));
}

async function writeGif(path: string, cells: Bitmap[], centisecs: number) {
  const frames = cells.map((b) => {
    const img = new BitmapImage(b.w, b.h, Buffer.from(b.px));
    GifUtil.quantizeDekker(img, 256);
    return new GifFrame(img, { delayCentisecs: centisecs });
  });
  const gif = await new GifCodec().encodeGif(frames, { loops: 0 });
  writeFileSync(path, gif.buffer);
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i < 0 ? undefined : argv[i + 1];
  };
  const scale = Number(arg("--scale") ?? 10);
  const only = arg("--only");
  // A trailing slash or the concatenation below silently makes nonsense, so
  // it is added here rather than demanded of whoever types the command.
  const slash = (u: string) => (u.endsWith("/") ? u : u + "/");
  const base = slash(arg("--base") ?? "https://solanacity.io/collectibles/");
  const imageBase = slash(arg("--image-base") ?? base);
  // A path you pass means what you typed, relative to where you are. The
  // DEFAULT is outside the repo: this repository is public, and a render
  // meant for Arweave should not be published by a stray commit instead.
  const out = arg("--out");
  const outDir = out ? resolve(out) : join(HERE, "..", "..", "..", "..", "collectible-art");
  mkdirSync(outDir, { recursive: true });

  const sheets = new Map<string, Bitmap>();
  const frameSheet = (kind: keyof typeof FRAME_SHEET) => {
    const file = FRAME_SHEET[kind];
    if (!sheets.has(file)) sheets.set(file, readPng(join(PUBLIC, file)));
    return sheets.get(file)!;
  };

  let made = 0, skipped = 0;
  for (const category of LAYER_ORDER as readonly LayerCategory[]) {
    for (const variant of getEnabledVariants(category)) {
      const kind = tileKindOf(category, variant);
      // No rarity and no provenance means a free item, which is not a
      // collectible and has nothing to be minted into.
      if (!kind) { skipped++; continue; }
      if (only && `${category}/${variant.id}` !== only && !variant.file.includes(only)) continue;

      const index = globalIndexOf(category, variant.id);
      const item = removeChroma(readPng(join(PUBLIC, "assets", "sprites", "paperdoll", variant.file)));
      // Backpacks are barely visible from the front, so the grid shows their
      // back row; the card has to agree or the two disagree about the item.
      const rowY = (category === "back" ? DIRECTION_ROW.up : DIRECTION_ROW.down) * SPRITE_FRAME_HEIGHT;

      const cells = Array.from(
        { length: FRAME_GEOMETRY.cells },
        (_, c) => composeCell(frameSheet(kind), c, item, rowY, scale),
      );
      writePng(join(outDir, `${index}.png`), cells[0]);
      await writeGif(join(outDir, `${index}.gif`), cells, FRAME_GEOMETRY.loopMs / FRAME_GEOMETRY.cells / 10);
      writeFileSync(join(outDir, `${index}.json`), JSON.stringify({
        name: variant.name,
        symbol: "SCC",
        description: `${RARITY_LABEL[kind]} ${category} from Sol City.`,
        image: `${imageBase}${index}.gif`,
        attributes: [
          { trait_type: "Rarity", value: RARITY_LABEL[kind] },
          { trait_type: "Slot", value: category },
          { trait_type: "Season", value: String(variant.season ?? 1) },
        ],
        properties: {
          files: [{ uri: `${imageBase}${index}.gif`, type: "image/gif" }],
          category: "image",
        },
      }, null, 2) + "\n");
      made++;
      console.log(`${String(index).padStart(5)}  ${RARITY_LABEL[kind].padEnd(9)} ${category}/${variant.id}`);
    }
  }
  // ── The packs ───────────────────────────────────────────────────────
  //
  // Drawn from their own sheet at its own cell size, which is 36x51 and not
  // square. The card is padded to a square because marketplaces lay out
  // squares, and a sheet stretched to fit one would be the only resampled
  // thing in this whole script.
  for (const pack of PACKS) {
    const art = removeChroma(readPng(join(PUBLIC, pack.art.file)));
    const k = Math.max(1, Math.floor(FRAME_GEOMETRY.cell * scale * 0.8 / pack.art.frameHeight));
    const side = FRAME_GEOMETRY.cell * scale;
    const cells = Array.from({ length: pack.art.frames }, (_, c) => {
      const out: Bitmap = { w: side, h: side, px: Buffer.alloc(side * side * 4) };
      drawScaled(
        out, art,
        c * pack.art.frameWidth, 0, pack.art.frameWidth, pack.art.frameHeight,
        Math.floor((side - pack.art.frameWidth * k) / 2),
        Math.floor((side - pack.art.frameHeight * k) / 2),
        k,
      );
      return out;
    });
    writePng(join(outDir, `pack-${pack.onChainId}.png`), cells[0]);
    // The shop plays this strip at 8fps; the card plays it at the same speed
    // or the pack a player bought animates differently from the one they saw.
    await writeGif(join(outDir, `pack-${pack.onChainId}.gif`), cells, 12);
    writeFileSync(join(outDir, `pack-${pack.onChainId}.json`), JSON.stringify({
      name: `Sol City ${pack.name}`,
      symbol: "SCC",
      description: `${pack.blurb} Sealed: ${pack.size} items, drawn when it is opened.`,
      image: `${imageBase}pack-${pack.onChainId}.gif`,
      attributes: [
        { trait_type: "Kind", value: "Sealed Pack" },
        { trait_type: "Items", value: String(pack.size) },
        { trait_type: "Season", value: String(CURRENT_SEASON) },
      ],
      properties: {
        files: [{ uri: `${imageBase}pack-${pack.onChainId}.gif`, type: "image/gif" }],
        category: "image",
      },
    }, null, 2) + "\n");
    console.log(`${"pack".padStart(5)}  ${pack.name}`);
  }

  console.log(`\n${made} collectibles and ${PACKS.length} packs rendered at ${FRAME_GEOMETRY.cell * scale}px into ${outDir}`);
  console.log(`metadata served from ${base}, pictures from ${imageBase}`);
  console.log(`the program's base_uri MUST be exactly ${base}`);
  console.log(`${skipped} free items skipped: a free item is not a collectible.`);
}

void main();
