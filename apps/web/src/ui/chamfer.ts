import type { CSSProperties } from "react";

/**
 * Shared pixel-art chamfer helpers. A chamfer is a flat diagonal corner cut
 * instead of a rounded one, matching the sci-fi frame system used in the HUD.
 */
export function chamferClip(corner: number): string {
  return `polygon(${corner}px 0, calc(100% - ${corner}px) 0, 100% ${corner}px, 100% calc(100% - ${corner}px), calc(100% - ${corner}px) 100%, ${corner}px 100%, 0 calc(100% - ${corner}px), 0 ${corner}px)`;
}

/** Same cut, as an SVG `points` string for a `<polygon>` — an `<svg>` `<rect rx>` has no chamfer equivalent. */
export function chamferRectPoints(x: number, y: number, w: number, h: number, c: number): string {
  return [
    [x + c, y], [x + w - c, y], [x + w, y + c], [x + w, y + h - c],
    [x + w - c, y + h], [x + c, y + h], [x, y + h - c], [x, y + c],
  ].map(([px, py]) => `${px},${py}`).join(" ");
}

const SQRT2 = Math.SQRT2;

type RGBA = [number, number, number, number];

function parseColor(input: string): RGBA | null {
  const c = input.trim();
  let m = c.match(/^#([0-9a-f]{3,4})$/i);
  if (m) {
    const h = m[1];
    const [r, g, b, a] = [...h].map((x) => parseInt(x + x, 16));
    return [r, g, b, h.length === 4 ? a / 255 : 1];
  }
  m = c.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) / 255 : 1];
  }
  m = c.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), a];
  }
  return null;
}

/** What shows behind a chamfered box when nothing opaque is known. */
const FALLBACK_BACKDROP = "#0b0e1c";

/**
 * The same colour as an opaque one: `color` laid over `over`.
 *
 * The outline of a chamfered box is several overlapping layers (four edge
 * strips and a diagonal per corner), and where translucent layers overlap their
 * alpha adds up, so the corners came out brighter than the sides. A solid
 * colour has nothing to add up. Anything this cannot read (a var(), a name) is
 * returned untouched.
 */
export function solidColor(color: string, over?: string): string {
  const fg = parseColor(color);
  if (!fg || fg[3] >= 1) return color;
  let base = parseColor(over ?? FALLBACK_BACKDROP) ?? parseColor(FALLBACK_BACKDROP)!;
  if (base[3] < 1) {
    const under = parseColor(FALLBACK_BACKDROP)!;
    base = [0, 1, 2].map((i) => base[i] * base[3] + under[i] * (1 - base[3])).concat(1) as RGBA;
  }
  const out = [0, 1, 2].map((i) => Math.round(fg[i] * fg[3] + base[i] * (1 - fg[3])));
  return `rgb(${out[0]},${out[1]},${out[2]})`;
}

function parseBorder(border: unknown): { w: number; c: string } | null {
  if (typeof border !== "string") return null;
  const m = border.trim().match(/^([\d.]+)px\s+(?:solid|dashed|dotted)\s+(.+)$/);
  if (!m) return null;
  const w = parseFloat(m[1]);
  return w > 0 ? { w, c: m[2] } : null;
}

