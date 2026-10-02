/**
 * Analytics are OFF unless someone turns them on.
 *
 * The key-value store is paid per command and is kept for what players would
 * miss: nicknames, direct messages, the daily check-in, quests and the city
 * boards. Analytics touch it on every action (each NPC talk, each message,
 * each tutorial card), which is exactly the traffic that spent a month of
 * quota in a few days of testing.
 *
 * Turn them on for a measured session with NEXT_PUBLIC_ANALYTICS=1 (and
 * redeploy), then turn them off again.
 *
 * Two kinds are never off, because they are not telemetry: something the game
 * itself shows players reads them back. See `alwaysRecorded`.
 */
export const ANALYTICS_ON =
  (typeof process !== "undefined" &&
    (process.env.NEXT_PUBLIC_ANALYTICS === "1" || process.env.ANALYTICS === "1")) || false;

/**
 * Kinds still recorded while analytics are off, because the game reads them
 * back to players: a board the city can see is not telemetry, and closing the
 * gate on one does not save quota, it silently breaks a feature.
 *
 * - `purchase`: rare, it is the revenue, and the money section of the dev
 *   panel is the only place it is visible.
 * - `hunt`: `ev:hunt:found:by` IS the Find Someone leaderboard (see
 *   lib/boards.ts). With the gate closed, a find wrote nowhere and the
 *   city-wide board stayed empty forever while every browser showed only its
 *   own localStorage count. A find is rare by construction — one per round,
 *   city-wide, for the single player whose on-chain claim landed first.
 * - `minigame`, except the `<id>-time` ids: `ev:minigame:<id>:best` is the
 *   per-game board, which had been frozen since the gate went in — kite-clash
 *   still showed one score from the last session analytics were on. The score
 *   event is one store command at the end of a round; `<id>-time` is how long
 *   somebody played, which nothing shows a player, so it stays gated.
 *
 * `id` is optional only so a caller that has not got one still type-checks;
 * every real event has one.
 */
export function alwaysRecorded(kind: string, id?: string): boolean {
  if (kind === "purchase" || kind === "hunt") return true;
  if (kind === "minigame") return !(id ?? "").endsWith("-time");
  return false;
}
