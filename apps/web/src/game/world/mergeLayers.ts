import * as Phaser from "phaser";

/**
 * Tile-layer consolidation, for memory and for physics cost.
 *
 * city.json is authored as 116 tile layers of 135x115 — one layer per palm,
 * per lamp post, per building — because a layer carries exactly ONE depth and
 * ONE alpha, and that is what lets a single palm fade out when the player
 * walks behind it. That authoring is right, but Phaser allocates a Tile object
 * for EVERY cell of EVERY layer whether it is painted or not: 1.8 million Tile
 * objects for the 43k tiles the artist actually painted, which is most of the
 * game's memory.
 *
 * Nothing here touches a layer that can fade or that y-sorts, so per-object
 * transparency keeps working exactly as authored. Two things are safe to
 * consolidate, and this module does only those:
 *
 *   1. Physics. Collision does not care which layer a solid tile came from,
 *      so every collidable tile is copied into ONE invisible layer. That
 *      turns ~74 colliders per moving body (times 96 pedestrians, every
 *      frame) into one.
 *   2. Flat ground. Layers that never collide, never fade and never y-sort —
 *      street, grass, sidewalk — only need to keep their paint order, so a
 *      contiguous run of them collapses into a single layer.
 *
 * A layer is only ever merged when it can be reproduced EXACTLY: whole-tile
 * offsets, nothing pushed out of bounds. Anything else is left alone.
 */

/** A layer's Tiled offset expressed in whole tiles, or null if fractional. */
function tileOffset(
  layer: Phaser.Tilemaps.TilemapLayer,
  map: Phaser.Tilemaps.Tilemap,
): { ox: number; oy: number } | null {
  const ox = layer.x / map.tileWidth;
  const oy = layer.y / map.tileHeight;
  if (!Number.isInteger(ox) || !Number.isInteger(oy)) return null;
  return { ox, oy };
}

/** Painted tiles of `src`, shifted onto the unoffset grid — null if any falls out of bounds. */
function shiftedTiles(
  src: Phaser.Tilemaps.TilemapLayer,
  map: Phaser.Tilemaps.Tilemap,
  onlyColliding: boolean,
): Array<{ tile: Phaser.Tilemaps.Tile; x: number; y: number }> | null {
  const off = tileOffset(src, map);
  if (!off) return null;
  const out: Array<{ tile: Phaser.Tilemaps.Tile; x: number; y: number }> = [];
  let escaped = false;
  src.forEachTile((tile: Phaser.Tilemaps.Tile) => {
    if (escaped) return;
    if (tile.index <= 0) return;
    if (onlyColliding && !tile.collides) return;
    const x = tile.x + off.ox;
    const y = tile.y + off.oy;
    // A tile that would land outside the grid cannot be reproduced here, and
    // dropping it would silently delete art (or a wall). Leave the whole layer.
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) { escaped = true; return; }
    out.push({ tile, x, y });
  });
  return escaped ? null : out;
}

export interface PhysicsMerge {
  /** The single invisible layer every collider should use. */
  layer: Phaser.Tilemaps.TilemapLayer;
  /** Layers that could not be reproduced and still need their own collider. */
  leftovers: Phaser.Tilemaps.TilemapLayer[];
}

/**
 * Copies every collidable tile of `sources` into one invisible layer.
 *
 * Per-side collision flags are carried over rather than forced solid: a tile
 * whose tileset only walls its south face must stay walkable from the north,
 * or the city quietly grows walls the map never had.
 */
