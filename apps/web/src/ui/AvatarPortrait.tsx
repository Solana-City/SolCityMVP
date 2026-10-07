"use client";

import { useEffect, useRef, useState } from "react";
import {
  DIRECTION_ROW, LAYER_ORDER, SPRITE_FRAME_HEIGHT, SPRITE_FRAME_WIDTH,
  getVariant, loadSavedLoadout, type LayerCategory, type Loadout,
} from "@/game/config/paperDoll";
import { octagonFrame, octagonFrameThin, chamferClip } from "@/ui/chamfer";
import { devicePixelRatioSafe } from "@/ui/crispPixels";

/**
 * The player's OWN character, composited from their equipped paper-doll layers
 * and cropped to a portrait.
 *
 * This is the one place that draws it. The expression wheel shows the head
 * once per expression (with the expression sheet standing in for the eyes),
 * and the HUD and profile show the bust, so the compositing - chroma key,
 * hair under hat masking, the crops - lives here instead of being copied per
 * surface.
 */

const CHROMA_R = 215, CHROMA_G = 123, CHROMA_B = 186, CHROMA_TOL = 30;

/**
 * What to take out of the 64px down-facing frame.
 *
 * "head" is hat to neck, tight to the face: the expression wheel's job is to
 * show which face you are about to pull, so anything below the chin is noise.
 *
 * "bust" is the portrait, cut at the waist, and sized off what the art
 * actually uses: hats reach x9..55 (the Viking horns are the widest thing in
 * the set), the t-shirt and the Jetpack bottom out at y49 and y50. 52 square
 * clears all of that, leaves the character centred with a little air at the
 * sides, and takes the first rows of the pants with it so the body runs to
 * the bottom edge instead of floating.
 */
export const CROPS = {
  head: { x: 14, y: 0, w: 36, h: 36 },
  bust: { x:  6, y: 0, w: 52, h: 52 },
} as const;

export type CropName = keyof typeof CROPS;

function removeChroma(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const d = ctx.getImageData(0, 0, w, h);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    if (
      Math.abs(px[i]   - CHROMA_R) <= CHROMA_TOL &&
      Math.abs(px[i+1] - CHROMA_G) <= CHROMA_TOL &&
      Math.abs(px[i+2] - CHROMA_B) <= CHROMA_TOL
    ) px[i+3] = 0;
  }
  ctx.putImageData(d, 0, 0);
}

interface DrawOptions {
  /** How much of the character to show. Default: the head. */
  crop?: CropName;
  /**
   * Sheet to draw as the eyes instead of the loadout's own face - the
   * expression wheel passes one per node. Omitted: the player's own face.
   */
  expressionFile?: string;
  /**
   * Scale the head smoothly instead of nearest-neighbour. Same rule the rest
   * of the interface follows (see useCrispPixelArt): nearest-neighbour is only
   * right when a source pixel covers a whole number of device pixels, and when
   * it does not, soft beats chewed.
   */
  smooth?: boolean;
}

