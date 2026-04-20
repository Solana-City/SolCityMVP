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

/**
 * Generates a runtime pixel-art tileset in a vertical strip.
 * Visual style: top-down cyber city with Solana neon accents.
 */
export function generateTileset(scene: Phaser.Scene): void {
  const width = TILE_SIZE;
  const height = TILE_SIZE * TILE_COUNT;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  for (let i = 0; i < TILE_COUNT; i++) {
    const color = TILE_COLORS[i] ?? 0x333333;
    const y = i * TILE_SIZE;
    paintBaseTile(ctx, y, color);

    switch (i) {
      case Tile.GRASS_A:
      case Tile.GRASS_B:
        paintGrass(ctx, y, i === Tile.GRASS_B);
        break;
      case Tile.PATH:
      case Tile.PATH_ACCENT:
        paintNeonRoad(ctx, y, i === Tile.PATH_ACCENT);
        break;
      case Tile.PLAZA:
        paintPlaza(ctx, y);
        break;
      case Tile.SAND:
        paintSand(ctx, y);
        break;
      case Tile.WATER:
      case Tile.WATER_DEEP:
        paintWater(ctx, y, i === Tile.WATER_DEEP);
        break;
      case Tile.DOCK:
        paintDock(ctx, y);
        break;
      case Tile.BLD_JUPITER:
      case Tile.BLD_POST:
      case Tile.BLD_GUILD:
      case Tile.BLD_SUPERTEAM:
      case Tile.BUILDING:
        paintBuildingRoof(ctx, y, color);
        break;
      case Tile.PARK:
        paintPark(ctx, y);
        break;
      case Tile.FLOWERS:
        paintFlowers(ctx, y);
        break;
    }

    paintTileBorder(ctx, y);
  }

  scene.textures.addCanvas("tileset", canvas);
}

function toHex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function paintBaseTile(ctx: CanvasRenderingContext2D, y: number, baseColor: number): void {
  ctx.fillStyle = toHex(baseColor);
  ctx.fillRect(0, y, TILE_SIZE, TILE_SIZE);
}

function paintTileBorder(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
  ctx.fillRect(0, y, TILE_SIZE, 2);
  ctx.fillRect(0, y, 2, TILE_SIZE);
}

function paintGrass(ctx: CanvasRenderingContext2D, y: number, dense: boolean): void {
  ctx.fillStyle = dense ? "rgba(20, 241, 149, 0.14)" : "rgba(255,255,255,0.04)";
  for (let py = 6; py < TILE_SIZE; py += 10) {
    for (let px = (py / 2) % 8; px < TILE_SIZE; px += 12) {
      ctx.fillRect(px, y + py, 2, 2);
    }
  }
}

function paintNeonRoad(ctx: CanvasRenderingContext2D, y: number, accent: boolean): void {
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  for (let x = 0; x < TILE_SIZE; x += 8) {
    ctx.fillRect(x, y + 12, 4, 2);
    ctx.fillRect(x + 2, y + TILE_SIZE - 14, 4, 2);
  }

  ctx.fillStyle = accent ? "rgba(153,69,255,0.65)" : "rgba(0,209,255,0.45)";
  ctx.fillRect(0, y + Math.floor(TILE_SIZE / 2) - 1, TILE_SIZE, 2);
}

function paintPlaza(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  for (let p = 0; p < TILE_SIZE; p += 16) {
    ctx.fillRect(p, y, 1, TILE_SIZE);
    ctx.fillRect(0, y + p, TILE_SIZE, 1);
  }
  ctx.fillStyle = "rgba(20,241,149,0.18)";
  ctx.fillRect(24, y + 24, 16, 16);
}

function paintSand(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.fillStyle = "rgba(255,255,255,0.13)";
  for (let i = 0; i < 22; i++) {
    const x = (i * 11) % TILE_SIZE;
    const yy = y + ((i * 17) % TILE_SIZE);
    ctx.fillRect(x, yy, 2, 2);
  }
}

function paintWater(ctx: CanvasRenderingContext2D, y: number, deep: boolean): void {
  ctx.fillStyle = deep ? "rgba(153,69,255,0.23)" : "rgba(0,209,255,0.2)";
  for (let row = 8; row < TILE_SIZE - 6; row += 12) {
    ctx.fillRect(6, y + row, TILE_SIZE - 12, 2);
  }
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(6, y + 6, TILE_SIZE - 12, 1);
}

function paintDock(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  for (let x = 0; x < TILE_SIZE; x += 10) {
    ctx.fillRect(x, y, 2, TILE_SIZE);
  }
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(0, y + TILE_SIZE - 6, TILE_SIZE, 2);
}

function paintBuildingRoof(ctx: CanvasRenderingContext2D, y: number, baseColor: number): void {
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(0, y, TILE_SIZE, 10);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(4, y + 14, TILE_SIZE - 8, 6);

  // Neon sign bar inspired by Solana palette.
  ctx.fillStyle = baseColor === COLORS.BLD_JUPITER ? "#FFD700" : "#9945FF";
  ctx.fillRect(10, y + TILE_SIZE - 16, TILE_SIZE - 20, 4);
}

function paintPark(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  for (let x = 6; x < TILE_SIZE; x += 12) {
    ctx.fillRect(x, y + 10, 2, 2);
    ctx.fillRect(x + 3, y + 26, 2, 2);
    ctx.fillRect(x + 1, y + 44, 2, 2);
  }
}

function paintFlowers(ctx: CanvasRenderingContext2D, y: number): void {
  paintGrass(ctx, y, true);
  const tones = ["#F72585", "#FFD700", "#14F195", "#00D1FF"];
  for (let i = 0; i < 16; i++) {
    const x = 6 + ((i * 13) % (TILE_SIZE - 12));
    const yy = y + 8 + ((i * 9) % (TILE_SIZE - 14));
    ctx.fillStyle = tones[i % tones.length];
    ctx.fillRect(x, yy, 2, 2);
  }
}
