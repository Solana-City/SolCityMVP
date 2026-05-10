"use client";

import { useState, useCallback, useEffect } from "react";
import type { NPCDefinition, NPCAction } from "@/game/config/npcRegistry";
import NPCPortrait from "./NPCPortrait";
import { profileManager } from "@/game/config/profileManager";

function useIsTouch() {
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    setIsTouch(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsTouch(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isTouch;
}

interface NPCDialogProps {
  npc: NPCDefinition | null;
  onClose: () => void;
  onAction: (action: NPCAction) => void;
}

export default function NPCDialog({ npc, onClose, onAction }: NPCDialogProps) {
  const [lineIndex, setLineIndex] = useState(0);
  const [portraitVisible, setPortraitVisible] = useState(false);
  const isTouch = useIsTouch();

  // Reset dialog state when NPC changes
  useEffect(() => {
    setLineIndex(0);
    setPortraitVisible(!!npc?.portrait);
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

  // ── Mobile layout: compact pill below the score HUD ──────────────────────
  if (isTouch) {
    return (
      <div
        onClick={handleAdvance}
        style={{
          position: "fixed",
          top: 96,                          // clears the score HUD (~70px + gap)
          left: 16,
          right: 16,
          zIndex: 30,
          fontFamily: '"Fira Code", monospace',
          background: "rgba(10,10,30,0.92)",
          border: `1px solid ${color}55`,
          borderLeft: `3px solid ${color}`,
          borderRadius: 10,
          padding: "8px 12px",
          backdropFilter: "blur(6px)",
          cursor: "pointer",
        }}
      >
        {/* Name + close */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{
            fontFamily: '"Press Start 2P", monospace',
            fontSize: "8px",
            color,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {npc.name}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            style={{ background: "none", border: "none", color: "#555566", fontSize: "16px", cursor: "pointer", padding: 0, lineHeight: 1 }}
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>

        {/* Dialog text */}
        <p style={{ fontSize: "11px", color: "#ccccdd", margin: 0, lineHeight: 1.5 }}>
          {npc.dialog[lineIndex]}
        </p>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
          <span style={{ fontSize: "9px", color: "#444455", animation: "tapPulse 1.5s ease-in-out infinite" }}>
            tap to continue ▶
          </span>
          {isLastLine && (
            <button
              onClick={(e) => { e.stopPropagation(); onAction(npc.action); }}
              style={{
                background: color,
                border: "none",
                color: "#000",
                fontFamily: '"Press Start 2P", monospace',
                fontSize: "7px",
                padding: "4px 10px",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              {npc.action.label.toUpperCase()}
            </button>
          )}
        </div>
        <style jsx>{`
          @keyframes tapPulse {
            0%, 100% { opacity: 0.35; }
            50% { opacity: 0.9; }
          }
        `}</style>
      </div>
    );
  }

  // ── Desktop layout: classic VN bubble, bottom-center ─────────────────────
  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-30 w-full max-w-2xl px-4"
      style={{ fontFamily: '"Fira Code", monospace', bottom: "96px" }}
    >
      <div className={`flex items-end ${portraitVisible ? "gap-4" : ""}`}>
        {portraitVisible && (
          <div className="mb-2">
            <NPCPortrait npc={npc} size={128} variant="frame" onError={() => setPortraitVisible(false)} />
          </div>
        )}

        <div
          className="relative rounded-xl p-4 flex-1"
          onClick={handleAdvance}
          style={{
            background: "rgba(10,10,30,0.95)",
            border: `2px solid ${color}`,
            backdropFilter: "blur(4px)",
            cursor: "pointer",
          }}
        >
          {portraitVisible && (
            <>
              <div
                className="absolute"
                style={{ left: -10, bottom: 28, width: 0, height: 0, borderTop: "8px solid transparent", borderBottom: "8px solid transparent", borderRight: `10px solid ${color}` }}
                aria-hidden
              />
              <div
                className="absolute"
                style={{ left: -7, bottom: 28, width: 0, height: 0, borderTop: "8px solid transparent", borderBottom: "8px solid transparent", borderRight: "10px solid rgba(10,10,30,0.95)" }}
                aria-hidden
              />
            </>
          )}

          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 min-w-0">
              <div style={{ fontFamily: '"Press Start 2P", monospace', fontSize: "10px", color }} className="font-bold truncate">
                {npc.name}
              </div>
              <div className="text-xs" style={{ color: "#777788" }}>{npc.role}</div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              className="text-lg cursor-pointer"
              style={{ background: "none", border: "none", color: "#555566" }}
              aria-label="Close dialog"
            >
              ×
            </button>
          </div>

          <p className="text-sm leading-relaxed mb-3" style={{ color: "#ccccdd", minHeight: "2.5em" }}>
            {npc.dialog[lineIndex]}
          </p>

          <div className="flex justify-between items-center gap-2">
            <span className="text-xs" style={{ color: "#444455" }}>
              {isLastLine ? "[E] Action" : "[E] Continue"} · [ESC] Close
            </span>
            {isLastLine && (
              <button
                onClick={(e) => { e.stopPropagation(); onAction(npc.action); }}
                className="px-4 py-2 rounded-lg cursor-pointer transition-colors"
                style={{ background: color, border: "none", color: "#000", fontFamily: '"Press Start 2P", monospace', fontSize: "8px" }}
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
