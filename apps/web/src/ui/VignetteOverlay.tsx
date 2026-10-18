"use client";

import { useEffect, useRef, useState } from "react";
import { VIGNETTES, vignetteSheetUrl, type VignetteId } from "@/game/vignettes/vignettes";
import { octagonFrame } from "@/ui/chamfer";
import { useEscape } from "@/ui/useEscape";

/**
 * The square in the middle of the screen that plays a vignette: petting the
 * Caramel Dog, drinking DOM's tea. It loops a few times and closes itself.
 *
 * Drawn on a canvas rather than as a stepped CSS background because the frame
 * width is read off the image: a sheet is one row of frames at whatever size
 * the artist drew, and nothing here has to be told which.
 */

/** The framed square's inner size. The art is scaled to fit by whole pixels. */
const BOX = 288;

export default function VignetteOverlay(
  { id, onClose }: { id: VignetteId; onClose: () => void },
) {
  const vignette = VIGNETTES[id];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  /**
   * A press that STARTED on this backdrop, which is the only kind allowed to
   * close it.
   *
   * The tap that opened the square is not a tap on the square. ACT fires on
   * pointerdown, so this mounts under the finger that is still down, and the
   * browser then sends that gesture's trailing `click` to whatever is under
   * the finger when it lifts — which is now this backdrop. Where the browser
   * does not retarget that click to the button holding pointer capture, the
   * square opened and shut inside one tap, and the only way to see the dog at
   * all was to keep ACT held down: exactly the report, and exactly why it
   * depended on the device.
   *
   * A trailing click has no pointerdown of its own here, so requiring one is
   * the whole fix. No timer to tune, and holding ACT no longer behaves
   * differently from tapping it.
   */
  const pressedHere = useRef(false);
  useEscape(onClose);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let timer: number | null = null;
    let cancelled = false;

    const image = new Image();
    image.src = vignetteSheetUrl(vignette);

    image.onerror = () => {
      // No art, no animation. Closing beats holding an empty square open.
      if (!cancelled) setFailed(true);
    };

    image.onload = () => {
      if (cancelled) return;
      const fw = Math.floor(image.naturalWidth / vignette.frames);
      const fh = image.naturalHeight;
      if (fw < 1 || fh < 1) { setFailed(true); return; }

      // Rounded UP, not down: a sheet whose frame doesn't divide BOX evenly
      // (113px frames into a 288px box, here) left a visible gap of bare
      // frame around it at the floor scale. Ceiling it instead draws past
      // BOX, and the canvas's own CSS max-width/height (below) scales that
      // back down to fill the box edge to edge — a much smaller, one-off
      // softening than the gap it replaces.
      const scale = Math.max(1, Math.ceil(BOX / Math.max(fw, fh)));
      canvas.width = fw * scale;
      canvas.height = fh * scale;
      ctx.imageSmoothingEnabled = false;

      let step = 0;
      const total = vignette.frames * vignette.loops;

      const draw = () => {
        const frame = step % vignette.frames;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(
          image,
          frame * fw, 0, fw, fh,
          0, 0, canvas.width, canvas.height,
        );
      };

      draw();
      timer = window.setInterval(() => {
        step++;
        if (step >= total) {
          if (timer !== null) window.clearInterval(timer);
          timer = null;
          onClose();
          return;
        }
        draw();
      }, vignette.frameMs);
    };

    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
      image.onload = null;
      image.onerror = null;
    };
  }, [onClose, vignette]);

  // A sheet that will not load closes on the next tick rather than mid-render.
  useEffect(() => {
    if (!failed) return;
    const id = window.setTimeout(onClose, 0);
    return () => window.clearTimeout(id);
  }, [failed, onClose]);

  if (failed) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 60,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(6,6,18,0.55)",
      }}
      // A stuck sheet should never trap the player in here — but only a press
      // that began on the backdrop counts (see pressedHere).
      onPointerDown={() => { pressedHere.current = true; }}
      onClick={() => { if (pressedHere.current) onClose(); }}
    >
      <div style={{ ...octagonFrame(1), background: "rgba(8,10,30,0.98)" }}>
        {/* Square box, art centred in it whatever shape the frames are. */}
        <div style={{
          width: BOX, height: BOX, maxWidth: "70vw", maxHeight: "70vw",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <canvas
            ref={canvasRef}
            style={{ imageRendering: "pixelated", maxWidth: "100%", maxHeight: "100%" }}
          />
        </div>
      </div>
    </div>
  );
}
