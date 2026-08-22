#!/usr/bin/env node
/**
 * Repairs collision in city.json that Tiled exported wrong. Two passes:
 *
 *   1. tileset backfill — tilesets exported with no collision shapes at all
 *   2. region fixes     — hand-corrected areas where the authored collision
 *                         does not match the artwork
 *
 * Why this exists: SCBuildSTBrStands (the Superteam Brasil market stands) and
 * SCBuildSTEarn02 (the Superteam Earn tent) were authored in Tiled with no
 * collision shapes at all, so the player walks straight through them. Every
 * other building tileset carries its collision in the tile's `objectgroup`,
 * which Phaser turns into colliders via `setCollisionFromCollisionGroup()`.
 *
 * Rather than hand-place walls in CityScene, this script writes the missing
 * collision into the map's embedded tilesets, so the fix flows through
 * everything that already reads tile.collides (player collider, pedestrians,
 * NPC spawn scan).
 *
 * A tile gets a full-tile collision box when it is actually used somewhere in
 * the map AND its artwork covers at least OPACITY_THRESHOLD of the tile. The
 * opacity test is what keeps the transparent padding tiles around each stand
 * walkable — those are painted with a real gid but draw nothing, and blocking
 * them would ring every 5x5 stand with an invisible 7x7 wall.
 *
 * Idempotent: tiles that already have an objectgroup are left alone, so this
 * is safe to re-run after re-exporting city.json from Tiled.
 *
 *   node apps/web/scripts/patch-map-collision.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "..");
const MAP = path.join(WEB, "public/assets/maps/city.json");
const TILESET_DIR = path.join(WEB, "public/assets/tilesets");

/** Tilesets Tiled exported with zero collision shapes. */
const TARGET_TILESETS = ["SCBuildSTBrStands", "SCBuildSTEarn02"];

/** Fraction of the tile that must be opaque before it becomes solid. */
const OPACITY_THRESHOLD = 0.5;

/**
 * Regions where Tiled's collision contradicts the artwork, fixed cell by cell.
 *
 * The central fountain is the one that matters: the art draws a two-tile-wide
 * flight of steps climbing from the south path up to the sculpture, but Tiled
 * blocked almost all of it, leaving a single-tile stub the player can stand on
 * and nothing else — the plaza reads as walkable and isn't. The other half of
 * the mistake is that most of the water basin was left WALKABLE; it only stayed
 * out of reach because the (wrong) staircase collision fenced it in. Opening the
 * steps without sealing the water would let the player stroll across the pools.
 *
 * So each region declares its full solid box plus the cells that must be open,
 * and the script forces both directions. Sealing is painted into the existing
 * ColliderInvisible barrier layer (which CityScene already force-collides and
 * hides); opening clears the tile's own collision box, which is safe here only
 * because those gids are used exactly once each in the whole map — the script
 * verifies that and refuses rather than silently unblocking tiles elsewhere.
 */
/**
 * Layers Tiled left with its default placeholder name ("Camada de Blocos N"),
 * renamed to something CityScene can key its render-order rules off.
 *
 * The ST Brasil welcome sign stands in front of the lighthouse, but it carries
 * no collision, so CityScene fell through to `depth = layer index` (40) while
 * the lighthouse Y-sorts to `depth = 2064` — the lighthouse simply painted over
 * it. Naming it DecorSign* opts it into the no-collision Y-sort branch, which
 * gives it a depth from its own base row instead.
 */
const LAYER_RENAMES = { "Camada de Blocos 119": "DecorSignSTBrasil" };

const REGION_FIXES = [
  {
    name: "central fountain",
    solid: { c0: 75, c1: 82, r0: 33, r1: 39 },
    walkable: [
      [78, 37], [79, 37],
      [78, 38], [79, 38],
      [78, 39], [79, 39],
    ],
  },
];

const GID_MASK = 0x1fffffff; // strip Tiled's flip/rotate flags