/** Composites the character described by `loadout`, filling `canvas`. */
export function drawAvatarPortrait(canvas: HTMLCanvasElement, loadout: Loadout, opts: DrawOptions = {}): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = opts.smooth ?? false;
  const crop = CROPS[opts.crop ?? "head"];
  const rowY = DIRECTION_ROW.down * SPRITE_FRAME_HEIGHT;

  const layerFiles: Array<{ cat: LayerCategory; file: string }> = [];
  for (const cat of LAYER_ORDER) {
    if (cat === "eyesFace" && opts.expressionFile) {
      layerFiles.push({ cat, file: opts.expressionFile });
      continue;
    }
    const id = loadout[cat];
    if (!id) continue;
    const v = getVariant(cat, id);
    if (v) layerFiles.push({ cat, file: v.file });
  }

  let loaded = 0;
  const imgs: Array<{ img: HTMLImageElement; cat: LayerCategory }> = [];
  const hatVariant = getVariant("hat", loadout.hat);

  const draw = () => {
    const offByCat = new Map<LayerCategory, HTMLCanvasElement>();
    for (const { img, cat } of imgs) {
      if (!img.naturalWidth) continue;   // failed to load: skip that layer
      const off = document.createElement("canvas");
      off.width = img.naturalWidth; off.height = img.naturalHeight;
      // willReadFrequently: every one of these canvases is read back, first by
      // removeChroma and then (for hair/hat) by the masking pass below. Without
      // the hint the browser keeps the surface on the GPU and each getImageData
      // pays a readback stall - expensive on the mobile Canvas2D renderer. The
      // flag has to go on the FIRST getContext call for a canvas: later calls
      // return the same context and silently ignore their options.
      const oc = off.getContext("2d", { willReadFrequently: true })!;
      oc.drawImage(img, 0, 0);
      removeChroma(oc, img.naturalWidth, img.naturalHeight);
      offByCat.set(cat, off);
    }

    // Hair under hat masking. Three styles (LayerVariant.hatCoverage):
    //   "full" (default) - per-column cutoff from the hat's own silhouette;
    //   "band" - mask only where the band's own pixels are opaque, so the
    //     crown above it stays visible;
    //   "suppress" - a full head covering (Ninja): hide the hair outright
    //     rather than leave a sliver showing past the mask's edges.
    const hatOff = offByCat.get("hat");
    const hairOff = offByCat.get("hair");
    if (hatOff && hairOff && hatVariant?.hatCoverage === "suppress") {
      hairOff.getContext("2d")!.clearRect(0, rowY, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT);
    } else if (hatOff && hairOff) {
      const hatData = hatOff.getContext("2d")!.getImageData(0, rowY, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT).data;
      const hairCtx = hairOff.getContext("2d")!;
      const hairData = hairCtx.getImageData(0, rowY, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT);
      if (hatVariant?.hatCoverage === "band") {
        let masked = false;
        for (let i = 0; i < hatData.length; i += 4) {
          if (hatData[i + 3] > 10) { hairData.data[i + 3] = 0; masked = true; }
        }
        if (masked) hairCtx.putImageData(hairData, 0, rowY);
      } else {
        const cutoffs = new Array<number>(SPRITE_FRAME_WIDTH).fill(SPRITE_FRAME_HEIGHT);
        for (let x = 0; x < SPRITE_FRAME_WIDTH; x++) {
          for (let y = 0; y < SPRITE_FRAME_HEIGHT; y++) {
            if (hatData[(y * SPRITE_FRAME_WIDTH + x) * 4 + 3] > 10) { cutoffs[x] = y; break; }
          }
        }
        if (cutoffs.some(c => c < SPRITE_FRAME_HEIGHT)) {
          for (let x = 0; x < SPRITE_FRAME_WIDTH; x++) {
            for (let y = 0; y < cutoffs[x]; y++) hairData.data[(y * SPRITE_FRAME_WIDTH + x) * 4 + 3] = 0;
          }
          hairCtx.putImageData(hairData, 0, rowY);
        }
      }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const { cat } of imgs) {
      const off = offByCat.get(cat);
      if (!off) continue;
      ctx.drawImage(off, crop.x, rowY + crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
    }
  };

  for (const { cat, file } of layerFiles) {
    const img = new Image();
    img.src = `/assets/sprites/paperdoll/${file}`;
    imgs.push({ img, cat });
    img.onload = () => { loaded++; if (loaded === imgs.length) draw(); };
    img.onerror = () => { loaded++; if (loaded === imgs.length) draw(); };
  }
}

/**
 * The saved loadout, kept current. Changing an outfit anywhere (the wardrobe,
 * the hair specialist) announces it on the game bus, so a portrait is never
 * left showing a look the player already took off.
 */
