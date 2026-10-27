export const TILE_SIZE = 24;

export const PLAYER_SPEED = 160;

/**
 * Depth a character's name tag draws at: over every map layer (the city's
 * foreground sits at 10000) and under the chat bubbles that have to clear it
 * (20000).
 *
 * A name is how you tell who somebody is, so it is the one part of a
 * character a building is never allowed to cover. It is also why a tag is not
 * a child of its container: a container's children sort inside it, at the
 * container's own depth, so whatever hid the character hid the name with it.
 * Whoever owns a tag places it every frame instead.
 */
export const NAME_DEPTH = 15000;
