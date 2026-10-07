"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  EXPRESSIONS, type Expression, loadSavedLoadout, type Loadout,
} from "@/game/config/paperDoll";
import { drawAvatarPortrait } from "@/ui/AvatarPortrait";

/**
 * GTA-style radial expression picker. Hold Q (desktop) to open a wheel of
 * the player's OWN head making each expression, aim with the mouse, release
 * to fire — or click/tap a head. On touch, a floating button dispatches
 * `solcity:openExpressionWheel` to open it and you tap a head. R re-fires
 * your last expression without opening the wheel.
 *
 * Each node is the live composited head (skin + hair + hat + the expression
 * as the eyes), reusing the same paper-doll compositing + hair/hat masking
 * the wardrobe preview uses — so you see exactly what you'll look like.
 */

const LAST_KEY = "solcity:lastExpression";

function HeadPreview({ loadout, expr, size, active }: {
  loadout: Loadout; expr: Expression; size: number; active: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // The head fills the node, so the backing store is the node's own size.
    canvas.width = size;
    canvas.height = size;
    drawAvatarPortrait(canvas, loadout, { crop: "head", expressionFile: expr.file });
  }, [loadout, expr.file, size]);
  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      style={{
        imageRendering: "pixelated",
        display: "block",
        transform: active ? "scale(1.18)" : "scale(1)",
        transition: "transform 0.08s ease",
        filter: active ? "none" : "saturate(0.85) brightness(0.9)",
      }}
    />
  );
}

export default function ExpressionWheel({ gameRef }: { gameRef: Phaser.Game | null }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [isTouch, setIsTouch] = useState(false);
  const [loadout, setLoadout] = useState<Loadout | null>(null);
  const openedByHold = useRef(false);

  useEffect(() => { setIsTouch(window.matchMedia("(pointer: coarse)").matches); }, []);

  const trigger = useCallback((expr: Expression) => {
    gameRef?.events.emit("expression:trigger", expr);
    try { localStorage.setItem(LAST_KEY, expr.id); } catch { /* ignore */ }
  }, [gameRef]);

  const openWheel = useCallback((byHold: boolean) => {
    openedByHold.current = byHold;
    setLoadout(loadSavedLoadout());   // snapshot the current look for the heads
    setActiveIndex(null);
    setOpen(true);
  }, []);

  const closeWheel = useCallback(() => { setOpen(false); setActiveIndex(null); }, []);

  const repeatLast = useCallback(() => {
    let id: string | null = null;
    try { id = localStorage.getItem(LAST_KEY); } catch { /* ignore */ }
    const expr = EXPRESSIONS.find(e => e.id === id) ?? EXPRESSIONS[0];
    if (expr) trigger(expr);
  }, [trigger]);

  // Keyboard: hold Q opens + release fires the aimed head; R repeats last.
  useEffect(() => {
    const typing = () => {
      const a = document.activeElement;
      return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA");
    };
    const onDown = (e: KeyboardEvent) => {
      if (typing()) return;
      if ((e.key === "q" || e.key === "Q") && !e.repeat) { e.preventDefault(); openWheel(true); }
      else if (e.key === "r" || e.key === "R") { e.preventDefault(); repeatLast(); }
      else if (e.key === "Escape" && open) { e.preventDefault(); closeWheel(); }
    };
    const onUp = (e: KeyboardEvent) => {
      if ((e.key === "q" || e.key === "Q") && open && openedByHold.current) {
        if (activeIndex !== null && EXPRESSIONS[activeIndex]) trigger(EXPRESSIONS[activeIndex]);
        closeWheel();
      }
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); };
  }, [open, activeIndex, openWheel, closeWheel, trigger, repeatLast]);

  // Touch/click opener from the floating button + ChatPanel emote icon.
  useEffect(() => {
    const onOpenEvent = () => openWheel(false);
    window.addEventListener("solcity:openExpressionWheel", onOpenEvent);
    return () => window.removeEventListener("solcity:openExpressionWheel", onOpenEvent);
  }, [openWheel]);

  // The mobile rail swaps its emoji button for a close button while the wheel
  // is up, so it needs to hear when that is, and to be able to ask for a close.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("solcity:expressionWheelState", { detail: { open } }));
  }, [open]);
  useEffect(() => {
    window.addEventListener("solcity:closeExpressionWheel", closeWheel);
    return () => window.removeEventListener("solcity:closeExpressionWheel", closeWheel);
  }, [closeWheel]);

  // Desktop aim: mouse angle from center → highlighted head (dead zone in the middle).
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (isTouch) return;
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const dx = e.clientX - cx, dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist < 42) { setActiveIndex(null); return; } // dead zone → no selection
    const ang = Math.atan2(dy, dx) + Math.PI / 2; // 0 = up
    const norm = (ang + Math.PI * 2) % (Math.PI * 2);
    setActiveIndex(Math.round(norm / (Math.PI * 2) * EXPRESSIONS.length) % EXPRESSIONS.length);
  }, [isTouch]);

  if (!open || !loadout) return null;

  const N = EXPRESSIONS.length;
  const radius = isTouch ? 136 : 158;
  const node = isTouch ? 88 : 98;

  return (
    <div
      onPointerMove={onPointerMove}
      onClick={closeWheel} // click backdrop closes
      style={{
        position: "fixed", inset: 0, zIndex: 45,
        background: "rgba(6,8,18,0.45)", backdropFilter: "blur(2px)",
      }}
    >
      {/* Center hint */}
      <div style={{
        position: "fixed", left: "50%", top: "50%", transform: "translate(-50%,-50%)",
        fontFamily: '"Press Start 2P", monospace', fontSize: 7, color: "#8a8ab0",
        textAlign: "center", pointerEvents: "none", lineHeight: 1.6, width: 120,
      }}>
        {isTouch ? "tap a face" : "aim + release Q"}
      </div>

      {EXPRESSIONS.map((expr, i) => {
        const ang = (i / N) * Math.PI * 2 - Math.PI / 2; // start at top
        const x = Math.cos(ang) * radius;
        const y = Math.sin(ang) * radius;
        const active = activeIndex === i;
        return (
          <div
            key={expr.id}
            onClick={(e) => { e.stopPropagation(); trigger(expr); closeWheel(); }}
            onPointerEnter={() => !isTouch && setActiveIndex(i)}
            title={expr.name}
            style={{
              position: "fixed",
              left: `calc(50% + ${x}px)`, top: `calc(50% + ${y}px)`,
              transform: "translate(-50%,-50%)",
              width: node, height: node,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <div style={{
              width: node, height: node, borderRadius: "50%",
              background: active ? "rgba(183,233,40,0.28)" : "rgba(10,10,30,0.72)",
              border: `2px solid ${active ? "#B7E928" : "rgba(183,233,40,0.35)"}`,
              boxShadow: active ? "0 0 18px rgba(183,233,40,0.55)" : "none",
              display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
              transition: "background 0.08s, border-color 0.08s, box-shadow 0.08s",
            }}>
              <HeadPreview loadout={loadout} expr={expr} size={node - 14} active={active} />
            </div>
            <span style={{
              marginTop: 4, fontFamily: '"Press Start 2P", monospace', fontSize: 7,
              color: active ? "#e0d0ff" : "#7a7aaa", whiteSpace: "nowrap",
              textShadow: "0 1px 2px rgba(0,0,0,0.9)",
            }}>{expr.name}</span>
          </div>
        );
      })}
    </div>
  );
}
