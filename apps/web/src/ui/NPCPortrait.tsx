"use client";

import { useCallback } from "react";
import type { NPCDefinition } from "@/game/config/npcRegistry";
import { CROPS, PortraitBox, removeChroma, type FrameWeight } from "@/ui/AvatarPortrait";

/**
 * An NPC's face for the dialog they open, cut from the sprite that is already
 * standing in front of the player. Nobody has to draw a portrait per NPC, and
 * one can never drift from the character in the city, because it IS them.
 *
 * The crop is the player's own bust (52 square, see CROPS), taken from the
 * first frame of the sheet - the standing, player-facing one on a walk grid,
 * and frame 0 of an idle loop otherwise.
 *
 * Anchoring: the sheets are a 64px grid with the character standing on the
 * bottom edge, so the bust is the top 52 rows of the LAST 64. On a 64px frame
 * that is just the top of the frame; on a taller one (Kite Pro's sheet is 97
 * so the kite has somewhere to fly) it skips the prop above the head and
 * still lands on the character.
 */

/** Where an NPC's sheet is served from (see BootScene, which loads the same). */
function sheetUrl(spriteKey: string): string {
  const file = spriteKey.startsWith("avatar-") ? spriteKey.slice("avatar-".length) : spriteKey;
  return `/assets/sprites/${encodeURIComponent(file)}.png`;
}

/** Cuts the bust out of `npc`'s sheet and fills `canvas` with it. */
function drawNPCBust(canvas: HTMLCanvasElement, npc: NPCDefinition, smooth: boolean): () => void {
  const ctx = canvas.getContext("2d");
  let cancelled = false;
  if (!ctx) return () => { cancelled = true; };

  const frameW = npc.spriteAnimation?.frameWidth ?? 64;
  const frameH = npc.spriteAnimation?.frameHeight ?? 64;
  const bust = CROPS.bust.w;
  const w = Math.min(bust, frameW);
  const h = Math.min(bust, frameH);
  const sx = Math.max(0, Math.round((frameW - w) / 2));
  const sy = Math.max(0, frameH - 64);

  const img = new Image();
  img.onload = () => {
    if (cancelled || !img.naturalWidth) return;
    // Cut first, at the art's own size, then blow the cut up: the chroma pass
    // then reads 52x52 instead of the whole sheet, and the scaling stays one
    // clean step.
    const off = document.createElement("canvas");
    off.width = w; off.height = h;
    // willReadFrequently: removeChroma reads this straight back, and the flag
    // only counts on a canvas's FIRST getContext.
    const oc = off.getContext("2d", { willReadFrequently: true })!;
    oc.imageSmoothingEnabled = false;
    oc.drawImage(img, sx, sy, w, h, 0, 0, w, h);
    // Most sheets ship transparent; a few (the Vietnamese Barista) carry the
    // paper-doll chroma background instead, which the game keys out on load.
    removeChroma(oc, w, h);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = smooth;
    ctx.drawImage(off, 0, 0, w, h, 0, 0, canvas.width, canvas.height);
  };
  img.src = sheetUrl(npc.spriteKey ?? "avatar-player");

  return () => { cancelled = true; };
}

export default function NPCPortrait({ npc, size, frame = 1 }: {
  npc: NPCDefinition;
  /** Total size including the frame. 70 shows the bust at 1x, 122 at 2x. */
  size: number;
  frame?: FrameWeight;
}) {
  const draw = useCallback(
    (canvas: HTMLCanvasElement, smooth: boolean) => drawNPCBust(canvas, npc, smooth),
    // The sheet and its frame size are all the drawing reads, and both are
    // fixed per NPC, so the identity of the definition object does not matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [npc.id],
  );
  return <PortraitBox size={size} source={CROPS.bust.w} frame={frame} draw={draw} />;
}
