"use client";

/**
 * Keeps every pixel-art image in the interface on whole device pixels.
 *
 * The HUD art is 64x64 and the panels ask for it at 20, 22, 24 CSS pixels —
 * ratios of 0.31, 0.34, 0.375. None of those divide a source pixel evenly, so
 * nearest-neighbour scaling drops some rows of the sprite and doubles others,
 * on EVERY screen, not only the fractional-DPI ones. That is the distortion
 * the 2026-09-27 playtest kept seeing in the interface after the canvas
 * itself was fixed.
 *
 * Sizing each call site by hand would fix it once and rot immediately: the
 * HUD gains icons weekly, and every new one would have to remember the rule.
 * So this normalises them where they are: it finds images the stylesheet
 * marks as pixel art, reads the size the layout gave them, and nudges each to
 * the nearest size at which its source pixels land whole — at most a pixel of
 * movement, in exchange for the art being drawn as drawn.
 *
 * Call once, from the client root.
 */
import { useEffect } from "react";
import { crispSize, devicePixelRatioSafe } from "./crispPixels";

/** What we last set on an element, to avoid reacting to our own change. */
const applied = new WeakMap<HTMLImageElement, number>();

function isPixelArt(img: HTMLImageElement): boolean {
  const rendering = getComputedStyle(img).imageRendering;
  return rendering === "pixelated" || rendering === "crisp-edges";
}

/**
 * How far an icon may be nudged to land on the grid. Beyond this the layout
 * would visibly shift, which is worse than the problem: a 22px icon whose
 * nearest crisp sizes are 16 and 32 does not want to be either.
 */
const MAX_NUDGE = 0.15;

function snap(img: HTMLImageElement): void {
  if (!img.naturalWidth || !img.naturalHeight) return;
  if (!isPixelArt(img)) return;

  const width = img.clientWidth;
  if (!width) return;
  if (applied.get(img) === width) return;

  const target = crispSize(img.naturalWidth, width);
  if (Math.abs(target - width) < 0.01) { applied.set(img, width); return; }

  if (Math.abs(target - width) / width <= MAX_NUDGE) {
    // Close enough to move: height follows the same ratio, so a non-square
    // source keeps its shape.
    const ratio = img.naturalHeight / img.naturalWidth;
    img.style.width = `${target}px`;
    img.style.height = `${target * ratio}px`;
    applied.set(img, target);
    return;
  }

  // Too far to move without shifting the layout. Stop pretending the art is
  // on the grid and let the browser resample it properly: an evenly soft icon
  // reads as intended, where nearest neighbour at 0.69 of a pixel eats whole
  // rows of it. Same trade the canvas makes at its in-between zoom steps.
  img.style.imageRendering = "auto";
  applied.set(img, width);
}

export function useCrispPixelArt(): void {
  useEffect(() => {
    let frame = 0;
    const sweep = () => {
      frame = 0;
      for (const img of Array.from(document.images)) snap(img);
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(sweep);
    };

    schedule();

    // New panels, new icons, and images that finish loading after their panel
    // rendered all arrive as mutations.
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });

    // Moving a window between screens changes the ratio under our feet.
    const onResize = () => {
      // The snapped sizes were computed for the old ratio; drop them so the
      // sweep recomputes rather than seeing its own numbers and stopping.
      for (const img of Array.from(document.images)) applied.delete(img);
      schedule();
    };
    window.addEventListener("resize", onResize);
    const media = window.matchMedia(`(resolution: ${devicePixelRatioSafe()}dppx)`);
    media.addEventListener("change", onResize);

    document.addEventListener("load", schedule, true);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      media.removeEventListener("change", onResize);
      document.removeEventListener("load", schedule, true);
    };
  }, []);
}
