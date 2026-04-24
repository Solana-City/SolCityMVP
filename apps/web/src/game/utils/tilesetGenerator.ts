import { TILE_SIZE, COLORS, Tile } from "../config/constants";

const TILE_COLORS: Record<number, number> = {
  [Tile.GRASS_A]: COLORS.GRASS_A,
  [Tile.GRASS_B]: COLORS.GRASS_B,
  [Tile.PATH]: COLORS.PATH,
  [Tile.PLAZA]: COLORS.PLAZA,
  [Tile.SAND]: COLORS.SAND,
  [Tile.WATER_DEEP]: COLORS.WATER_DEEP,
  [Tile.WATER]: COLORS.WATER,
  [Tile.DOCK]: COLORS.DOCK,
  [Tile.BUILDING]: COLORS.BLD_GENERIC,
  [Tile.PARK]: COLORS.PARK,
  [Tile.FLOWERS]: COLORS.FLOWERS,
  [Tile.BLD_JUPITER]: COLORS.BLD_JUPITER,
  [Tile.BLD_POST]: COLORS.BLD_POST,
  [Tile.BLD_GUILD]: COLORS.BLD_GUILD,
  [Tile.BLD_SUPERTEAM]: COLORS.BLD_SUPERTEAM,
  [Tile.PATH_ACCENT]: 0x705898,
};

const TILE_COUNT = Object.keys(TILE_COLORS).length;
const T = TILE_SIZE;

export function generateTileset(scene: Phaser.Scene): void {
  const canvas = document.createElement("canvas");
  canvas.width = T;
  canvas.height = T * TILE_COUNT;
  const ctx = canvas.getContext("2d")!;

  for (let i = 0; i < TILE_COUNT; i++) {
    const color = TILE_COLORS[i] ?? 0x333333;
    const y = i * T;

    // Base fill
    ctx.fillStyle = hex(color);
    ctx.fillRect(0, y, T, T);

    switch (i) {
      case Tile.GRASS_A: drawGrass(ctx, y, false); break;
      case Tile.GRASS_B: drawGrass(ctx, y, true); break;
      case Tile.PATH: drawPath(ctx, y, false); break;
      case Tile.PATH_ACCENT: drawPath(ctx, y, true); break;
      case Tile.PLAZA: drawPlaza(ctx, y); break;
      case Tile.SAND: drawSand(ctx, y); break;
      case Tile.WATER: drawWater(ctx, y, false); break;
      case Tile.WATER_DEEP: drawWater(ctx, y, true); break;
      case Tile.DOCK: drawDock(ctx, y); break;
      case Tile.PARK: drawPark(ctx, y); break;
      case Tile.FLOWERS: drawFlowers(ctx, y); break;
      case Tile.BLD_JUPITER:
      case Tile.BLD_POST:
      case Tile.BLD_SUPERTEAM:
      case Tile.BLD_GUILD:
      case Tile.BUILDING:
        drawBuilding(ctx, y, color); break;
    }
  }

  scene.textures.addCanvas("tileset", canvas);
}

function hex(c: number): string { return `#${c.toString(16).padStart(6, "0")}`; }

function drawGrass(ctx: CanvasRenderingContext2D, y: number, alt: boolean): void {
  // Subtle texture dots
  ctx.fillStyle = alt ? "rgba(20,241,149,0.08)" : "rgba(255,255,255,0.03)";
  for (let i = 0; i < 6; i++) {
    const px = (i * 7 + 3) % T;
    const py = y + (i * 11 + 2) % T;
    ctx.fillRect(px, py, 1, 1);
  }
  // Thin edge (subtler than before)
  ctx.fillStyle = "rgba(0,0,0,0.04)";
  ctx.fillRect(0, y, T, 1);
  ctx.fillRect(0, y, 1, T);
}

function drawPath(ctx: CanvasRenderingContext2D, y: number, accent: boolean): void {
  // Subtle stone texture
  ctx.fillStyle = "rgba(0,0,0,0.08)";
  ctx.fillRect(0, y, T, 1);
  ctx.fillRect(0, y, 1, T);
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(1, y + 1, T - 2, 1);

  // Center line glow
  ctx.fillStyle = accent ? "rgba(153,69,255,0.35)" : "rgba(0,209,255,0.15)";
  ctx.fillRect(0, y + T / 2, T, 1);
}

function drawPlaza(ctx: CanvasRenderingContext2D, y: number): void {
  // Subtle tile grid pattern
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  for (let p = 0; p < T; p += 8) {
    ctx.fillRect(p, y, 1, T);
    ctx.fillRect(0, y + p, T, 1);
  }
  // Small Solana green accent dot in center
  ctx.fillStyle = "rgba(20,241,149,0.12)";
  ctx.fillRect(T / 2 - 1, y + T / 2 - 1, 2, 2);
}

function drawSand(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  for (let i = 0; i < 8; i++) {
    ctx.fillRect((i * 5 + 2) % T, y + (i * 7 + 1) % T, 1, 1);
  }
}

function drawWater(ctx: CanvasRenderingContext2D, y: number, deep: boolean): void {
  ctx.fillStyle = deep ? "rgba(153,69,255,0.12)" : "rgba(0,209,255,0.1)";
  ctx.fillRect(4, y + T / 3, T - 8, 1);
  ctx.fillRect(6, y + T * 2 / 3, T - 12, 1);
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fillRect(3, y + 3, T - 6, 1);
}

function drawDock(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  for (let x = 0; x < T; x += 6) {
    ctx.fillRect(x, y, 1, T);
  }
}

function drawBuilding(ctx: CanvasRenderingContext2D, y: number, color: number): void {
  // Shadow top
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.fillRect(0, y, T, 4);
  // Window
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(4, y + 8, T - 8, 4);
  // Neon accent bar at bottom
  const neonColor = color === COLORS.BLD_JUPITER ? "#FFD700"
    : color === COLORS.BLD_POST ? "#00D1FF"
    : color === COLORS.BLD_SUPERTEAM ? "#9945FF"
    : "#14F195";
  ctx.fillStyle = neonColor;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(6, y + T - 6, T - 12, 2);
  ctx.globalAlpha = 1.0;
}

function drawPark(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(4 + i * 8, y + 6 + (i % 2) * 8, 2, 2);
  }
}

function drawFlowers(ctx: CanvasRenderingContext2D, y: number): void {
  drawGrass(ctx, y, true);
  const colors = ["#F72585", "#FFD700", "#14F195", "#00D1FF"];
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(3 + (i * 6) % (T - 6), y + 4 + (i * 5) % (T - 8), 1, 1);
  }
}
