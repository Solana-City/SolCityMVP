import * as Phaser from "phaser";
import type { SparseLayer } from "./sparseLayer";

/**
 * Bakes every static city layer (ground, and buildings that never fade) into
 * a grid of textures, drawn once instead of every frame.
 *
 * After the Blitter pass, drawing tiles was still most of the frame: ~10k
 * quads a frame, because street, sidewalk and grass are painted in stacked
 * layers and every one of them was redrawn each frame. None of them ever
 * change — no fade, no y-sort, no animation — and they all sit BELOW
 * everything that moves: their depths are layer indices (0 to ~116) while
 * characters and y-sorted objects use their world Y. So their final pixels
 * are the same every frame and can be drawn once.
 *
 * The world is cut into CHUNK_PX squares; each chunk that has any static tile
 * gets one RenderTexture, painted with that chunk's tiles in the exact order
 * the layers drew them (by depth, then row by row). A visible chunk then costs
 * one quad per frame, and chunks off camera are not drawn at all.
 *
 * The textures are STREAMED: only chunks near the camera hold one. Baking the
 * whole city at once cost 72 textures of 384x384 — 40 MB standing, whatever
 * the player was looking at, on a phone as much as on a desktop. Now a chunk
 * takes its texture when it comes within a screen of the camera and gives it
 * back when it leaves, so what is held follows the view: about 2 MB at a
 * phone's default zoom, 14 at a desktop's, and the full map only if somebody
 * zooms out far enough to see the full map.
 *
 * Painting is spread over frames (PAINTS_PER_FRAME), and the ring of chunks
 * beyond the view is painted BEFORE it is needed, so walking never arrives at
 * an unpainted chunk. A player who teleports (fast travel) can, so a chunk
 * that is visible and not yet painted is painted immediately rather than
 * queued.
 *
 * The baked grid takes the HIGHEST static depth, so anything that used to
 * draw above every static layer still does, and anything that sat between
 * them (nothing is meant to) stays underneath as before.
 *
 * WebGL can lose its context (phones do it when the app is backgrounded);
 * render textures come back blank, so the bake is redrawn on restore.
 */

const CHUNK_PX = 384; // 16 tiles of 24px: tile edges never straddle a chunk
/**
 * How far beyond the view a chunk is brought in, and how much further it has
 * to be before it is let go. Two numbers, not one: with a single threshold a
 * camera resting on a chunk boundary would create and destroy that texture
 * every frame. Bringing in at a quarter chunk still gives half a second of
 * warning at walking speed, which is ten times what painting one costs.
 */
const ATTACH_PAD = 96;
const RELEASE_PAD = CHUNK_PX;
/** Chunks painted per frame while catching up — painting is drawImage-heavy. */
const PAINTS_PER_FRAME = 2;

interface Chunk {
  /** Null while this chunk is far from the camera. */
  rt: Phaser.GameObjects.RenderTexture | null;
  bounds: Phaser.Geom.Rectangle;
  tiles: Array<{ key: string; frame: string; x: number; y: number }>;
  on: boolean;
  /** Painted since the texture was created (or since a context loss). */
  painted: boolean;
}

export interface BakedGround {
  chunks: number;
  tiles: number;
  cull(view: Phaser.Geom.Rectangle): void;
  destroy(): void;
}

/**
 * Bakes `layers` (all static) and releases their per-frame rendering. Returns
 * null — touching nothing — if any layer cannot be baked exactly, since
 * leaving one static layer out would break the draw order of the rest.
 */
