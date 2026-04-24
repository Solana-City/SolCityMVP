"use client";

import { useState, useCallback, useEffect } from "react";
import type { NPCDefinition, NPCAction } from "@/game/config/npcRegistry";
import NPCPortrait from "./NPCPortrait";
import { profileManager } from "@/game/config/profileManager";

interface NPCDialogProps {
  npc: NPCDefinition | null;
  onClose: () => void;
  onAction: (action: NPCAction) => void;
}

export default function NPCDialog({ npc, onClose, onAction }: NPCDialogProps) {
  const [lineIndex, setLineIndex] = useState(0);

  // Reset dialog line when NPC changes, and mark the NPC as visited
  // (first-time vs. return is surfaced via the progression bus).
  useEffect(() => {
    setLineIndex(0);
    if (npc) {
      profileManager.visitNPC(npc.id, npc.name);
    }
  }, [npc?.id]);

  const handleAdvance = useCallback(() => {
    if (!npc) return;
    if (lineIndex < npc.dialog.length - 1) {
      setLineIndex((i) => i + 1);
    } else {
      onAction(npc.action);
    }
  }, [npc, lineIndex, onAction]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!npc) return;
      if (e.key === "e" || e.key === "E" || e.key === "Enter") {
        e.preventDefault();
        handleAdvance();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [npc, handleAdvance, onClose]);

  if (!npc) return null;

  const isLastLine = lineIndex >= npc.dialog.length - 1;
  const color = `#${npc.color.toString(16).padStart(6, "0")}`;

  return (
    <div
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 w-full max-w-2xl px-4"
      style={{ fontFamily: '"Fira Code", monospace' }}
    >
      <div className="flex items-end gap-4">
        {/* VN-style portrait — hidden on narrow screens, shown on sm+ */}
        <div className="hidden sm:block mb-2">
          <NPCPortrait npc={npc} size={128} variant="frame" />
        </div>

        {/* Speech bubble */}
        <div
          className="relative rounded-xl p-4 flex-1"
          style={{
            background: "rgba(10,10,30,0.95)",
            border: `2px solid ${color}`,
            backdropFilter: "blur(4px)",
          }}
        >
          {/* Speech tail pointing toward the portrait (visible on sm+ only).
              Two-layer triangle: outer in NPC color acts as border, inner in
              bubble background color "hides" the overlap — crisp beveled tail. */}
          <div
            className="hidden sm:block absolute"
            style={{
              left: -10,
              bottom: 28,
              width: 0,
              height: 0,
              borderTop: "8px solid transparent",
              borderBottom: "8px solid transparent",
              borderRight: `10px solid ${color}`,
            }}
            aria-hidden
          />
          <div
            className="hidden sm:block absolute"
            style={{
              left: -7,
              bottom: 28,
              width: 0,
              height: 0,
              borderTop: "8px solid transparent",
              borderBottom: "8px solid transparent",
              borderRight: "10px solid rgba(10,10,30,0.95)",
            }}
            aria-hidden
          />

          {/* Compact header: avatar (mobile fallback) + name/role + close */}
          <div className="flex items-center gap-3 mb-3">
            {/* On mobile, show the compact avatar here since the frame is hidden */}
            <div className="sm:hidden">
              <NPCPortrait npc={npc} size={40} variant="avatar" />
            </div>
            <div className="flex-1 min-w-0">
              <div
                className="font-bold truncate"
                style={{
                  fontFamily: '"Press Start 2P", monospace',
                  fontSize: "10px",
                  color,
                }}
              >
                {npc.name}
              </div>
              <div className="text-xs" style={{ color: "#777788" }}>
                {npc.role}
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-lg cursor-pointer"
              style={{
                background: "none",
                border: "none",
                color: "#555566",
              }}
              aria-label="Close dialog"
            >
              ×
            </button>
          </div>

          {/* Dialog text */}
          <p
            className="text-sm leading-relaxed mb-3"
            style={{ color: "#ccccdd", minHeight: "2.5em" }}
          >
            {npc.dialog[lineIndex]}
          </p>

          {/* Action hint */}
          <div className="flex justify-between items-center gap-2">
            <span className="text-xs" style={{ color: "#444455" }}>
              {isLastLine ? "[E] Action" : "[E] Continue"} · [ESC] Close
            </span>
            {isLastLine && (
              <button
                onClick={() => onAction(npc.action)}
                className="px-4 py-2 rounded-lg cursor-pointer transition-colors"
                style={{
                  background: color,
                  border: "none",
                  color: "#000000",
                  fontFamily: '"Press Start 2P", monospace',
                  fontSize: "8px",
                }}
              >
                {npc.action.label.toUpperCase()}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
