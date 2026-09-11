#!/usr/bin/env node
/**
 * Repairs collision in city.json that Tiled exported wrong:
 *
 *   1. tileset backfill — tilesets exported with no collision shapes at all
 *   2. layer renames    — Tiled placeholder names CityScene cannot key rules on
 *   3. region fixes     — hand-corrected areas where the authored collision
 *                         contradicts the artwork
 *   4. ColliderAuto     — a generated barrier layer, rebuilt each run: solid
 *                         decor, building ground floors, and every tile walled
 *                         off from the spawn
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
 * A tile becomes solid when it is used in the map, its artwork covers at least
 * OPACITY_THRESHOLD of the tile, AND it sits below the structure's canopy rows
 * (see CANOPY_TOP_ROWS). The opacity test keeps the transparent padding around
 * each stall walkable — those tiles carry a real gid but draw nothing, and
 * blocking them would ring every 5x5 stall with an invisible 7x7 wall. The row
 * test is what leaves an awning to walk behind.
 *
 * Idempotent: every pass either re-derives its output and compares, or skips
 * work already present, so a re-run after exporting city.json from Tiled
 * reports "0 tiles would change" and rewrites nothing.
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

/**
 * Tilesets Tiled exported with zero collision shapes.
 *
 * The artist authored nothing here, so every `tiles[]` entry in them is this
 * script's own work — which is why the pass below can clear and re-derive them
 * on each run instead of only ever adding.
 */
const TARGET_TILESETS = ["SCBuildSTBrStands", "SCBuildSTEarn02"];

/**
 * How many rows at the TOP of each of these structures are canopy the player
 * should be able to walk behind, exactly as they can walk into the upper storey
 * of every other building.
 *
 * Backfilling those two tilesets by opacity alone made the whole silhouette
 * solid, because a tileset has no idea where its tiles sit in a structure. That
 * left the market stalls and the ST Earn tent as the only buildings in the city
 * with no walk-behind at all — you could reach the lane north of them and not a
 * tile further, which is what "can't get behind the tent or the stands" was.
 *
 * Row counts come from the art: a stall is three rows of awning (dark green top
 * plus the striped valance) over two rows of counter, and the tent is five rows
 * of roof over the two where its poles and desk meet the ground.
 *
 * SolSentry and Peg-risk get the same treatment. They have no awning, which is
 * why they were left solid at first — but they are tall vertical cabinets, so
 * their upper half (counter top, sign, screen) stands above head height and
 * only the bottom rows actually meet the sand. Leaving them solid to the top
 * made them the last two structures the player could not walk behind.
 */
const CANOPY_TOP_ROWS = {
  BuildStand01: 3,
  BuildStand02: 3,
  BuildStand04: 3,
  BuildStand05: 3,
  BuildStand07: 3,
  BuildStand08: 3,
  BuildSTEarn: 5,
  BuildStandSolSentry: 3,
  BuildStandPegana: 3,
};

/** Fraction of the tile that must be opaque before it becomes solid. */
const OPACITY_THRESHOLD = 0.5;

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
const LAYER_RENAMES = {
  "Camada de Blocos 119": "DecorSignSTBrasil",
  // The planter palms flanking the central bridge. Filed inside the Ground
  // group, so CityScene saw "Ground/Camada de Blocos 109", matched no rule and
  // dropped it to `depth = layer index` (16) — the player walked over the
  // fronds. DecorPalmBridge* opts it into the above-head branch.
  "Camada de Blocos 109": "DecorPalmBridge",
  // A building beside BuildSTBrazil. Named Build* so it Y-sorts like its
  // neighbours and joins the ground-floor sweep below.
  "Camada de Blocos 122": "BuildGenericSTBrazil",
};

/**
 * Layers whose art is solid but whose tiles carry no collision shape.
 *
 * `minOpacity` overrides OPACITY_THRESHOLD. Rocks need a lower bar than the
 * market stands: a stand is a neat rectangle padded with fully transparent
 * tiles, so 50% cleanly separates body from padding, but a rock cluster is
 * irregular and splits across tiles at every coverage from 10% to 100%. At 50%
 * the outcrop came out half-climbable — the player could stand on its northern
 * tiles. Only the near-empty fringe stays walkable now.
 */
const SOLID_LAYERS = [
  { layer: "Rocks/Rock01", minOpacity: 0.2 },
  { layer: "Rocks/Rock02", minOpacity: 0.2 },
  { layer: "Rocks/Rock03", minOpacity: 0.2 },
];

