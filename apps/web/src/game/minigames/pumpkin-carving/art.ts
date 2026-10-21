/**
 * Pumpkin Carving: every pixel the game paints, in code.
 *
 * This is the final art, not a stand-in. It was written as one, and the plan
 * was for sheets to replace `paintPumpkin` and `makeKnife`, but Halloween is
 * a short season and the owner called these good enough to ship (2026-10-21).
 * Drawing rather than importing also keeps the carve honest: the hollows, the
 * cuts and the candle are effects computed over the same shapes the scoring
 * uses, so what the player sees is what the knife actually did.
 *
 * If a sheet ever does arrive, those two functions are still the seam, and
 * everything below them works over whatever pumpkin is underneath.
 */
import { ART, PATTERN, sampleOutline, type CarveScore } from "./pattern";

/** 4x4 ordered dither, 0..1: what makes flat shading read as pixel art. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const dither = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

// ─── Pumpkin ─────────────────────────────────────────────────────────────────

/**
 * Dark to light, index 0 the outline. Taken from the Pumpkin Head sheet
 * (hat/Pumpkin_head.png) so the pumpkin you carve is the one you wear, with
 * one in-between tone added for the larger canvas.
 */
const SKIN = ["#0a0808", "#563226", "#8f492a", "#b5582c", "#d86830", "#f09548", "#f6b16a"];
const SPECULAR = "#efd081";

/**
 * The body, as on the sheet: rounder than it is wide by only a little (43x38
 * there), a dip at the top where the stalk sits and a small one underneath.
 */
const BODY = { cx: 64, cy: 76, rx: 49, ry: 43 } as const;

/**
 * The ribs, as the sine of their longitude: one down the middle, then two
 * each side, the same five creases the sheet draws (columns 6, 14, 21, 28, 36
 * of its 43). Between two ribs, a lobe bulges.
 */
const RIBS = [-0.72, -0.33, 0, 0.33, 0.72];

/**
 * Light from the upper left but mostly from the front: the sheet is lit flat
 * and bright, and the face sits low on the pumpkin, so a raking light put the
 * whole carving area in shadow.
 */
const LIGHT = (() => {
  const v = [-0.42, -0.48, 0.77];
  const n = Math.hypot(v[0], v[1], v[2]);
  return v.map((c) => c / n);
})();

function inside(x: number, y: number): boolean {
  const u = (x - BODY.cx) / BODY.rx, v = (y - BODY.cy) / BODY.ry;
  if (u * u + v * v > 1) return false;
  if (((x - 64) / 10) ** 2 + ((y - 31) / 5) ** 2 < 1) return false;
  if (((x - 64) / 6) ** 2 + ((y - 121) / 3.5) ** 2 < 1) return false;
  return true;
}