export function bakeStaticLayers(scene: Phaser.Scene, layers: SparseLayer[]): BakedGround | null {
  if (layers.length === 0) return null;

  // Draw order: by depth; equal depths keep their creation order (stable sort).
  const ordered = layers
    .map((layer, i) => ({ layer, i }))
    .sort((a, b) => a.layer.depth - b.layer.depth || a.i - b.i)
    .map((e) => e.layer);

  const lists = ordered.map((l) => l.drawList());
  if (lists.some((l) => l === null)) return null;

  const byChunk = new Map<string, Chunk["tiles"]>();
  let tileCount = 0;
  for (const list of lists) {
    for (const t of list!) {
      const key = `${Math.floor(t.x / CHUNK_PX)},${Math.floor(t.y / CHUNK_PX)}`;
      let bucket = byChunk.get(key);
      if (!bucket) { bucket = []; byChunk.set(key, bucket); }
      bucket.push(t);
      tileCount++;
    }
  }

  const depth = Math.max(...ordered.map((l) => l.depth));
  const chunks: Chunk[] = [];
  for (const [key, tiles] of byChunk) {
    const [cx, cy] = key.split(",").map(Number);
    const x0 = cx * CHUNK_PX;
    const y0 = cy * CHUNK_PX;
    chunks.push({
      rt: null,
      bounds: new Phaser.Geom.Rectangle(x0, y0, CHUNK_PX, CHUNK_PX),
      tiles,
      on: false,
      painted: false,
    });
  }

  const attach = (c: Chunk): void => {
    if (c.rt) return;
    c.rt = scene.add
      .renderTexture(c.bounds.x, c.bounds.y, CHUNK_PX, CHUNK_PX)
      .setOrigin(0, 0)
      .setDepth(depth);
    c.rt.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    // Starts hidden and matches `on`, which the cull sets in the same pass:
    // a chunk in the ring beyond the view exists to be ready, not to be drawn.
    c.rt.setVisible(false);
    c.painted = false;
  };

  const release = (c: Chunk): void => {
    c.rt?.destroy();
    c.rt = null;
    c.painted = false;
    c.on = false;
  };

  const paint = (c: Chunk): void => {
    if (!c.rt) return;
    c.rt.clear();
    c.rt.beginDraw();
    for (const t of c.tiles) c.rt.batchDrawFrame(t.key, t.frame, t.x - c.bounds.x, t.y - c.bounds.y);
    c.rt.endDraw();
    c.painted = true;
  };

  for (const l of ordered) l.releaseRendering();

  const renderer = scene.game.renderer;
  // A lost WebGL context empties every render texture; they are repainted on
  // the next cull, which runs every frame.
  const onRestore = () => { for (const c of chunks) c.painted = false; };
  renderer.on(Phaser.Renderer.Events.RESTORE_WEBGL, onRestore);

  const attachArea = new Phaser.Geom.Rectangle();
  const releaseArea = new Phaser.Geom.Rectangle();
  const pad = (out: Phaser.Geom.Rectangle, view: Phaser.Geom.Rectangle, by: number) =>
    out.setTo(view.x - by, view.y - by, view.width + by * 2, view.height + by * 2);

  return {
    chunks: chunks.length,
    tiles: tileCount,
    cull(view) {
      pad(attachArea, view, ATTACH_PAD);
      pad(releaseArea, view, RELEASE_PAD);

      let budget = PAINTS_PER_FRAME;
      for (const c of chunks) {
        if (!Phaser.Geom.Rectangle.Overlaps(releaseArea, c.bounds)) {
          if (c.rt) release(c);
          continue;
        }
        // Between the two rings: keep what is already held, take nothing new.
        if (!Phaser.Geom.Rectangle.Overlaps(attachArea, c.bounds) && !c.rt) continue;

        attach(c);
        const on = Phaser.Geom.Rectangle.Overlaps(view, c.bounds);

        if (!c.painted) {
          // On camera and unpainted means the player arrived faster than the
          // ring could be filled (fast travel, or a jump in zoom): pay for it
          // now rather than show a hole. Everything else waits its turn.
          if (on || budget > 0) {
            if (!on) budget--;
            paint(c);
          }
        }

        if (on !== c.on) {
          c.on = on;
          c.rt!.setVisible(on);
        }
      }
    },
    destroy() {
      renderer.off(Phaser.Renderer.Events.RESTORE_WEBGL, onRestore);
      for (const c of chunks) release(c);
      chunks.length = 0;
    },
  };
}
