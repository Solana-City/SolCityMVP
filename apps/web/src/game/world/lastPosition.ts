/**
 * Where the player was standing, kept across reloads.
 *
 * The page reloads itself on a few occasions (a new build, a chunk that fails
 * to load, a wallet error caught mid-render) and every one of them used to
 * drop the player back at the fountain, mid-session, with no explanation.
 * The reloads themselves are being chased down separately; this makes them
 * stop costing the player their place in the city.
 *
 * Kept per browser, not per wallet: a guest who reloads deserves the same.
 * Anything older than MAX_AGE_MS is ignored, so coming back tomorrow still
 * starts at the fountain.
 */

const KEY = "solcity:last-position";
const MAX_AGE_MS = 30 * 60_000;

export interface SavedPosition {
  x: number;
  y: number;
  at: number;
}

export function saveLastPosition(x: number, y: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ x: Math.round(x), y: Math.round(y), at: Date.now() }));
  } catch { /* storage blocked — the fountain it is */ }
}

/** The stored spot, or null when there is none, it is stale, or it is unreadable. */
export function readLastPosition(): SavedPosition | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as SavedPosition;
    if (typeof p?.x !== "number" || typeof p?.y !== "number" || typeof p?.at !== "number") return null;
    if (Date.now() - p.at > MAX_AGE_MS) return null;
    return p;
  } catch {
    return null;
  }
}

export function clearLastPosition(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
