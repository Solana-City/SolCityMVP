"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  EXPRESSIONS, type Expression,
  LAYER_ORDER, getVariant, loadSavedLoadout, type Loadout, type LayerCategory,
  DIRECTION_ROW, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT,
} from "@/game/config/paperDoll";

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

const CHROMA_R = 215, CHROMA_G = 123, CHROMA_B = 186, CHROMA_TOL = 30;
const LAST_KEY = "solcity:lastExpression";

// Head crop within the 64px down-facing frame (x14..50, y0..36 — hat to neck).
const HEAD_X = 14, HEAD_Y = 0, HEAD_W = 36, HEAD_H = 36;

function removeChroma(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const d = ctx.getImageData(0, 0, w, h);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    if (
      Math.abs(px[i]   - CHROMA_R) <= CHROMA_TOL &&
      Math.abs(px[i+1] - CHROMA_G) <= CHROMA_TOL &&
      Math.abs(px[i+2] - CHROMA_B) <= CHROMA_TOL
    ) px[i+3] = 0;
  }
  ctx.putImageData(d, 0, 0);
}

/** Composites the player's head with `expressionFile` as the eyes, cropped. */
function drawHead(canvas: HTMLCanvasElement, loadout: Loadout, expressionFile: string, size: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = false;
  const rowY = DIRECTION_ROW.down * SPRITE_FRAME_HEIGHT;

  // Layer files in render order; eyesFace is always the expression sheet.
  const layerFiles: Array<{ cat: LayerCategory; file: string }> = [];
  for (const cat of LAYER_ORDER) {
    if (cat === "eyesFace") { layerFiles.push({ cat, file: expressionFile }); continue; }
    const id = loadout[cat];
    if (!id) continue;
    const v = getVariant(cat, id);
    if (v) layerFiles.push({ cat, file: v.file });
  }

  let loaded = 0;
  const imgs: Array<{ img: HTMLImageElement; cat: LayerCategory }> = [];
  const hatVariant = getVariant("hat", loadout.hat);

  const draw = () => {
    const offByCat = new Map<LayerCategory, HTMLCanvasElement>();
    for (const { img, cat } of imgs) {
      const off = document.createElement("canvas");
      off.width = img.naturalWidth; off.height = img.naturalHeight;
      const oc = off.getContext("2d")!;
      oc.drawImage(img, 0, 0);
      removeChroma(oc, img.naturalWidth, img.naturalHeight);
      offByCat.set(cat, off);
    }

    // Hair ↔ hat masking (same rules as the wardrobe preview).
    const hatOff = offByCat.get("hat");
    const hairOff = offByCat.get("hair");
    if (hatOff && hairOff && hatVariant?.hatCoverage === "suppress") {
      hairOff.getContext("2d")!.clearRect(0, rowY, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT);
    } else if (hatOff && hairOff) {
      const hatData = hatOff.getContext("2d")!.getImageData(0, rowY, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT).data;
      const hairCtx = hairOff.getContext("2d")!;
      const hairData = hairCtx.getImageData(0, rowY, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT);
      if (hatVariant?.hatCoverage === "band") {
        let masked = false;
        for (let i = 0; i < hatData.length; i += 4) {
          if (hatData[i + 3] > 10) { hairData.data[i + 3] = 0; masked = true; }
        }
        if (masked) hairCtx.putImageData(hairData, 0, rowY);
      } else {
        const cutoffs = new Array<number>(SPRITE_FRAME_WIDTH).fill(SPRITE_FRAME_HEIGHT);
        for (let x = 0; x < SPRITE_FRAME_WIDTH; x++) {
          for (let y = 0; y < SPRITE_FRAME_HEIGHT; y++) {
            if (hatData[(y * SPRITE_FRAME_WIDTH + x) * 4 + 3] > 10) { cutoffs[x] = y; break; }
          }
        }
        if (cutoffs.some(c => c < SPRITE_FRAME_HEIGHT)) {
          for (let x = 0; x < SPRITE_FRAME_WIDTH; x++) {
            for (let y = 0; y < cutoffs[x]; y++) hairData.data[(y * SPRITE_FRAME_WIDTH + x) * 4 + 3] = 0;
          }
          hairCtx.putImageData(hairData, 0, rowY);
        }
      }
    }

    ctx.clearRect(0, 0, size, size);
    for (const { cat } of imgs) {
      const off = offByCat.get(cat)!;
      ctx.drawImage(off, HEAD_X, rowY + HEAD_Y, HEAD_W, HEAD_H, 0, 0, size, size);
    }
  };

  for (const { cat, file } of layerFiles) {
    const img = new Image();
    img.src = `/assets/sprites/paperdoll/${file}`;
    imgs.push({ img, cat });
    img.onload = () => { loaded++; if (loaded === imgs.length) draw(); };
    img.onerror = () => { loaded++; if (loaded === imgs.length) draw(); };
  }
}

function HeadPreview({ loadout, expr, size, active }: {
  loadout: Loadout; expr: Expression; size: number; active: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawHead(ref.current, loadout, expr.file, size);
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

  // Touch/click opener from the floating button + ChatPanel 😀.
  useEffect(() => {
    const onOpenEvent = () => openWheel(false);
    window.addEventListener("solcity:openExpressionWheel", onOpenEvent);
    return () => window.removeEventListener("solcity:openExpressionWheel", onOpenEvent);
  }, [openWheel]);

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
              background: active ? "rgba(153,69,255,0.28)" : "rgba(10,10,30,0.72)",
              border: `2px solid ${active ? "#c084fc" : "rgba(153,69,255,0.35)"}`,
              boxShadow: active ? "0 0 18px rgba(153,69,255,0.55)" : "none",
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
