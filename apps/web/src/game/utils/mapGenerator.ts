import { MAP_COLS, MAP_ROWS, Tile } from "../config/constants";

const W = Tile.WATER;
const D = Tile.WATER_DEEP;
const S = Tile.SAND;
const G = Tile.GRASS_A;
const g = Tile.GRASS_B;
const P = Tile.PATH;
const Z = Tile.PLAZA;
const B = Tile.BUILDING;
const R = Tile.PARK;
const F = Tile.FLOWERS;
const J = Tile.BLD_JUPITER;
const O = Tile.BLD_POST;
const T = Tile.BLD_SUPERTEAM;
const A = Tile.PATH_ACCENT;

// prettier-ignore
const LAYOUT: number[][] = [
//0  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39
 [D, D, D, D, D, D, D, D, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, D, D, D, D, D, D, D, D], // 0
 [D, D, D, D, D, W, W, W, W, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, W, W, W, W, D, D, D, D, D, D, D], // 1
 [D, D, D, W, W, W, S, S, S, G, G, g, G, g, G, G, g, G, G, g, G, G, g, G, G, g, G, g, G, S, S, W, W, W, D, D, D, D, D, D], // 2
 [D, D, W, W, S, S, G, G, g, G, J, J, J, G, g, P, A, P, g, G, O, O, O, G, g, G, G, G, g, G, S, S, W, W, D, D, D, D, D, D], // 3
 [D, W, W, S, S, G, G, g, G, G, J, J, J, G, G, P, g, P, G, G, O, O, O, G, F, g, F, G, G, G, S, S, W, W, W, D, D, D, D, D], // 4
 [D, W, S, S, G, G, g, G, G, g, G, g, G, G, g, P, g, P, g, G, G, g, G, G, g, G, g, G, G, g, G, S, W, W, W, D, D, D, D, D], // 5
 [W, W, S, G, G, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, G, G, G, S, S, W, W, D, D, D, D, D], // 6
 [W, S, S, G, g, P, G, g, R, R, R, g, G, A, Z, Z, Z, Z, Z, Z, A, G, g, G, F, P, G, g, G, G, G, S, S, W, W, D, D, D, D, D], // 7
 [W, S, G, G, G, P, G, R, R, R, R, R, G, Z, Z, Z, Z, Z, Z, Z, Z, G, g, G, G, P, G, G, G, g, G, S, W, W, W, D, D, D, D, D], // 8
 [W, S, G, g, G, P, G, R, R, R, R, R, G, Z, Z, Z, Z, Z, Z, Z, Z, G, G, g, G, P, g, G, G, G, S, S, W, W, D, D, D, D, D, D], // 9
 [W, S, G, G, g, P, G, g, R, R, R, g, G, Z, Z, Z, Z, Z, Z, Z, Z, g, G, G, G, P, G, G, g, S, S, W, W, D, D, D, D, D, D, D], // 10
 [W, S, G, G, G, P, G, G, g, G, G, G, G, Z, Z, Z, Z, Z, Z, Z, Z, G, G, g, G, P, G, g, S, S, W, W, D, D, D, D, D, D, D, D], // 11
 [W, S, G, g, G, P, G, g, G, g, G, g, G, A, Z, Z, Z, Z, Z, Z, A, G, g, G, G, P, G, G, S, W, W, D, D, D, D, D, D, D, D, D], // 12
 [W, S, G, G, G, P, P, P, P, P, P, P, P, P, P, A, P, A, P, P, P, P, P, P, P, P, G, g, S, W, W, D, D, D, D, D, D, D, D, D], // 13
 [W, S, G, g, G, P, G, G, g, G, G, g, G, G, g, P, g, P, g, G, G, g, G, G, g, P, G, G, S, S, W, W, D, D, D, D, D, D, D, D], // 14
 [W, S, G, G, g, P, G, g, G, g, G, G, G, g, G, P, G, P, G, g, G, G, g, G, G, P, g, G, G, S, W, W, D, D, D, D, D, D, D, D], // 15
 [W, S, G, G, G, P, G, G, g, G, G, g, G, G, g, P, g, P, g, G, G, g, G, G, G, P, G, g, G, S, S, W, W, D, D, D, D, D, D, D], // 16
 [W, S, S, G, g, P, F, g, F, G, g, G, G, g, G, P, G, P, G, g, T, T, T, G, g, P, G, G, g, G, S, W, W, D, D, D, D, D, D, D], // 17
 [W, W, S, G, G, P, G, G, G, G, G, g, G, G, g, P, g, P, g, G, T, T, T, G, G, P, g, G, G, S, S, W, W, D, D, D, D, D, D, D], // 18
 [D, W, S, G, g, P, G, g, G, g, G, G, G, g, G, P, G, P, G, g, T, T, T, g, G, P, G, g, G, G, S, W, W, D, D, D, D, D, D, D], // 19
 [D, W, S, S, G, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, G, G, G, S, S, W, W, D, D, D, D, D, D, D], // 20
 [D, W, W, S, G, P, G, G, g, G, B, B, B, G, g, P, g, G, B, B, B, G, g, G, G, P, g, G, S, S, W, W, D, D, D, D, D, D, D, D], // 21
 [D, D, W, S, S, P, G, g, G, G, B, B, B, G, G, P, G, G, B, B, B, g, G, F, G, P, G, S, S, W, W, D, D, D, D, D, D, D, D, D], // 22
 [D, D, W, W, S, G, G, G, g, G, B, B, B, g, G, P, G, g, B, B, B, G, g, G, G, G, S, S, W, W, D, D, D, D, D, D, D, D, D, D], // 23
 [D, D, D, W, W, S, S, G, G, g, G, G, g, G, G, P, G, G, g, G, G, G, G, G, G, S, S, W, W, D, D, D, D, D, D, D, D, D, D, D], // 24
 [D, D, D, D, W, W, S, S, G, G, G, g, G, G, G, P, G, g, G, G, g, G, G, G, S, S, W, W, D, D, D, D, D, D, D, D, D, D, D, D], // 25
 [D, D, D, D, D, W, W, S, S, S, G, G, g, G, G, g, G, G, g, G, G, G, S, S, S, W, W, D, D, D, D, D, D, D, D, D, D, D, D, D], // 26
 [D, D, D, D, D, D, W, W, W, S, S, S, S, S, S, S, S, S, S, S, S, S, S, W, W, W, D, D, D, D, D, D, D, D, D, D, D, D, D, D], // 27
 [D, D, D, D, D, D, D, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D], // 28
 [D, D, D, D, D, D, D, D, D, D, W, W, W, W, W, W, W, W, W, W, W, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D], // 29
];

const WALKABLE = new Set([
  Tile.GRASS_A, Tile.GRASS_B, Tile.PATH, Tile.PLAZA, Tile.SAND,
  Tile.DOCK, Tile.PARK, Tile.FLOWERS, Tile.PATH_ACCENT,
]);

export function getMapData(): {
  ground: number[];
  collision: number[];
  width: number;
  height: number;
} {
  const ground: number[] = [];
  const collision: number[] = [];

  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const tile = LAYOUT[r]?.[c] ?? Tile.WATER_DEEP;
      ground.push(tile);
      collision.push(WALKABLE.has(tile) ? -1 : 0);
    }
  }

  return { ground, collision, width: MAP_COLS, height: MAP_ROWS };
}

export function getSpawnPoint(): { x: number; y: number } {
  return { x: 16, y: 9 };
}
