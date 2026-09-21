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
 * The baked grid takes the HIGHEST static depth, so anything that used to
 * draw above every static layer still does, and anything that sat between
 * them (nothing is meant to) stays underneath as before.
 *
 * WebGL can lose its context (phones do it when the app is backgrounded);
 * render textures come back blank, so the bake is redrawn on restore.
 */

const CHUNK_PX = 384; // 16 tiles of 24px: tile edges never straddle a chunk

interface Chunk {
  rt: Phaser.GameObjects.RenderTexture;
  bounds: Phaser.Geom.Rectangle;
  tiles: Array<{ key: string; frame: string; x: number; y: number }>;
  on: boolean;
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
    const rt = scene.add.renderTexture(x0, y0, CHUNK_PX, CHUNK_PX).setOrigin(0, 0).setDepth(depth);
    rt.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    chunks.push({ rt, bounds: new Phaser.Geom.Rectangle(x0, y0, CHUNK_PX, CHUNK_PX), tiles, on: true });
  }

  const paint = () => {
    for (const c of chunks) {
      c.rt.clear();
      c.rt.beginDraw();
      for (const t of c.tiles) c.rt.batchDrawFrame(t.key, t.frame, t.x - c.bounds.x, t.y - c.bounds.y);
      c.rt.endDraw();
    }
  };
  paint();

  for (const l of ordered) l.releaseRendering();

  const renderer = scene.game.renderer;
  const onRestore = () => paint();
  renderer.on(Phaser.Renderer.Events.RESTORE_WEBGL, onRestore);

  return {
    chunks: chunks.length,
    tiles: tileCount,
    cull(view) {
      for (const c of chunks) {
        const on = Phaser.Geom.Rectangle.Overlaps(view, c.bounds);
        if (on === c.on) continue;
        c.on = on;
        c.rt.setVisible(on);
      }
    },
    destroy() {
      renderer.off(Phaser.Renderer.Events.RESTORE_WEBGL, onRestore);
      for (const c of chunks) c.rt.destroy();
      chunks.length = 0;
    },
  };
}