export function useLiveLoadout(gameRef: Phaser.Game | null): Loadout | null {
  // Null until the first effect: localStorage is not readable while rendering
  // on the server, and a portrait is better absent for a frame than wrong.
  const [loadout, setLoadout] = useState<Loadout | null>(null);

  useEffect(() => { setLoadout(loadSavedLoadout()); }, []);

  useEffect(() => {
    if (!gameRef) return;
    const onLoadout = (next: Loadout) => setLoadout({ ...next });
    gameRef.events.on("wardrobe:loadout", onLoadout);
    return () => { gameRef.events.off("wardrobe:loadout", onLoadout); };
  }, [gameRef]);

  return loadout;
}

/**
 * Ring weights the portrait can wear, and the corner the box is cut to so the
 * fill behind the ring does not poke out of it.
 */
const FRAMES = {
  thin: { ring: 4,  corner: 3.6, style: octagonFrameThin() },
  1:    { ring: 9,  corner: 8,   style: octagonFrame(1) },
  2:    { ring: 18, corner: 16,  style: octagonFrame(2) },
} as const;

/**
 * The player's character inside the octagon frame: the picture that stands
 * for them in the HUD and at the top of their profile.
 *
 * The art is 52 pixels of bust (see CROPS), so it is shown at a WHOLE
 * multiple of that and centred in the ring, rather than stretched to whatever
 * the box happens to be: a fractional size gives some rows of a pixel two
 * screen pixels and their neighbours one, which is the tearing the HUD art
 * was fixed for. What the picture does not use is frame and fill, not mangled
 * art. A box too small for even 1x shrinks it smoothly instead, since it is
 * blowing art UP unevenly that chews it.
 *
 * So pick `size` to leave the crop room inside the ring: for the bust that is
 * 60 with the thin ring, 70 with ring 1, 88 with ring 2.
 */
export function AvatarPortrait({
  loadout, size, crop = "bust", frame = 1, title, fill = "rgba(8,12,32,0.95)",
}: {
  /**
   * Whose character this is. The player's own comes from useLiveLoadout;
   * another player's rides along with their position (OnChainPlayer.loadout).
   * Null leaves the frame empty rather than showing a stand-in wearing
   * something they are not.
   */
  loadout: Loadout | null;
  /** Total size including the frame. */
  size: number;
  /** How much of the character to show. Default: the bust. */
  crop?: CropName;
  /** Ring weight: "thin" is 4px, 1 a 9px ring, 2 the native 18px. */
  frame?: keyof typeof FRAMES;
  title?: string;
  fill?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Read on the client only, and again if the window moves to another screen
  // (a 100% and a 150% monitor side by side is common).
  const [dpr, setDpr] = useState(1);
  useEffect(() => {
    const read = () => setDpr(devicePixelRatioSafe());
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  const { ring, corner, style } = FRAMES[frame];
  const source = CROPS[crop].w;
  const inside = size - 2 * ring;
  // The picture's size on the page, which stays put whatever the screen is: a
  // layout that moved with the pixel ratio is the mistake useCrispPixelArt
  // was written to undo.
  const scale = Math.floor(inside / source);
  const artCss = scale >= 1 ? source * scale : inside;
  // ...while the canvas behind it is at the screen's own resolution.
  const px = Math.max(1, Math.round(artCss * dpr));
  const wholeDpr = Math.abs(dpr - Math.round(dpr)) < 0.01;
  const smooth = scale < 1 || !wholeDpr;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !loadout) return;
    canvas.width = px;
    canvas.height = px;
    drawAvatarPortrait(canvas, loadout, { crop, smooth });
  }, [loadout, crop, px, smooth]);

  return (
    <span
      title={title}
      style={{
        position: "relative", display: "flex", flexShrink: 0,
        alignItems: "center", justifyContent: "center",
        width: size, height: size, background: fill,
        clipPath: chamferClip(corner),
      }}
    >
      <canvas
        ref={ref}
        style={{
          display: "block", width: artCss, height: artCss,
          imageRendering: "pixelated",
        }}
      />
      {/* The ring last, so it sits over the art the way the photo frame did. */}
      <span aria-hidden="true" style={{ ...style, position: "absolute", inset: 0, pointerEvents: "none" }} />
    </span>
  );
}
