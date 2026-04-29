import { TILE_SIZE, COLORS, Tile } from "../config/constants";
import { TILED_PALETTE_COLORS } from "./tiledParser";

const T = TILE_SIZE; // 32

// ── Tile colour palette ─────────────────────────────────────────────────────

const BASE: Record<number, number> = {
  [Tile.GRASS_A]:     0x1e5a2e,
  [Tile.GRASS_B]:     0x27703a,
  [Tile.PATH]:        0x8a7a60,
  [Tile.PLAZA]:       0x6a6090,
  [Tile.SAND]:        0xc8b078,
  [Tile.WATER_DEEP]:  0x061a2c,
  [Tile.WATER]:       0x0b3b5c,
  [Tile.DOCK]:        0x5a4535,
  [Tile.BUILDING]:    0x2a2a4a,
  [Tile.PARK]:        0x145c14,
  [Tile.FLOWERS]:     0x1e5a2e,
  [Tile.BLD_JUPITER]: 0x7a5c08,
  [Tile.BLD_POST]:    0x106490,
  [Tile.BLD_GUILD]:   0x882222,
  [Tile.BLD_SUPERTEAM]:0x4a208a,
  [Tile.PATH_ACCENT]: 0x503878,
};

const TILE_COUNT = Object.keys(BASE).length;

// ── Entry point ─────────────────────────────────────────────────────────────

export function generateTileset(scene: Phaser.Scene): void {
  const canvas = document.createElement("canvas");
  canvas.width  = T;
  canvas.height = T * TILE_COUNT;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  for (let i = 0; i < TILE_COUNT; i++) {
    const y   = i * T;
    const col = BASE[i] ?? 0x222222;
    fill(ctx, col, 0, y, T, T);

    switch (i) {
      case Tile.GRASS_A:      drawGrass(ctx, y, 0);   break;
      case Tile.GRASS_B:      drawGrass(ctx, y, 1);   break;
      case Tile.PATH:         drawPath(ctx, y, false); break;
      case Tile.PATH_ACCENT:  drawPath(ctx, y, true);  break;
      case Tile.PLAZA:        drawPlaza(ctx, y);        break;
      case Tile.SAND:         drawSand(ctx, y);         break;
      case Tile.WATER:        drawWater(ctx, y, false); break;
      case Tile.WATER_DEEP:   drawWater(ctx, y, true);  break;
      case Tile.DOCK:         drawDock(ctx, y);          break;
      case Tile.PARK:         drawPark(ctx, y);          break;
      case Tile.FLOWERS:      drawFlowers(ctx, y);       break;
      case Tile.BLD_JUPITER:  drawBuilding(ctx, y, COLORS.BLD_JUPITER,  "J", "#FFD700"); break;
      case Tile.BLD_POST:     drawBuilding(ctx, y, COLORS.BLD_POST,     "P", "#00D1FF"); break;
      case Tile.BLD_SUPERTEAM:drawBuilding(ctx, y, COLORS.BLD_SUPERTEAM,"S", "#9945FF"); break;
      case Tile.BLD_GUILD:    drawBuilding(ctx, y, COLORS.BLD_GUILD,    "G", "#14F195"); break;
      case Tile.BUILDING:     drawBuilding(ctx, y, COLORS.BLD_GENERIC,  "·", "#14F195"); break;
    }
  }

  scene.textures.addCanvas("tileset", canvas);
}

/**
 * Generates a 11-tile colour-coded tileset for the Tiled map parser.
 * One 24×24 tile per palette entry (indices 0-10).
 * Stored as "tiled-palette" texture key.
 */
