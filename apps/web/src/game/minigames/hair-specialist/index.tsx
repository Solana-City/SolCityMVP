"use client";

/**
 * Hair Specialist (Superteam Turkey): a timing game. The player's own
 * character stands bald while every hairstyle slides past at head height;
 * tap when one lines up with the head to land it. The further off the tap,
 * the more crooked the hair sits.
 *
 * Free play for now. Rounds that ask for one specific hairstyle come later.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { MiniGameComponentProps } from "../types";
import {
  LAYER_ORDER,
  DIRECTION_ROW,
  SPRITE_FRAME_WIDTH as FW,
  SPRITE_FRAME_HEIGHT as FH,
  getEnabledVariants,
  getVariant,
  loadSavedLoadout,
  saveLoadout,
  type LayerVariant,
} from "../../config/paperDoll";

const FONT = '"Press Start 2P", monospace';
const ACCENT = "#E30A17";
const CHROMA_R = 215, CHROMA_G = 123, CHROMA_B = 186, CHROMA_TOL = 30;

/** Stage size in sprite pixels; the character stands in the middle. */
const STAGE_W = 208;
const HEAD_X = (STAGE_W - FW) / 2;
/** Gap between hairstyles on the conveyor, and their speed (sprite px/s). */
const SPACING = 56;
const SPEED = 80;
/** Backing-store pixels per sprite pixel (CSS scales the canvas to fit). */
const SCALE = 4;

type Rating = "perfect" | "good" | "crooked" | "miss";
const RATING: Record<Rating, { label: string; color: string; score: number }> = {
  perfect: { label: "PERFECT!", color: "#14F195", score: 3 },
  good:    { label: "GOOD!",    color: "#FFD700", score: 2 },
  crooked: { label: "CROOKED",  color: "#FF9F43", score: 1 },
  miss:    { label: "MISS",     color: "#FF4D6D", score: 0 },
};

function rate(offset: number): Rating {
  const d = Math.abs(offset);
  if (d <= 2) return "perfect";
  if (d <= 6) return "good";
  if (d <= 16) return "crooked";
  return "miss";
}

/** Loads a paper-doll sheet and returns its front-facing frame 0, chroma removed. */
function loadFrame(file: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = FW;
      c.height = FH;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, DIRECTION_ROW.down * FH, FW, FH, 0, 0, FW, FH);
      const d = ctx.getImageData(0, 0, FW, FH);
      const px = d.data;
      for (let i = 0; i < px.length; i += 4) {
        if (
          Math.abs(px[i] - CHROMA_R) <= CHROMA_TOL &&
          Math.abs(px[i + 1] - CHROMA_G) <= CHROMA_TOL &&
          Math.abs(px[i + 2] - CHROMA_B) <= CHROMA_TOL
        ) px[i + 3] = 0;
      }
      ctx.putImageData(d, 0, 0);
      resolve(c);
    };
    img.onerror = reject;
    img.src = `/assets/sprites/paperdoll/${file}`;
  });
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Hair { variant: LayerVariant; frame: HTMLCanvasElement }
interface Landed { hair: Hair; offset: number; rating: Rating }

