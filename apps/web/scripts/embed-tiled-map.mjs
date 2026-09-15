#!/usr/bin/env node
/**
 * Turns a Tiled export into the embedded-tileset city.json the game expects.
 *
 * Why this exists: the Tiled project (city.json's source) lives OUTSIDE this
 * repo, on the map artist's machine — see MAP_INTEGRATION.md. Tiled's own
 * "Export As" writes a .tmj whose tilesets are EXTERNAL references
 * (`"source": "../Map/SCPalm.tsx"`), one per sibling .tsj in an Exports/Tiles
 * folder. Phaser's tilemap loader wants everything embedded inline instead
 * (name/tiles/image, no `source`) — that's the only shape apps/web ships, so
 * a raw Tiled export can't be dropped in as-is.
 *
 * This script splices each tileset's sibling .tsj into the map in place of
 * its `source` pointer. Tilesets already embedded (Tiled's "Embed Tileset",
 * if the artist's workflow starts doing that) pass through untouched.
 *
 * Usage:
 *   node apps/web/scripts/embed-tiled-map.mjs "<path to Exports/<Map>.tmj>"
 *
 * The sibling tileset JSONs are expected at "<Exports dir>/Tiles/<name>.tsj",
 * matching Tiled's default per-tileset JSON export layout.
 *
 * Run `patch-map-collision.mjs` right after this — it expects the embedded
 * shape and regenerates ColliderAuto from scratch every time.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "..");
const OUT_MAP = path.join(WEB, "public/assets/maps/city.json");

const srcArg = process.argv[2];
if (!srcArg) {
  console.error("Usage: node apps/web/scripts/embed-tiled-map.mjs \"<path to Exports/<Map>.tmj>\"");
  process.exit(1);
}
const SRC_MAP = path.resolve(srcArg);
const TILES_DIR = path.join(path.dirname(SRC_MAP), "Tiles");

const map = JSON.parse(fs.readFileSync(SRC_MAP, "utf8"));

// Each tileset is exported to Exports/Tiles/<name>.tsj by its OWN "Export
// Tileset As" action in Tiled — a separate step from exporting the map, easy
// to forget after editing a tileset's collision in place. A stale .tsj embeds
// silently-wrong collision with no error anywhere in the pipeline (this is
// how DecorMonkeDaoFlag's banner kept blocking movement 2026-09-01, after the
// artist had already removed that collision in Tiled — the map export was
// fresh, but SCBuildMonkeyDAO.tsj was 2 days old). Warn whenever the live
// .tsx is newer than the .tsj this script is about to trust.
const staleWarnings = [];

let embedded = 0;
map.tilesets = map.tilesets.map((ts) => {
  if (!ts.source) return ts; // already embedded — nothing to do
  const base = path.basename(ts.source, path.extname(ts.source));
  const tsjPath = path.join(TILES_DIR, `${base}.tsj`);
  const tsxPath = path.resolve(path.dirname(SRC_MAP), ts.source);
  if (fs.existsSync(tsxPath)) {
    const tsxTime = fs.statSync(tsxPath).mtimeMs;
    const tsjTime = fs.statSync(tsjPath).mtimeMs;
    if (tsxTime > tsjTime) {
      staleWarnings.push(`${base}: .tsx is newer than Exports/Tiles/${base}.tsj by ${Math.round((tsxTime - tsjTime) / 60000)} min`);
    }
  }
  const tsj = JSON.parse(fs.readFileSync(tsjPath, "utf8"));
  tsj.image = path.basename(tsj.image); // bare filename — matches apps/web/public/assets/tilesets/
  embedded++;
  return {
    firstgid: ts.firstgid,
    ...tsj,
    type: "tileset",
    version: "1.10",
  };
});

fs.writeFileSync(OUT_MAP, JSON.stringify(map));
console.log(`wrote ${path.relative(WEB, OUT_MAP)}`);
console.log(`tilesets: ${map.tilesets.length} (${embedded} newly embedded, ${map.tilesets.length - embedded} already were)`);

if (staleWarnings.length) {
  console.warn("\nWARNING: these tileset exports may be stale — re-export them in Tiled");
  console.warn("(select the tileset tab → File → Export Tileset As, overwrite the .tsj) before trusting this city.json:");
  for (const w of staleWarnings) console.warn(`  ! ${w}`);
}

// Remind the artist which tileset PNGs actually changed, so they know what to
// copy into public/assets/tilesets/ before this export is usable — comparing
// file hashes here would need the SCAssets source tree, which is outside the
// repo and not something this script can locate on every machine.
console.log("\nNext: copy any changed tileset PNGs into apps/web/public/assets/tilesets/,");
console.log("then run: node apps/web/scripts/patch-map-collision.mjs");
