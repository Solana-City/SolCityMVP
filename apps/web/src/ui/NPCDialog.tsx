"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { NPCDefinition, NPCAction, NPCDialogLine } from "@/game/config/npcRegistry";
import NPCPortrait from "./NPCPortrait";
import { profileManager } from "@/game/config/profileManager";
import { chamferBox } from "@/ui/chamfer";
import ChamferGlow from "@/ui/ChamferGlow";
import { CloseButton, ExternalLinkIcon } from "@/ui/PixelIcons";
import { useButtonFeel, feelStyle } from "@/ui/useButtonFeel";

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
  const [displayText, setDisplayText]     = useState("");
  const [isTyping, setIsTyping]           = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Set by skipToEnd so the line it lands on appears fully, not typed out. */
  const instantRef = useRef(false);
  const isTouch = useIsTouch();
  const actionFeel = useButtonFeel();
  const skipFeel = useButtonFeel();

  // Reset when NPC changes
  useEffect(() => {
    setLineIndex(0);
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
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      {npc.dialog.map((_, i) => (
        <div
          key={i}
          style={{
            width:        10,
            height:       10,
            background:   i === lineIndex ? color
                        : i < lineIndex   ? `${color}66`
                                          : "#3a4060",
            transition: "all 0.2s",
          }}
        />
      ))}
    </div>
  );

  // One layout for both screens, as in the design: the speaker's face inside
  // the box, in its own frame, beside the name, the words and the controls.
  // Desktop is the roomy version (a big portrait on the left, everything else
  // in a column); a phone puts a small portrait on the header row and lets the
  // text run the full width underneath.
  const actionButton = (
    <button
      onClick={(e) => { e.stopPropagation(); onAction(npc.action); }}
      {...actionFeel.handlers}
      style={chamferBox(8, {
        background:  color,
        border:      "none",
        color:       "#000",
        fontFamily:  '"Press Start 2P", monospace',
        fontSize: isTouch ? "7px" : "8px",
        padding:     isTouch ? "9px 16px" : "10px 20px",
        cursor:      "pointer",
        fontWeight:  "bold",
        touchAction: "manipulation",
        display: "flex", alignItems: "center", gap: 6,
        flexShrink: 0,
        ...feelStyle(actionFeel),
      })}
    >
      {npc.action.label.toUpperCase()}
      {npc.action.type === "link" && <ExternalLinkIcon size={8} color="#000" />}
    </button>
  );
  const skipButton = showSkip ? (
    <button
      onClick={(e) => { e.stopPropagation(); skipToEnd(); }}
      {...skipFeel.handlers}
      style={chamferBox(8, {
        background: "transparent",
        border: `2px solid ${color}`,
        color,
        fontFamily: '"Press Start 2P", monospace',
        fontSize: isTouch ? "7px" : "8px",
        padding: isTouch ? "8px 12px" : "9px 14px",
        cursor: "pointer",
        flexShrink: 0,
        whiteSpace: "nowrap",
        touchAction: "manipulation",
        ...feelStyle(skipFeel),
      })}
      title={isTouch ? undefined : "Skip to the end [Tab]"}
      aria-label="Skip dialog"
    >
      {"SKIP >>"}{!isTouch && <span style={{ opacity: 0.7 }}> [TAB]</span>}
    </button>
  ) : null;
  const hint = (
    <span style={{
      display: "block",
      fontSize: isTouch ? "8px" : "8px",
      color: "#5f6684",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      animation: isTouch && doneTyping ? "tapPulse 1.4s ease-in-out infinite" : "none",
    }}>
      {isTyping ? "..." : isTouch
        ? (isLastLine ? "" : "Tap to continue")
        : isLastLine ? "[E/Space] Action · [ESC] Close" : "[E/Space] Continue · [ESC] Close"}
    </span>
  );
  const footer = (
    <div style={{
      display: "flex", alignItems: "center", gap: isTouch ? 10 : 16,
      borderTop: `1px solid ${color}20`, paddingTop: isTouch ? 10 : 12,
    }}>
      <Dots />
      <div style={{ flex: 1, minWidth: 0 }}>{hint}</div>
      {isLastLine && doneTyping ? actionButton : skipButton}
    </div>
  );
  const closeButton = (
    <CloseButton
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      label="Close dialog" color={color}
      size={isTouch ? 24 : 28}
      style={{ touchAction: "manipulation", alignSelf: "flex-start" }}
    />
  );
  /** The quiet line under the name and the one above the controls. */
  const divider = <div style={{ height: 1, background: `${color}2a`, marginTop: isTouch ? 10 : 12 }} />;
  const words = (
    <p style={{
      fontSize: isTouch ? "10px" : "12px",
      color: "#e4e6f4",
      margin: isTouch ? "10px 0 12px" : "12px 0 12px",
      lineHeight: 1.7,
      minHeight: isTouch ? "3.4em" : "3.4em",
      whiteSpace: "pre-line",
    }}>
      <Spoken />
    </p>
  );

  // ── The stage layout ─────────────────────────────────────────────────────
  // Read off the design's frame on its own: the top edge has two heights. Left
  // of the name tab it runs LOW (a shoulder), with one small spike climbing to
  // the full height and dropping straight back down (the speech-bubble tail);
  // from the tab on to the far corner it runs HIGH.
  //
  // The speaker stands on the shoulder and is cut off at the waist BY the
  // frame: they are BEHIND it, their lower edge hidden under the shoulder's
  // border line, and the spike overlaps them. That is why the frame is drawn
  // over the speaker rather than the other way round.
  //
  // A step cannot be made with chamferBox, so the frame is two clipped layers:
  // the whole polygon in the border colour, and the same polygon inset by the
  // border width in the box's fill. The speaker, the tab and the frame are
  // siblings, because clip-path clips whatever pokes out of its element.
  const sz       = isTouch ? 84 : 136;           // the speaker, drawn to this size
  const D        = isTouch ? 11 : 16;            // how far the shoulder sits below the high edge
  const hide     = isTouch ? 7 : 10;             // how much of the speaker is under the shoulder
  const above    = sz - D - hide;                // the high edge's distance from the speaker's top
  const padX     = isTouch ? 16 : 22;
  const pillH    = isTouch ? 24 : 34;
  const pillPadX = isTouch ? 10 : 14;
  const pillTop  = isTouch ? -7 : -10;           // the tab pokes this far above the high edge
  const C        = isTouch ? 12 : 16;            // corner cut
  const B        = 3;                            // border
  const xa       = padX + Math.round(sz * 0.24); // the spike: where its ramp starts...
  const xb       = xa + D + 6;                   // ...and its straight drop
  const pillLeft = padX + Math.round(sz * 0.9);
  const step     = pillLeft + 12;                // where the edge goes from low to high, under the tab
  const BOX_BG   = "rgba(8,8,24,0.96)";
  const k        = 0.414 * B;                    // how far a 45-degree edge's inset vertex slides along
  const px       = (n: number) => `${Math.round(n * 100) / 100}px`;
  const pt       = (x: string, y: string) => `${x} ${y}`;
  const R        = (n: number) => `calc(100% - ${px(n)})`;
  const outer = [
    pt("0", px(D + C)), pt(px(C), px(D)),
    pt(px(xa), px(D)), pt(px(xa + D), "0"), pt(px(xb), "0"), pt(px(xb), px(D)),
    pt(px(step), px(D)), pt(px(step), "0"),
    pt(R(C), "0"), pt("100%", px(C)),
    pt("100%", R(C)), pt(R(C), "100%"),
    pt(px(C), "100%"), pt("0", R(C)),
  ].join(", ");
  const inner = [
    pt(px(B), px(D + C + k)), pt(px(C + k), px(D + B)),
    pt(px(xa + k), px(D + B)), pt(px(xa + D + k), px(B)), pt(px(xb - B), px(B)), pt(px(xb - B), px(D + B)),
    pt(px(step + B), px(D + B)), pt(px(step + B), px(B)),
    pt(R(C + k), px(B)), pt(R(B), px(C + k)),
    pt(R(B), R(C + k)), pt(R(C + k), R(B)),
    pt(px(C + k), R(B)), pt(px(B), R(C + k)),
  ].join(", ");
  const stageBox = (
    <div style={{ position: "relative", paddingTop: above, fontFamily: '"Press Start 2P", monospace' }}>
      {/* The speaker: BEHIND the frame, which is drawn over their waist. */}
      <div style={{ position: "absolute", left: padX, top: 0, zIndex: 1, pointerEvents: "none" }}>
        <NPCPortrait npc={npc} size={sz} bare />
      </div>

      <div
        onClick={onBubbleClick}
        style={{ position: "relative", zIndex: 2, cursor: isLastLine && doneTyping ? "default" : "pointer" }}
      >
        <div aria-hidden style={{ position: "absolute", inset: 0, background: color, clipPath: `polygon(${outer})` }} />
        <div aria-hidden style={{ position: "absolute", inset: 0, background: BOX_BG, clipPath: `polygon(${inner})` }} />

        <div style={{ position: "relative", padding: `${pillH + pillTop + 8}px ${padX + B}px ${(isTouch ? 12 : 16) + B}px` }}>
          <div style={{
            marginLeft: pillLeft - padX + pillPadX - B,
            fontSize: isTouch ? "8px" : "10px", color: "#5f6684",
            minHeight: isTouch ? 12 : 14,
            paddingRight: isTouch ? 30 : 40,
          }}>
            {npc.role}
          </div>
          <div style={{ position: "absolute", top: isTouch ? 8 : 12, right: isTouch ? 12 : 16 }}>
            {closeButton}
          </div>
          {divider}
          {words}
          <Highlights compact />
          {footer}
        </div>
        <style jsx>{`
          @keyframes tapPulse {
            0%, 100% { opacity: 0.4; }
            50%       { opacity: 1; }
          }
          @keyframes cursorBlink {
            0%, 100% { opacity: 0.5; }
            50%       { opacity: 0; }
          }
        `}</style>
      </div>

      {/* The name, on a tab across the step in the top edge. */}
      <div style={chamferBox(8, {
        position: "absolute", left: pillLeft, top: above + pillTop, zIndex: 3,
        height: pillH, display: "flex", alignItems: "center", padding: `0 ${pillPadX}px`,
        background: "#080818", border: `2px solid ${color}`, color,
        fontFamily: '"Press Start 2P", monospace', fontSize: isTouch ? "11px" : "14px",
        whiteSpace: "nowrap", maxWidth: `calc(100% - ${pillLeft + (isTouch ? 36 : 50)}px)`,
        overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none",
      })}>
        {npc.name}
      </div>
    </div>
  );
  const content = stageBox;

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
        {content}
      </ChamferGlow>
    );
  }

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-30 w-full max-w-3xl px-4"
      style={{ fontFamily: '"Press Start 2P", monospace', bottom: "96px" }}
    >
      <ChamferGlow className="relative" glow={`drop-shadow(0 0 16px ${color}40)`}>
        {content}
      </ChamferGlow>
    </div>
  );
}
