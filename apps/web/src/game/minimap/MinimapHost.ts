/**
 * Builds the city minimap FROM the live tilemap and exposes it to React.
 *
 * Nothing here is a baked screenshot: the picture is drawn tile by tile from
 * the layers CityScene created, and the place labels come from the layer
 * names, so editing city.json in Tiled updates the map on the next load.
 *
 * NPCs are pinned where they spawn (their home spot), with a portrait cut
 * from their own sprite sheet. React polls `snapshot()` on its own animation
 * frame for the moving parts (you, other players) instead of the scene
 * pushing events every frame.
 */
import * as Phaser from "phaser";
import { LANDMARK_LAYERS, npcCategory, type MinimapCategory } from "./categories";
import type { NPCSprite } from "../entities/NPCSprite";
import type { AvatarSprite } from "../entities/AvatarSprite";

/** Minimap pixels per world pixel: 24px tiles become 8px. */
export const MINIMAP_SCALE = 1 / 3;

export interface MinimapPoint {
  id: string;
  name: string;
  role?: string;
  category: MinimapCategory;
  x: number;
  y: number;
  /**
   * Where fast travel should aim, when that isn't the marker itself: a
   * building's front edge (its centre is roof, which can be unblocked art).
   */
  travel?: { x: number; y: number };
  /** The NPC standing, cropped tight to its artwork. NPCs only. */
  portrait?: HTMLCanvasElement;
  /** Opaque pixels in the portrait: how much "body" it has, for even sizing. */
  portraitMass?: number;
}

export interface MinimapSnapshot {
  player: { x: number; y: number } | null;
  players: MinimapPoint[];
  npcs: MinimapPoint[];
}

export interface MinimapHost {
  /** The whole map at MINIMAP_SCALE. */
  image: HTMLCanvasElement;
  worldW: number;
  worldH: number;
  landmarks: MinimapPoint[];
  snapshot(): MinimapSnapshot;
}

type Host = typeof globalThis & { __solCityMinimap?: MinimapHost | null };

export function getMinimapHost(): MinimapHost | null {
  return (globalThis as Host).__solCityMinimap ?? null;
}

export const MINIMAP_READY_EVENT = "solcity:minimap-ready";

export function publishMinimap(
  scene: Phaser.Scene,
  map: Phaser.Tilemaps.Tilemap,
  layers: Phaser.Tilemaps.TilemapLayer[],
  sources: {
    player: () => { x: number; y: number } | null;
    npcs: () => NPCSprite[];
    players: () => Array<{ wallet: string; avatar: AvatarSprite; name: string }>;
  },
): void {
  const worldW = map.widthInPixels;
  const worldH = map.heightInPixels;
  const image = document.createElement("canvas");
  image.width = Math.ceil(worldW * MINIMAP_SCALE);
  image.height = Math.ceil(worldH * MINIMAP_SCALE);
  const ctx = image.getContext("2d")!;
  ctx.fillStyle = "#0b3a5c";
  ctx.fillRect(0, 0, image.width, image.height);
  // Smoothing ON: this is a 3x downscale, and averaging reads far better at
  // that size than dropping two pixels in three.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const landmarkTiles = new Map<string, Array<{ x: number; y: number }>>();

  for (const layer of layers) {
    if (!layer.visible) continue;
    const leaf = layer.layer.name.slice(layer.layer.name.lastIndexOf("/") + 1);
    const label = LANDMARK_LAYERS[leaf];
    layer.forEachTile((tile: Phaser.Tilemaps.Tile) => {
      if (tile.index <= 0) return;
      const ts = tile.tileset;
      const tex = ts?.image;
      if (!ts || !tex) return;
      const coords = ts.getTileTextureCoordinates(tile.index) as { x: number; y: number } | null;
      if (!coords) return;
      const src = tex.getSourceImage() as CanvasImageSource;
      const wx = layer.tileToWorldX(tile.x) ?? 0;
      // Oversized tiles are bottom-aligned to their cell, as Tiled draws them.
      const wy = (layer.tileToWorldY(tile.y) ?? 0) + map.tileHeight - ts.tileHeight;
      const dw = ts.tileWidth * MINIMAP_SCALE;
      const dh = ts.tileHeight * MINIMAP_SCALE;
      const dx = wx * MINIMAP_SCALE;
      const dy = wy * MINIMAP_SCALE;
      if (tile.flipX || tile.flipY || tile.rotation) {
        ctx.save();
        ctx.translate(dx + dw / 2, dy + dh / 2);
        ctx.rotate(tile.rotation);
        ctx.scale(tile.flipX ? -1 : 1, tile.flipY ? -1 : 1);
        ctx.drawImage(src, coords.x, coords.y, ts.tileWidth, ts.tileHeight, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();
      } else {
        ctx.drawImage(src, coords.x, coords.y, ts.tileWidth, ts.tileHeight, dx, dy, dw, dh);
      }
      if (label) {
        const list = landmarkTiles.get(label) ?? [];
        list.push({ x: Math.floor(wx / map.tileWidth), y: Math.floor(wy / map.tileHeight) });
        landmarkTiles.set(label, list);
      }
    });
  }

  const landmarks: MinimapPoint[] = [];
  for (const [name, tiles] of landmarkTiles) {
    const c = largestCluster(tiles);
    landmarks.push({
      id: `landmark:${name}`,
      name,
      category: "landmark",
      x: ((c.x0 + c.x1 + 1) / 2) * map.tileWidth,
      y: ((c.y0 + c.y1 + 1) / 2) * map.tileHeight,
      travel: { x: ((c.x0 + c.x1 + 1) / 2) * map.tileWidth, y: (c.y1 + 1.5) * map.tileHeight },
    });
  }

  // Portraits and spawn points don't change, so both are resolved once.
  const npcPoints: MinimapPoint[] = sources.npcs().map((n) => {
    const home = n.getSpawn();
    return {
      id: n.def.id, name: n.def.name, role: n.def.role,
      category: npcCategory(n.def.action), x: home.x, y: home.y,
      ...portraitFields(npcPortrait(scene, n.textureKey)),
    };
  });

  const host: MinimapHost = {
    image,
    worldW,
    worldH,
    landmarks,
    snapshot: () => ({
      player: sources.player(),
      npcs: npcPoints,
      players: sources.players().map((p) => {
        const c = p.avatar.getContainer();
        return { id: p.wallet, name: p.name, category: "players" as const, x: c.x, y: c.y };
      }),
    }),
  };

  (globalThis as Host).__solCityMinimap = host;
  window.dispatchEvent(new Event(MINIMAP_READY_EVENT));
  scene.events.once("shutdown", () => {
    if ((globalThis as Host).__solCityMinimap === host) (globalThis as Host).__solCityMinimap = null;
  });
}

function portraitFields(c: HTMLCanvasElement | null): Pick<MinimapPoint, "portrait" | "portraitMass"> {
  if (!c) return {};
  const { data } = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
  let mass = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] >= 24) mass++;
  return { portrait: c, portraitMass: mass };
}

