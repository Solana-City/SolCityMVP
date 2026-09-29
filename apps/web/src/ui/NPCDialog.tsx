"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { NPCDefinition, NPCAction, NPCDialogLine } from "@/game/config/npcRegistry";
import NPCPortrait from "./NPCPortrait";
import { profileManager } from "@/game/config/profileManager";
import { chamferBox } from "@/ui/chamfer";
import ChamferGlow from "@/ui/ChamferGlow";
import { CloseButton, ExternalLinkIcon } from "@/ui/PixelIcons";

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

/**
 * The page as one string, accent included: the typewriter types through it in
 * one pass, and the renderer splits the revealed part at `accentAt` below.
 */
function pageText(line: NPCDialogLine | undefined): string {
  if (line === undefined) return "";
  return typeof line === "string" ? line : `${line.text}\n${line.accent}`;
}

/** Where the accent sentence starts in that string, or -1 when there is none. */
function accentAt(line: NPCDialogLine | undefined): number {
  return line === undefined || typeof line === "string" ? -1 : line.text.length + 1;
}

export default function NPCDialog({ npc, onClose, onAction }: NPCDialogProps) {
  const [lineIndex, setLineIndex]         = useState(0);
  const [portraitVisible, setPortraitVisible] = useState(false);
  const [displayText, setDisplayText]     = useState("");
  const [isTyping, setIsTyping]           = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Set by skipToEnd so the line it lands on appears fully, not typed out. */
  const instantRef = useRef(false);
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
    const text = pageText(npc.dialog[lineIndex]);
    if (timerRef.current) clearInterval(timerRef.current);
    if (instantRef.current) {
      instantRef.current = false;
      timerRef.current = null;
      setDisplayText(text);
      setIsTyping(false);
      return;
    }
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
      setDisplayText(pageText(npc.dialog[lineIndex]));
      setIsTyping(false);
      return;
    }
    if (lineIndex < npc.dialog.length - 1) {
      setLineIndex((i) => i + 1);
    } else {
      onAction(npc.action);
    }
  }, [npc, lineIndex, isTyping, onAction]);

  /** Jump straight to the last line, fully shown, so the action is one click
   *  away. For players who already know what this NPC does. */
  const skipToEnd = useCallback(() => {
    if (!npc) return;
    const last = npc.dialog.length - 1;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (lineIndex === last) {
      setDisplayText(pageText(npc.dialog[last]));
      setIsTyping(false);
      return;
    }
    instantRef.current = true;
    setLineIndex(last);
  }, [npc, lineIndex]);

  /** Clicks on the bubble body only skip/advance text. On the last line the
   *  action fires from its own button (or E/ACT), never from a stray click
   *  anywhere on the bubble. */
  const onBubbleClick = useCallback(() => {
    if (!npc) return;
    if (!isTyping && lineIndex >= npc.dialog.length - 1) return;
    skipOrAdvance();
  }, [npc, lineIndex, isTyping, skipOrAdvance]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!npc) return;
      if (e.key === "e" || e.key === "E" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        skipOrAdvance();
      }
      if (e.key === "Tab") {
        e.preventDefault();
        skipToEnd();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [npc, skipOrAdvance, skipToEnd, onClose]);

  // Mobile ACT button doubles as the dialog key: while a dialog is open,
  // CityScene ignores touch:interact (interactionBlocked), so the press
  // lands here and skips/advances exactly like E/Space on desktop.
  useEffect(() => {
    if (!npc) return;
    const bus = (globalThis as any).__solCityGameEvents as
      | { on: Function; off: Function } | undefined;
    if (!bus) return;
    const handler = () => skipOrAdvance();
    bus.on("touch:interact", handler);
    return () => { bus.off("touch:interact", handler); };
  }, [npc, skipOrAdvance]);

  if (!npc) return null;

  const isLastLine  = lineIndex >= npc.dialog.length - 1;
  const doneTyping  = !isTyping;
  const color       = `#${npc.color.toString(16).padStart(6, "0")}`;
  // Only worth offering while there is still text between here and the action.
  const showSkip    = npc.dialog.length > 1 && !isLastLine;
  const skipStyle: React.CSSProperties = chamferBox(6, {
    background: "transparent",
    border: `1px solid ${color}66`,
    color,
    fontFamily: '"Press Start 2P", monospace',
    fontSize: "7px",
    padding: "5px 8px",
    cursor: "pointer",
    flexShrink: 0,
    whiteSpace: "nowrap",
  });

  /** Illustrative info, on the last line once it has typed out. No frame or
   *  button-shaped chip around these: they aren't clickable, and boxing them
   *  in the same chamfered octagon as a real button reads as one. */
  const Highlights = ({ compact }: { compact?: boolean }) =>
    npc.highlights && npc.highlights.length > 0 && isLastLine && doneTyping ? (
      <div style={{
        display: "flex", gap: compact ? 12 : 16, flexWrap: "wrap",
        margin: compact ? "0 0 10px" : "0 16px 14px", justifyContent: "flex-start",
      }}>
        {npc.highlights.map((h) => (
          <div key={h.label} style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
            <span aria-hidden style={{ width: 6, height: 6, flexShrink: 0, background: color }} />
            <span style={{ fontFamily: '"Press Start 2P", monospace', fontSize: compact ? 6 : 7, color: "#8a8aa7", whiteSpace: "nowrap" }}>
              {h.label}
            </span>
          </div>
        ))}
      </div>
    ) : null;

  /**
   * The text as typed so far, with the closing sentence in the NPC's colour
   * once the typewriter reaches it. "pre-line" is what makes the writer's own
   * line breaks land where they wrote them.
   */
  const Spoken = () => {
    const split = accentAt(npc.dialog[lineIndex]);
    const cursor = isTyping ? (
      <span style={{ opacity: 0.5, animation: "cursorBlink 0.7s step-end infinite" }}>▌</span>
    ) : null;
    if (split < 0) return <>{displayText}{cursor}</>;
    return (
      <>
        {displayText.slice(0, split)}
        <span style={{ color, fontWeight: 700 }}>{displayText.slice(split)}</span>
        {cursor}
      </>
    );
  };

  /** Dot row showing progress through dialog lines */
  const Dots = () => (
    <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
      {npc.dialog.map((_, i) => (
        <div
          key={i}
          style={{
            width:        i === lineIndex ? 8 : 6,
            height:       i === lineIndex ? 8 : 6,
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
      <ChamferGlow
        glow={`drop-shadow(0 -4px 14px ${color}40)`}
        style={{
          position:     "fixed",
          bottom:       "calc(env(safe-area-inset-bottom, 0px) + 12px)",
          left:         "50%",
          transform:    "translateX(-50%)",
          width:        "calc(100vw - 20px)",
          maxWidth:     480,
          zIndex:       30,
        }}
      >
      <div
        onClick={onBubbleClick}
        style={chamferBox(14, {
          fontFamily:   '"Press Start 2P", monospace',
          background:   "rgba(8,8,24,0.96)",
          border:       `1px solid ${color}55`,
          borderTop:    `3px solid ${color}`,
          padding:      "12px 14px 14px",
          backdropFilter: "blur(8px)",
          cursor:       isLastLine && doneTyping ? "default" : "pointer",
        })}
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
              fontSize: "9px",
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
          <CloseButton onClick={(e) => { e.stopPropagation(); onClose(); }} label="Close dialog" color={color} size={18} style={{ touchAction: "manipulation" }} />
        </div>

        {/* Dialog text */}
        <p style={{
          fontSize: "10px",
          color:      "#d0d0e8",
          margin:     "0 0 12px",
          lineHeight: 1.65,
          minHeight:  "3.3em",
          whiteSpace: "pre-line",
        }}>
          <Spoken />
        </p>

        <Highlights compact />

        {/* Footer: progress dots + continue hint / action button */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Dots />
          {isLastLine && doneTyping ? (
            <button
              onClick={(e) => { e.stopPropagation(); onAction(npc.action); }}
              style={chamferBox(8, {
                background:  color,
                border:      "none",
                color:       "#000",
                fontFamily:  '"Press Start 2P", monospace',
                fontSize: "7px",
                padding:     "9px 16px",
                cursor:      "pointer",
                fontWeight:  "bold",
                touchAction: "manipulation",
                display: "flex", alignItems: "center", gap: 6,
              })}
            >
              {npc.action.label.toUpperCase()}
              {npc.action.type === "link" && <ExternalLinkIcon size={8} color="#000" />}
            </button>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{
                fontSize: "8px",
                color:     "#3a3a52",
                animation: doneTyping ? "tapPulse 1.4s ease-in-out infinite" : "none",
              }}>
                {doneTyping ? "tap to continue ▶" : "..."}
              </span>
              {showSkip && (
                <button
                  onClick={(e) => { e.stopPropagation(); skipToEnd(); }}
                  style={{ ...skipStyle, padding: "8px 10px", touchAction: "manipulation" }}
                  aria-label="Skip dialog"
                >
                  {"SKIP >>"}
                </button>
              )}
            </div>
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
      </ChamferGlow>
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

        <ChamferGlow className="relative flex-1" glow={`drop-shadow(0 0 16px ${color}40)`}>
          {/* Bubble arrow pointing at portrait. It sits outside the clipped
              box below, so the chamfer does not cut it off. */}
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
                zIndex: 1,
              }} aria-hidden />
            </>
          )}
        <div
          className="relative"
          onClick={onBubbleClick}
          style={chamferBox(12, {
            background:     "rgba(8,8,24,0.96)",
            border:         `2px solid ${color}`,
            backdropFilter: "blur(6px)",
            cursor:         isLastLine && doneTyping ? "default" : "pointer",
          })}
        >

          {/* Header */}
          <div style={{ padding: "14px 16px 0" }}>
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div style={{
                  fontFamily:   '"Press Start 2P", monospace',
                  fontSize: "11px",
                  color,
                  marginBottom: 4,
                }}>
                  {npc.name}
                </div>
                <div style={{ fontSize: "8px", color: "#5a5a72" }}>{npc.role}</div>
              </div>
              <CloseButton onClick={(e) => { e.stopPropagation(); onClose(); }} label="Close dialog" color={color} size={18} />
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
            whiteSpace: "pre-line",
          }}>
            <Spoken />
          </p>

          <Highlights />

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
            {showSkip && (
              <button
                onClick={(e) => { e.stopPropagation(); skipToEnd(); }}
                style={skipStyle}
                title="Skip to the end [Tab]"
                aria-label="Skip dialog"
              >
                {"SKIP >>"} <span style={{ opacity: 0.6 }}>[TAB]</span>
              </button>
            )}
            {isLastLine && doneTyping && (
              <button
                onClick={(e) => { e.stopPropagation(); onAction(npc.action); }}
                style={chamferBox(8, {
                  background:  color,
                  border:      "none",
                  color:       "#000",
                  fontFamily:  '"Press Start 2P", monospace',
                  fontSize: "7px",
                  padding:     "10px 20px",
                  cursor:      "pointer",
                  fontWeight:  "bold",
                  display: "flex", alignItems: "center", gap: 6,
                })}
              >
                {npc.action.label.toUpperCase()}
                {npc.action.type === "link" && <ExternalLinkIcon size={8} color="#000" />}
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
        </ChamferGlow>
      </div>
    </div>
  );
}
