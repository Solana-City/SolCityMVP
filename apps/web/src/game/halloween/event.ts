/**
 * When Halloween is on, in one place.
 *
 * The event had no window at all: Jack O' Lantern stood in the park forever
 * and the pumpkins kept spawning, so "the event runs until the 2nd" was a
 * promise only the announcement made. This is the gate that makes it true.
 *
 * ── What turning off means, and what it does not ──────────────────────────
 *
 * Off removes the ACTIVITY: the NPC leaves the park, no pumpkins spawn, and
 * the quest drops off the board unless the player already finished it.
 *
 * It does not take anything back. A wallet that carved one clean keeps the
 * Pumpkin Head in its wardrobe, keeps the achievement, and stays on the
 * winners list a mint would read. Nothing here is consulted when the hat is
 * worn, only when it can still be earned.
 *
 * ── UTC, deliberately ─────────────────────────────────────────────────────
 *
 * The rest of the city counts days in UTC (`todayKey`, the quest day keys,
 * the pumpkin spots), so the event ends on the same clock the hunt resets on.
 * A local-time boundary would mean the last day's pumpkins vanished partway
 * through it for half the players.
 */

/**
 * Midnight UTC on 2 November 2026: the first instant the event is off.
 *
 * So the 1st is the last playable day, and `2/11` is the date on which it is
 * gone rather than the last date it runs. Month 10 is November.
 */
export const HALLOWEEN_ENDS_AT = Date.UTC(2026, 10, 2, 0, 0, 0);

/**
 * Whether the event is still running.
 *
 * Read at module load for the NPC registry, which is static data, and per
 * call everywhere else. Either way a tab left open across the boundary keeps
 * what it already placed until it is reloaded: the city builds its NPCs once,
 * at scene creation, so there is nothing a live check could remove anyway.
 */
export function isHalloweenOn(now: number = Date.now()): boolean {
  return now < HALLOWEEN_ENDS_AT;
}

/**
 * The carving board, `ev:minigame:pumpkin-carving:best` behind the API.
 *
 * Here rather than inside the mini-game because two other things read it: the
 * board the carving screen shows, and the reconciliation that re-grants the
 * hat from the server (see `reconcileCarvingReward`). A second copy of this
 * string is a silent way for them to stop agreeing.
 */
export const CARVING_BOARD = "game:pumpkin-carving";
