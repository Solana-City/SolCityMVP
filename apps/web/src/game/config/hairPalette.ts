/**
 * Hair colour: one palette, applied to every hairstyle at runtime.
 *
 * ── Why this works at all ──────────────────────────────────────────────────
 *
 * Every hair sheet in the game is drawn with TWO colours (the beard is the one
 * exception, at three): a main tone covering most of the ink, plus a single
 * shading tone. Two of the sets shipped are already literal palette swaps of
 * each other — Black_hair/Brown_hair and the three Magawks are pixel for pixel
 * identical in silhouette AND in where each shade falls, differing only in the
 * two colours used.
 *
 * So recolouring at runtime is not a new technique here. It is the same swap
 * the artist was doing by hand and saving as another file, done by the client
 * instead, which is why one hairstyle no longer needs one sheet per colour.
 *
 * ── The catch, and the rule that solves it ─────────────────────────────────
 *
 * The art uses two OPPOSITE shading conventions, and a naive "majority colour
 * becomes the palette colour" rule breaks on it:
 *
 *   Afro, Anime, Black, Brown, long, beard   main is DARK,  shade is LIGHTER
 *   Avatar, Magawk                           main is LIGHT, shade is DARKER
 *
 * Map blindly and one swatch reads as a dark maroon afro and a bright red
 * mohawk. So a swatch carries THREE stops, and each sheet resolves its own:
 *
 *   the majority colour            → `main`
 *   a minority colour, lighter     → `highlight`
 *   a minority colour, darker      → `shadow`
 *
 * Every sheet keeps the lighting its artist drew, no sheet needs reworking,
 * and one swatch reads the same across all of them.
 *
 * ── Nothing that shipped changes appearance ────────────────────────────────
 *
 * The first seven swatches ARE the ramps already in the art, lifted hex for
 * hex. Each style's default (STYLE_DEFAULT_COLOR) is the swatch its sheet was
 * drawn in, so a style at its default resolves to a no-op and renders from the
 * original texture with nothing derived and nothing allocated. It also makes
 * the three Magawks and Brown_hair exactly reproducible as one style plus a
 * colour, which is what let them collapse into one wardrobe entry each
 * (see hairPalette.test.ts, which pins that pixel for pixel).
 */

export interface HairColor {
  /** Stable id. Goes on the wire and into save data: never renamed. */
  id: string;
  /** Shown in the wardrobe. */
  name: string;
  /** Replaces the sheet's majority colour. */
  main: string;
  /** Replaces a minority colour that is LIGHTER than the majority. */
  highlight: string;
  /** Replaces a minority colour that is DARKER than the majority. */
  shadow: string;
}

/**
 * Twenty swatches, free to everyone.
 *
 * The first seven are the ramps the shipped art already uses, so the styles
 * drawn in them are untouched. The rest are new. Editing a hex here moves
 * every surface that draws hair; there is no second copy anywhere.
 */
export const HAIR_COLORS: HairColor[] = [
  // ── The ramps already in the art (do not retune without redrawing) ──
  { id: "black",    name: "Black",    main: "#1f1723", highlight: "#3c2f52", shadow: "#0a0808" },
  { id: "raven",    name: "Raven",    main: "#0a0808", highlight: "#3c2f52", shadow: "#050404" },
  { id: "brown",    name: "Brown",    main: "#563226", highlight: "#ac6b26", shadow: "#331d16" },
  { id: "chestnut", name: "Chestnut", main: "#8f492a", highlight: "#ac6b26", shadow: "#673417" },
  { id: "blue",     name: "Blue",     main: "#4995f3", highlight: "#8fc0ff", shadow: "#4656a5" },
  { id: "green",    name: "Green",    main: "#3ec54b", highlight: "#7ee88a", shadow: "#317c3b" },
  { id: "red",      name: "Red",      main: "#f5464c", highlight: "#ff8a8e", shadow: "#b22741" },

  // ── Naturals ──
  { id: "ginger",   name: "Ginger",   main: "#c75a28", highlight: "#e8903f", shadow: "#8a3a19" },
  { id: "blonde",   name: "Blonde",   main: "#e0b457", highlight: "#f5dc9a", shadow: "#a87f33" },
  { id: "platinum", name: "Platinum", main: "#e8e2d4", highlight: "#ffffff", shadow: "#a9a195" },
  { id: "silver",   name: "Silver",   main: "#9aa0ad", highlight: "#ccd2dc", shadow: "#656b77" },

  // ── City colours ──
  { id: "crimson",  name: "Crimson",  main: "#a01f3c", highlight: "#d9405f", shadow: "#6b1026" },
  { id: "orange",   name: "Orange",   main: "#ff8c33", highlight: "#ffbb7a", shadow: "#c25f16" },
  { id: "gold",     name: "Gold",     main: "#ffd700", highlight: "#fff08a", shadow: "#b89400" },
  { id: "mint",     name: "Mint",     main: "#14f195", highlight: "#8dffd0", shadow: "#0b9e62" },
  { id: "teal",     name: "Teal",     main: "#1f9e8f", highlight: "#4fd0bf", shadow: "#136b60" },
  { id: "cyan",     name: "Cyan",     main: "#00d1ff", highlight: "#7fe8ff", shadow: "#0b8bab" },
  { id: "indigo",   name: "Indigo",   main: "#5a4fcf", highlight: "#8b82e8", shadow: "#3a3192" },
  { id: "purple",   name: "Purple",   main: "#9b5de5", highlight: "#c39bf5", shadow: "#6a33a8" },
  { id: "pink",     name: "Pink",     main: "#ff79c6", highlight: "#ffb3de", shadow: "#c2498f" },
];