/**
 * Buildings whose ground floor only got part of its collision in Tiled.
 *
 * The lighthouse carries one solid row across its back wall (row 81) and then a
 * swiss-cheese of holes through rows 82-85, so the player walks in through the
 * door and stands inside the tower; MagicBlock has the same gaps at rows 52-55.
 * Those two were merely the ones spotted in play — sweeping every Build* layer
 * turned up 19 with the same defect, BuildIndies (66 holes) and
 * BuildGenericEnergy (48) worse than either. So this matches them all rather
 * than naming the two that happened to get noticed.
 *
 * Rather than invent a footprint, seal the painted art from the FIRST row that
 * carries any authored collision down to the bottom of the layer. That row is
 * the artist's own marker for "here the building meets the ground"; this just
 * fills it in completely. Everything above it is the upper storey rising behind
 * the player and stays walkable.
 */
const SEAL_BUILDING_BASES = /(^|\/)Build/;

/**
 * Anything walled off from this tile gets sealed solid.
 *
 * The sea, the grey margin outside the city, and the pockets inside building
 * footprints are all *walkable* in the raw export — they just happen to be
 * fenced in, so the player never notices. Pedestrians do: PedestrianManager
 * picks a tile, checks only "is this tile itself a collider", and happily drops
 * a citizen in the middle of the ocean or inside a sealed courtyard, where it
 * is stuck forever. Making unreachable ground genuinely solid removes the whole
 * class of bug instead of patching it at each spawn site.
 *
 * Must match CityScene's spawn tile.
 */
const SEAL_UNREACHABLE_FROM = { col: 78, row: 38 };

/**
 * Script-generated barriers live in their own layer, rebuilt from scratch on
 * every run. Writing them into the hand-drawn ColliderInvisible instead would
 * bake them in permanently: the next run's flood fill would see last run's
 * seals as walls, so a path opened later in Tiled could never reopen.
 */
const AUTO_LAYER = "ColliderAuto";

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

/**
 * Tiled nests layers inside `group` layers; walk the whole tree.
 *
 * `layerPath` records each layer's "Group/Name", the form Phaser reports, and
 * `layerOffset` records its pixel offset with every parent group's offset
 * folded in — the same accumulation Phaser's Tiled parser does in
 * CreateGroupLayer. Skipping that is not academic: the Rocks group carries
 * offsetx -192 / offsety 216, so reading Rock01..03 at their own offsets alone
 * puts every tile 8 columns right and 9 rows up of where it actually renders.
 */
const layerPath = new Map();
const layerOffset = new Map();
function tileLayers(layers, prefix = "", ax = 0, ay = 0) {
  const out = [];
  for (const l of layers) {
    const ox = ax + (l.offsetx ?? 0);
    const oy = ay + (l.offsety ?? 0);
    if (l.type === "group") {
      out.push(...tileLayers(l.layers ?? [], `${prefix}${l.name}/`, ox, oy));
    } else if (l.type === "tilelayer" && l.data) {
      layerPath.set(l, prefix + l.name);
      layerOffset.set(l, { x: ox, y: oy });
      out.push(l);
    }
  }
  return out;
}

/** Tile-space origin of a layer, group offsets included. */
function originOf(layer) {
  const off = layerOffset.get(layer) ?? { x: 0, y: 0 };
  return {
    col: (layer.x ?? 0) + Math.round(off.x / map.tilewidth),
    row: (layer.y ?? 0) + Math.round(off.y / map.tileheight),
  };
}

