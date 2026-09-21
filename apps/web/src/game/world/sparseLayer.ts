import * as Phaser from "phaser";

/**
 * A city object (palm, lamp post, building) drawn with a Blitter instead of a
 * full tilemap layer.
 *
 * city.json keeps every object on its own tile layer because a layer carries
 * one depth and one alpha — that is what makes a single palm fade out when
 * the player walks behind it. The cost is the grid: Phaser allocates a Tile
 * for all 15,525 cells of a layer even when the palm paints six of them.
 *
 * A Blitter keeps the part that matters — one depth, one alpha — and drops the
 * grid: it holds one lightweight Bob per painted tile, drawn straight out of
 * the tileset texture. So each object still fades on its own, exactly as
 * before, for a few hundred bytes instead of a few megabytes.
 *
 * Collision is NOT handled here. By the time a layer is converted its solid
 * tiles already live in the merged physics layer (see mergeLayers.ts); a
 * layer whose collision could not be merged is never converted.
 */

/** The fields of a painted tile that the minimap and the stock screens read. */
export interface PaintedTile {
  index: number;
  x: number;
  y: number;
  tileset: Phaser.Tilemaps.Tileset | null;
  flipX: boolean;
  flipY: boolean;
  rotation: number;
}

/**
 * The part of a tile layer the rest of the city talks to. Both a real
 * TilemapLayer and a SparseLayer satisfy it, so the fade loop, the minimap and
 * the Stocklana screens do not care which one they hold.
 */
export interface CityLayer {
  readonly layer: { name: string };
  readonly depth: number;
  alpha: number;
  readonly visible: boolean;
  getTileAtWorldXY(worldX: number, worldY: number): unknown;
  forEachTile(callback: (tile: PaintedTile) => void): unknown;
  tileToWorldX(tileX: number): number | null;
  tileToWorldY(tileY: number): number | null;
}

/** Layers painting up to this many tiles become ONE Blitter (one object,
 *  culled as a whole). Denser layers — the ground — are split into chunks. */
export const SPARSE_MAX_TILES = 1000;

/** Chunk edge, in tiles, for dense layers: each chunk is its own Blitter and
 *  is culled on its own, so only the chunks near the camera are drawn. */
export const GROUND_CHUNK_TILES = 16;

export class SparseLayer implements CityLayer {
  readonly layer: { name: string };
  readonly visible = true;
  /** World-space rectangle covering every tile, for culling. */
  readonly bounds: Phaser.Geom.Rectangle;

  /** One Blitter per (texture, chunk), each with the world rect it covers. */
  private readonly parts: Array<{ blitter: Phaser.GameObjects.Blitter; bounds: Phaser.Geom.Rectangle; on: boolean }> = [];
  private readonly tiles: PaintedTile[];
  /** row * gridW + col → tile, for the fade loop's per-frame lookups. */
  private readonly cells = new Map<number, PaintedTile>();
  private readonly offX: number;
  private readonly offY: number;
  private readonly tileW: number;
  private readonly tileH: number;
  private readonly gridW: number;
  private _alpha: number;
  private _depth: number;

