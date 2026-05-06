"use client";

import { useState, useEffect } from "react";
import type { NPCDefinition } from "@/game/config/npcRegistry";

interface NPCPortraitProps {
  npc: NPCDefinition;
  size?: number;
  /**
   * Render variant:
   *  - "frame": large standalone VN-style portrait (card with name plate).
   *  - "avatar": compact square used inside lists or headers.
   */
  variant?: "frame" | "avatar";
}

/**
 * Renders an NPC portrait with a graceful fallback:
 *   1. If `npc.portrait` is set AND the image loads → show the PNG.
 *   2. Otherwise → render a colored tile with the NPC's initial.
 *
 * Pixel art is preserved via `image-rendering: pixelated`, so any PNG
 * authored at a lower resolution (e.g. 64x64) stays crisp when scaled.
 */
export default function NPCPortrait({
  npc,
  size = 128,
  variant = "frame",
}: NPCPortraitProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const color = `#${npc.color.toString(16).padStart(6, "0")}`;

  useEffect(() => {
    setImageFailed(false);
  }, [npc.id]);

  // No portrait defined — render nothing; callers should not show the area at all.
  if (!npc.portrait) return null;

  const showImage = !imageFailed;

  if (variant === "avatar") {
    return (
      <div
        className="rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0"
        style={{
          width: size,
          height: size,
          background: `${color}22`,
          border: `2px solid ${color}`,
          color,
          fontSize: size * 0.45,
          fontWeight: "bold",
          fontFamily: '"Press Start 2P", monospace',
        }}
      >
        {showImage ? (
          <img
            src={npc.portrait}
            alt={npc.name}
            width={size}
            height={size}
            onError={() => setImageFailed(true)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              imageRendering: "pixelated",
            }}
          />
        ) : (
          <span>{npc.name[0]}</span>
        )}
      </div>
    );
  }

  // frame variant: VN-style card with glow and name plate
  return (
    <div
      className="flex flex-col items-center"
      style={{
        width: size,
        // Drop shadow tinted with NPC color gives a subtle "spotlight" look
        filter: `drop-shadow(0 0 12px ${color}55)`,
      }}
    >
      <div
        className="rounded-xl overflow-hidden flex items-center justify-center"
        style={{
          width: size,
          height: size,
          background: "rgba(10,10,30,0.95)",
          border: `2px solid ${color}`,
          boxShadow: `inset 0 0 0 1px ${color}33`,
        }}
      >
        {showImage ? (
          <img
            src={npc.portrait}
            alt={npc.name}
            width={size}
            height={size}
            onError={() => setImageFailed(true)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              imageRendering: "pixelated",
            }}
          />
        ) : (
          <span
            style={{
              color,
              fontSize: size * 0.45,
              fontFamily: '"Press Start 2P", monospace',
              fontWeight: "bold",
            }}
          >
            {npc.name[0]}
          </span>
        )}
      </div>

      {/* Name plate */}
      <div
        className="mt-2 px-3 py-1 rounded-md w-full text-center"
        style={{
          background: "rgba(10,10,30,0.95)",
          border: `1px solid ${color}`,
          fontFamily: '"Press Start 2P", monospace',
          fontSize: "8px",
          color,
          letterSpacing: "0.05em",
        }}
      >
        {npc.name}
      </div>
    </div>
  );
}
