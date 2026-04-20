export const TILE_SIZE = 64;
export const MAP_COLS = 40;
export const MAP_ROWS = 30;
export const MAP_WIDTH = MAP_COLS * TILE_SIZE;
export const MAP_HEIGHT = MAP_ROWS * TILE_SIZE;

export const PLAYER_SPEED = 220;

export const COLORS = {
  PURPLE: 0x9945ff,
  GREEN: 0x14f195,
  CYAN: 0x00d1ff,
  DARK: 0x0e0e2c,
  MID: 0x1a1a3e,
  GOLD: 0xffd700,
  ORANGE: 0xff6b35,
  PINK: 0xf72585,
  GRASS_A: 0x1e5a2e,
  GRASS_B: 0x246832,
  PATH: 0x8a7a60,
  PLAZA: 0x7068a0,
  SAND: 0xc8b078,
  WATER: 0x0b3b5c,
  WATER_DEEP: 0x061a2c,
  DOCK: 0x6a5540,
  PARK: 0x1a7a18,
  FLOWERS: 0x1e5a2e,
  BLD_JUPITER: 0xc8960f,
  BLD_POST: 0x1878a8,
  BLD_GUILD: 0xcc4422,
  BLD_SUPERTEAM: 0x7040bb,
  BLD_GENERIC: 0x2a2a4a,
  NPC_ZONE: 0x9945ff,
} as const;

export enum Tile {
  GRASS_A = 0,
  GRASS_B = 1,
  PATH = 2,
  PLAZA = 3,
  SAND = 4,
  WATER_DEEP = 5,
  WATER = 6,
  DOCK = 7,
  BUILDING = 8,
  PARK = 9,
  FLOWERS = 10,
  BLD_JUPITER = 11,
  BLD_POST = 12,
  BLD_GUILD = 13,
  BLD_SUPERTEAM = 14,
  PATH_ACCENT = 15,
}