const dry = process.argv.includes("--dry");
const map = JSON.parse(fs.readFileSync(MAP, "utf8"));

/** Tiled nests layers inside `group` layers; walk the whole tree. */
function tileLayers(layers) {
  const out = [];
  for (const l of layers) {
    if (l.type === "group") out.push(...tileLayers(l.layers ?? []));
    else if (l.type === "tilelayer" && l.data) out.push(l);
  }
  return out;
}

/** Every gid painted anywhere in the map. */
const usedGids = new Set();
for (const layer of tileLayers(map.layers)) {
  for (const raw of layer.data) {
    if (raw) usedGids.add(raw & GID_MASK);
  }
}

/** Fraction of pixels in tile `localId` that are opaque. */
function tileOpacity(png, tileset, localId) {
  const cols = tileset.columns || Math.floor(png.width / tileset.tilewidth);
  const margin = tileset.margin ?? 0;
  const spacing = tileset.spacing ?? 0;
  const tx = margin + (localId % cols) * (tileset.tilewidth + spacing);
  const ty = margin + Math.floor(localId / cols) * (tileset.tileheight + spacing);
  let opaque = 0;
  let total = 0;
  for (let y = 0; y < tileset.tileheight; y++) {
    for (let x = 0; x < tileset.tilewidth; x++) {
      const px = tx + x;
      const py = ty + y;
      total++;
      if (px >= png.width || py >= png.height) continue;
      if (png.data[((py * png.width + px) << 2) + 3] > 128) opaque++;
    }
  }
  return total ? opaque / total : 0;
}

function fullTileCollision(tileset) {
  return {
    draworder: "index",
    id: 2,
    name: "",
    objects: [
      {
        height: tileset.tileheight,
        id: 1,
        name: "",
        opacity: 1,
        rotation: 0,
        type: "",
        visible: true,
        width: tileset.tilewidth,
        x: 0,
        y: 0,
      },
    ],
    opacity: 1,
    type: "objectgroup",
    visible: true,
    x: 0,
    y: 0,
  };
}

let totalAdded = 0;
for (const name of TARGET_TILESETS) {
  const tileset = map.tilesets.find((t) => t.name === name);
  if (!tileset) {
    console.error(`  ! tileset ${name} not found in city.json — skipped`);
    continue;
  }

  const imageFile = tileset.image.replace(/^.*[\\/]/, "");
  const png = PNG.sync.read(fs.readFileSync(path.join(TILESET_DIR, imageFile)));

  tileset.tiles ??= [];
  const existing = new Map(tileset.tiles.map((t) => [t.id, t]));

  let added = 0;
  let skippedTransparent = 0;
  for (const gid of usedGids) {
    const localId = gid - tileset.firstgid;
    if (localId < 0 || localId >= tileset.tilecount) continue;

    const entry = existing.get(localId);
    if (entry?.objectgroup?.objects?.length) continue; // already solid

    if (tileOpacity(png, tileset, localId) < OPACITY_THRESHOLD) {
      skippedTransparent++;
      continue;
    }

    if (entry) {
      entry.objectgroup = fullTileCollision(tileset);
    } else {
      const created = { id: localId, objectgroup: fullTileCollision(tileset) };
      tileset.tiles.push(created);
      existing.set(localId, created);
    }
    added++;
  }

  tileset.tiles.sort((a, b) => a.id - b.id);
  totalAdded += added;
  console.log(
    `  ${name}: +${added} solid tiles (${skippedTransparent} left walkable as transparent padding)`
  );
}

// ---------------------------------------------------------------- pass 2 ---
// Layer renames.

let renamed = 0;
for (const layer of tileLayers(map.layers)) {
  const next = LAYER_RENAMES[layer.name];
  if (!next) continue;
  layer.name = next;
  renamed++;
  console.log(`  renamed layer -> ${next}`);
}

