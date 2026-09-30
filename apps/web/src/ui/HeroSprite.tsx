"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The animated banner behind the login screen.
 *
 * The art is one row of frames (Aseprite's default export), scaled up to fill
 * the panel the sidebar leaves over. The scene is composed around its centre,
 * so the panel being narrower than the frame costs nothing: it is centred and
 * the sides are clipped, which is the deal the panel has always had with the
 * still image it replaces.
 *
 * Two details worth keeping:
 *
 * The frame element stays at the sheet's NATURAL size and is blown up with a
 * transform, rather than being sized to the panel with a background stretched
 * to match. At this zoom (a 200px frame over ~2000px of screen) the second
 * shape asks the browser to rasterize a background some 69,000px wide, which
 * is hundreds of megabytes it has no reason to spend. The transform keeps the
 * raster at 200x100 and hands the scaling to the compositor.
 *
 * The scale is rounded up to a whole number so every source pixel lands on
 * the same number of screen pixels. A fractional scale makes some pixels a
 * row wider than their neighbours, which reads as a shimmer on art this
 * chunky, and rounding UP keeps the panel covered.
 */

const SHEET = "/assets/branding/city-hero-anim.png";
const FRAMES = 32;
const FRAME_MS = 75;

export default function HeroSprite({ className }: { className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  /** Natural sheet size, known only once it has loaded. Null = not yet. */
  const [sheet, setSheet] = useState<{ w: number; h: number } | null>(null);

  // Load the sheet before showing it. The still image stays up until this
  // resolves, so a slow connection sees the old screen rather than an empty
  // one, and a sheet that fails to load leaves the old screen alone.
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setSheet({ w: img.naturalWidth, h: img.naturalHeight });
      }
    };
    img.src = SHEET;
    return () => { img.onload = null; };
  }, []);

  // Cover the panel: scale by whichever axis is short, and re-fit whenever the
  // panel changes size — the window resizing, and the sidebar reflowing under
  // it at the 820px breakpoint.
  useEffect(() => {
    const box = boxRef.current;
    const layer = layerRef.current;
    if (!box || !layer || !sheet) return;
    const frameW = sheet.w / FRAMES;
    const fit = () => {
      const { width, height } = box.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const scale = Math.max(width / frameW, height / sheet.h);
      layer.style.setProperty("--sc-hero-scale", String(Math.ceil(scale)));
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
            .sc-hero-anim {
              position: absolute; top: 50%; left: 50%;
              width: ${frameW}px; height: ${sheet.h}px;
              background-image: url(${SHEET});
              background-repeat: no-repeat;
              background-size: ${sheet.w}px ${sheet.h}px;
              image-rendering: pixelated;
              transform-origin: 50% 50%;
              transform: translate(-50%, -50%) scale(var(--sc-hero-scale, 1));
              animation:
                sc-hero-run ${FRAMES * FRAME_MS}ms steps(${FRAMES}) infinite,
                sc-hero-in 420ms ease-out both;
            }
            /* steps() with the default jump-end lands on 0, -1, ... -(N-1)
               frames and never on the sheet's end, so the loop is seamless. */
            @keyframes sc-hero-run {
              from { background-position-x: 0; }
              to   { background-position-x: -${sheet.w}px; }
            }
            @keyframes sc-hero-in { from { opacity: 0; } to { opacity: 1; } }
            @media (prefers-reduced-motion: reduce) {
              .sc-hero-anim { animation: sc-hero-in 420ms ease-out both; }
            }
          `}</style>
          <div ref={layerRef} className="sc-hero-anim" aria-hidden="true" />
        </>
      )}
    </div>
  );
}