export function generateTiledPalette(scene: Phaser.Scene): void {
  if (scene.textures.exists("tiled-palette")) return;

  const T = 24; // matches Tiled tile size
  const COUNT = 11;

  const canvas = document.createElement("canvas");
  canvas.width  = T;
  canvas.height = T * COUNT;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  for (let i = 0; i < COUNT; i++) {
    const y   = i * T;
    const col = TILED_PALETTE_COLORS[i] ?? 0x111111;

    // Base fill
    ctx.fillStyle = hex(col);
    ctx.fillRect(0, y, T, T);

    if (i === 0) {
      // Transparent empty tile — just black
      ctx.clearRect(0, y, T, T);
      continue;
    }

    // Light top edge (gives slight depth)
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(0, y, T, 1);
    ctx.fillRect(0, y, 1, T);

    // Dark bottom-right edge
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, y + T - 1, T, 1);
    ctx.fillRect(T - 1, y, 1, T);

    switch (i) {
      case 1: // Ground base — subtle grid
        ctx.fillStyle = "rgba(0,209,255,0.06)";
        for (let g = 0; g < T; g += 8) {
          ctx.fillRect(g, y, 1, T);
          ctx.fillRect(0, y + g, T, 1);
        }
        break;

      case 2: // Grass — dithered dots
      case 3:
        ctx.fillStyle = i === 2 ? "rgba(74,255,136,0.20)" : "rgba(74,255,136,0.28)";
        for (let d = 0; d < 6; d++) {
          ctx.fillRect((d * 5 + 2) % T, y + (d * 7 + 1) % T, 1, 1);
        }
        break;

      case 4: // Sidewalk — cobblestone
        ctx.fillStyle = "rgba(0,0,0,0.20)";
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            ctx.fillRect(c * 8, y + r * 8, 8, 1);
            ctx.fillRect(c * 8, y + r * 8, 1, 8);
          }
        }
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            ctx.fillRect(c * 8 + 1, y + r * 8 + 1, 6, 1);
          }
        }
        break;

      case 5: // Generic building
      case 6: // STEarn
      case 7: // STBrazil
      case 8: // Jupiter
      case 10: { // MonkeyDAO
        // Two small windows
        const winCol = i === 8 ? "#ffe88a" : i === 6 ? "#c888ff" : i === 7 ? "#80ffee" : i === 10 ? "#ffcc80" : "#aaaacc";
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(0, y, T, 4); // roof band
        ctx.fillStyle = winCol;
        ctx.globalAlpha = 0.70;
        ctx.fillRect(3, y + 7,  7, 5);
        ctx.fillRect(14, y + 7, 7, 5);
        ctx.fillRect(3, y + 15, 7, 5);
        ctx.fillRect(14, y + 15, 7, 5);
        ctx.globalAlpha = 1;
        // Neon bottom strip
        const accent = i === 8 ? "#FFD700" : i === 6 ? "#9945FF" : i === 7 ? "#14F195" : i === 10 ? "#FF6B35" : "#00D1FF";
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.70;
        ctx.fillRect(2, y + T - 4, T - 4, 2);
        ctx.globalAlpha = 1;
        break;
      }

      case 9: // Fountain
        ctx.fillStyle = "rgba(0,209,255,0.35)";
        ctx.fillRect(4, y + 8, T - 8, T - 12);
        ctx.fillStyle = "#00d1ff";
        ctx.globalAlpha = 0.80;
        ctx.fillRect(T/2, y + 2, 1, 7);
        ctx.fillRect(T/2 - 3, y + 3, 1, 4);
        ctx.fillRect(T/2 + 3, y + 3, 1, 4);
        ctx.globalAlpha = 1;
        break;
    }
  }

  scene.textures.addCanvas("tiled-palette", canvas);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function hex(c: number): string {
  return `#${(c >>> 0).toString(16).padStart(6, "0")}`;
}

function fill(
  ctx: CanvasRenderingContext2D,
  color: number,
  x: number, y: number, w: number, h: number,
  alpha = 1
): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle   = hex(color);
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
}

function px(
  ctx: CanvasRenderingContext2D,
  color: string,
  x: number, y: number, alpha = 1
): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle   = color;
  ctx.fillRect(x, y, 1, 1);
  ctx.globalAlpha = 1;
}

// Dithered noise — deterministic so the tile looks the same every load
function dither(
  ctx: CanvasRenderingContext2D,
  y0: number,
  color: string,
  pattern: [number, number][],
  alpha = 1
): void {
  for (const [dx, dy] of pattern) {
    px(ctx, color, dx, y0 + dy, alpha);
  }
}

// ── Tile drawers ─────────────────────────────────────────────────────────────

function drawGrass(ctx: CanvasRenderingContext2D, y: number, variant: number): void {
  // Dark border (simulates edge shading between tiles)
  fill(ctx, 0x000000, 0, y,     T, 1, 0.10);
  fill(ctx, 0x000000, 0, y,     1, T, 0.10);
  fill(ctx, 0xffffff, 1, y + 1, T-2, 1, 0.04);

  // Deterministic pixel noise for texture
  const offsets: [number, number][] = variant === 0
    ? [[3,4],[8,1],[13,6],[19,2],[24,8],[29,3],[6,14],[16,11],[26,19],[11,22],[21,27],[5,29]]
    : [[1,3],[7,8],[12,2],[18,7],[23,4],[28,9],[4,15],[14,12],[24,20],[9,23],[19,28],[27,5]];

  dither(ctx, y, "#4aff88", offsets, 0.25);

  // Occasional slightly lighter 2×1 "blade" of grass
  const blades: [number, number][] = variant === 0
    ? [[4,5],[14,13],[24,21]]
    : [[9,7],[19,15],[28,23]];
  for (const [dx, dy] of blades) {
    fill(ctx, 0x3aee77, dx, y + dy, 2, 1, 0.30);
  }
}

