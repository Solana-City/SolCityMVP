/**
 * Which on-chain slot each mini-game's best score lives in.
 *
 * `PlayerState.game_bests` is `[u32; 16]` and the index into it is the only
 * thing the chain knows about a mini-game: there is no name up there, no
 * registry, nothing to look a score up by. The position IS the identity.
 *
 * APPEND ONLY, and never reorder. Every score already written is addressed by
 * its slot, so moving an entry re-labels history: yesterday's Kite Clash
 * records silently become Food Cart records, on accounts nobody can rewrite.
 * A game that is removed leaves its slot behind as a gap rather than letting
 * the ones after it shift up.
 *
 * Sixteen is the ceiling, because widening the array is a struct change and a
 * redeploy. Eleven free today.
 */
export const GAME_SLOTS = [
  "food-cart",
  "kite-clash",
  "sol-mechs",
  "hair-specialist",
  "pumpkin-carving",
] as const;

/** How many slots the program reserves (`GAME_SLOTS` in lib.rs). */
export const GAME_SLOT_CAP = 16;

export type GameSlotId = (typeof GAME_SLOTS)[number];

/**
 * The slot for a mini-game id, or -1 for one that has never been given one.
 *
 * -1 rather than a throw or a 0: a game with no slot should record nothing at
 * all, and defaulting to 0 would write its score into Food Cart's board.
 */
export function gameSlotOf(id: string): number {
  return (GAME_SLOTS as readonly string[]).indexOf(id);
}

/** The id in a slot, for turning a decoded `game_bests` array back into names. */
export function gameInSlot(slot: number): GameSlotId | null {
  return GAME_SLOTS[slot] ?? null;
}
