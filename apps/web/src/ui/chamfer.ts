import type { CSSProperties } from "react";

/**
 * Shared pixel-art chamfer helpers. A chamfer is a flat diagonal corner cut
 * instead of a rounded one, matching the sci-fi frame system used in the HUD.
 */
export function chamferClip(corner: number): string {
  return `polygon(${corner}px 0, calc(100% - ${corner}px) 0, 100% ${corner}px, 100% calc(100% - ${corner}px), calc(100% - ${corner}px) 100%, ${corner}px 100%, 0 calc(100% - ${corner}px), 0 ${corner}px)`;
}

const SQRT2 = Math.SQRT2;

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

  const { w, c } = b;
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

/** Avatar in the octagon frame; `size` is the total size including the frame. */
export function avatarFrame(scale: 1 | 2, size: number): CSSProperties {
  return { ...octagonFrame(scale), width: size, height: size };
}

/** Background that puts the photo under the whole frame, or a plain fill. */
export function avatarPhoto(src: string | null, fill = "rgba(8,12,32,0.95)"): CSSProperties {
  return src
    ? { background: `url("${src}") center / cover no-repeat border-box, ${fill}` }
    : { background: fill };
}

/** The thin (4px) frame4 ring, for cards nested inside a window. Trims its own background to the octagon. */
export function octagonFrameThin(): CSSProperties {
  return {
    boxSizing: "border-box", borderWidth: 4, borderStyle: "solid", borderColor: "transparent",
    borderImage: "url(/assets/branding/ui/frame-btn.png) 18 fill / 4px / 0 round",
    imageRendering: "pixelated", clipPath: chamferClip(3.6),
  };
}
