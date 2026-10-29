"use client";

import type { CSSProperties, ReactNode } from "react";
import { FRAME_SHEET, FRAME_GEOMETRY, type TileKind } from "@/game/collections/seasons";

/**
 * A collectible in its frame: the drawn border, its animated background, and
 * the item itself sitting in the middle.
 *
 * ── Why the item is a child and not a prop ──────────────────────────────
 *
 * The two surfaces that use this draw their items differently. The wardrobe
 * reads a sprite sheet through a canvas, keys out its background and zooms to
 * the item's own ink box; the pack reveal has already done that work and
 * holds the result. Taking a ReactNode lets both hand over whatever they
 * already have, and keeps this file about the frame.
 *
 * ── Why the item is sized here and not by the caller ────────────────────
 *
 * Where the item goes is a property of the ART: the window is a measured
 * rectangle inside a 64x64 cell, and the item fills a fixed share of it. A
 * caller passing its own size would be guessing at numbers that live in
 * FRAME_GEOMETRY, and the first one to guess differently would be the one
 * tile in the grid that looks wrong.
 *
 * So the caller says how big the whole card is, and the child is told how big
 * it may be through `innerSize(size)`, which both surfaces call.
 */
export function RarityFrame({ kind, size, children, style }: {
  /** Null for an item with no rarity at all. It gets no frame: a free shirt
   *  is not a collectible, and framing one would say it was. */
  kind: TileKind | null | undefined;
  /** The whole card, in CSS pixels. The art inside scales with it. */
  size: number;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  const { cell, cells, loopMs } = FRAME_GEOMETRY;
  if (!kind) return <>{children}</>;

  const inner = innerSize(size);
  const { x, y, w, h } = FRAME_GEOMETRY.window;
  // The window's centre, in the card's pixels, so the item is centred on the
  // lit area rather than on the card: the two differ, because the border is
  // not the same thickness top and bottom.
  const cx = size * (x + w / 2) / cell;
  const cy = size * (y + h / 2) / cell;

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        backgroundImage: `url("${FRAME_SHEET[kind]}")`,
        backgroundSize: `${size * cells}px ${size}px`,
        backgroundRepeat: "no-repeat",
        imageRendering: "pixelated",
        // The strip is walked one cell at a time and wraps at its full width,
        // the same way the pack art rolls.
        ["--roll" as string]: `-${size * cells}px`,
        animation: `rarity-frame-roll ${(loopMs / 1000).toFixed(2)}s steps(${cells}) infinite`,
        ...style,
      }}
    >
      <div style={{
        position: "absolute",
        left: cx - inner / 2,
        top: cy - inner / 2,
        width: inner,
        height: inner,
        // The frame rolls; what is in it must not. Without this the item
        // inherits the animation and slides out of the window.
        animation: "none",
      }}>
        {children}
      </div>
    </div>
  );
}

/**
 * How big the item may be drawn inside a card of `size`.
 *
 * A square, because every surface that draws an item draws it into a square.
 * It is the shorter side of the window times `fill`, so a wide item never
 * runs past the border on the side the window is tightest.
 */
export function innerSize(size: number): number {
  const { cell, window: win, fill } = FRAME_GEOMETRY;
  return Math.round(size * Math.min(win.w, win.h) * fill / cell);
}
