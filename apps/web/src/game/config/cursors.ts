/**
 * The city's cursor, for the things Phaser draws.
 *
 * The page itself is handled in CSS (see the "Custom cursor" block at the end
 * of app/globals.css) — html gets the resting arrow, anything clickable gets
 * the hover arrow, and a held mouse button gets the pressed one. That covers
 * every DOM element, but it cannot reach INSIDE the canvas: an NPC is a
 * drawing, not an element, so no selector can say "the pointer is over one".
 *
 * Phaser can. It writes `canvas.style.cursor` itself whenever the pointer
 * enters an interactive object, and this module is the string it writes. The
 * pressed state is not here: the CSS rule for it is `!important`, which beats
 * Phaser's inline style, so clicking on the canvas already shows it.
 *
 * KEEP IN SYNC with globals.css — same files, same hotspots.
 */

const BASE = "/assets/ui";

/**
 * A `cursor` value, with the 2x art when the browser can take it.
 *
 * `image-set()` inside `cursor` is a recent arrival, and a browser that does
 * not understand it would silently ignore the whole assignment and leave the
 * pointer on whatever it was. CSS.supports() asks first, so the answer is
 * always a value that will actually apply; the cost of the older path is a
 * cursor the OS upscales on a high-density screen.
 */
function cursorValue(name: string, hotX: number, hotY: number, fallback: string): string {
  const plain = `url("${BASE}/cursor_${name}.png") ${hotX} ${hotY}, ${fallback}`;
  const retina =
    `image-set(url("${BASE}/cursor_${name}.png") 1x, url("${BASE}/cursor_${name}@2x.png") 2x)`
    + ` ${hotX} ${hotY}, ${fallback}`;
  if (typeof CSS !== "undefined" && CSS.supports?.("cursor", retina)) return retina;
  return plain;
}

let hover: string | null = null;

/**
 * What the canvas shows while the pointer is over something in the world that
 * can be clicked: an NPC, another player. Resolved once and remembered — it
 * is asked for on every hit zone the scene builds.
 */
export function hoverCursor(): string {
  if (hover === null) hover = cursorValue("hover", 0, 0, "pointer");
  return hover;
}
