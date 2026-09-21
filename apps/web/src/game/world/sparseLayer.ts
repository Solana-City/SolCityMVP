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

/** Layers painting more tiles than this stay tilemaps: they are ground, and a
 *  TilemapLayer only draws the cells on screen, while a Blitter draws them all. */
export const SPARSE_MAX_TILES = 1000;

export class SparseLayer implements CityLayer {
  readonly layer: { name: string };
  readonly visible = true;
  /** World-space rectangle covering every tile, for culling. */
  readonly bounds: Phaser.Geom.Rectangle;

  private readonly blitters: Phaser.GameObjects.Blitter[] = [];
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
  private onScreen = true;

  private constructor(
    scene: Phaser.Scene,
    src: Phaser.Tilemaps.TilemapLayer,
    tiles: PaintedTile[],
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

    const byTexture = new Map<string, Phaser.GameObjects.Blitter>();
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

      let blitter = byTexture.get(tex.key);
      if (!blitter) {
        blitter = scene.add.blitter(0, 0, tex.key);
        blitter.setDepth(this._depth);
        blitter.setAlpha(this._alpha);
        byTexture.set(tex.key, blitter);
        this.blitters.push(blitter);
      }

      // Same placement as TilemapLayerWebGLRenderer: grid cell, minus the
      // tileset's draw offset (Phaser subtracts it), top-left anchored.
      const x = this.offX + t.x * this.tileW - ts.tileOffset.x;
      const y = this.offY + t.y * this.tileH - ts.tileOffset.y;
      const bob = blitter.create(x, y, frameName);
      bob.flipX = t.flipX;
      bob.flipY = t.flipY;

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
   * tileset has no texture).
   */
  static from(scene: Phaser.Scene, src: Phaser.Tilemaps.TilemapLayer): SparseLayer | null {
    const tiles: PaintedTile[] = [];
    let ok = true;
    let texture: Phaser.Textures.Texture | null = null;
    src.forEachTile((t: Phaser.Tilemaps.Tile) => {
      if (!ok || t.index <= 0) return;
      const ts = t.tileset;
      if (!ts || !ts.image || t.rotation !== 0 || t.alpha !== 1) { ok = false; return; }
      // A tilemap paints row by row, so an oversized tile overlaps its
      // neighbours in that order. Bobs keep creation order only within one
      // Blitter, and a Blitter draws from one texture — a layer mixing
      // tilesets could come out stacked differently, so it stays a tilemap.
      if (texture && texture !== ts.image) { ok = false; return; }
      texture = ts.image;
      // Plain objects: holding the Tile itself would keep its LayerData — and
      // with it the whole 15,525-cell grid — alive.
      tiles.push({
        index: t.index, x: t.x, y: t.y, tileset: ts,
        flipX: t.flipX, flipY: t.flipY, rotation: 0,
      });
    });
    if (!ok || tiles.length === 0) return null;

    const sparse = new SparseLayer(scene, src, tiles);
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
    for (const b of this.blitters) b.setAlpha(value);
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
   * Hides the object while it is off screen. A Blitter submits every Bob each
   * frame (a TilemapLayer culls to the camera), so without this every palm in
   * the city would be drawn whether you can see it or not.
   */
  cull(view: Phaser.Geom.Rectangle): void {
    const on = Phaser.Geom.Rectangle.Overlaps(view, this.bounds);
    if (on === this.onScreen) return;
    this.onScreen = on;
    for (const b of this.blitters) b.setVisible(on);
  }

  destroy(): void {
    for (const b of this.blitters) b.destroy();
    this.blitters.length = 0;
  }
}
