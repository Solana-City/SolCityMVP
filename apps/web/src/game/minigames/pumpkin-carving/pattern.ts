/**
 * Pumpkin Carving: the pattern, the knife's rules and the scoring. No canvas,
 * no React, so all of it is testable on its own.
 *
 * Everything is in ART pixels: the pumpkin is a 128x128 pixel-art canvas that
 * CSS scales up with `image-rendering: pixelated`, and pointer positions are
 * mapped into the same space, so a cut and the line it is meant to follow are
 * measured in the same units whatever the screen size.
 */

export const ART = 128;

/** How long a carve lasts once the first cut lands. */
export const CARVE_SECONDS = 60;
/** Accuracy (0-100) that counts as a clean carve and pays the reward. */
export const PASS_ACCURACY = 80;
/**
 * How far, in art pixels, a cut may sit from the line and still be on it: the
 * main difficulty knob, together with PASS_ACCURACY and KNIFE_SPEED.
 *
 * Tuned 2026-10-20 against a simulated wobbly hand (sines on the true path).
 * At 3.5 a wobble of about 5 art px still passed, which is ~13 screen px on a
 * desktop pumpkin, and the first playtest called it easy. At 2.5 a wobble of
 * ~3 px passes at about 85% and ~3.6 px fails at about 74%.
 *
 * A finger gets half a pixel more. It hides the very line it is cutting, and
 * the pumpkin is smaller on a landscape phone (~300 css px against ~360), so
 * 3.0 art px there is about the same margin on screen as 2.5 on a desktop.
 */
export const TOLERANCE = { mouse: 2.5, touch: 3 } as const;
/**
 * The knife is heavy: its tip follows the pointer at most this fast, in art px
 * per second. Drag slowly and it is exactly under the pointer. Rush a corner
 * and the tip cuts straight across toward where the pointer already is, off
 * the line. That is the skill the clock leans on: careful costs time.
 *
 * Tuned 2026-10-20 by simulating a hand that traces the 401 px outline at a
 * steady speed with a small wobble. At 45 the whole face took ~10s, so the
 * minute never mattered. At 25 a flawless steady trace takes ~16s (a real hand
 * with corners and corrections, two to three times that), and a hand running
 * 1.4x ahead of the knife drops to 66-82%, about 2x to ~40%.
 */
export const KNIFE_SPEED = 25;
/** Share of a shape's outline that has to be cut before the piece pops out. */
export const SHAPE_DONE = 0.92;

export type Pt = readonly [number, number];

/**
 * The cut lines: closed shapes, fixed, the same every run. Knowing the
 * pattern is part of the skill, so it is never randomised.
 *
 * The Pumpkin Head's face (hat/Pumpkin_head.png): its angry brows, its
 * arrowhead nose, its grin curling up at the corners. Two things are not the
 * sheet's, on purpose. The face sits in the middle of the pumpkin rather than
 * low on it, and the grin keeps the jagged row of teeth along its top: the
 * sheet's smooth grin carved in a few seconds, and the teeth are where a
 * hurried knife rounds a corner off and loses points.
 */
export const PATTERN: readonly (readonly Pt[])[] = [
  // Eyes: high at the outside, sloping down toward the nose, closing in a
  // point underneath.
  [[32, 50], [57, 61], [47, 70]],
  [[96, 50], [71, 61], [81, 70]],
  // Nose: a little arrowhead pointing up, notched underneath.
  [[64, 64], [71, 78], [64, 74], [57, 78]],
  // Mouth: six teeth hanging from a zigzag top, two square ones standing on
  // the bottom, and the corners curling up.
  [[27, 80], [34, 86], [40, 91], [46, 86], [52, 92], [58, 87], [64, 93], [70, 87], [76, 92], [82, 86], [88, 91], [94, 86], [101, 80],
   [98, 90], [90, 98], [84, 102], [83, 96], [77, 96], [75, 105], [53, 105], [51, 96], [45, 96], [44, 102], [38, 98], [30, 90]],
];

export interface Sample { x: number; y: number; shape: number }

