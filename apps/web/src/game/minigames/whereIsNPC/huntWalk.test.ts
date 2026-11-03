import { describe, it, expect } from "vitest";
import { HuntWalk, HUNT_TILE_MS, type Tile } from "./huntWalk";

/**
 * The hunted citizen has to be on the same tile for everybody, and never on a
 * tile it cannot stand on. These pin both.
 */

/** A 10x10 block of street with a 3x3 "building" in the middle. */
function district(): Tile[] {
  const tiles: Tile[] = [];
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      if (col >= 4 && col <= 6 && row >= 4 && row <= 6) continue;
      tiles.push({ col, row });
    }
  }
  return tiles;
}

describe("the hunt walk", () => {
  it("is the same walk for the same round on every client", () => {
    const a = new HuntWalk(district(), 5, 1234);
    const b = new HuntWalk(district(), 5, 1234);
    for (let step = 0; step < 300; step++) expect(b.tileAt(step)).toEqual(a.tileAt(step));
  });

  it("is a different walk for another round", () => {
    const a = new HuntWalk(district(), 5, 1);
    const b = new HuntWalk(district(), 5, 2);
    const differs = Array.from({ length: 60 }, (_, s) => s)
      .some((s) => JSON.stringify(a.tileAt(s)) !== JSON.stringify(b.tileAt(s)));
    expect(differs).toBe(true);
  });

  it("only ever stands on free tiles, one neighbour at a time", () => {
    const tiles = district();
    const free = new Set(tiles.map((t) => `${t.col},${t.row}`));
    const w = new HuntWalk(tiles, 0, 99);
    let prev = w.tileAt(0);
    for (let step = 1; step < 400; step++) {
      const t = w.tileAt(step);
      expect(free.has(`${t.col},${t.row}`)).toBe(true);
      expect(Math.abs(t.col - prev.col) + Math.abs(t.row - prev.row)).toBeLessThanOrEqual(1);
      prev = t;
    }
  });

  it("does not depend on the order the steps are asked for", () => {
    const a = new HuntWalk(district(), 7, 42);
    const late = a.tileAt(250);
    const b = new HuntWalk(district(), 7, 42);
    for (let s = 0; s <= 250; s++) b.tileAt(s);
    expect(b.tileAt(250)).toEqual(late);
  });

  it("actually goes somewhere", () => {
    const w = new HuntWalk(district(), 0, 7);
    const seen = new Set<string>();
    for (let s = 0; s < 300; s++) { const t = w.tileAt(s); seen.add(`${t.col},${t.row}`); }
    expect(seen.size).toBeGreaterThan(20);
  });

  it("puts a client that joins mid-step where the others already see it", () => {
    const w = new HuntWalk(district(), 3, 5);
    const p = w.positionAt(10 * HUNT_TILE_MS + HUNT_TILE_MS / 2, 24);
    const a = w.tileAt(10);
    const b = w.tileAt(11);
    expect(p.x).toBeCloseTo(((a.col + b.col) / 2) * 24 + 12);
    expect(p.y).toBeCloseTo(((a.row + b.row) / 2) * 24 + 12);
    expect(p.msToNextTile).toBeCloseTo(HUNT_TILE_MS / 2);
  });
});
