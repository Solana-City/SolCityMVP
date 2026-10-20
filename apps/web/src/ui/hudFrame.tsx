"use client";

import type { CSSProperties, ReactNode } from "react";
import { PixelImg } from "@/ui/PixelIcons";
import { useButtonFeel, feelStyle } from "@/ui/useButtonFeel";

/**
 * The shell a HUD card is drawn in: the panel art, the square frame button and
 * the arrow that points at a collapse.
 *
 * These lived inside WhereIsNPCCard, which was fine while the hunt was the only
 * card that sat on the HUD rather than opening as a modal. The quest card is
 * the second, and two copies of a border-image incantation drift the moment one
 * of them is tuned. Moved here unchanged, so the hunt looks exactly as it did.
 */

/** "Press Start 2P", the pixel face every HUD surface uses. */
export const PIX = '"Press Start 2P", monospace';

/** The lime the HUD accents with, and the muted grey it pairs with. */
export const HUD_ACCENT = "#B7E928";
export const HUD_MUTED = "#9a9ab5";
export const HUD_TEXT = "#d0d0f0";

/**
 * The desktop card's border: the panel art at its full 20px, which leaves
 * content inside the art's teal band.
 */
export const PANEL_FRAME: CSSProperties = {
  borderWidth: 20, borderStyle: "solid", borderColor: "transparent",
  borderImage: "url(/assets/branding/ui/frame-panel-test.png) 64 fill / 20px / 0 round",
  imageRendering: "pixelated",
};

/**
 * The same art at half size with a 5px layout border: content starts where the
 * teal band ends instead of a whole band further in, which is what keeps a
 * mobile panel short enough to leave the city visible behind it.
 */
export const THIN_FRAME: CSSProperties = {
  borderWidth: 5, borderStyle: "solid", borderColor: "transparent",
  borderImage: "url(/assets/branding/ui/frame-panel-test.png) 64 fill / 10px / 0 round",
  imageRendering: "pixelated",
};

/** A square button on the frame-button art. */
export function FrameBtn({ size, title, onClick, children }: {
  size: number; title: string; onClick: () => void; children: ReactNode;
}) {
  const feel = useButtonFeel();
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      {...feel.handlers}
      title={title} aria-label={title}
      style={{
        backgroundImage: "url(/assets/ui/icon_frame_btn.png)", backgroundSize: "100% 100%",
        imageRendering: "pixelated", border: "none",
        width: size, height: size, padding: 0, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
        ...feelStyle(feel),
      }}
    >
      {children}
    </button>
  );
}

/** The down-arrow art turned to point left (collapse) or right (expand). */
export function Arrow({ dir }: { dir: "left" | "right" | "down" | "up" }) {
  const deg = dir === "left" ? 90 : dir === "right" ? -90 : dir === "up" ? 180 : 0;
  return (
    <PixelImg
      src="/assets/ui/icon_down1.png"
      size={12}
      style={deg ? { transform: `rotate(${deg}deg)` } : undefined}
    />
  );
}