/** Decoded tileset images, loaded on demand. */
const pngCache = new Map();
function tilesetPng(tileset) {
  if (!pngCache.has(tileset.name)) {
    const file = tileset.image.replace(/^.*[\\/]/, "");
    pngCache.set(tileset.name, PNG.sync.read(fs.readFileSync(path.join(TILESET_DIR, file))));
  }
  return pngCache.get(tileset.name);
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
{
  const targets = TARGET_TILESETS
    .map((name) => {
      const ts = map.tilesets.find((t) => t.name === name);
      if (!ts) console.error(`  ! tileset ${name} not found in city.json — skipped`);
      return ts;
    })
    .filter(Boolean);

  // Wipe last run's work so the canopy rule can be re-derived from scratch;
  // safe because the artist authored no collision in these tilesets at all.
  // The previous ids are kept so a re-run that lands on the same answer reports
  // no change instead of rewriting the map every time.
  const tilesBefore = new Map(targets.map((ts) => [ts.name, (ts.tiles ?? []).map((t) => t.id).join(",")]));
  for (const ts of targets) ts.tiles = [];

  const tilesetOf = (gid) =>
    targets.find((t) => gid >= t.firstgid && gid < t.firstgid + t.tilecount);

  /**
   * Which local tile ids must be solid.
   *
   * Decided POSITIONALLY, then applied per tile id. Walking the layers gives
   * each painted cell its row within its own structure, so the canopy rows can
   * be told from the body; applying the result by id then keeps every copy of a
   * stall consistent, since all six are built from the same tiles.
   */
  const solidIds = new Set();
  const openIds = new Set();
  for (const layer of tileLayers(map.layers)) {
    const label = layerPath.get(layer);
    const leaf = label.slice(label.lastIndexOf("/") + 1);
    const origin = originOf(layer);

    // Top row of the structure's ARTWORK. Measured from opaque tiles only: the
    // 7x7 stalls are padded with a ring of fully transparent tiles that draw
    // nothing, and counting those put their canopy window a row too high, so
    // the same tile read as canopy on one stall and body on another.
    let topRow = Infinity;
    for (let i = 0; i < layer.data.length; i++) {
      const raw0 = layer.data[i];
      if (!raw0) continue;
      const ts0 = tilesetOf(raw0 & GID_MASK);
      if (!ts0) continue;
      if (tileOpacity(tilesetPng(ts0), ts0, (raw0 & GID_MASK) - ts0.firstgid) < OPACITY_THRESHOLD) continue;
      topRow = Math.min(topRow, origin.row + Math.floor(i / layer.width));
    }
    if (!Number.isFinite(topRow)) continue;

    const canopyRows = CANOPY_TOP_ROWS[leaf] ?? 0;
    for (let i = 0; i < layer.data.length; i++) {
      const raw = layer.data[i];
      if (!raw) continue;
      const gid = raw & GID_MASK;
      const ts = tilesetOf(gid);
      if (!ts) continue;
      const row = origin.row + Math.floor(i / layer.width);
      const localId = gid - ts.firstgid;
      if (row < topRow + canopyRows) openIds.add(localId);
      else solidIds.add(localId);
    }
  }

  for (const ts of targets) {
    const png = tilesetPng(ts);
    let added = 0;
    let canopy = 0;
    let transparent = 0;
    for (const localId of solidIds) {
      if (localId < 0 || localId >= ts.tilecount) continue;
      if (!usedGids.has(ts.firstgid + localId)) continue;
      if (tileOpacity(png, ts, localId) < OPACITY_THRESHOLD) { transparent++; continue; }
      ts.tiles.push({ id: localId, objectgroup: fullTileCollision(ts) });
      added++;
    }
    for (const localId of openIds) {
      if (localId >= 0 && localId < ts.tilecount && !solidIds.has(localId)) canopy++;
    }
    ts.tiles.sort((a, b) => a.id - b.id);
    const changed = ts.tiles.map((t) => t.id).join(",") !== tilesBefore.get(ts.name);
    if (changed) totalAdded += added;
    console.log(
      `  ${ts.name}: ${added} solid tiles (${canopy} canopy left walk-behind, ` +
        `${transparent} transparent)${changed ? "" : " — unchanged"}`
    );
  }
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
    const origin = originOf(layer);
    const lc = col - origin.col;
    const lr = row - origin.row;
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

// ---------------------------------------------------------------- pass 4 ---
// Rebuild the generated barrier layer: solid decor + everything unreachable.

// Start from a blank slate so seals from earlier runs never masquerade as walls.
let auto = map.layers.find((l) => l.name === AUTO_LAYER);
if (!auto) {
  auto = {
    data: new Array(map.width * map.height).fill(0),
    height: map.height,
    id: Math.max(0, ...map.layers.map((l) => l.id ?? 0)) + 1,
    name: AUTO_LAYER,
    opacity: 1,
    type: "tilelayer",
    visible: false,
    width: map.width,
    x: 0,
    y: 0,
  };
  map.layers.push(auto);
}
const autoBefore = auto.data.filter(Boolean).length;
auto.data.fill(0);

/** Tile index -> solid, from tileset shapes plus every hand-drawn barrier. */
function buildBlocked() {
  const grid = new Uint8Array(map.width * map.height);
  for (const layer of tileLayers(map.layers)) {
    if (layer.name === AUTO_LAYER) continue;
    const origin = originOf(layer);
    const forced = layer.name.startsWith("Collider");
    for (let i = 0; i < layer.data.length; i++) {
      const raw = layer.data[i];
      if (!raw) continue;
      if (!forced && !solidGids.has(raw & GID_MASK)) continue;
      const col = origin.col + (i % layer.width);
      const row = origin.row + Math.floor(i / layer.width);
      if (col < 0 || col >= map.width || row < 0 || row >= map.height) continue;
      grid[row * map.width + col] = 1;
    }
  }
  return grid;
}

const grid = buildBlocked();
const seal = (col, row) => {
  auto.data[row * map.width + col] = BARRIER_GID;
  grid[row * map.width + col] = 1;
};

// 4a. Solid decor the tilesets left walkable (rocks in the shallows and on
// the sand). Same opacity test as the tileset backfill, so the transparent
// corners of each rock sprite stay walkable.
let rocks = 0;
for (const layer of tileLayers(map.layers)) {
  const label = layerPath.get(layer);
  const rule = SOLID_LAYERS.find((s) => s.layer === label);
  if (!rule) continue;
  const minOpacity = rule.minOpacity ?? OPACITY_THRESHOLD;
  const origin = originOf(layer);
  for (let i = 0; i < layer.data.length; i++) {
    const raw = layer.data[i];
    if (!raw) continue;
    const col = origin.col + (i % layer.width);
    const row = origin.row + Math.floor(i / layer.width);
    if (col < 0 || col >= map.width || row < 0 || row >= map.height) continue;
    if (grid[row * map.width + col]) continue;
    const gid = raw & GID_MASK;
    const ts = [...map.tilesets].sort((a, b) => b.firstgid - a.firstgid).find((t) => gid >= t.firstgid);
    const png = tilesetPng(ts);
    if (tileOpacity(png, ts, gid - ts.firstgid) < minOpacity) continue;
    seal(col, row);
    rocks++;
  }
}

// 4ab. Close the gaps in partly-collided building ground floors.
let bases = 0;
for (const layer of tileLayers(map.layers)) {
  if (!SEAL_BUILDING_BASES.test(layerPath.get(layer))) continue;
  const origin = originOf(layer);

  const cellOf = (i) => ({
    col: origin.col + (i % layer.width),
    row: origin.row + Math.floor(i / layer.width),
  });

  // The artist's own ground line: the topmost row carrying authored collision.
  let baseRow = Infinity;
  for (let i = 0; i < layer.data.length; i++) {
    const raw = layer.data[i];
    if (!raw || !solidGids.has(raw & GID_MASK)) continue;
    baseRow = Math.min(baseRow, cellOf(i).row);
  }
  if (!Number.isFinite(baseRow)) {
    console.error(`  ! ${layerPath.get(layer)} has no authored collision — skipped`);
    continue;
  }

  for (let i = 0; i < layer.data.length; i++) {
    const raw = layer.data[i];
    if (!raw) continue;
    const { col, row } = cellOf(i);
    if (row < baseRow) continue; // tower above — stays walkable behind
    if (col < 0 || col >= map.width || row < 0 || row >= map.height) continue;
    if (grid[row * map.width + col]) continue;
    const gid = raw & GID_MASK;
    const ts = [...map.tilesets].sort((a, b) => b.firstgid - a.firstgid).find((t) => gid >= t.firstgid);
    if (tileOpacity(tilesetPng(ts), ts, gid - ts.firstgid) < 0.35) continue;
    seal(col, row);
    bases++;
  }
  console.log(`  ${layerPath.get(layer)}: ground floor sealed from row ${baseRow}`);
}

// 4b. Flood the reachable world from the spawn, then seal everything else.
const { col: sc, row: sr } = SEAL_UNREACHABLE_FROM;
if (grid[sr * map.width + sc]) {
  throw new Error(`spawn tile ${sc},${sr} is solid — cannot flood the walkable world`);
}
const reached = new Uint8Array(map.width * map.height);
reached[sr * map.width + sc] = 1;
const queue = [[sc, sr]];
while (queue.length) {
  const [c, r] = queue.pop();
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nc = c + dc;
    const nr = r + dr;
    if (nc < 0 || nc >= map.width || nr < 0 || nr >= map.height) continue;
    const i = nr * map.width + nc;
    if (reached[i] || grid[i]) continue;
    reached[i] = 1;
    queue.push([nc, nr]);
  }
}

let walled = 0;
for (let row = 0; row < map.height; row++) {
  for (let col = 0; col < map.width; col++) {
    const i = row * map.width + col;
    if (grid[i] || reached[i]) continue;
    seal(col, row);
    walled++;
  }
}

const autoAfter = auto.data.filter(Boolean).length;
console.log(
  `  ${AUTO_LAYER}: ${rocks} solid-decor + ${bases} building-base + ${walled} walled-off = ${autoAfter} tiles ` +
    `(was ${autoBefore}); ${reached.reduce((a, b) => a + b, 0)} tiles reachable from ${sc},${sr}`
);

totalAdded += sealed + opened + renamed + (autoAfter === autoBefore ? 0 : 1);

if (dry) {
  console.log(`\n--dry: ${totalAdded} tiles would change, city.json not written`);
} else if (totalAdded > 0) {
  fs.writeFileSync(MAP, JSON.stringify(map));
  console.log(`\nwrote ${path.relative(process.cwd(), MAP)} (+${totalAdded} solid tiles)`);
} else {
  console.log("\nnothing to do — all target tiles already have collision");
}
