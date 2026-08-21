#!/usr/bin/env node
/**
 * Adds per-tile collision to map tilesets that Tiled exported without any.
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

if (dry) {
  console.log(`\n--dry: ${totalAdded} tiles would change, city.json not written`);
} else if (totalAdded > 0) {
  fs.writeFileSync(MAP, JSON.stringify(map));
  console.log(`\nwrote ${path.relative(process.cwd(), MAP)} (+${totalAdded} solid tiles)`);
} else {
  console.log("\nnothing to do — all target tiles already have collision");
}