export function buildPhysicsLayer(
  map: Phaser.Tilemaps.Tilemap,
  tilesets: Phaser.Tilemaps.Tileset[],
  sources: Phaser.Tilemaps.TilemapLayer[],
): PhysicsMerge | null {
  const merged = map.createBlankLayer("__physics", tilesets);
  if (!merged) return null;
  merged.setVisible(false);
  // Purely a collision volume: never drawn, never in front of anything.
  merged.setDepth(-1);

  const leftovers: Phaser.Tilemaps.TilemapLayer[] = [];

  for (const src of sources) {
    const tiles = shiftedTiles(src, map, true);
    if (!tiles) { leftovers.push(src); continue; }
    for (const { tile, x, y } of tiles) {
      const existing = merged.getTileAt(x, y);
      if (existing && existing.index > 0) {
        // Two layers wall the same cell: keep every side either one blocks.
        existing.setCollision(
          existing.collideLeft  || tile.collideLeft,
          existing.collideRight || tile.collideRight,
          existing.collideUp    || tile.collideUp,
          existing.collideDown  || tile.collideDown,
          false,
        );
        continue;
      }
      const dst = merged.putTileAt(tile.index, x, y, false);
      if (!dst) continue;
      dst.setCollision(
        tile.collideLeft, tile.collideRight, tile.collideUp, tile.collideDown, false,
      );
    }
  }

  // Interior faces decide which edges Arcade separates against, and putTileAt
  // was told not to recalculate them one by one.
  merged.calculateFacesWithin(0, 0, map.width, map.height);
  return { layer: merged, leftovers };
}

/**
 * Collapses a run of flat ground layers into as few layers as their stacking
 * allows, pixel for pixel.
 *
 * A cell can only hold one tile per layer, and ground tiles DO stack: a curb
 * or a beach edge is painted over the street and leaves part of its cell
 * transparent, so whatever is underneath still shows through. Flattening those
 * two into one cell would punch a hole in the city. So a source layer joins
 * the layer being filled only while none of its cells is already taken; the
 * first clash opens a new one.
 *
 * Order is preserved by construction: each output holds sources in the order
 * they were authored, outputs are created in that same order, and a clash can
 * only ever be with a source that went into this output or an earlier one.
 * A run of 29 layers collapses to however deep the paint actually stacks,
 * which is a handful.
 *
 * Returns an empty array without touching anything if the run cannot be
 * reproduced exactly, or if there is nothing to gain.
 */
export function mergeGroundRun(
  map: Phaser.Tilemaps.Tilemap,
  tilesets: Phaser.Tilemaps.Tileset[],
  run: Phaser.Tilemaps.TilemapLayer[],
  name: string,
): Phaser.Tilemaps.TilemapLayer[] {
  if (run.length < 2) return [];

  // Validate everything BEFORE creating or destroying anything.
  const batches: Array<Array<{ tile: Phaser.Tilemaps.Tile; x: number; y: number }>> = [];
  for (const src of run) {
    if (src.alpha !== 1 || !src.visible) return [];
    const tiles = shiftedTiles(src, map, false);
    if (!tiles) return [];
    batches.push(tiles);
  }

  const out: Phaser.Tilemaps.TilemapLayer[] = [];
  // Cell occupancy of the layer currently being filled — cheaper to consult
  // than the tilemap, and it has to be checked for every tile of every layer.
  let taken = new Uint8Array(map.width * map.height);
  let current: Phaser.Tilemaps.TilemapLayer | null = null;

  for (let i = 0; i < run.length; i++) {
    const batch = batches[i];
    const clashes = current !== null &&
      batch.some(({ x, y }) => taken[y * map.width + x] === 1);

    if (current === null || clashes) {
      const next = map.createBlankLayer(`${name}_${out.length}`, tilesets);
      if (!next) break; // out of layers — keep whatever was merged so far
      next.setDepth(run[i].depth);
      out.push(next);
      current = next;
      taken = new Uint8Array(map.width * map.height);
    }

    for (const { tile, x, y } of batch) {
      const dst = current.putTileAt(tile.index, x, y, false);
      taken[y * map.width + x] = 1;
      if (!dst) continue;
      dst.flipX = tile.flipX;
      dst.flipY = tile.flipY;
      dst.rotation = tile.rotation;
    }
  }

  if (out.length >= run.length) {
    // Nothing gained — drop the copies and leave the originals in place.
    for (const l of out) l.destroy(true);
    return [];
  }

  // destroy(true) also drops the LayerData off the Tilemap — without it the
  // 15,525 Tile objects behind each source layer stay reachable and nothing
  // is actually freed, which is the entire point of this pass.
  for (const src of run) src.destroy(true);
  return out;
}