/**
 * The NPC as it stands facing the camera (frame 0 of its sheet), cropped
 * tight to its artwork: the whole body, feet on the bottom edge.
 */
function npcPortrait(scene: Phaser.Scene, key: string): HTMLCanvasElement | null {
  const frame = scene.textures.getFrame(key, 0) ?? scene.textures.getFrame(key);
  if (!frame) return null;
  const src = frame.source.image as CanvasImageSource;
  const fw = frame.cutWidth;
  const fh = frame.cutHeight;
  const tmp = document.createElement("canvas");
  tmp.width = fw;
  tmp.height = fh;
  const tctx = tmp.getContext("2d", { willReadFrequently: true });
  if (!tctx) return null;
  tctx.drawImage(src, frame.cutX, frame.cutY, fw, fh, 0, 0, fw, fh);
  const { data } = tctx.getImageData(0, 0, fw, fh);
  let x0 = fw, y0 = fh, x1 = -1, y1 = -1;
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      if (data[(y * fw + x) * 4 + 3] < 24) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1;
  let h = y1 - y0 + 1;
  // Some sheets carry a prop far above the character (Kite Pro's kite), which
  // would shrink the body to a speck once the whole frame is fitted to a pin.
  // Keep the feet and at most ~1.5x the width upward.
  const maxH = Math.round(w * 1.5);
  const top = h > maxH ? y1 + 1 - maxH : y0;
  h = y1 + 1 - top;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  out.getContext("2d")!.drawImage(tmp, x0, top, w, h, 0, 0, w, h);
  return out;
}

/**
 * Bounding box of the biggest group of touching tiles (2-tile gaps allowed).
 * A layer can hold a building plus a stray prop elsewhere on the map; the
 * label belongs on the building.
 */
function largestCluster(tiles: Array<{ x: number; y: number }>) {
  const key = (x: number, y: number) => `${x},${y}`;
  const all = new Set(tiles.map((t) => key(t.x, t.y)));
  const seen = new Set<string>();
  let best = { n: 0, x0: 0, y0: 0, x1: 0, y1: 0 };
  for (const t of tiles) {
    const k0 = key(t.x, t.y);
    if (seen.has(k0)) continue;
    const cur = { n: 0, x0: t.x, y0: t.y, x1: t.x, y1: t.y };
    const stack = [t];
    seen.add(k0);
    while (stack.length) {
      const p = stack.pop()!;
      cur.n++;
      cur.x0 = Math.min(cur.x0, p.x); cur.x1 = Math.max(cur.x1, p.x);
      cur.y0 = Math.min(cur.y0, p.y); cur.y1 = Math.max(cur.y1, p.y);
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const k = key(p.x + dx, p.y + dy);
          if (all.has(k) && !seen.has(k)) {
            seen.add(k);
            stack.push({ x: p.x + dx, y: p.y + dy });
          }
        }
      }
    }
    if (cur.n > best.n) best = cur;
  }
  return best;
}
