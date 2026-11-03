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
 *   --frame-ms   how long the card holds each frame cell; defaults to
 *                CARD_FRAME_MS, which is what went to Arweave
 *
 * ── What comes out ─────────────────────────────────────────────────────
 *
 * Per item, named by its CATALOG INDEX, because that is the only name the
 * chain knows: `mint_unlock` builds `<base_uri><index>.json` and nothing on
 * chain stores a filename.
 *
 *   <index>.gif    the animated card: the frame's four cells on its own
 *                  clock, and an animated item playing its sheet on its own
 *                  (see `timeline`), looped where the two meet again
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
import { LAYER_ORDER, DIRECTION_ROW, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT, SPRITE_COLS, getEnabledVariants, effectCell, showsFromBehind } from "../src/game/config/paperDoll";
import { tileKindOf, PACKS } from "../src/game/config/packs";
import { globalIndexOf } from "../src/game/config/catalogIndex";
import { FRAME_GEOMETRY, FRAME_SHEET, RARITY_LABEL, CURRENT_SEASON } from "../src/game/collections/seasons";
import type { LayerCategory, LayerVariant as Variant } from "../src/game/config/paperDoll";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "public");

/**
 * The card's frame cell. Not the game's 100: see where it is read. Changing
 * it changes every picture, and the pictures on Arweave cannot change.
 */
const CARD_FRAME_MS = 150;

/**
 * The largest an item's pixel may be, in frame pixels. 2.2 is what trousers
 * and backpacks reach when fitted (22x at scale 10), the biggest of any
 * ordinary garment; only the rings and the Cyber Visor were above it, at up
 * to 6.4, and read as giant next to everything else.
 */
const MAX_ITEM_ZOOM = 2.2;

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

type Box = { x: number; y: number; w: number; h: number };

/**
 * The ink of every cell the card will show, as one box. An animated item is
 * fitted by this union, not cell by cell, or its size and position would
 * twitch from frame to frame. The wardrobe tile measures it the same way.
 */
function inkUnion(b: Bitmap, cells: number[], rowY: number): Box | null {
  let u: Box | null = null;
  for (const c of cells) {
    const ink = inkBox(b, c * SPRITE_FRAME_WIDTH, rowY);
    if (!ink) continue;
    if (!u) { u = ink; continue; }
    const x1 = Math.max(u.x + u.w, ink.x + ink.w), y1 = Math.max(u.y + u.h, ink.y + ink.h);
    u.x = Math.min(u.x, ink.x); u.y = Math.min(u.y, ink.y);
    u.w = x1 - u.x; u.h = y1 - u.y;
  }
  return u;
}

/**
 * One cell of the card: the frame at `scale`, item cell `itemCell` fitted to
 * the window by `ink`, the box shared by every cell of this card.
 */