export default function HairSpecialist({ onResult, onClose }: MiniGameComponentProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bodyRef = useRef<HTMLCanvasElement[]>([]);
  const hairsRef = useRef<Hair[]>([]);
  const scrollRef = useRef(0);
  const landedRef = useRef<Landed | null>(null);
  const [ready, setReady] = useState(false);
  const [landed, setLanded] = useState<Landed | null>(null);
  const [kept, setKept] = useState(false);

  // Load the player's own look minus hair and hat, plus every hairstyle
  // except Avatar (a full head, not a hairstyle).
  useEffect(() => {
    let cancelled = false;
    const loadout = loadSavedLoadout();
    const bodyFiles = LAYER_ORDER
      .filter((cat) => cat !== "hair" && cat !== "hat")
      .map((cat) => getVariant(cat, loadout[cat])?.file)
      .filter((f): f is string => !!f);
    const hairVariants = shuffle(getEnabledVariants("hair").filter((v) => v.id !== "Avatar"));
    Promise.all([
      Promise.all(bodyFiles.map(loadFrame)),
      Promise.all(hairVariants.map((v) => loadFrame(v.file).then((frame) => ({ variant: v, frame })))),
    ]).then(([body, hairs]) => {
      if (cancelled) return;
      bodyRef.current = body;
      hairsRef.current = hairs;
      setReady(true);
    }).catch((e) => console.warn("[HairSpecialist] sprite load failed", e));
    return () => { cancelled = true; };
  }, []);

  /** Where hair i currently sits, as an x in stage pixels. */
  const hairX = (i: number, count: number) => {
    const loop = count * SPACING;
    return ((((i * SPACING - scrollRef.current) % loop) + loop) % loop) - SPACING;
  };

  // Render loop: scrolls the conveyor until a hair lands.
  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const hit = landedRef.current;
      if (!hit) scrollRef.current += SPEED * dt;

      ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      ctx.clearRect(0, 0, STAGE_W, FH);
      for (const layer of bodyRef.current) ctx.drawImage(layer, HEAD_X, 0);
      if (hit) {
        if (hit.rating !== "miss") ctx.drawImage(hit.hair.frame, HEAD_X + hit.offset, 0);
      } else {
        const hairs = hairsRef.current;
        hairs.forEach((h, i) => ctx.drawImage(h.frame, Math.round(hairX(i, hairs.length)), 0));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  const drop = useCallback(() => {
    if (!ready || landedRef.current) return;
    const hairs = hairsRef.current;
    let best = 0;
    let bestOffset = Infinity;
    hairs.forEach((_, i) => {
      const off = Math.round(hairX(i, hairs.length)) - HEAD_X;
      if (Math.abs(off) < Math.abs(bestOffset)) { best = i; bestOffset = off; }
    });
    const hit: Landed = { hair: hairs[best], offset: bestOffset, rating: rate(bestOffset) };
    landedRef.current = hit;
    setLanded(hit);
    setKept(false);
    void onResult({
      success: hit.rating !== "miss",
      metadata: { score: RATING[hit.rating].score, hair: hit.hair.variant.id, keepOpen: true },
    });
  }, [ready, onResult]);

  const again = useCallback(() => {
    landedRef.current = null;
    setLanded(null);
  }, []);

  const keep = useCallback(() => {
    if (!landed || landed.rating === "miss") return;
    const next = { ...loadSavedLoadout(), hair: landed.hair.variant.id };
    saveLoadout(next);
    (globalThis as any).__solCityGameEvents?.emit("wardrobe:loadout", next);
    setKept(true);
  }, [landed]);

  // Touch devices get a bigger button and "tap" wording; keyboards get E.
  const [touch, setTouch] = useState(false);
  useEffect(() => { setTouch(window.matchMedia("(pointer: coarse)").matches); }, []);

  /** One action for every input: drop a hair, or start over after one landed. */
  const act = useCallback(() => {
    if (landedRef.current) again(); else drop();
  }, [again, drop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.repeat) return;
      if (e.key === "e" || e.key === "E" || e.key === " " || e.key === "Enter") {
        e.preventDefault();
        // A focused button would also fire on Space keyup and act twice.
        (document.activeElement as HTMLElement | null)?.blur();
        act();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act, onClose]);

  const r = landed ? RATING[landed.rating] : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(6,10,20,0.9)", fontFamily: FONT, padding: 8, touchAction: "manipulation" }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          maxHeight: "100%",
          background: "#141a2b",
          border: `3px solid ${ACCENT}`,
          borderRadius: 12,
          padding: "10px 12px 12px",
          position: "relative",
          color: "#fff",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{ position: "absolute", top: 4, right: 4, color: "#9AA4B2", fontSize: 14, fontFamily: FONT, padding: 8 }}
        >
          X
        </button>
        <div style={{ color: ACCENT, fontSize: 12, marginBottom: 6 }}>HAIR SPECIALIST</div>
        <div style={{ color: "#9AA4B2", fontSize: 8, marginBottom: 8, minHeight: 10 }}>
          {r ? landed!.hair.variant.name : touch ? "Tap when a hair is on your head!" : "Press E when a hair is on your head!"}
        </div>

        {/* Marker over the head: where the hair has to be. */}
        <div style={{ color: ACCENT, fontSize: 10, lineHeight: 1 }}>▼</div>
        {/* Width follows the screen height too, so a landscape phone fits
            the whole card without scrolling (stage is 208:64 = 3.25:1). */}
        <div
          onPointerDown={(e) => { e.preventDefault(); act(); }}
          style={{
            position: "relative",
            width: "min(100%, calc((100dvh - 150px) * 3.25))",
            background: "#0b1020",
            borderRadius: 8,
            cursor: "pointer",
            touchAction: "none",
            userSelect: "none",
            WebkitUserSelect: "none",
            WebkitTouchCallout: "none",
          }}
        >
          <canvas
            ref={canvasRef}
            width={STAGE_W * SCALE}
            height={FH * SCALE}
            style={{ width: "100%", height: "auto", display: "block", imageRendering: "pixelated" }}
          />
          {!ready && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#9AA4B2" }}>
              Loading...
            </div>
          )}
          {r && (
            <div style={{ position: "absolute", top: 8, left: 0, right: 0, fontSize: 16, color: r.color, textShadow: "0 2px 0 #000", pointerEvents: "none" }}>
              {r.label}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 10, minHeight: 38 }}>
          {landed ? (
            <>
              <button onClick={again} style={btn("#2a3350", touch)}>AGAIN</button>
              {landed.rating !== "miss" && (
                <button onClick={keep} disabled={kept} style={{ ...btn(kept ? "#14F195" : ACCENT, touch), color: kept ? "#0b1020" : "#fff" }}>
                  {kept ? "SAVED!" : "KEEP IT"}
                </button>
              )}
            </>
          ) : (
            // Pointer-down, not click: click waits for the finger to lift,
            // which would land the hair late.
            <button
              onPointerDown={(e) => { e.preventDefault(); drop(); }}
              disabled={!ready}
              style={{ ...btn(ACCENT, touch), touchAction: "none" }}
            >
              {touch ? "DROP!" : "DROP! (E)"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function btn(bg: string, big = false): CSSProperties {
  return {
    background: bg,
    color: "#fff",
    fontFamily: FONT,
    fontSize: big ? 12 : 11,
    padding: big ? "12px 22px" : "10px 16px",
    borderRadius: 8,
    border: "2px solid rgba(0,0,0,0.4)",
    boxShadow: "0 3px 0 rgba(0,0,0,0.45)",
  };
}
