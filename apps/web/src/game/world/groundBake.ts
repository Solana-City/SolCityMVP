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
 * How far each chunk's texture reaches into its neighbours, in world pixels.
 *
 * A chunk is drawn as one quad, and the camera rounds a quad's position to a
 * whole device pixel (roundPixels, which is what keeps the art crisp) without
 * rounding its SIZE. When a chunk is a whole number of device pixels wide the
 * two roundings agree and neighbours meet exactly. When it is not, one
 * neighbour can round a pixel further out than the one before it ends, and
 * what shows in the crack is the canvas behind the city: a grid of thin lines
 * over the whole map, one square per chunk.
 *
 * That is not a rare case, it is two specific zoom steps. A chunk is
 * 384 world px and the camera zoom is viewScale * 2 * dpr, so the width in
 * device pixels is whole at every step except the two widest, 0.3x and 0.4x
 * — on every screen density. Which is exactly where players saw it: "the
 * minimum zooms, from far away".
 *
 * So each texture is painted a few pixels PAST its chunk, with the
 * neighbouring tiles that belong there, and the textures overlap instead of
 * meeting. The overlap is the same picture drawn twice, so it is invisible at
 * every zoom, and 4 world px covers a one-device-pixel crack even at the
 * widest step on a dpr-1 screen (0.6 device px per world px).
 *
 * The alternative was to bend the zoom ladder until every step divided 384,
 * which would have moved steps the room chose and changed nothing about the
 * cause.
 */
const BLEED = 4;
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

  // The bleed, as a second pass: a tile sitting within BLEED of a chunk's far
  // edge is painted into that chunk as well. It is a second pass rather than
  // part of the first so the tiles keep the order the layers drew them in —
  // within a chunk's own tiles, and within the borrowed ones. Borrowed tiles
  // land beyond CHUNK_PX, where a chunk has nothing of its own (tile edges
  // never straddle a chunk), so drawing them last changes nothing.
  //
  // Only chunks that already exist take bleed: a chunk with no tiles of its
  // own is open sea, and giving it a texture to hold a single column of its
  // neighbour would cost memory to show nothing.
  for (const list of lists) {
    for (const t of list!) {
      const cx = Math.floor(t.x / CHUNK_PX);
      const cy = Math.floor(t.y / CHUNK_PX);
      const nearLeftEdge = t.x - cx * CHUNK_PX < BLEED;
      const nearTopEdge = t.y - cy * CHUNK_PX < BLEED;
      if (nearLeftEdge) byChunk.get(`${cx - 1},${cy}`)?.push(t);
      if (nearTopEdge) byChunk.get(`${cx},${cy - 1}`)?.push(t);
      if (nearLeftEdge && nearTopEdge) byChunk.get(`${cx - 1},${cy - 1}`)?.push(t);
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
      // Bigger than the chunk it stands for, by the bleed: `bounds` stays the
      // chunk itself, which is what the culling below reasons about.
      .renderTexture(c.bounds.x, c.bounds.y, CHUNK_PX + BLEED, CHUNK_PX + BLEED)
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
    // Borrowed tiles are drawn at CHUNK_PX or just past it; the render
    // texture clips them to the few pixels of bleed that fit.
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
