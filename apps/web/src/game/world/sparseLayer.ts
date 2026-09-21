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
 * One layer is often MORE than one object: a Tiled layer named
 * "VegetationPalmCenter" holds all seven palms around the plaza. So a layer is
 * split into objects (clusters of touching tiles), and each object gets its
 * own depth and its own fade. Otherwise walking behind one palm faded every
 * palm on the layer, including ones across the screen, and a northern palm
 * was depth-sorted by the base of the southernmost one.
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
  /** Solid in the source layer: marks a trunk or a wall base for y-sorting. */
  collides?: boolean;
}

/** Tiles at most this far apart (in cells) belong to the same object. */
const OBJECT_GAP = 2;
/** Alpha of an object while it hides the player. */
const FADED_ALPHA = 0.25;
/** A pixel counts as covering the player from this alpha up (0..255). */
const OPAQUE_ALPHA = 32;

/**
 * Per-tile "is this pixel visible" masks, built lazily and shared by every
 * layer. Big buildings are sliced into a grid, so a building's rectangle is
 * full of fully transparent tiles: a tile being PAINTED somewhere says
 * nothing about whether it hides anything there.
 */
const opaqueMasks = new Map<string, Uint8Array>();
/** One scratch canvas for reading tile pixels, reused for every mask. */
let maskCanvas: HTMLCanvasElement | null = null;

function opaqueMask(ts: Phaser.Tilemaps.Tileset, index: number): Uint8Array | null {
  const tex = ts.image;
  if (!tex) return null;
  const key = `${tex.key}|${index}`;
  const hit = opaqueMasks.get(key);
  if (hit) return hit;
  const w = ts.tileWidth;
  const h = ts.tileHeight;
  maskCanvas ??= document.createElement("canvas");
  if (maskCanvas.width < w) maskCanvas.width = w;
  if (maskCanvas.height < h) maskCanvas.height = h;
  const ctx = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.clearRect(0, 0, w, h);
  const c = ts.getTileTextureCoordinates(index) as { x: number; y: number };
  ctx.drawImage(tex.getSourceImage() as CanvasImageSource, c.x, c.y, w, h, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] >= OPAQUE_ALPHA ? 1 : 0;
  opaqueMasks.set(key, mask);
  return mask;
}

type Part = { blitter: Phaser.GameObjects.Blitter; bounds: Phaser.Geom.Rectangle; on: boolean };

/** One object on the layer: its own blitters, depth and fade. */
interface CityObject {
  parts: Part[];
  depth: number;
  alpha: number;
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

  /** One Blitter per (object or chunk, texture), each with the world rect it covers. */
  private readonly parts: Part[] = [];
  /** The separate objects on this layer (one entry for a chunked ground layer). */
  private readonly objects: CityObject[] = [];
  private readonly tiles: PaintedTile[];
  /** row * gridW + col → tile, for the fade loop's per-frame lookups. */
  private readonly cells = new Map<number, PaintedTile>();
  /** row * gridW + col → index into `objects`. */
  private readonly cellObject = new Map<number, number>();
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
    ySorted: boolean,
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

    for (const t of tiles) this.cells.set(t.y * this.gridW + t.x, t);