  private constructor(
    scene: Phaser.Scene,
    src: Phaser.Tilemaps.TilemapLayer,
    tiles: PaintedTile[],
    chunkTiles: number,
  ) {
    this.layer = { name: src.layer.name };
    this.tiles = tiles;
    this.offX = src.x;
    this.offY = src.y;
    this.tileW = src.tilemap.tileWidth;
    this.tileH = src.tilemap.tileHeight;
    this.gridW = src.layer.width;
    this._alpha = src.alpha;
    this._depth = src.depth;

    const byPart = new Map<string, { blitter: Phaser.GameObjects.Blitter; bounds: Phaser.Geom.Rectangle; on: boolean }>();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const t of tiles) {
      const ts = t.tileset!;
      const tex = ts.image!;
      // One frame per tile id, added to the tileset texture itself and shared
      // by every object that uses the tile.
      const frameName = `__tile${t.index}`;
      if (!tex.has(frameName)) {
        const c = ts.getTileTextureCoordinates(t.index) as { x: number; y: number };
        tex.add(frameName, 0, c.x, c.y, ts.tileWidth, ts.tileHeight);
      }

      // Same placement as TilemapLayerWebGLRenderer: grid cell, minus the
      // tileset's draw offset (Phaser subtracts it), top-left anchored.
      const x = this.offX + t.x * this.tileW - ts.tileOffset.x;
      const y = this.offY + t.y * this.tileH - ts.tileOffset.y;

      const partKey = chunkTiles > 0
        ? `${tex.key}|${Math.floor(t.x / chunkTiles)},${Math.floor(t.y / chunkTiles)}`
        : tex.key;
      let part = byPart.get(partKey);
      if (!part) {
        const blitter = scene.add.blitter(0, 0, tex.key);
        blitter.setDepth(this._depth);
        blitter.setAlpha(this._alpha);
        part = { blitter, bounds: new Phaser.Geom.Rectangle(x, y, 0, 0), on: true };
        byPart.set(partKey, part);
        this.parts.push(part);
      }
      const bob = part.blitter.create(x, y, frameName);
      bob.flipX = t.flipX;
      bob.flipY = t.flipY;
      Phaser.Geom.Rectangle.MergeRect(part.bounds, new Phaser.Geom.Rectangle(x, y, ts.tileWidth, ts.tileHeight));

      this.cells.set(t.y * this.gridW + t.x, t);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + ts.tileWidth);
      maxY = Math.max(maxY, y + ts.tileHeight);
    }

    this.bounds = new Phaser.Geom.Rectangle(minX, minY, maxX - minX, maxY - minY);
  }

  /**
   * Converts `src` and destroys it, or returns null and leaves it alone when
   * it cannot be reproduced exactly (rotated or tinted tiles, a tile whose
   * tileset has no texture, or a stacking order Blitters cannot keep).
   *
   * `chunkTiles` > 0 splits the layer into square chunks of that many tiles,
   * each its own Blitter culled on its own: that is how the dense ground is
   * converted, where one Blitter would draw the whole map every frame.
   */
  static from(
    scene: Phaser.Scene,
    src: Phaser.Tilemaps.TilemapLayer,
    chunkTiles = 0,
  ): SparseLayer | null {
    const map = src.tilemap;
    const tiles: PaintedTile[] = [];
    let ok = true;
    let texture: Phaser.Textures.Texture | null = null;
    let multiTexture = false;
    let oversized = false;
    src.forEachTile((t: Phaser.Tilemaps.Tile) => {
      if (!ok || t.index <= 0) return;
      const ts = t.tileset;
      if (!ts || !ts.image || t.rotation !== 0 || t.alpha !== 1) { ok = false; return; }
      if (texture && texture !== ts.image) multiTexture = true;
      texture = ts.image;
      if (ts.tileWidth !== map.tileWidth || ts.tileHeight !== map.tileHeight ||
          ts.tileOffset.x !== 0 || ts.tileOffset.y !== 0) oversized = true;
      // Plain objects: holding the Tile itself would keep its LayerData — and
      // with it the whole grid — alive.
      tiles.push({
        index: t.index, x: t.x, y: t.y, tileset: ts,
        flipX: t.flipX, flipY: t.flipY, rotation: 0,
      });
    });
    if (!ok || tiles.length === 0) return null;

    // A tilemap paints row by row, so a tile bigger than its grid cell
    // overlaps its neighbours in that order. Bobs keep creation order only
    // inside one Blitter — so whenever a layer needs more than one (several
    // tilesets, or chunks), it must be made of grid-sized tiles that never
    // overlap, or it could come out stacked differently. Those stay tilemaps.
    if (oversized && (multiTexture || chunkTiles > 0)) return null;

    const sparse = new SparseLayer(scene, src, tiles, chunkTiles);
    src.destroy(true);
    return sparse;
  }

  get depth(): number {
    return this._depth;
  }

  get alpha(): number {
    return this._alpha;
  }

  set alpha(value: number) {
    this._alpha = value;
    for (const p of this.parts) p.blitter.setAlpha(value);
  }

  /** Same contract as TilemapLayer: something when a tile is painted there, null otherwise. */
  getTileAtWorldXY(worldX: number, worldY: number): PaintedTile | null {
    const col = Math.floor((worldX - this.offX) / this.tileW);
    const row = Math.floor((worldY - this.offY) / this.tileH);
    if (col < 0 || row < 0 || col >= this.gridW) return null;
    return this.cells.get(row * this.gridW + col) ?? null;
  }

  forEachTile(callback: (tile: PaintedTile) => void): this {
    for (const t of this.tiles) callback(t);
    return this;
  }

  tileToWorldX(tileX: number): number {
    return this.offX + tileX * this.tileW;
  }

  tileToWorldY(tileY: number): number {
    return this.offY + tileY * this.tileH;
  }

  /**
   * Hides every part that is off screen. A Blitter submits every Bob each
   * frame (a TilemapLayer culls to the camera), so without this every palm —
   * and every chunk of street — would be drawn whether you can see it or not.
   */
  cull(view: Phaser.Geom.Rectangle): void {
    for (const p of this.parts) {
      const on = Phaser.Geom.Rectangle.Overlaps(view, p.bounds);
      if (on === p.on) continue;
      p.on = on;
      p.blitter.setVisible(on);
    }
  }

  destroy(): void {
    for (const p of this.parts) p.blitter.destroy();
    this.parts.length = 0;
  }
}