/** Paints the uncarved pumpkin, pixel by pixel, onto a 128x128 context. */
export function paintPumpkin(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, ART, ART);
  for (let y = 0; y < ART; y++) {
    for (let x = 0; x < ART; x++) {
      const px = x + 0.5, py = y + 0.5;
      if (!inside(px, py)) continue;
      // A crisp dark outline wherever a neighbour is outside.
      if (!inside(px - 1, py) || !inside(px + 1, py) || !inside(px, py - 1) || !inside(px, py + 1)) {
        ctx.fillStyle = SKIN[0];
        ctx.fillRect(x, y, 1, 1);
        continue;
      }
      // Where this pixel sits on the round body: v up and down, u across the
      // row (the sine of its longitude), so the ribs curve in toward the top
      // and the bottom the way meridians do on a ball.
      const v = (py - BODY.cy) / BODY.ry;
      const half = BODY.rx * Math.sqrt(Math.max(0.0001, 1 - v * v));
      const u = (px - BODY.cx) / half;
      // Nearest rib on each side, and how far across the lobe between them.
      let lo = -1, hi = 1;
      for (const r of RIBS) {
        if (r <= u) lo = r;
        if (r > u) { hi = r; break; }
      }
      const t = ((u - lo) / (hi - lo)) * 2 - 1; // -1 at the left rib, 1 at the right
      const ribPx = Math.min(Math.abs(u - lo), Math.abs(hi - u)) * half;
      // Normal: the ball's, tilted sideways by the lobe's own bulge.
      let nx = (px - BODY.cx) / BODY.rx + t * 0.32;
      let ny = v;
      const r = Math.hypot(nx, ny);
      if (r > 0.97) { nx *= 0.97 / r; ny *= 0.97 / r; }
      const nz = Math.sqrt(1 - nx * nx - ny * ny);
      const lambert = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
      const crease = lo > -1 || hi < 1 ? Math.max(0, 1 - ribPx / 1.6) : 0;
      const ground = Math.max(0, (v - 0.65) / 0.35);
      const shade = 0.36 + 0.66 * lambert - 0.5 * crease - 0.14 * ground;
      const spec = lambert > 0.94 && crease < 0.1 && Math.abs(t) < 0.6;
      // A softer dither than the old pumpkin's: the sheet is mostly flat colour.
      const idx = Math.max(1, Math.min(SKIN.length - 1, Math.floor(shade * (SKIN.length - 1) + dither(x, y) * 0.6 - 0.1)));
      ctx.fillStyle = spec && dither(x, y) > 0.45 ? SPECULAR : SKIN[idx];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  paintStem(ctx);
}

/** A short stalk leaning right out of the dip, in the sheet's two greens. */
function paintStem(ctx: CanvasRenderingContext2D): void {
  // Rows top to bottom: [x start, y, width].
  const rows: [number, number, number][] = [
    [65, 23, 6], [64, 24, 7], [63, 25, 6], [62, 26, 6], [62, 27, 6], [61, 28, 7],
    [61, 29, 7], [61, 30, 7], [60, 31, 8], [60, 32, 8], [59, 33, 9], [59, 34, 9], [58, 35, 11],
  ];
  for (const [x0, y, w] of rows) {
    for (let i = 0; i < w; i++) {
      const edge = i === 0 || i === w - 1;
      ctx.fillStyle = edge ? "#0a0808" : i === 1 ? "#7fd36b" : i < w / 2 ? "#38a244" : "#416549";
      ctx.fillRect(x0 + i, y, 1, 1);
    }
  }
  // The cut top of the stalk.
  ctx.fillStyle = "#a9e29a";
  ctx.fillRect(66, 22, 4, 1);
  ctx.fillStyle = "#0a0808";
  ctx.fillRect(65, 22, 1, 1);
  ctx.fillRect(70, 22, 1, 1);
}

// ─── Pattern ─────────────────────────────────────────────────────────────────

/**
 * The pattern as a dashed pixel line, visible the whole carve. Dark marker on
 * the orange, like a stencil. Shapes already popped out are skipped: their
 * line is gone with the piece.
 */
export function paintGuide(ctx: CanvasRenderingContext2D, opened: readonly boolean[]): void {
  ctx.clearRect(0, 0, ART, ART);
  ctx.fillStyle = "#2a0d02";
  sampleOutline(PATTERN).forEach((p, i) => {
    if (opened[p.shape]) return;
    if (Math.floor(i / 2) % 2 === 0) ctx.fillRect(Math.floor(p.x), Math.floor(p.y), 1, 1);
  });
}

// ─── Cuts ────────────────────────────────────────────────────────────────────

/** A knife slit: dark in the middle, the cut flesh catching the light below it. */
export const CUT_SLIT = "#1a0702";
export const CUT_FLESH = "#ffd88f";

/**
 * Stamps one point of a cut. Two layers so a later stamp's dark slit never
 * buries an earlier stamp's bright edge the wrong way round: the flesh layer
 * is composited first, the slits on top.
 */
export function stampCut(flesh: CanvasRenderingContext2D, slit: CanvasRenderingContext2D, x: number, y: number): void {
  const px = Math.floor(x), py = Math.floor(y);
  flesh.fillRect(px, py + 1, 2, 1);
  slit.fillRect(px, py, 2, 1);
  slit.fillRect(px, py - 1, 1, 1);
}

// ─── Hollows ─────────────────────────────────────────────────────────────────

const HOLLOW_DARK = "#140501";
const WALL_LIT = "#e9a24a";
const WALL_SHADE = "#7a3510";
/**
 * The pixels inside each mask, listed once. The candle repaints the holes
 * about ten times a second, and walking the full 128x128 mask of every shape
 * each time was 65k checks per shape for a few hundred pixels.
 */
const maskPixels = new WeakMap<Uint8Array, Int32Array>();
function pixelsOf(mask: Uint8Array): Int32Array {
  let list = maskPixels.get(mask);
  if (!list) {
    const out: number[] = [];
    for (let i = 0; i < mask.length; i++) if (mask[i]) out.push(i);
    list = Int32Array.from(out);
    maskPixels.set(mask, list);
  }
  return list;
}

/** Candle light, dim to bright. */
const FLAME = ["#4a1600", "#8a3204", "#d16a0c", "#ff9e1f", "#ffcf3f", "#fff3b0"];

/**
 * Paints the holes left by the pieces that are out. Unlit, the inside is dark
 * with the pumpkin's wall showing on the far side of each hole. Lit (0..1),
 * the candle fills them, brightest near the middle of the face, and `flicker`
 * makes it breathe.
 */
export function paintHollows(
  ctx: CanvasRenderingContext2D,
  masks: readonly Uint8Array[],
  opened: readonly boolean[],
  lit = 0,
  flicker = 0,
): void {
  ctx.clearRect(0, 0, ART, ART);
  masks.forEach((mask, s) => {
    if (!opened[s]) return;
    for (const i of pixelsOf(mask)) {
      const x = i % ART, y = (i / ART) | 0;
      const top = y > 0 && !mask[i - ART];
      const left = x > 0 && !mask[i - 1];
      let color: string;
      if (lit > 0) {
        // Brightest at the candle, behind the nose.
        const d = Math.hypot(x - 64, (y - 78) * 1.3) / 48;
        const b = lit * (0.95 - d * 0.7 + flicker * 0.18) + (top || left ? -0.15 : 0);
        const k = Math.max(0, Math.min(FLAME.length - 1, Math.floor(b * FLAME.length + dither(x, y) - 0.5)));
        color = FLAME[k];
      } else {
        // The far wall shows under the top and left edges of the hole.
        color = top ? WALL_LIT : left ? WALL_SHADE : HOLLOW_DARK;
      }
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  });
}

/** A mask as an alpha image, for cutting pieces out with canvas compositing. */
export function maskCanvas(mask: Uint8Array): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = ART;
  c.height = ART;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(ART, ART);
  for (let i = 0; i < mask.length; i++) if (mask[i]) img.data[i * 4 + 3] = 255;
  ctx.putImageData(img, 0, 0);
  return c;
}

// ─── Review ──────────────────────────────────────────────────────────────────

/**
 * After the meter: where the carve went wrong, in red. Slipped cuts and the
 * stretches of pattern nobody cut. The pattern never changes, so this is what
 * the next attempt is for.
 */
export function paintReview(ctx: CanvasRenderingContext2D, score: CarveScore): void {
  ctx.clearRect(0, 0, ART, ART);
  ctx.fillStyle = "#ff3b5c";
  for (const p of score.slips) ctx.fillRect(Math.floor(p.x), Math.floor(p.y), 1, 1);
  for (const p of score.missed()) ctx.fillRect(Math.floor(p.x), Math.floor(p.y), 1, 1);
}

// ─── Knife ───────────────────────────────────────────────────────────────────

/** Where the tip sits inside the knife sprite. */
export const KNIFE_TIP = { x: 2, y: 21 } as const;

/**
 * A carving knife at 45 degrees, tip at the bottom left, handle up and right,
 * built from distances along and across its own axis so it stays crisp.
 */
export function makeKnife(offLine = false): HTMLCanvasElement {
  const S = 24;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d")!;
  const color = (x: number, y: number): string | null => {
    const dx = x - KNIFE_TIP.x, dy = y - KNIFE_TIP.y;
    const a = (dx - dy) / Math.SQRT2; // along the knife, from the tip
    const p = (dx + dy) / Math.SQRT2; // across it, positive toward the edge
    if (a < 0) return null;
    if (a <= 11) {
      const w = Math.min(1.7, 0.5 + a * 0.3);
      if (Math.abs(p) > w) return null;
      // Off the line the blade goes red: the cut it is making is a slip.
      if (offLine) return p > 0.55 ? "#9a1f35" : p < -0.55 ? "#ffd0d6" : "#ff6b81";
      return p > 0.55 ? "#5b6573" : p < -0.55 ? "#f4f8fc" : "#b9c3d0";
    }
    if (a <= 12.6) return Math.abs(p) <= 2.6 ? "#3a3f4a" : null;
    if (a <= 20.5) {
      if (Math.abs(p) > 1.5) return null;
      if (Math.abs(p) < 0.6 && (Math.abs(a - 15) < 0.6 || Math.abs(a - 18.5) < 0.6)) return "#e8cc84";
      return p > 0.6 ? "#4a2812" : "#7d4624";
    }
    return null;
  };
  const filled = new Uint8Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const col = color(x + 0.5, y + 0.5);
    if (!col) continue;
    filled[y * S + x] = 1;
    ctx.fillStyle = col;
    ctx.fillRect(x, y, 1, 1);
  }
  // A 1px dark outline so the knife reads on bright orange and on the dark.
  ctx.fillStyle = "#120c08";
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (filled[y * S + x]) continue;
    const n = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < S && yy < S && filled[yy * S + xx];
    if (n(x - 1, y) || n(x + 1, y) || n(x, y - 1) || n(x, y + 1)) ctx.fillRect(x, y, 1, 1);
  }
  return c;
}
