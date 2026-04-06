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
 * Generates a tileset texture at runtime.
 * Each tile is a colored square in a vertical strip.
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
    ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    ctx.fillRect(0, i * TILE_SIZE, TILE_SIZE, TILE_SIZE);

    ctx.fillStyle = "rgba(0,0,0,0.05)";
    ctx.fillRect(0, i * TILE_SIZE, TILE_SIZE, 1);
    ctx.fillRect(0, i * TILE_SIZE, 1, TILE_SIZE);

    // Plaza tiles get a subtle pattern
    if (i === Tile.PLAZA) {
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fillRect(2, i * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4);
    }

    // Path accent gets a Solana purple tint line
    if (i === Tile.PATH_ACCENT) {
      ctx.fillStyle = "rgba(153,69,255,0.15)";
      ctx.fillRect(0, i * TILE_SIZE + TILE_SIZE - 3, TILE_SIZE, 3);
    }
  }

  scene.textures.addCanvas("tileset", canvas);
}
