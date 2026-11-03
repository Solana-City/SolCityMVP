/**
 * Where the hunted citizen is, at any moment of its round, on every client.
 *
 * The citizen walks from tile to tile: each step goes to a neighbouring tile
 * that is free of collision, inside the round's district. That is what keeps
 * it out of buildings, water and trees. Its old path was a smooth curve
 * tweened straight onto the container, and a tween does not ask the physics
 * about walls, so the citizen walked through everything and was left wherever
 * the curve ended when the round moved on.
 *
 * The walk is a pure function of (district tiles, start tile, round seed) and
 * of the time since the round began. Every client has the same district (the
 * same flood fill, sorted), the same start (getTargetSpot) and the same seed
 * (the round), and reads the time from the round's own start, so every client
 * puts the citizen on the same tile at the same moment. Nothing is exchanged.
 *
 * Step choice, drawn from one seeded stream with a FIXED number of draws per
 * step so no branch can shift the sequence for the steps after it:
 * - sometimes stand still for a step, like somebody looking around;
 * - usually keep going the same way, so it reads as walking somewhere;
 * - otherwise turn to a random open side, and only turn back at a dead end.
 */

export interface Tile { col: number; row: number }

/** One tile per step: 24 px/s at TILE_SIZE 24, inside the crowd's 22-30. */
export const HUNT_TILE_MS = 1_000;
const PAUSE_CHANCE = 0.12;
const STRAIGHT_CHANCE = 0.7;
/** Beyond any round (5 min is 300 steps); a cap, not a design number. */
const MAX_STEPS = 4_000;

const DIRS: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class HuntWalk {
  private readonly index = new Map<string, number>();
  private readonly path: number[];
  private readonly dirs: number[] = [-1];
  private readonly rand: () => number;

  constructor(private readonly tiles: Tile[], startIndex: number, seed: number) {
    tiles.forEach((t, i) => this.index.set(`${t.col},${t.row}`, i));
    const start = Math.min(Math.max(0, startIndex), Math.max(0, tiles.length - 1));
    this.path = [start];
    this.rand = mulberry32((seed ^ 0x51ed27) >>> 0);
  }

  /** The tile the walk is on at `step` (step 0 is the start tile). */
  tileAt(step: number): Tile {
    const s = Math.min(Math.max(0, Math.floor(step)), MAX_STEPS);
    while (this.path.length <= s) this.advance();
    return this.tiles[this.path[s]];
  }

  /**
   * World position at `elapsedMs` into the round, for a tile of `tileSize`
   * px: between the centres of two neighbouring free tiles, never anywhere
   * else. Also the facing and whether it is mid-stride.
   */
  positionAt(elapsedMs: number, tileSize: number): {
    x: number; y: number; moving: boolean; dir: "up" | "down" | "left" | "right";
    msToNextTile: number; next: { x: number; y: number };
  } {
    const t = Math.max(0, elapsedMs);
    const step = Math.floor(t / HUNT_TILE_MS);
    const frac = (t - step * HUNT_TILE_MS) / HUNT_TILE_MS;
    const a = this.tileAt(step);
    const b = this.tileAt(step + 1);
    const cx = (tile: Tile) => tile.col * tileSize + tileSize / 2;
    const cy = (tile: Tile) => tile.row * tileSize + tileSize / 2;
    const dc = b.col - a.col;
    const dr = b.row - a.row;
    const dir = dr < 0 ? "up" : dr > 0 ? "down" : dc < 0 ? "left" : "right";
    return {
      x: cx(a) + (cx(b) - cx(a)) * frac,
      y: cy(a) + (cy(b) - cy(a)) * frac,
      moving: dc !== 0 || dr !== 0,
      dir,
      msToNextTile: (step + 1) * HUNT_TILE_MS - t,
      next: { x: cx(b), y: cy(b) },
    };
  }

  private advance(): void {
    const cur = this.path[this.path.length - 1];
    const prevDir = this.dirs[this.dirs.length - 1];
    // Always three draws, whatever happens with them.
    const rPause = this.rand();
    const rStraight = this.rand();
    const rTurn = this.rand();

    const here = this.tiles[cur];
    const open: number[] = [];
    for (let d = 0; d < 4; d++) {
      if (this.neighbour(here, d) !== undefined) open.push(d);
    }
    if (open.length === 0 || rPause < PAUSE_CHANCE) {
      this.path.push(cur);
      this.dirs.push(prevDir);
      return;
    }
    let dir: number;
    if (prevDir >= 0 && open.includes(prevDir) && rStraight < STRAIGHT_CHANCE) {
      dir = prevDir;
    } else {
      const reverse = prevDir >= 0 ? (prevDir + 2) % 4 : -1;
      const choices = open.length > 1 ? open.filter((d) => d !== reverse) : open;
      dir = choices[Math.floor(rTurn * choices.length) % choices.length];
    }
    this.path.push(this.neighbour(here, dir)!);
    this.dirs.push(dir);
  }

  private neighbour(t: Tile, d: number): number | undefined {
    const [dc, dr] = DIRS[d];
    return this.index.get(`${t.col + dc},${t.row + dr}`);
  }
}