function composeCell(
  frame: Bitmap, cell: number,
  item: Bitmap, itemCell: number, rowY: number, ink: Box | null,
  scale: number,
): Bitmap {
  const { cell: C, window: win, fill } = FRAME_GEOMETRY;
  const side = C * scale;
  const out: Bitmap = { w: side, h: side, px: Buffer.alloc(side * side * 4) };
  drawScaled(out, frame, cell * C, 0, C, C, 0, 0, scale);

  if (ink) {
    const availW = Math.floor(win.w * scale * fill);
    const availH = Math.floor(win.h * scale * fill);
    // The largest INTEGER magnification that still fits. Integer because a
    // fractional one resamples, and resampled pixel art stops being pixel art.
    const k = Math.max(1, Math.min(
      Math.floor(availW / ink.w), Math.floor(availH / ink.h),
      // A small item stays small: a 6px ring fitted to the window came out
      // with pixels three times a pair of trousers'. No item's pixel may be
      // larger than the largest an ordinary garment gets.
      Math.floor(scale * MAX_ITEM_ZOOM),
    ));
    const dx = win.x * scale + Math.floor((win.w * scale - ink.w * k) / 2);
    const dy = win.y * scale + Math.floor((win.h * scale - ink.h * k) / 2);
    drawScaled(out, item, itemCell * SPRITE_FRAME_WIDTH + ink.x, rowY + ink.y, ink.w, ink.h, dx, dy, k);
  }
  return out;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Which sheet cell a card shows at each step of the item's clock. */
type CardRule = { steps: number; cell: (step: number) => number };

/**
 * Cards that do not play their sheet the way the game does.
 *
 * The Halo's sheet holds each sparkle for a group of four cells and spends
 * the group bobbing a pixel up and down. In the game that pixel is the
 * float. On a card the item is drawn eight times larger, so the same bob is
 * an eight-pixel jump every 150 ms while the sparkle waits 600 ms to move:
 * it read as truncated, not smooth (owner, 2026-11-03).
 *
 * So the card steps the sparkle every 150 ms, one group per step, and drops
 * the float: the first cell of each group, as the Crown plays. The owner
 * tried keeping the float at half pace and preferred this.
 */
const CARD_RULE: Record<string, CardRule> = {
  "hat/Halo": { steps: 12, cell: (s) => (s % 12) * SPRITE_COLS },
};

/**
 * The card's timeline: which frame cell and which item cell to show, and for
 * how long. A new GIF frame starts only where one of the two changes, so the
 * loop is exact for both clocks and no longer than their common cycle.
 *
 * The item cell comes from effectCell, the same rule the game and the wardrobe
 * use, called WITHOUT a walk column: a card does not walk, so a walkSynced
 * garment shows its standing pose, exactly as the wardrobe tile does.
 */
function timeline(frameMs: number, effect: Variant["effect"], cellKey: (cell: number) => string, cardRule?: CardRule) {
  const frameLoop = frameMs * FRAME_GEOMETRY.cells;
  if (!effect) {
    return Array.from({ length: FRAME_GEOMETRY.cells }, (_, c) => ({ frameCell: c, itemCell: 0, ms: frameMs }));
  }
  const stepMs = Math.round(1000 / effect.fps);
  const groups = effect.frames / SPRITE_COLS;
  // The loop as the sheet DRAWS it, not as it is declared: the Halo is 48
  // cells whose second half copies the first, so it repeats after 24. Found
  // by comparing pixels, so a sheet that repeats is never rendered twice over.
  const rule: CardRule = cardRule ?? {
    steps: effect.steady || effect.walkSynced ? groups : effect.frames,
    cell: (step) => effectCell(effect, (step + 0.5) * stepMs),
  };
  const steps = rule.steps;
  const seq = Array.from({ length: steps }, (_, i) => cellKey(rule.cell(i)));
  let drawn = steps;
  for (let p = 1; p < steps; p++) {
    if (steps % p === 0 && seq.every((k, i) => k === seq[(i + p) % steps])) { drawn = p; break; }
  }
  const itemLoop = stepMs * drawn;
  const period = frameLoop / gcd(frameLoop, itemLoop) * itemLoop;
  const cuts = new Set<number>();
  for (let t = 0; t < period; t += frameMs) cuts.add(t);
  for (let t = 0; t < period; t += stepMs) cuts.add(t);
  const at = [...cuts].sort((a, b) => a - b);
  const out: { frameCell: number; itemCell: number; ms: number }[] = [];
  at.forEach((t0, i) => {
    const t1 = at[i + 1] ?? period;
    // Sampled mid-segment so float rounding at a boundary cannot pick a neighbour.
    const mid = (t0 + t1) / 2;
    out.push({
      frameCell: Math.floor(mid / frameMs) % FRAME_GEOMETRY.cells,
      itemCell: rule.cell(Math.floor(mid / stepMs)),
      ms: t1 - t0,
    });
  });
  return out;
}

function writePng(path: string, b: Bitmap) {
  const png = new PNG({ width: b.w, height: b.h });
  b.px.copy(png.data);
  writeFileSync(path, PNG.sync.write(png));
}

/** At most 256 colours, every fully transparent pixel counting as one. */
function fitsPalette(b: Bitmap): boolean {
  const seen = new Set<number>();
  for (let i = 0; i < b.px.length; i += 4) {
    seen.add(b.px[i + 3] === 0 ? -1 : b.px.readUInt32BE(i));
    if (seen.size > 256) return false;
  }
  return true;
}

async function writeGif(path: string, cells: Bitmap[], centisecs: number | number[]) {
  const frames = cells.map((b, i) => {
    const img = new BitmapImage(b.w, b.h, Buffer.from(b.px));
    // Pixel art nearly always fits a GIF palette as drawn, and then nothing
    // is quantized: the colours stay exact, and it is many times faster.
    if (!fitsPalette(b)) GifUtil.quantizeDekker(img, 256);
    return new GifFrame(img, { delayCentisecs: Array.isArray(centisecs) ? centisecs[i] : centisecs });
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
  // How long the CARD holds each frame cell. The game's own value stays in
  // FRAME_GEOMETRY and is not touched by this.
  //
  // 150, the owner's call (2026-11-03): it is the item sheets' own cell, so
  // a legendary loops in 12 GIF frames (the Halo in 24) instead of 48, and
  // weighs about a quarter. The price is a frame border that turns at two
  // thirds of the game's speed, on a card nobody sees beside the game.
  const frameMs = Number(arg("--frame-ms") ?? CARD_FRAME_MS);
  if (frameMs % 10) throw new Error("--frame-ms must be whole centiseconds, a GIF cannot hold anything finer");
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
      const rowY = (showsFromBehind(category, variant) ? DIRECTION_ROW.up : DIRECTION_ROW.down) * SPRITE_FRAME_HEIGHT;

      const cellKey = (cell: number) => {
        const rows: Buffer[] = [];
        for (let y = 0; y < SPRITE_FRAME_HEIGHT; y++) {
          const at = ((rowY + y) * item.w + cell * SPRITE_FRAME_WIDTH) * 4;
          rows.push(item.px.subarray(at, at + SPRITE_FRAME_WIDTH * 4));
        }
        return Buffer.concat(rows).toString("base64");
      };
      const steps = timeline(frameMs, variant.effect, cellKey, CARD_RULE[`${category}/${variant.id}`]);
      const ink = inkUnion(item, [...new Set(steps.map((s) => s.itemCell))], rowY);
      const cells = steps.map((s) => composeCell(frameSheet(kind), s.frameCell, item, s.itemCell, rowY, ink, scale));
      writePng(join(outDir, `${index}.png`), cells[0]);
      await writeGif(join(outDir, `${index}.gif`), cells, steps.map((s) => s.ms / 10));
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
    if (only && !`pack-${pack.onChainId}`.includes(only)) continue;
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
