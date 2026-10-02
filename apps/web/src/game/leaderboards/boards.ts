/**
 * City-wide boards, client side.
 *
 * Reads /api/leaderboard, which serves the scores the gameplay events already
 * record, with nicknames resolved. Every screen that used to read its own
 * `localStorage` copy now shows the same numbers to everyone.
 *
 * Failures are quiet on purpose: a board that cannot load shows the local
 * fallback rather than an error, because a leaderboard is never the reason a
 * player opened the game.
 */
export interface BoardRow {
  wallet: string;
  name: string | null;
  value: number;
}

export interface BoardResult {
  rows: BoardRow[];
  mine: { value: number; rank: number | null } | null;
  /**
   * Whether the board actually answered.
   *
   * An empty board and an unreachable one both used to arrive as an empty
   * array, so every caller had to guess, and they all guessed the same wrong
   * way: no rows meant "fall back to this browser's own history". That made a
   * freshly cleared board show the OLD local scores back again, which is
   * indistinguishable from a reset that did not work. An empty board is a
   * legitimate answer, and this is how a caller can tell.
   */
  ok: boolean;
}

const CACHE_MS = 15_000;
const cache = new Map<string, { at: number; value: BoardResult }>();

/** `hunt`, `quests`, or `game:<id>`. */
export async function fetchBoard(
  board: string,
  opts: { wallet?: string | null; limit?: number; force?: boolean } = {},
): Promise<BoardResult> {
  const key = `${board}:${opts.wallet ?? ""}:${opts.limit ?? 10}`;
  const hit = cache.get(key);
  if (!opts.force && hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  try {
    const params = new URLSearchParams({ board, limit: String(opts.limit ?? 10) });
    if (opts.wallet) params.set("wallet", opts.wallet);
    const res = await fetch(`/api/leaderboard?${params.toString()}`);
    if (!res.ok) throw new Error(`board ${res.status}`);
    const body = await res.json();
    const value: BoardResult = { rows: body.rows ?? [], mine: body.mine ?? null, ok: true };
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch {
    return hit?.value ?? { rows: [], mine: null, ok: false };
  }
}

/** Drops the cached copy so the next read is fresh (after scoring, say). */
export function invalidateBoard(board: string): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${board}:`)) cache.delete(key);
  }
}
