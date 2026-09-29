"use client";

/**
 * Pixel art in the DOM, sized so it does not crack.
 *
 * Same rule as the game canvas (see game/config/zoomConfig): a source pixel
 * has to cover a whole number of DEVICE pixels, or nearest-neighbour scaling
 * gives some rows two screen pixels and their neighbours one. In CSS that is
 * easy to get wrong, because a size is written in CSS pixels and the screen
 * may be at 1.25 or 1.5 device pixels to the CSS pixel — Windows at 125% and
 * 150%, which is exactly where the 2026-09-27 playtest saw the interface
 * tear while the same art looked fine on a retina laptop.
 *
 * `crispSize` takes the size a layout wants and returns the nearest size that
 * lands whole. It can only ever move by a fraction of a pixel, so layouts do
 * not shift; and it never returns zero.
 */

export function devicePixelRatioSafe(): number {
  if (typeof window === "undefined") return 1;
  return Math.min(Math.max(window.devicePixelRatio || 1, 1), 4);
}

/**
 * The nearest CSS size to `desiredCss` at which `sourcePx` source pixels each
 * cover a whole number of device pixels.
 *
 * Scaling UP snaps to an integer multiple; scaling DOWN snaps to an integer
 * divisor, since those are the only ratios that keep every source pixel the
 * same size on screen.
 */
export function crispSize(sourcePx: number, desiredCss: number): number {
  const dpr = devicePixelRatioSafe();
  if (sourcePx <= 0 || desiredCss <= 0) return desiredCss;
  const ratio = (desiredCss * dpr) / sourcePx; // device px per source px
  const snapped = ratio >= 1
    ? Math.max(1, Math.round(ratio))
    : 1 / Math.max(1, Math.round(1 / ratio));
  return (sourcePx * snapped) / dpr;
}

/**
 * Like `crispSize`, but never SMALLER than what was asked for.
 *
 * For a box that crops a sheet — a portrait showing frame 0 of a 4x4 walk
 * grid — rounding the frame down leaves the bottom of the box past the end of
 * that frame, and what shows through is the top of the frame below it. That
 * is the second head players saw under the character on the connect screen,
 * on any machine whose ratio made the rounding go down (Windows at 125%).
 */
export function crispSizeAtLeast(sourcePx: number, minCss: number): number {
  const dpr = devicePixelRatioSafe();
  if (sourcePx <= 0 || minCss <= 0) return minCss;
  const ratio = (minCss * dpr) / sourcePx;
  const snapped = ratio >= 1
    ? Math.ceil(ratio)
    : 1 / Math.max(1, Math.floor(1 / ratio));
  return (sourcePx * snapped) / dpr;
}

/** True while the screen would resample pixel art at a fraction. */
export function wouldCrack(sourcePx: number, cssSize: number): boolean {
  const dpr = devicePixelRatioSafe();
  const ratio = (cssSize * dpr) / sourcePx;
  const nearest = ratio >= 1 ? Math.round(ratio) : 1 / Math.round(1 / ratio);
  return Math.abs(ratio - nearest) > 0.001;
}