    // Chunked ground is one group; everything else is split into objects.
    const groups = chunkTiles > 0 ? [tiles] : this.splitObjects(tiles);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    groups.forEach((group, objectIndex) => {
      // A y-sorted object sorts by ITS OWN base, not the layer's.
      const depth = ySorted && chunkTiles === 0 ? this.baseDepth(group) : this._depth;
      const object: CityObject = { parts: [], depth, alpha: this._alpha };
      const byPart = new Map<string, Part>();

      for (const t of group) {
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
          blitter.setDepth(depth);
          blitter.setAlpha(this._alpha);
          part = { blitter, bounds: new Phaser.Geom.Rectangle(x, y, 0, 0), on: true };
          byPart.set(partKey, part);
          object.parts.push(part);
          this.parts.push(part);
        }
        const bob = part.blitter.create(x, y, frameName);
        bob.flipX = t.flipX;
        bob.flipY = t.flipY;
        Phaser.Geom.Rectangle.MergeRect(part.bounds, new Phaser.Geom.Rectangle(x, y, ts.tileWidth, ts.tileHeight));

        this.cellObject.set(t.y * this.gridW + t.x, objectIndex);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + ts.tileWidth);
        maxY = Math.max(maxY, y + ts.tileHeight);
      }
      this.objects.push(object);
    });

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
    /** Depth-sorted against the player: each object then sorts by its own base. */
    ySorted = false,
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
        flipX: t.flipX, flipY: t.flipY, rotation: 0, collides: t.collides,
      });
    });
    if (!ok || tiles.length === 0) return null;

    // A tilemap paints row by row, so a tile bigger than its grid cell
    // overlaps its neighbours in that order. Bobs keep creation order only
    // inside one Blitter — so whenever a layer needs more than one (several
    // tilesets, or chunks), it must be made of grid-sized tiles that never
    // overlap, or it could come out stacked differently. Those stay tilemaps.
    if (oversized && (multiTexture || chunkTiles > 0)) return null;

    const sparse = new SparseLayer(scene, src, tiles, chunkTiles, ySorted);
    src.destroy(true);
    return sparse;
  }

  /** The layer's lowest object depth (what the static bake compares against). */
  get depth(): number {
    return this.objects.reduce((d, o) => Math.min(d, o.depth), Infinity);
  }

  /** The most faded object's alpha: exact for a one-object layer. */
  get alpha(): number {
    return this.objects.reduce((a, o) => Math.min(a, o.alpha), 1);
  }

  set alpha(value: number) {
    this._alpha = value;
    for (const o of this.objects) this.setObjectAlpha(o, value);
  }

  /**
   * Fades only the object that actually hides the player: it has to draw
   * above them (its own depth past their feet) AND cover their body. Sampled
   * at the torso and head, since the player is drawn upward from the feet.
   * Every other object on the layer eases back to fully opaque.
   */
  updateFade(px: number, feetY: number): void {
    const hiding = new Set<number>();
    // Torso and head, centre and both sides: the object hides the player only
    // where it has VISIBLE pixels over their body, not wherever it has a tile.
    const points: Array<[number, number]> = [
      [px, feetY - this.tileH], [px - 6, feetY - this.tileH], [px + 6, feetY - this.tileH],
      [px, feetY - this.tileH * 1.5],
    ];
    for (const [x, y] of points) {
      const idx = this.objectAt(x, y);
      if (idx === undefined || hiding.has(idx) || !(this.objects[idx].depth > feetY)) continue;
      if (this.opaqueAt(x, y)) hiding.add(idx);
    }
    this.objects.forEach((o, i) => {
      const target = hiding.has(i) ? FADED_ALPHA : 1;
      if (Math.abs(o.alpha - target) > 0.004) {
        this.setObjectAlpha(o, Phaser.Math.Linear(o.alpha, target, 0.12));
      }
    });
  }

  private objectAt(worldX: number, worldY: number): number | undefined {
    const col = Math.floor((worldX - this.offX) / this.tileW);
    const row = Math.floor((worldY - this.offY) / this.tileH);
    if (col < 0 || row < 0 || col >= this.gridW) return undefined;
    return this.cellObject.get(row * this.gridW + col);
  }

  /** True when the tile painted at this world point has a visible pixel there. */
  private opaqueAt(worldX: number, worldY: number): boolean {
    const col = Math.floor((worldX - this.offX) / this.tileW);
    const row = Math.floor((worldY - this.offY) / this.tileH);
    const t = this.cells.get(row * this.gridW + col);
    if (!t?.tileset) return false;
    const ts = t.tileset;
    const mask = opaqueMask(ts, t.index);
    if (!mask) return true; // cannot read the pixels: keep the old, tile-level answer
    let lx = Math.floor(worldX - (this.offX + t.x * this.tileW - ts.tileOffset.x));
    let ly = Math.floor(worldY - (this.offY + t.y * this.tileH - ts.tileOffset.y));
    if (lx < 0 || ly < 0 || lx >= ts.tileWidth || ly >= ts.tileHeight) return false;
    if (t.flipX) lx = ts.tileWidth - 1 - lx;
    if (t.flipY) ly = ts.tileHeight - 1 - ly;
    return mask[ly * ts.tileWidth + lx] === 1;
  }

  private setObjectAlpha(o: CityObject, value: number): void {
    o.alpha = value;
    for (const p of o.parts) p.blitter.setAlpha(value);
  }

  /** Groups tiles that touch (within OBJECT_GAP cells) into separate objects. */
  private splitObjects(tiles: PaintedTile[]): PaintedTile[][] {
    const key = (x: number, y: number) => y * this.gridW + x;
    const left = new Map<number, PaintedTile>();
    for (const t of tiles) left.set(key(t.x, t.y), t);
    const groups: PaintedTile[][] = [];
    for (const start of tiles) {
      if (!left.has(key(start.x, start.y))) continue;
      left.delete(key(start.x, start.y));
      const group = [start];
      const stack = [start];
      while (stack.length) {
        const t = stack.pop()!;
        for (let dy = -OBJECT_GAP; dy <= OBJECT_GAP; dy++) {
          for (let dx = -OBJECT_GAP; dx <= OBJECT_GAP; dx++) {
            const k = key(t.x + dx, t.y + dy);
            const n = left.get(k);
            if (!n) continue;
            left.delete(k);
            group.push(n);
            stack.push(n);
          }
        }
      }
      // Keep the source's row-by-row paint order inside the object.
      group.sort((a, b) => a.y - b.y || a.x - b.x);
      groups.push(group);
    }
    return groups;
  }

  /**
   * Where an object meets the ground, as a depth. Same rule the scene uses for
   * a whole layer: the southernmost well-populated row of its solid tiles
   * (a trunk, a wall base), ignoring a stray tile or two; with no solid
   * tiles, the bottom of whatever it paints.
   */
  private baseDepth(group: PaintedTile[]): number {
    const solid = group.filter((t) => t.collides);
    let baseRow: number;
    if (solid.length > 0) {
      const perRow = new Map<number, number>();
      for (const t of solid) perRow.set(t.y, (perRow.get(t.y) ?? 0) + 1);
      const busiest = Math.max(...perRow.values());
      baseRow = -1;
      for (const [row, count] of perRow) {
        if (count * 4 < busiest) continue;
        if (row > baseRow) baseRow = row;
      }
    } else {
      baseRow = Math.max(...group.map((t) => t.y));
    }
    return this.offY + baseRow * this.tileH + this.tileH;
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

  /**
   * Every tile as the renderer draws it — texture, frame and world position —
   * in draw order, for baking into a static texture (see groundBake.ts).
   * Null if a tile is flipped: the bake draws frames as-is and cannot flip.
   */
  drawList(): Array<{ key: string; frame: string; x: number; y: number }> | null {
    const out: Array<{ key: string; frame: string; x: number; y: number }> = [];
    for (const t of this.tiles) {
      if (t.flipX || t.flipY) return null;
      const ts = t.tileset!;
      out.push({
        key: ts.image!.key,
        frame: `__tile${t.index}`,
        x: this.offX + t.x * this.tileW - ts.tileOffset.x,
        y: this.offY + t.y * this.tileH - ts.tileOffset.y,
      });
    }
    return out;
  }

  /**
   * Stops drawing this layer: its pixels now live in a baked texture. The
   * tile data stays, so the minimap and tile lookups keep working.
   */
  releaseRendering(): void {
    for (const p of this.parts) p.blitter.destroy();
    this.parts.length = 0;
  }

  destroy(): void {
    this.releaseRendering();
  }
}
