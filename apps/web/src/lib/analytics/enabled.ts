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
 * Purchases are the exception: they are rare, they are the revenue, and the
 * money section of the dev panel is the only place they are visible.
 */
export const ANALYTICS_ON =
  (typeof process !== "undefined" &&
    (process.env.NEXT_PUBLIC_ANALYTICS === "1" || process.env.ANALYTICS === "1")) || false;

/** Kinds still recorded while analytics are off. */
export function alwaysRecorded(kind: string): boolean {
  return kind === "purchase";
}