/** One point per `step` art px along every line of the pattern. */
export function sampleOutline(shapes: readonly (readonly Pt[])[], step = 1): Sample[] {
  const out: Sample[] = [];
  shapes.forEach((shape, s) => {
    for (let i = 0; i < shape.length; i++) {
      const [x0, y0] = shape[i];
      const [x1, y1] = shape[(i + 1) % shape.length];
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
      for (let k = 0; k < n; k++) out.push({ x: x0 + ((x1 - x0) * k) / n, y: y0 + ((y1 - y0) * k) / n, shape: s });
    }
  });
  return out;
}

/** Which pixels lie inside a shape (pixel centres, even-odd rule). */
export function shapeMask(shape: readonly Pt[]): Uint8Array {
  const mask = new Uint8Array(ART * ART);
  for (let y = 0; y < ART; y++) {
    const cy = y + 0.5;
    for (let x = 0; x < ART; x++) {
      const cx = x + 0.5;
      let inside = false;
      for (let i = 0, j = shape.length - 1; i < shape.length; j = i++) {
        const [xi, yi] = shape[i];
        const [xj, yj] = shape[j];
        if ((yi > cy) !== (yj > cy) && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) mask[y * ART + x] = 1;
    }
  }
  return mask;
}

/**
 * Running score of one carve.
 *
 * Accuracy is coverage times precision:
 * - coverage: how much of the pattern has a cut on it,
 * - precision: how much of what was cut sits on the pattern.
 * Tracing every line exactly scores 100. Skipping a shape costs coverage, and
 * scribbling over the whole pumpkin to cover it costs precision, so neither
 * shortcut gets near the pass mark.
 */
export class CarveScore {
  private readonly targets = sampleOutline(PATTERN);
  private readonly covered = new Uint8Array(this.targets.length);
  private readonly shapeTotal = new Array<number>(PATTERN.length).fill(0);
  private readonly shapeCovered = new Array<number>(PATTERN.length).fill(0);
  private coveredCount = 0;
  private cutSamples = 0;
  private onLine = 0;
  /** Cut points that missed every line: drawn red on the review. */
  readonly slips: { x: number; y: number }[] = [];

  constructor(private readonly tolerance: number = TOLERANCE.mouse) {
    for (const t of this.targets) this.shapeTotal[t.shape]++;
  }

  /** Feeds one cut point, already in art pixels. Returns whether it was on a line. */
  add(x: number, y: number): boolean {
    const t2 = this.tolerance * this.tolerance;
    let near = false;
    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i];
      const dx = t.x - x;
      const dy = t.y - y;
      if (dx * dx + dy * dy > t2) continue;
      near = true;
      if (!this.covered[i]) {
        this.covered[i] = 1;
        this.coveredCount++;
        this.shapeCovered[t.shape]++;
      }
    }
    this.cutSamples++;
    if (near) this.onLine++;
    else this.slips.push({ x, y });
    return near;
  }

  /** Points of the pattern no cut came near: drawn red on the review. */
  missed(): { x: number; y: number }[] {
    return this.targets.filter((_, i) => !this.covered[i]);
  }

  /** 0-1: how much of one shape's outline has been cut. */
  shapeCoverage(shape: number): number {
    return this.shapeCovered[shape] / this.shapeTotal[shape];
  }

  get coverage(): number { return this.coveredCount / this.targets.length; }
  get precision(): number { return this.cutSamples ? this.onLine / this.cutSamples : 0; }
  /** 0-100, whole numbers: this is also the board score. */
  get accuracy(): number { return Math.round(this.coverage * this.precision * 100); }
}

/** Calls `fn` at every art pixel along a segment, ends included. */
export function walkSegment(x0: number, y0: number, x1: number, y1: number, fn: (x: number, y: number) => void): void {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let k = 0; k <= n; k++) fn(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n);
}

/** One step of the heavy knife: where the tip is after `dt` seconds chasing `target`. */
export function stepKnife(
  tip: { x: number; y: number },
  target: { x: number; y: number },
  dt: number,
  speed = KNIFE_SPEED,
): { x: number; y: number } {
  const dx = target.x - tip.x;
  const dy = target.y - tip.y;
  const dist = Math.hypot(dx, dy);
  const reach = speed * dt;
  if (dist <= reach) return { x: target.x, y: target.y };
  return { x: tip.x + (dx / dist) * reach, y: tip.y + (dy / dist) * reach };
}