function drawPath(ctx: CanvasRenderingContext2D, y: number, accent: boolean): void {
  // Cobblestone grid — 8×8 stones with 1px darker grout
  const grout = 0x5a4c38;
  const stone = accent ? 0x6840a8 : 0x8a7a60;
  const hilite = accent ? 0x7858c0 : 0x9a8a70;

  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const sx = col * 8;
      const sy = y + row * 8;
      // Grout cross
      fill(ctx, grout, sx,     sy,     8, 1, 0.60);
      fill(ctx, grout, sx,     sy,     1, 8, 0.60);
      // Stone face (6×6 inside grout)
      fill(ctx, stone, sx+1,   sy+1,   6, 6, 1.00);
      // Top-left highlight
      fill(ctx, hilite, sx+1,  sy+1,   5, 1, 0.50);
      fill(ctx, hilite, sx+1,  sy+2,   1, 4, 0.30);
    }
  }

  if (accent) {
    // Purple glow line in center
    fill(ctx, 0x9945ff, 8, y + 15, 16, 2, 0.50);
    fill(ctx, 0xb070ff, 10, y+16,  12, 1, 0.25);
  }
}

function drawPlaza(ctx: CanvasRenderingContext2D, y: number): void {
  // Marble-like tile pattern — 16×16 sub-tiles
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const sx = col * 16;
      const sy = y + row * 16;
      const lighter = (row + col) % 2 === 0;
      fill(ctx, lighter ? 0x7a70a8 : 0x6a6090, sx, sy, 16, 16);
      // Grout
      fill(ctx, 0x3a3060, sx,    sy,    16, 1, 0.70);
      fill(ctx, 0x3a3060, sx,    sy,    1, 16, 0.70);
      fill(ctx, 0x9080c0, sx+1,  sy+1,  14, 1, 0.20);
      // Solana green corner accent
      fill(ctx, 0x14f195, sx+14, sy+14,  2, 2, 0.30);
    }
  }
}

function drawSand(ctx: CanvasRenderingContext2D, y: number): void {
  // Dithered sandy texture
  const dots: [number, number][] = [
    [2,3],[6,1],[10,7],[14,2],[18,5],[22,9],[26,3],[30,7],
    [4,12],[8,18],[12,14],[16,20],[20,11],[24,17],[28,22],
    [1,26],[5,23],[9,29],[13,25],[17,28],[21,24],[25,27],
  ];
  dither(ctx, y, "#e0c890", dots, 0.35);
  dither(ctx, y, "#b09050", dots.map(([x, dy]) => [x+2, dy+1] as [number,number]), 0.15);
  // Subtle edge darkening
  fill(ctx, 0x000000, 0, y, T, 1, 0.08);
}

function drawWater(ctx: CanvasRenderingContext2D, y: number, deep: boolean): void {
  const shimmer  = deep ? "#9945ff" : "#00d1ff";
  const waveAlpha = deep ? 0.12 : 0.20;

  // Wave lines — 3 horizontal bands, varied width
  fill(ctx, deep ? 0x0a2540 : 0x0d4a70, 0,  y,    T, T, 1);
  fill(ctx, deep ? 0x07203a : 0x093c5a, 0,  y,    T, 1, 0.80);
  fill(ctx, deep ? 0x07203a : 0x093c5a, 0,  y+T-1, T, 1, 0.60);

  // Wave crests
  const waves: [number, number, number][] = [
    [4, y+9,   22],
    [8, y+18,  16],
    [2, y+25,  20],
  ];
  for (const [x, wy, w] of waves) {
    fill(ctx, 0xffffff, x,   wy, w,   1, waveAlpha);
    fill(ctx, 0xffffff, x+2, wy+1, w-4, 1, waveAlpha * 0.5);
  }

  // Sparkle pixels
  const sparkles: [number, number][] = deep
    ? [[6, 6], [18, 14], [28, 22], [10, 28]]
    : [[5, 5], [15, 13], [25, 20], [11, 27]];
  dither(ctx, y, shimmer, sparkles, 0.60);
  dither(ctx, y, "#ffffff", sparkles, 0.30);
}

