#!/usr/bin/env node
/**
 * Packs every tileset down to the tiles the map actually uses.
 *
 * The art is authored as big sheets — SCPalm is 1800x1800 — and the map uses
 * a fraction of each: 178 of its 5625 tiles. A PNG full of transparency is
 * tiny on disk (SCPalm is 91 KB) and enormous in memory, because the browser
 * decodes it to width x height x 4 bytes whatever is in it. Loaded whole, the
 * 22 tilesets are 130 MB of RGBA; the tiles actually drawn are under 17 MB.
 * That gap is memory the device holds, uploads to the GPU and heats up for,
 * and never shows anybody.
 *
 * So this reads the map, finds the used tiles, writes one compact sheet per
 * tileset and a rewritten map that points at them. It never touches the
 * artist's files: city.json and the original sheets stay exactly as exported,
 * and everything it writes lands in `packed/` (and city.packed.json) as
 * build output. Re-run it after every map export:
 *
 *     node scripts/pack-tilesets.mjs
 *
 * A tileset the map stopped using entirely is kept (as a single blank tile)
 * rather than dropped, so the loader's list of names stays valid.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Imported dynamically so a missing dependency cannot fail the BUILD. The
// packed map and sheets are committed, so skipping the repack ships the last
// packed copy rather than nothing — which is what happened the first time
// this ran on the deploy host, where `npm install` inside apps/web had no
// pngjs and the whole site stopped updating.
let PNG;
try {
  ({ PNG } = await import("pngjs"));
} catch {
  console.warn("[pack-tilesets] pngjs not installed — keeping the committed packed map. Run `npm i -D pngjs` in apps/web to repack.");
  process.exit(0);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "..", "public", "assets");
const MAP_IN = path.join(PUBLIC, "maps", "city.json");
const MAP_OUT = path.join(PUBLIC, "maps", "city.packed.json");
const TILESETS = path.join(PUBLIC, "tilesets");
const OUT_DIR = path.join(TILESETS, "packed");

/** Tiled packs three flip bits into the top of every gid. */
const FLAGS = 0xe0000000;
const ID = 0x1fffffff;

const map = JSON.parse(fs.readFileSync(MAP_IN, "utf8"));
const TS = map.tilewidth;

// ── Which tiles the map draws ──────────────────────────────────────────
const used = new Set();
const eachTileLayer = (layers, fn) => {
  for (const l of layers) {
    if (l.type === "group") { eachTileLayer(l.layers, fn); continue; }
    if (l.type === "tilelayer") fn(l);
  }
};
eachTileLayer(map.layers, (l) => {
  for (const v of l.data) if (v) used.add(v & ID);
});

fs.mkdirSync(OUT_DIR, { recursive: true });

// ── One compact sheet per tileset, and the gid map that goes with it ───
/** old gid -> new gid */
const remap = new Map();
const packedTilesets = [];
let nextFirstGid = 1;
let bytesBefore = 0;
let bytesAfter = 0;

for (const ts of map.tilesets) {
  if (!ts.image) { packedTilesets.push(ts); continue; }

  const localUsed = [];
  for (let id = 0; id < ts.tilecount; id++) {
    if (used.has(ts.firstgid + id)) localUsed.push(id);
  }

  const src = PNG.sync.read(fs.readFileSync(path.join(TILESETS, ts.image)));
  bytesBefore += src.width * src.height * 4;

  // Squarish, and never wider than the source: a long thin strip would waste
  // as much as the sheet we are trying to shrink.
  const count = Math.max(1, localUsed.length);
  const columns = Math.min(Math.ceil(Math.sqrt(count)), Math.floor(src.width / TS) || 1);
  const rows = Math.ceil(count / columns);
  const out = new PNG({ width: columns * TS, height: rows * TS });
  out.data.fill(0);
  bytesAfter += out.width * out.height * 4;

  localUsed.forEach((id, i) => {
    const sx = (id % ts.columns) * TS;
    const sy = Math.floor(id / ts.columns) * TS;
    const dx = (i % columns) * TS;
    const dy = Math.floor(i / columns) * TS;
    for (let y = 0; y < TS; y++) {
      const from = ((src.width * (sy + y)) + sx) << 2;
      const to = ((out.width * (dy + y)) + dx) << 2;
      src.data.copy(out.data, to, from, from + (TS << 2));
    }
    remap.set(ts.firstgid + id, nextFirstGid + i);
  });

  const file = `${ts.name}.png`;
  fs.writeFileSync(path.join(OUT_DIR, file), PNG.sync.write(out));

  // Per-tile data (collision shapes, properties) follows its tile's new id.
  const oldToNew = new Map(localUsed.map((id, i) => [id, i]));
  const tiles = (ts.tiles ?? [])
    .filter((t) => oldToNew.has(t.id))
    .map((t) => ({ ...t, id: oldToNew.get(t.id) }));

  packedTilesets.push({
    ...ts,
    firstgid: nextFirstGid,
    image: `packed/${file}`,
    imagewidth: out.width,
    imageheight: out.height,
    columns,
    tilecount: count,
    margin: 0,
    spacing: 0,
    // ALWAYS written, even empty: spreading the source tileset above carries
    // its original `tiles` array, whose ids point at the unpacked sheet. Left
    // in place, those ids run past the packed tilecount and land inside the
    // NEXT tileset's gid range, which handed 73 innocent cells a collision
    // shape that belonged to another sheet entirely.
    tiles,
  });

  console.log(
    `${ts.name.padEnd(30)} ${String(localUsed.length).padStart(5)} / ${String(ts.tilecount).padEnd(6)} tiles` +
    `  ${(src.width * src.height * 4 / 1048576).toFixed(1).padStart(5)} MB -> ${(out.width * out.height * 4 / 1048576).toFixed(2)} MB`,
  );

  nextFirstGid += count;
}

// ── The map, pointing at the packed sheets ─────────────────────────────
const packed = { ...map, tilesets: packedTilesets };
const rewrite = (layers) => layers.map((l) => {
  if (l.type === "group") return { ...l, layers: rewrite(l.layers) };
  if (l.type !== "tilelayer") return l;
  return {
    ...l,
    data: l.data.map((v) => (v ? ((remap.get(v & ID) ?? 0) | (v & FLAGS)) >>> 0 : 0)),
  };
});
packed.layers = rewrite(map.layers);

fs.writeFileSync(MAP_OUT, JSON.stringify(packed));

console.log(
  `\ntilesets in memory: ${(bytesBefore / 1048576).toFixed(0)} MB -> ${(bytesAfter / 1048576).toFixed(1)} MB` +
  ` (${(100 - (bytesAfter / bytesBefore) * 100).toFixed(0)}% less)`,
);
console.log(`wrote ${path.relative(process.cwd(), MAP_OUT)} and ${packedTilesets.length - 1} sheets in ${path.relative(process.cwd(), OUT_DIR)}`);
