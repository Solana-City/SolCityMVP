/**
 * The coffee cup that marks the Vietnamese Barista's speed buff, drawn here
 * as a 12x12 pixel matrix so the buff can ship before the art does.
 *
 * One matrix, two consumers: Phaser paints it into a canvas texture for the
 * badge over the player's head, and React reads it as an SVG data URL for the
 * HUD timer. When the real icon lands in /assets/ui, both of these become a
 * one-line swap (a `load.image` and a path) and the matrix goes away.
 *
 * `import type` for Phaser on purpose: this module is pulled into the React
 * HUD, and a value import would drag the whole engine into that bundle.
 */
import type * as Phaser from "phaser";

/** Source size of the art, in pixels. Rendered 1:1 in world space. */
export const COFFEE_ICON_SIZE = 12;

/**
 * o = outline, b = coffee, c = porcelain, t = saucer, s = steam.
 * A dot is transparent. Every row is COFFEE_ICON_SIZE characters wide.
 */
const ART = [
  "...s...s....",
  "....s.s.....",
  "...s...s....",
  "............",
  ".oooooooo...",
  ".obbbbbbooo.",
  ".obbbbbbo.o.",
  ".occccccooo.",
  ".occcccco...",
  "..occcco....",
  "..oooooo....",
  ".tttttttttt.",
];

const PALETTE: Record<string, string> = {
  o: "#3b2416",
  b: "#7a3f16",
  c: "#f2ece0",
  t: "#c9c0ae",
  s: "#dfe7f0",
};

/** Steam reads as vapour, not as three solid dots. */
const STEAM_ALPHA = 0.7;

/** Phaser texture key for the in-world badge. */
export const COFFEE_TEXTURE_KEY = "buff-coffee";

/**
 * Paints the matrix into a canvas texture the first time it is asked for, and
 * hands back the key every time after. Safe to call on every scene start.
 */
export function ensureCoffeeTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(COFFEE_TEXTURE_KEY)) return COFFEE_TEXTURE_KEY;

  const texture = scene.textures.createCanvas(COFFEE_TEXTURE_KEY, COFFEE_ICON_SIZE, COFFEE_ICON_SIZE);
  if (!texture) return COFFEE_TEXTURE_KEY;

  const ctx = texture.getContext();
  for (let y = 0; y < ART.length; y++) {
    for (let x = 0; x < ART[y].length; x++) {
      const fill = PALETTE[ART[y][x]];
      if (!fill) continue;
      ctx.globalAlpha = ART[y][x] === "s" ? STEAM_ALPHA : 1;
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  ctx.globalAlpha = 1;
  texture.refresh();
  return COFFEE_TEXTURE_KEY;
}

/**
 * The same art as an SVG data URL, for <img> in the HUD. `crispEdges` keeps
 * the pixels square at whatever size the chip renders it.
 */
export const COFFEE_ICON_URL = (() => {
  let rects = "";
  for (let y = 0; y < ART.length; y++) {
    for (let x = 0; x < ART[y].length; x++) {
      const ch = ART[y][x];
      const fill = PALETTE[ch];
      if (!fill) continue;
      const opacity = ch === "s" ? ` opacity="${STEAM_ALPHA}"` : "";
      rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"${opacity}/>`;
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${COFFEE_ICON_SIZE} ${COFFEE_ICON_SIZE}" ` +
    `shape-rendering="crispEdges">${rects}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
})();