/** Split a CSS list on top-level commas (ignoring commas inside parentheses). */
function splitTop(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const isImage = (s: string) => /gradient\(|url\(/.test(s);

/**
 * A chamfered box whose outline follows the chamfer.
 *
 * `clip-path` alone cuts the corners off a rectangular `border` and leaves no
 * stroke along the new diagonal. This keeps the border space (so layout does
 * not move) but paints the outline itself as background layers on top of the
 * element's own background: four edge strips plus a diagonal stroke per
 * corner. Pass the same style object you would have used, with `border` and
 * `background` as usual.
 *
 * For hover effects, do not write `style.background` / `style.borderColor`
 * (the outline would be lost). Use `style.backgroundColor = ...` and
 * `style.setProperty("--cbc", color)` for the outline color instead.
 *
 * `clip-path` also clips `box-shadow`, so glows do not belong on the same
 * element: wrap it in <ChamferGlow> instead.
 */
export function chamferBox(corner: number, style: CSSProperties): CSSProperties {
  const clipPath = chamferClip(corner);
  const b = parseBorder(style.border);
  if (!b) return { ...style, clipPath };

  const { w } = b;
  // The element's own background, if it is a plain colour: the outline is
  // blended over it (see solidColor).
  const bgOf = (style.background ?? style.backgroundColor) as string | undefined;
  const bgColor = bgOf ? splitTop(bgOf).find((p) => !isImage(p)) : undefined;
  const c = solidColor(b.c, bgColor);
  const col = `var(--cbc, ${c})`;
  const line = `linear-gradient(${col}, ${col})`;
  // The diagonal stroke covers x + y in [corner, corner + reach].
  const reach = w * SQRT2;
  const edge = Math.ceil(corner + reach);
  const stop = ((corner + reach) / SQRT2).toFixed(2);
  const L = edge + 1;
  // Edge strips start at the corner (not after the diagonal) and overlap it, so
  // no notch is left where the diagonal meets the straight outline.
  const start = Math.ceil(corner);
  const span = `calc(100% - ${start * 2}px)`;
  const diag = (angle: number) => `linear-gradient(${angle}deg, ${col} ${stop}px, transparent ${stop}px)`;

  const images = [line, line, line, line, diag(135), diag(225), diag(45), diag(315)];
  const positions = [`${start}px 0`, `${start}px 100%`, `0 ${start}px`, `100% ${start}px`, "0 0", "100% 0", "0 100%", "100% 100%"];
  const sizes = [`${span} ${w}px`, `${span} ${w}px`, `${w}px ${span}`, `${w}px ${span}`, `${L}px ${L}px`, `${L}px ${L}px`, `${L}px ${L}px`, `${L}px ${L}px`];
  const repeats = images.map(() => "no-repeat");
  const origins = images.map(() => "border-box");
  const clips = images.map(() => "border-box");

  // The element's own background goes underneath the outline.
  let color: string | undefined;
  const original = (style.background ?? style.backgroundColor) as string | undefined;
  if (original) {
    const parts = splitTop(original);
    for (const part of parts) {
      if (isImage(part)) {
        images.push(part); positions.push("0 0"); sizes.push("auto"); repeats.push("repeat"); origins.push("padding-box"); clips.push("border-box");
      } else {
        color = part;
      }
    }
  }

  const { background: _b, backgroundColor: _bc, border: _bd, ...rest } = style;
  return {
    // First, so a per-side override such as `borderTop` still wins.
    border: `${w}px solid transparent`,
    ...rest,
    backgroundImage: images.join(", "),
    backgroundPosition: positions.join(", "),
    backgroundSize: sizes.join(", "),
    backgroundRepeat: repeats.join(", "),
    backgroundOrigin: origins.join(", "),
    backgroundClip: clips.join(", "),
    ...(color ? { backgroundColor: color } : null),
    clipPath,
    ["--cbc" as string]: c,
  } as CSSProperties;
}

/**
 * Octagon ring frame (frame-btn.png: 54px source = 27 art pixels at 2x, 6px
 * bar, 16px corner cut). Scale 1 draws it at 9px per side (one art pixel = one
 * CSS pixel); scale 2 at native size. Keep the scale an integer so the pixels
 * stay square. The element is clipped to the octagon so a photo or fill behind
 * it does not poke out of the cut corners.
 */
export function octagonFrame(scale: 1 | 2): CSSProperties {
  const w = 9 * scale;
  return {
    boxSizing: "border-box",
    borderWidth: w,
    borderStyle: "solid",
    borderColor: "transparent",
    borderImage: `url(/assets/branding/ui/frame-btn.png) 18 / ${w}px / 0 round`,
    imageRendering: "pixelated",
    clipPath: chamferClip(8 * scale),
  };
}

/** The thin (4px) frame4 ring, for cards nested inside a window. Trims its own background to the octagon. */
export function octagonFrameThin(): CSSProperties {
  return {
    boxSizing: "border-box", borderWidth: 4, borderStyle: "solid", borderColor: "transparent",
    borderImage: "url(/assets/branding/ui/frame-btn.png) 18 fill / 4px / 0 round",
    imageRendering: "pixelated", clipPath: chamferClip(3.6),
  };
}
