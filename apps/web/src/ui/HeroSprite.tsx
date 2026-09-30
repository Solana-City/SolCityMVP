"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The animated banner behind the login screen.
 *
 * The art is one row of frames (Aseprite's default export) at 200x100 each,
 * which is a banner, not a backdrop: the panel the sidebar leaves over is
 * around 1250x900, so filling it outright means blowing a 100px-tall frame up
 * ten times. That was the first cut of this, and it read as a zoom-in — the
 * fountain filled the panel and the pool it stands in was off both edges.
 *
 * So the frame is fitted to the panel's WIDTH instead, which is a third less
 * zoom and keeps the whole scene, and the height it does not reach is filled
 * with the flat night blue of the art's own top row. That colour is a single
 * value across the sheet, so the join is invisible and the sky simply carries
 * on up. The frame sits on the panel's floor: when there is less room than it
 * needs, the sky is what gets cropped, never the water or the fountain.
 *
 * Two details worth keeping:
 *
 * The frame element stays at the sheet's NATURAL size and is blown up with a
 * transform, rather than being sized to the panel with a background stretched
 * to match. The second shape asks the browser to rasterize a background some
 * 45,000px wide, which is hundreds of megabytes for art that is 34KB on disk.
 * The transform keeps the raster at 200x100 and hands the scaling to the
 * compositor.
 *
 * The scale is a whole number, so every source pixel covers the same number
 * of screen pixels. A fractional scale leaves some pixels a row wider than
 * their neighbours, which reads as a shimmer on art this chunky.
 */

const SHEET = "/assets/branding/city-hero-anim.png";
const FRAMES = 32;
const FRAME_MS = 75;

/**
 * Least of the panel's height the art is allowed to occupy. Fitting the width
 * is the right call for the panel shapes this screen actually gets (roughly
 * 4:3 down to 1:1), but a narrow enough window would leave the banner a strip
 * at the bottom under a wall of empty sky. Past this point it scales up and
 * pays for it at the sides instead.
 */
const MIN_HEIGHT_FILL = 0.55;

/** Used only if the sheet's own sky colour can't be read: the page's own blue. */
const SKY_FALLBACK = "#07152E";

/**
 * The art's top row, which is flat sky — the colour the panel is padded with
 * above the frame. Read off the sheet rather than hardcoded so redrawing the
 * art at a different time of day doesn't leave a band of the old sky behind.
 */
function readSkyColor(img: HTMLImageElement): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return SKY_FALLBACK;
    ctx.drawImage(img, 0, 0, 1, 1, 0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return SKY_FALLBACK;
  }
}

interface Sheet { w: number; h: number; sky: string }

export default function HeroSprite({ className }: { className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  /** Known only once the sheet has loaded. Null = still the still image. */
  const [sheet, setSheet] = useState<Sheet | null>(null);

  // Load the sheet before showing it. The still image stays up until this
  // resolves, so a slow connection sees the old screen rather than an empty
  // one, and a sheet that fails to load leaves the old screen alone.
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setSheet({ w: img.naturalWidth, h: img.naturalHeight, sky: readSkyColor(img) });
      }
    };
    img.src = SHEET;
    return () => { img.onload = null; };
  }, []);

  // Re-fit whenever the panel changes size: the window resizing, and the
  // sidebar reflowing under it at the 820px breakpoint.
  useEffect(() => {
    const box = boxRef.current;
    const layer = layerRef.current;
    if (!box || !layer || !sheet) return;
    const frameW = sheet.w / FRAMES;
    const fit = () => {
      const { width, height } = box.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const scale = Math.max(
        Math.ceil(width / frameW),
        Math.ceil((height * MIN_HEIGHT_FILL) / sheet.h),
      );
      layer.style.setProperty("--sc-hero-scale", String(scale));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, [sheet]);

  const frameW = sheet ? sheet.w / FRAMES : 0;

  return (
    <div ref={boxRef} className={className} style={{ position: "relative", overflow: "hidden" }}>
      {sheet && (
        <>
          <style>{`
            .sc-hero-stage {
              position: absolute; inset: 0;
              background: ${sheet.sky};
              animation: sc-hero-in 420ms ease-out both;
            }
            .sc-hero-anim {
              position: absolute; left: 50%; bottom: 0;
              width: ${frameW}px; height: ${sheet.h}px;
              background-image: url(${SHEET});
              background-repeat: no-repeat;
              background-size: ${sheet.w}px ${sheet.h}px;
              image-rendering: pixelated;
              transform-origin: 50% 100%;
              transform: translateX(-50%) scale(var(--sc-hero-scale, 1));
              animation: sc-hero-run ${FRAMES * FRAME_MS}ms steps(${FRAMES}) infinite;
            }
            /* steps() with the default jump-end lands on frames 0..N-1 and
               never on the sheet's end, so the loop is seamless. */
            @keyframes sc-hero-run {
              from { background-position-x: 0; }
              to   { background-position-x: -${sheet.w}px; }
            }
            @keyframes sc-hero-in { from { opacity: 0; } to { opacity: 1; } }
            @media (prefers-reduced-motion: reduce) {
              .sc-hero-anim { animation: none; }
            }
          `}</style>
          <div className="sc-hero-stage" aria-hidden="true">
            <div ref={layerRef} className="sc-hero-anim" />
          </div>
        </>
      )}
    </div>
  );
}
