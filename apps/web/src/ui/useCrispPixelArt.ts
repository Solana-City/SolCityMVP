"use client";

/**
 * Decides, per element, whether the interface's pixel art is drawn crisp or
 * smooth. It changes NOTHING else — no sizes, no positions.
 *
 * Nearest-neighbour scaling ("pixelated") is only correct when a source pixel
 * covers a whole number of device pixels. At 1.25 or 1.5 device pixels per
 * source pixel it gives some rows of a sprite two screen pixels and their
 * neighbours one, which is the tearing players reported in the HUD. Smoothing
 * spreads that unevenness instead: slightly soft, never chewed.
 *
 * An earlier version tried to fix the SIZES instead, snapping each icon to
 * the nearest size that lands whole. That was the wrong lever twice over: it
 * made the layout depend on the screen's pixel ratio (a few pixels of growth
 * pushed the zoom control's + button out of its row on a 125% display, while
 * the same build looked fine on a colleague's 100% one), and it could not
 * touch the pieces that are not <img> at all — the profile picture is a CSS
 * background, and it kept tearing.
 *
 * What is crisp on which screen is therefore a property of the SCREEN:
 *   - a whole ratio (1, 2, 3): pixel art can be crisp, and only an <img>
 *     whose displayed size is not a whole multiple or fraction of its file
 *     needs smoothing;
 *   - a fractional ratio (1.25, 1.5, 1.75): nothing in the DOM can land on
 *     whole device pixels short of sizing every element in fractions of a
 *     CSS pixel, so everything pixel-art is smoothed.
 *
 * Making the HUD crisp on those screens is a design change, not a runtime
 * one: the art is 32x32 and the panels ask for 20, 22, 24 and 26 CSS pixels.
 * See SPRITE_REQUESTS.md.
 */
import { useEffect } from "react";
import { devicePixelRatioSafe } from "./crispPixels";

/** Elements that declare pixel art: every image, plus inline-styled boxes. */
const SELECTOR = 'img, [style*="pixelated"], [style*="crisp-edges"]';

function isPixelArt(el: HTMLElement): boolean {
  const rendering = getComputedStyle(el).imageRendering;
  return rendering === "pixelated" || rendering === "crisp-edges";
}

/** True when this image's displayed size lands its pixels whole. */
function imageLandsWhole(img: HTMLImageElement, dpr: number): boolean {
  if (!img.naturalWidth) return true; // not loaded yet: decide on the next sweep
  const width = img.clientWidth;
  if (!width) return true;
  const ratio = (width * dpr) / img.naturalWidth;
  const nearest = ratio >= 1 ? Math.round(ratio) : 1 / Math.max(1, Math.round(1 / ratio));
  return Math.abs(ratio - nearest) < 0.01;
}

export function useCrispPixelArt(): void {
  useEffect(() => {
    let frame = 0;

    const sweep = () => {
      frame = 0;
      const dpr = devicePixelRatioSafe();
      const wholeScreen = Math.abs(dpr - Math.round(dpr)) < 0.01;

      for (const node of Array.from(document.querySelectorAll<HTMLElement>(SELECTOR))) {
        // Restore first, or an element can never go back to crisp after the
        // window moves to a screen with a different ratio.
        if (node.dataset.pixelSmoothed === "1") {
          node.style.imageRendering = "";
          delete node.dataset.pixelSmoothed;
        }
        if (!isPixelArt(node)) continue;

        const smooth = !wholeScreen
          || (node instanceof HTMLImageElement && !imageLandsWhole(node, dpr));
        if (!smooth) continue;

        node.style.imageRendering = "auto";
        node.dataset.pixelSmoothed = "1";
      }
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(sweep);
    };

    schedule();

    // New panels, icons that finish loading after their panel rendered, and
    // anything React swaps in.
    //
    // Two filters, because this observer watches the whole body subtree and
    // the sweep behind it runs a querySelectorAll plus a getComputedStyle per
    // match — and the HUD re-renders constantly while the player stands still
    // (the transaction feed alone ticks a few times a second even closed).
    //
    // 1. Only element nodes can carry pixel art, so a batch that moved nothing
    //    but text is dropped without scheduling anything.
    // 2. Leading-edge throttle: the first mutation after a quiet spell sweeps
    //    on the next frame as before, so a panel opening never shows a frame
    //    of wrongly-smoothed art. A burst after that is collapsed into one
    //    trailing sweep instead of one per frame.
    const QUIET_MS = 200;
    let lastSweep = -Infinity;
    let trailing: ReturnType<typeof setTimeout> | null = null;
    const onMutations = (records: MutationRecord[]) => {
      let touchedElements = false;
      for (const r of records) {
        for (const n of Array.from(r.addedNodes)) {
          if (n.nodeType === Node.ELEMENT_NODE) { touchedElements = true; break; }
        }
        if (touchedElements) break;
      }
      if (!touchedElements) return;

      const now = performance.now();
      if (now - lastSweep >= QUIET_MS) {
        lastSweep = now;
        schedule();
        return;
      }
      if (trailing) return;
      trailing = setTimeout(() => {
        trailing = null;
        lastSweep = performance.now();
        schedule();
      }, QUIET_MS - (now - lastSweep));
    };

    const observer = new MutationObserver(onMutations);
    observer.observe(document.body, { childList: true, subtree: true });

    // Moving a window between screens changes the ratio under our feet.
    window.addEventListener("resize", schedule);
    document.addEventListener("load", schedule, true);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (trailing) clearTimeout(trailing);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("load", schedule, true);
    };
  }, []);
}
