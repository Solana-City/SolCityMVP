/**
 * Where people actually walk.
 *
 * Deliberately NOT built from the position-sync traffic: that fires up to ten
 * times a second per player and would drown the store in noise to answer a
 * question about neighbourhoods. Instead the player's tile is sampled every
 * few seconds, counts are accumulated in memory, and one small batch is sent
 * every half minute.
 *
 * The grid is coarse (8 tiles a cell) because the question is "which corners
 * of the city are dead", not "which pixel". A coarse grid also means the
 * whole map is a few hundred numbers, so the panel can draw it in one read.
 */
const SAMPLE_MS = 4_000;
const FLUSH_MS = 30_000;
/** Map tiles per heat cell. The map is 135x115 tiles, so this is 17x15 cells. */
export const CELL_TILES = 8;
const TILE_PX = 24;

const counts = new Map<string, number>();
let sampleTimer: ReturnType<typeof setInterval> | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;

function cellOf(x: number, y: number): string {
  const cx = Math.floor(x / TILE_PX / CELL_TILES);
  const cy = Math.floor(y / TILE_PX / CELL_TILES);
  return `${cx},${cy}`;
}

async function flush(useBeacon = false): Promise<void> {
  if (counts.size === 0) return;
  const cells = Object.fromEntries(counts);
  counts.clear();
  const body = JSON.stringify({ cells });
  try {
    // On the way out the tab may die before fetch resolves; a beacon survives.
    if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon("/api/heat", new Blob([body], { type: "application/json" }));
      return;
    }
    await fetch("/api/heat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    });
  } catch {
    /* a lost sample is a lost pixel; never worth surfacing */
  }
}

/**
 * Starts sampling. `readPosition` returns the player's world position, or null
 * when they are not in the city (a mini-game, a menu), which is not walking.
 */
export function startHeatmap(readPosition: () => { x: number; y: number } | null): () => void {
  if (typeof window === "undefined" || sampleTimer) return () => {};

  sampleTimer = setInterval(() => {
    const at = readPosition();
    if (!at) return;
    const key = cellOf(at.x, at.y);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }, SAMPLE_MS);

  flushTimer = setInterval(() => { void flush(); }, FLUSH_MS);
  const onHide = () => { void flush(true); };
  window.addEventListener("pagehide", onHide);

  return () => {
    if (sampleTimer) clearInterval(sampleTimer);
    if (flushTimer) clearInterval(flushTimer);
    sampleTimer = null;
    flushTimer = null;
    window.removeEventListener("pagehide", onHide);
    void flush(true);
  };
}
