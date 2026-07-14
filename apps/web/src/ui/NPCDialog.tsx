"use client";

import { useState, useCallback, useEffect, useRef } from "react";
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

/** ms per character — lower = faster typewriter */
const CHAR_DELAY = 22;

interface NPCDialogProps {
  npc: NPCDefinition | null;
  onClose: () => void;
  onAction: (action: NPCAction) => void;
}

export default function NPCDialog({ npc, onClose, onAction }: NPCDialogProps) {
  const [lineIndex, setLineIndex]         = useState(0);
  const [portraitVisible, setPortraitVisible] = useState(false);
  const [displayText, setDisplayText]     = useState("");
  const [isTyping, setIsTyping]           = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isTouch = useIsTouch();

  // Reset when NPC changes
  useEffect(() => {
    setLineIndex(0);
    setPortraitVisible(!!npc?.portrait);
    if (npc) profileManager.visitNPC(npc.id, npc.name);
  }, [npc?.id]);

  // Typewriter animation — re-runs whenever line changes
  useEffect(() => {
    if (!npc) return;
    const text = npc.dialog[lineIndex] ?? "";
    setDisplayText("");
    setIsTyping(true);
    let i = 0;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      i++;
      setDisplayText(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(timerRef.current!);
        timerRef.current = null;
        setIsTyping(false);
      }
    }, CHAR_DELAY);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [npc?.id, lineIndex]);

  /** First tap/click skips animation; second advances to next line (or triggers action). */
  const skipOrAdvance = useCallback(() => {
    if (!npc) return;
    if (isTyping) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      setDisplayText(npc.dialog[lineIndex] ?? "");
      setIsTyping(false);
      return;
    }
    if (lineIndex < npc.dialog.length - 1) {
      setLineIndex((i) => i + 1);
    } else {
      onAction(npc.action);
    }
  }, [npc, lineIndex, isTyping, onAction]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!npc) return;
      if (e.key === "e" || e.key === "E" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        skipOrAdvance();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [npc, skipOrAdvance, onClose]);

  if (!npc) return null;

  const isLastLine  = lineIndex >= npc.dialog.length - 1;
  const doneTyping  = !isTyping;
  const color       = `#${npc.color.toString(16).padStart(6, "0")}`;

  /** Dot row showing progress through dialog lines */
  const Dots = () => (
    <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
      {npc.dialog.map((_, i) => (
        <div
          key={i}
          style={{
            width:        i === lineIndex ? 8 : 6,
            height:       i === lineIndex ? 8 : 6,
            borderRadius: "50%",
            background:   i === lineIndex ? color
                        : i < lineIndex   ? `${color}66`
                                          : "#2a2a3a",
            transition: "all 0.2s",
          }}
        />
      ))}
    </div>
  );

  // ── Mobile layout ─────────────────────────────────────────────────────────
  // Positioned at the bottom (classic RPG style). Portrait shown as compact
  // avatar. Larger text and touch targets than the previous pill design.
  if (isTouch) {
    return (
      <div
        onClick={skipOrAdvance}
        style={{
          position:     "fixed",
          bottom:       "calc(env(safe-area-inset-bottom, 0px) + 12px)",
          left:         "50%",
          transform:    "translateX(-50%)",
          width:        "calc(100vw - 20px)",
          maxWidth:     480,
          zIndex:       30,
          fontFamily:   '"Press Start 2P", monospace',
          background:   "rgba(8,8,24,0.96)",
          border:       `1px solid ${color}55`,
          borderTop:    `3px solid ${color}`,
          borderRadius: 14,
          padding:      "12px 14px 14px",
          backdropFilter: "blur(8px)",
          cursor:       "pointer",
          boxShadow:    `0 -4px 28px ${color}20`,
        }}
      >
        {/* Header: portrait + name/role + close */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          {portraitVisible && (
            <NPCPortrait
              npc={npc}
              size={52}
              variant="avatar"
              onError={() => setPortraitVisible(false)}
            />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily:    '"Press Start 2P", monospace',
              fontSize: "7px",
              color,
              overflow:      "hidden",
              textOverflow:  "ellipsis",
              whiteSpace:    "nowrap",
              marginBottom:  3,
            }}>
              {npc.name}
            </div>
            <div style={{ fontSize: "8px", color: "#5a5a72" }}>{npc.role}</div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            style={{
              background: "none", border: "none", color: "#5a5a72",
              fontSize: "17px", cursor: "pointer", padding: "0 4px",
              lineHeight: 1, flexShrink: 0, touchAction: "manipulation",
            }}
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>

        {/* Dialog text */}
        <p style={{
          fontSize: "10px",
          color:      "#d0d0e8",
          margin:     "0 0 12px",
          lineHeight: 1.65,
          minHeight:  "3.3em",
        }}>
          {displayText}
          {isTyping && (
            <span style={{ opacity: 0.5, animation: "cursorBlink 0.7s step-end infinite" }}>▌</span>
          )}
        </p>

        {/* Footer: progress dots + continue hint / action button */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Dots />
          {isLastLine && doneTyping ? (
            <button
              onClick={(e) => { e.stopPropagation(); onAction(npc.action); }}
              style={{
                background:  color,
                border:      "none",
                color:       "#000",
                fontFamily:  '"Press Start 2P", monospace',
                fontSize: "7px",
                padding:     "9px 16px",
                borderRadius: 8,
                cursor:      "pointer",
                fontWeight:  "bold",
                touchAction: "manipulation",
              }}
            >
              {npc.action.label.toUpperCase()}
            </button>
          ) : (
            <span style={{
              fontSize: "8px",
              color:     "#3a3a52",
              animation: doneTyping ? "tapPulse 1.4s ease-in-out infinite" : "none",
            }}>
              {doneTyping ? "tap to continue ▶" : "..."}
            </span>
          )}
        </div>

        <style jsx>{`
          @keyframes tapPulse {
            0%, 100% { opacity: 0.3; }
            50%       { opacity: 0.9; }
          }
          @keyframes cursorBlink {
            0%, 100% { opacity: 0.5; }
            50%       { opacity: 0; }
          }
        `}</style>
      </div>
    );
  }

  // ── Desktop layout ────────────────────────────────────────────────────────
  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-30 w-full max-w-2xl px-4"
      style={{ fontFamily: '"Press Start 2P", monospace', bottom: "96px" }}
    >
      <div className={`flex items-end ${portraitVisible ? "gap-5" : ""}`}>
        {portraitVisible && (
          <div className="mb-2 flex-shrink-0">
            <NPCPortrait
              npc={npc}
              size={160}
              variant="frame"
              onError={() => setPortraitVisible(false)}
            />
          </div>
        )}

        <div
          className="relative rounded-xl flex-1"
          onClick={skipOrAdvance}
          style={{
            background:     "rgba(8,8,24,0.96)",
            border:         `2px solid ${color}`,
            backdropFilter: "blur(6px)",
            cursor:         "pointer",
            boxShadow:      `0 0 36px ${color}20`,
          }}
        >
          {/* Bubble arrow pointing at portrait */}
          {portraitVisible && (
            <>
              <div className="absolute" style={{
                left: -12, bottom: 36, width: 0, height: 0,
                borderTop: "10px solid transparent",
                borderBottom: "10px solid transparent",
                borderRight: `12px solid ${color}`,
              }} aria-hidden />
              <div className="absolute" style={{
                left: -9, bottom: 36, width: 0, height: 0,
                borderTop: "10px solid transparent",
                borderBottom: "10px solid transparent",
                borderRight: "12px solid rgba(8,8,24,0.96)",
              }} aria-hidden />
            </>
          )}

          {/* Header */}
          <div style={{ padding: "14px 16px 0" }}>
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div style={{
                  fontFamily:   '"Press Start 2P", monospace',
                  fontSize: "8px",
                  color,
                  marginBottom: 4,
                }}>
                  {npc.name}
                </div>
                <div style={{ fontSize: "8px", color: "#5a5a72" }}>{npc.role}</div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                style={{
                  background: "none", border: "none", color: "#5a5a72",
                  fontSize: "16px", cursor: "pointer", padding: "2px 6px",
                  lineHeight: 1,
                }}
                aria-label="Close dialog"
              >
                ×
              </button>
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: `${color}2a`, margin: "10px 16px" }} />

          {/* Dialog text */}
          <p style={{
            fontSize: "11px",
            color:      "#d0d0e8",
            lineHeight: 1.7,
            minHeight:  "3.4em",
            margin:     0,
            padding:    "0 16px 14px",
          }}>
            {displayText}
            {isTyping && (
              <span style={{ opacity: 0.5, animation: "cursorBlink 0.7s step-end infinite" }}>▌</span>
            )}
          </p>

          {/* Footer */}
          <div style={{
            display:        "flex",
            justifyContent: "space-between",
            alignItems:     "center",
            padding:        "10px 16px 14px",
            borderTop:      `1px solid ${color}20`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <Dots />
              <span style={{ fontSize: "8px", color: "#3a3a52" }}>
                {isTyping ? "..." : isLastLine
                  ? "[E/Space] Action · [ESC] Close"
                  : "[E/Space] Continue · [ESC] Close"}
              </span>
            </div>
            {isLastLine && doneTyping && (
              <button
                onClick={(e) => { e.stopPropagation(); onAction(npc.action); }}
                style={{
                  background:  color,
                  border:      "none",
                  color:       "#000",
                  fontFamily:  '"Press Start 2P", monospace',
                  fontSize: "7px",
                  padding:     "10px 20px",
                  borderRadius: 8,
                  cursor:      "pointer",
                  fontWeight:  "bold",
                }}
              >
                {npc.action.label.toUpperCase()}
              </button>
            )}
          </div>

          <style jsx>{`
            @keyframes cursorBlink {
              0%, 100% { opacity: 0.5; }
              50%       { opacity: 0; }
            }
          `}</style>
        </div>
      </div>
    </div>
  );
}