// ---------------------------------------------------------------- pass 3 ---
// Region fixes: force specific cells solid or walkable.

/** Tiles carrying a collision box, by gid. */
const solidGids = new Set();
for (const ts of map.tilesets) {
  for (const t of ts.tiles ?? []) {
    if (t.objectgroup?.objects?.length) solidGids.add(ts.firstgid + t.id);
  }
}

/** How many cells in the whole map paint each gid. */
const gidUses = new Map();
for (const layer of tileLayers(map.layers)) {
  for (const raw of layer.data) {
    if (!raw) continue;
    const gid = raw & GID_MASK;
    gidUses.set(gid, (gidUses.get(gid) ?? 0) + 1);
  }
}

const barrier = map.layers.find((l) => l.name === "ColliderInvisible");
if (!barrier) throw new Error("ColliderInvisible layer missing — cannot seal cells");
const BARRIER_GID = barrier.data.find((v) => v) ?? 0;
if (!BARRIER_GID) throw new Error("ColliderInvisible layer is empty — no gid to paint with");

/** Every gid painted at (col,row), with the layer it came from. */
function cellGids(col, row) {
  const hits = [];
  for (const layer of tileLayers(map.layers)) {
    const ox = Math.round((layer.offsetx ?? 0) / map.tilewidth);
    const oy = Math.round((layer.offsety ?? 0) / map.tileheight);
    const lc = col - (layer.x ?? 0) - ox;
    const lr = row - (layer.y ?? 0) - oy;
    if (lc < 0 || lc >= layer.width || lr < 0 || lr >= layer.height) continue;
    const raw = layer.data[lr * layer.width + lc];
    if (raw) hits.push({ layer, index: lr * layer.width + lc, gid: raw & GID_MASK });
  }
  return hits;
}

let sealed = 0;
let opened = 0;
for (const fix of REGION_FIXES) {
  const open = new Set(fix.walkable.map(([c, r]) => `${c},${r}`));
  const { c0, c1, r0, r1 } = fix.solid;

  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const hits = cellGids(col, row);
      const wantOpen = open.has(`${col},${row}`);
      const isSolid = hits.some((h) => solidGids.has(h.gid));

      if (wantOpen) {
        // Drop the collision box from every solid gid sitting on this cell.
        for (const h of hits) {
          if (!solidGids.has(h.gid)) continue;
          if (h.layer.name === "ColliderInvisible") {
            h.layer.data[h.index] = 0;
            opened++;
            continue;
          }
          const uses = gidUses.get(h.gid) ?? 0;
          if (uses !== 1) {
            throw new Error(
              `refusing to open ${col},${row}: gid ${h.gid} is painted ${uses}x ` +
                `across the map, so clearing it would unblock tiles elsewhere`
            );
          }
          const ts = [...map.tilesets]
            .sort((a, b) => b.firstgid - a.firstgid)
            .find((t) => h.gid >= t.firstgid);
          const entry = ts.tiles.find((t) => t.id === h.gid - ts.firstgid);
          delete entry.objectgroup;
          solidGids.delete(h.gid);
          opened++;
        }
      } else if (!isSolid) {
        // Paint the invisible barrier so this cell blocks.
        const bc = col - (barrier.x ?? 0);
        const br = row - (barrier.y ?? 0);
        barrier.data[br * barrier.width + bc] = BARRIER_GID;
        sealed++;
      }
    }
  }
  console.log(`  ${fix.name}: ${opened} cells opened, ${sealed} sealed`);
}

totalAdded += sealed + opened + renamed;

if (dry) {
  console.log(`\n--dry: ${totalAdded} tiles would change, city.json not written`);
} else if (totalAdded > 0) {
  fs.writeFileSync(MAP, JSON.stringify(map));
  console.log(`\nwrote ${path.relative(process.cwd(), MAP)} (+${totalAdded} solid tiles)`);
} else {
  console.log("\nnothing to do — all target tiles already have collision");
}