const BY_ID = new Map(HAIR_COLORS.map((c) => [c.id, c]));

/**
 * The swatch each sheet was DRAWN in. A style worn at its own default
 * resolves to a no-op, so the original texture is used as is.
 *
 * A style missing from this table falls back to "black", which is only ever
 * visible for art added without a line here.
 */
export const STYLE_DEFAULT_COLOR: Record<string, string> = {
  Avatar: "blue",
  Black_hair: "black",
  Afro: "black",
  Anime: "black",
  Magawk_blue: "blue",
  black_long: "raven",
  brown_beard: "chestnut",
};

export const DEFAULT_HAIR_COLOR = "black";

export function hairColorOf(id: string | undefined): HairColor {
  return (id ? BY_ID.get(id) : undefined) ?? BY_ID.get(DEFAULT_HAIR_COLOR)!;
}

export function defaultColorFor(styleId: string | undefined): string {
  return (styleId && STYLE_DEFAULT_COLOR[styleId]) || DEFAULT_HAIR_COLOR;
}

/** True when this style in this colour is the art as drawn: nothing to derive. */
export function isDefaultHairColor(styleId: string | undefined, colorId: string | undefined): boolean {
  return (colorId ?? defaultColorFor(styleId)) === defaultColorFor(styleId);
}

// ── The recolour itself ─────────────────────────────────────────────────────

/** "#rrggbb" to [r, g, b]. Parsed once per swatch, never per pixel. */
function parseHex(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Rec. 601 luma, the same weighting the art was judged by. */
function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** One source colour and what it becomes. */
export interface ColorSwap { r: number; g: number; b: number; nr: number; ng: number; nb: number }

/**
 * Works out what to replace, for one sheet in one colour.
 *
 * Scans the sheet's distinct opaque colours (two, or three on the beard),
 * takes the most common as the main tone, and sorts the rest into highlight or
 * shadow by whether they are lighter or darker than it.
 *
 * Returns an EMPTY list when the swap would change nothing. That is the signal
 * not to derive a texture at all, and it is the common case: every style worn
 * in the colour it was drawn in lands here.
 */
export function buildHairSwaps(data: Uint8ClampedArray, color: HairColor): ColorSwap[] {
  // Art this flat has two tones, so a small array beats a Map and keeps the
  // scan allocation-free.
  const keys: number[] = [];
  const counts: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 16) continue; // chroma background, or masked away by a hat
    const k = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    const at = keys.indexOf(k);
    if (at === -1) {
      // A sheet with many tones is not one this palette understands, and
      // recolouring it would be guesswork. Leave it exactly as drawn.
      if (keys.length === MAX_TONES) return [];
      keys.push(k);
      counts.push(1);
    } else counts[at]++;
  }
  if (keys.length === 0) return [];

  let mainAt = 0;
  for (let i = 1; i < keys.length; i++) if (counts[i] > counts[mainAt]) mainAt = i;

  const unpack = (k: number): [number, number, number] => [(k >> 16) & 255, (k >> 8) & 255, k & 255];
  const [mr, mg, mb] = unpack(keys[mainAt]);
  const mainLuma = luma(mr, mg, mb);

  const main = parseHex(color.main);
  const highlight = parseHex(color.highlight);
  const shadow = parseHex(color.shadow);

  const swaps: ColorSwap[] = [];
  let changed = false;
  for (let i = 0; i < keys.length; i++) {
    const [r, g, b] = unpack(keys[i]);
    const to = i === mainAt ? main : luma(r, g, b) > mainLuma ? highlight : shadow;
    if (to[0] !== r || to[1] !== g || to[2] !== b) changed = true;
    swaps.push({ r, g, b, nr: to[0], ng: to[1], nb: to[2] });
  }
  return changed ? swaps : [];
}

/** Above this many distinct tones a sheet is not flat pixel art and is left alone. */
const MAX_TONES = 8;

/**
 * Applies the swaps in place. One linear pass, and with two or three entries
 * a straight compare beats any lookup structure.
 *
 * Transparent pixels are skipped: the chroma key and anything a hat masked
 * away keep alpha 0, and their stale RGB never reaches the screen.
 */
export function applyHairSwaps(data: Uint8ClampedArray, swaps: ColorSwap[]): void {
  if (swaps.length === 0) return;
  const n = swaps.length;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 16) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    for (let s = 0; s < n; s++) {
      const sw = swaps[s];
      if (sw.r === r && sw.g === g && sw.b === b) {
        data[i] = sw.nr; data[i + 1] = sw.ng; data[i + 2] = sw.nb;
        break;
      }
    }
  }
}

/** Scan and apply, for a caller that already holds one sheet's pixels. */
export function recolorHair(data: Uint8ClampedArray, colorId: string | undefined): void {
  applyHairSwaps(data, buildHairSwaps(data, hairColorOf(colorId)));
}
