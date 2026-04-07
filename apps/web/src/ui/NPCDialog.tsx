"use client";

import { useState, useCallback, useEffect } from "react";
import type { NPCDefinition, NPCAction } from "@/game/config/npcRegistry";

interface NPCDialogProps {
  npc: NPCDefinition | null;
  onClose: () => void;
  onAction: (action: NPCAction) => void;
}

export default function NPCDialog({ npc, onClose, onAction }: NPCDialogProps) {
  const [lineIndex, setLineIndex] = useState(0);

  // Reset dialog line when NPC changes
  useEffect(() => {
    setLineIndex(0);
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
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 w-full max-w-lg"
      style={{ fontFamily: '"Fira Code", monospace' }}
    >
      <div
        className="rounded-xl p-4"
        style={{
          background: "rgba(10,10,30,0.95)",
          border: `2px solid ${color}`,
          backdropFilter: "blur(4px)",
        }}
      >
        {/* NPC header */}
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold"
            style={{
              background: `${color}22`,
              border: `2px solid ${color}`,
              color: color,
            }}
          >
            {npc.name[0]}
          </div>
          <div>
            <div
              className="text-sm font-bold"
              style={{
                fontFamily: '"Press Start 2P", monospace',
                fontSize: "10px",
                color: color,
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
            className="ml-auto text-lg cursor-pointer"
            style={{
              background: "none",
              border: "none",
              color: "#555566",
            }}
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
        <div className="flex justify-between items-center">
          <span className="text-xs" style={{ color: "#444455" }}>
            {isLastLine ? "[E] Action" : "[E] Continue"} · [ESC] Close
          </span>
          {isLastLine && (
            <button
              onClick={() => onAction(npc.action)}
              className="px-4 py-2 rounded-lg text-xs cursor-pointer transition-colors"
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
  );
}
