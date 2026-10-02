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
 * Kinds still recorded while analytics are off.
 *
 * - `purchase`: rare, it is the revenue, and the money section of the dev
 *   panel is the only place it is visible.
 * - `hunt`: `ev:hunt:found:by` IS the Find Someone leaderboard (see
 *   lib/boards.ts), not a metric. With the gate closed, a find wrote nowhere
 *   and the city-wide board stayed empty forever while every browser showed
 *   only its own localStorage count. A find is also rare by construction —
 *   one per round, city-wide, and only for the player whose on-chain claim
 *   landed first — so this costs a handful of commands per hour, not the
 *   per-action flood the gate exists to stop.
 */
export function alwaysRecorded(kind: string): boolean {
  return kind === "purchase" || kind === "hunt";
}
