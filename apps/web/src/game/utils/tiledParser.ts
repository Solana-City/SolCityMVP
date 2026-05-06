/**
 * Parses the raw Tiled JSON (TMJ) exported by the artist.
 * Works without the original tileset PNGs — renders a colour-coded
 * placeholder palette so the map is visible immediately.
 *
 * Palette indices (matches generateTiledPalette in tilesetGenerator.ts):
 *   0  empty
 *   1  ground base       (dark blue-grey)
 *   2  grass             (dark green)
 *   3  grass centre      (slightly lighter green)
 *   4  sidewalk          (warm grey)
 *   5  generic building  (dark purple-grey)
 *   6  STEarn building   (purple)
 *   7  STBrazil building (teal)
 *   8  Jupiter building  (gold)
 *   9  Fountain decor    (cyan)
 *  10  MonkeyDAO build   (orange)
 *  11  NPC layer         (not rendered, positions extracted separately)
 */

export interface TiledParseResult {
  /** 2D array [row][col] of palette indices for visual rendering */
  display: number[][];
  /** Flat array: 0 = blocked, -1 = walkable */
  collision: number[];
  width:     number;
  height:    number;
  tileSize:  number;
  /** Top-left tile of each NPC sprite on the NPC layer */
  npcTiles:  { col: number; row: number }[];
  spawnCol:  number;
  spawnRow:  number;
}

// ── Layer name → palette index ─────────────────────────────────────────────

const LAYER_PALETTE: Record<string, number> = {
  "Camada de Blocos 15": 1,
  "Street":              1,
  "Grass":               2,
  "GrassCenter":         3,
  "SidewalkCenter":      4,
  "Sidewalk":            4,
  "Sidewalk02":          4,
  "Sidewalk03":          4,
  "Sidewalk04":          4,
  "Camada de Blocos 30": 4,
  "BuildGeneric01":      5,
  "BuildGeneric02":      5,
  "BuildGeneric03":      5,
  "BuildGeneric04":      5,
  "BuildGeneric05":      5,
  "BuildGeneric06":      5,
  "BuildSTEarn":         6,
  "BuildSTBrazil":       7,
  "BuildJupiter":        8,
  "DecorFountain":       9,
  "BuildMonkeDAo":      10,
  "VegetationPalmBack":  2,
  "VegetationPalmFront": 2,
  "VegetationPalmCenter":2,
  "VegetationTree":      2,
  "BuildIndies":        11,
};

// Layers that block the player
const COLLISION_LAYERS = new Set([
  "BuildSTEarn",
  "BuildGeneric01", "BuildGeneric02", "BuildGeneric03",
  "BuildSTBrazil",
  "BuildJupiter",
  "BuildMonkeDAo",
  "BuildIndies",
]);

// NPC tile GIDs — 14530 = top tile, 14551 = bottom tile (2-tile NPC sprite)
const NPC_TOP_GIDS = new Set([14530]);

export function parseTiledJSON(json: any): TiledParseResult {
  const W        = json.width  as number;
  const H        = json.height as number;
  const tileSize = json.tilewidth as number;
  const layers   = json.layers as any[];

  // ── Build display grid (z-composited) ─────────────────────────────────
  // Start from a flat empty grid; higher layers paint over lower ones.
  const display: number[][] = Array.from({ length: H }, () =>
    new Array<number>(W).fill(0)
  );

  const collision = new Float32Array(W * H).fill(-1); // -1 = walkable

  const npcTiles: { col: number; row: number }[] = [];

  for (const layer of layers) {
    if (layer.type !== "tilelayer") continue;

    const name  = layer.name as string;
    const data  = layer.data as number[];
    const palette = LAYER_PALETTE[name] ?? 0;
    const isCollision = COLLISION_LAYERS.has(name);
    const isNPC       = name === "NPC";

    for (let i = 0; i < data.length; i++) {
      const gid = data[i];
      if (gid === 0) continue;

      const row = Math.floor(i / W);
      const col = i % W;

      if (isNPC) {
        if (NPC_TOP_GIDS.has(gid)) {
          npcTiles.push({ col, row });
        }
        continue; // NPC layer is invisible
      }

      // Paint display
      if (palette > 0) {
        display[row][col] = palette;
      }

      // Mark collision
      if (isCollision) {
        collision[i] = 0;
      }
    }
  }

  // Default spawn: centre of map, avoid known building zones
  const spawnCol = Math.floor(W / 2);
  const spawnRow = Math.floor(H / 2) - 5;

  return { display, collision: Array.from(collision), width: W, height: H, tileSize, npcTiles, spawnCol, spawnRow };
}

/** Palette colour definitions — used by tilesetGenerator to draw tiles */
export const TILED_PALETTE_COLORS: Record<number, number> = {
  0:  0x000000,  // empty
  1:  0x0e1f2e,  // ground base / street
  2:  0x1e5a2e,  // grass / vegetation
  3:  0x27703a,  // grass centre
  4:  0x7a6e58,  // sidewalk
  5:  0x2a2a45,  // generic building
  6:  0x5020a0,  // STEarn purple
  7:  0x187880,  // STBrazil teal
  8:  0xc89010,  // Jupiter gold
  9:  0x108090,  // Fountain cyan
  10: 0xc06020,  // MonkeyDAO orange
  11: 0x803060,  // Indies magenta
};