function drawDock(ctx: CanvasRenderingContext2D, y: number): void {
  // Wooden plank pattern — horizontal lines every 6px
  for (let row = 0; row < 5; row++) {
    const wy = y + row * 6 + 2;
    fill(ctx, 0x6a5540, 0,  wy, T, 5);
    fill(ctx, 0x7a6550, 0,  wy, T, 1, 0.40);   // lighter top
    fill(ctx, 0x4a3530, 0,  wy+4, T, 1, 0.40); // darker bottom
    // Plank seams every 8px
    for (let col = 0; col < T; col += 8) {
      fill(ctx, 0x3a2520, col, wy, 1, 5, 0.30);
    }
  }
}

function drawPark(ctx: CanvasRenderingContext2D, y: number): void {
  // Darker grass base
  fill(ctx, 0x0e480e, 0, y, T, T, 0.30);

  // Three tree canopies — arranged as small pixel circles
  const trees: [number, number, number][] = [
    [6,  y+6,  0x0e6a0e],
    [22, y+5,  0x116611],
    [14, y+18, 0x0a5a0a],
  ];
  for (const [cx, cy, col] of trees) {
    // 5×5 canopy circle approximation
    fill(ctx, col, cx-2, cy,   5, 1);
    fill(ctx, col, cx-3, cy+1, 7, 3);
    fill(ctx, col, cx-2, cy+4, 5, 1);
    // Highlight
    fill(ctx, 0x1aaa1a, cx-1, cy+1, 2, 1, 0.50);
    // Trunk
    fill(ctx, 0x5a3a1a, cx,   cy+5, 2, 3);
  }
}

function drawFlowers(ctx: CanvasRenderingContext2D, y: number): void {
  drawGrass(ctx, y, 0);
  // Colourful 1px flower heads at offset positions
  const blooms: [number, number, string][] = [
    [4,  y+8,  "#f72585"],
    [12, y+5,  "#ffd700"],
    [20, y+12, "#14f195"],
    [27, y+7,  "#00d1ff"],
    [8,  y+20, "#f72585"],
    [18, y+22, "#ffd700"],
    [25, y+25, "#9945ff"],
  ];
  for (const [x, fy, col] of blooms) {
    // 3×3 flower cross
    px(ctx, col, x,   fy,   0.90);
    px(ctx, col, x-1, fy,   0.60);
    px(ctx, col, x+1, fy,   0.60);
    px(ctx, col, x,   fy-1, 0.60);
    px(ctx, col, x,   fy+1, 0.40);
  }
}

function drawBuilding(
  ctx: CanvasRenderingContext2D,
  y: number,
  _tileBase: number,
  _letter: string,
  neonColor: string
): void {
  const wall = BASE[Tile.BUILDING];

  // Wall face — 3 horizontal zones: roof, wall, base
  fill(ctx, 0x1a1a38, 0, y,     T, 5);       // dark roof strip
  fill(ctx, wall,     0, y+5,   T, T-10);    // wall
  fill(ctx, 0x0e0e28, 0, y+T-5, T, 5);       // dark foundation

  // Left-edge shadow
  fill(ctx, 0x000000, 0, y, 2, T, 0.25);

  // Window grid — 2 columns × 2 rows of 5×4 windows
  const winColor = 0xe8f4ff;
  const windows: [number, number][] = [
    [6, y+7], [18, y+7],
    [6, y+18], [18, y+18],
  ];
  for (const [wx, wy] of windows) {
    fill(ctx, 0x0d0d25, wx-1, wy-1, 7, 6, 0.50); // window recess
    fill(ctx, winColor, wx,   wy,   5, 4);          // glass
    // Lit window — warm yellow glow
    fill(ctx, 0xffee88, wx+1, wy+1, 3, 2, 0.70);
    // Reflection
    fill(ctx, 0xffffff, wx,   wy,   1, 1, 0.60);
  }

  // Neon accent bar at bottom edge
  ctx.fillStyle   = neonColor;
  ctx.globalAlpha = 0.80;
  ctx.fillRect(4, y + T - 6, T-8, 2);
  ctx.globalAlpha = 0.35;
  ctx.fillRect(2, y + T - 8, T-4, 2);   // soft glow above
  ctx.globalAlpha = 1.0;
}
