"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { KiteClashEngine, type EngineSnapshot } from "./KiteClashEngine";
import type { MiniGameComponentProps } from "../types";
import type { MiniGameBaseContext } from "../types";

const isTouchDevice = () =>
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

const KITE_UI = "/assets/minigames/kite/ui";
const PIXELATED: React.CSSProperties = { imageRendering: "pixelated" };

// Wind gauge fill frame per tier (wind_power1-6.png, increasing fill).
// Each tier alternates between two adjacent frames for a windy shimmer.
const WIND_FRAME_BASE: Record<EngineSnapshot["windTier"], number> = { LOW: 2, MEDIUM: 4, HIGH: 6 };

/**
 * Kite Clash — single-player MVP. Renders the animated scene on a <canvas>
 * (owned by KiteClashEngine) with the score/wind/line-length HUD as a DOM
 * overlay on top, matching the existing minigame overlays' convention of
 * crisp DOM text over a game canvas rather than canvas-drawn text.
 */
const JOYSTICK_R = 48; // px

export default function KiteClashGame({ onResult, onClose }: MiniGameComponentProps<MiniGameBaseContext>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<KiteClashEngine | null>(null);
  const lastUiUpdateRef = useRef(0);
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null);
  const [isTouch, setIsTouch] = useState(false);
  const [windShimmer, setWindShimmer] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setWindShimmer((v) => !v), 350);
    return () => clearInterval(id);
  }, []);

  // joystick state refs (not React state — updated on every pointer move)
  const joystickOrigin = useRef({ x: 0, y: 0 });
  const joystickPointerId = useRef<number | null>(null);
  const joystickThumbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsTouch(isTouchDevice());
  }, []);

  // Joystick handlers
  const onJoyDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (joystickPointerId.current !== null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    joystickPointerId.current = e.pointerId;
    const rect = e.currentTarget.getBoundingClientRect();
    joystickOrigin.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, []);

  const onJoyMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (joystickPointerId.current !== e.pointerId) return;
    const dx = e.clientX - joystickOrigin.current.x;
    const dy = e.clientY - joystickOrigin.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const clamped = Math.min(dist, JOYSTICK_R);
    const angle = Math.atan2(dy, dx);
    const tx = Math.cos(angle) * clamped;
    const ty = Math.sin(angle) * clamped;
    if (joystickThumbRef.current) joystickThumbRef.current.style.transform = `translate(${tx}px,${ty}px)`;
    engineRef.current?.setTouchMove(tx / JOYSTICK_R, ty / JOYSTICK_R);
  }, []);

  const onJoyRelease = useCallback(() => {
    joystickPointerId.current = null;
    if (joystickThumbRef.current) joystickThumbRef.current.style.transform = "translate(0px,0px)";
    engineRef.current?.setTouchMove(0, 0);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new KiteClashEngine(canvas, {
      onSnapshot: (s) => {
        const now = performance.now();
        // Throttle React re-renders to ~10/sec — the canvas itself still
        // animates at full frame rate inside the engine's own loop.
        const dueForUiUpdate = now - lastUiUpdateRef.current > 100;
        setSnapshot((prev) => {
          if (!dueForUiUpdate && prev && prev.phase === s.phase && prev.cutMessage === s.cutMessage) return prev;
          lastUiUpdateRef.current = now;
          return s;
        });
      },
    });
    engineRef.current = engine;
    engine.start();

    const onResize = () => engine.resize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      engine.destroy();
    };
  }, []);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const windFrame = Math.max(
    1,
    WIND_FRAME_BASE[snapshot?.windTier ?? "LOW"] - (windShimmer ? 1 : 0)
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "#0a0a14",
        fontFamily: '"Press Start 2P", monospace',
        color: "#fff",
      }}
    >
      <style>{`
        @keyframes kc-fadeOut { 0% { opacity: 1; } 70% { opacity: 1; } 100% { opacity: 0; } }
        @keyframes kc-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.25); } }
        .kc-ready { animation: kc-fadeOut 1.2s ease forwards; }
        .kc-multiplier-pulse { animation: kc-pulse 0.4s ease; }
      `}</style>

      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />

      {/* Top-left: player label + run counter — reference shows a LIVES
          counter here, but the GDD is permadeath (1 life), so RUN # takes
          that visual slot instead (see Section 3 "known mismatch" note). */}
      <div style={{ position: "absolute", top: 14, left: 16 }}>
        <div
          style={{
            fontFamily: '"Press Start 2P", monospace',
            fontSize: 10,
            color: "#7CFC4D",
            textShadow: "0 2px 0 #000, 2px 0 0 #000, -2px 0 0 #000, 0 -2px 0 #000",
          }}
        >
          PLAYER 1
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 4 }}>
          {/* One heart — the GDD is permadeath (1 life per run). */}
          <img src={`${KITE_UI}/ico_heart.png`} width={18} height={18} alt="Life" draggable={false} style={PIXELATED} />
          <span style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 8, color: "#fff" }}>
            RUN #{snapshot?.runNumber ?? 1}
          </span>
        </div>
      </div>

      {/* Top-right: score + multiplier, then wind indicator below */}
      <div style={{ position: "absolute", top: 14, right: 16, textAlign: "right" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, justifyContent: "flex-end" }}>
          <span
            style={{
              fontFamily: '"Press Start 2P", monospace',
              fontSize: 12,
              textShadow: "0 2px 0 #000, 2px 0 0 #000, -2px 0 0 #000, 0 -2px 0 #000",
            }}
          >
            <span style={{ color: "#FFA94D" }}>SCORE:</span>{" "}
            <span style={{ color: "#fff" }}>{String(snapshot?.score ?? 0).padStart(6, "0")}</span>
          </span>
          <span
            key={snapshot?.multiplier}
            className="kc-multiplier-pulse"
            style={{
              fontFamily: '"Press Start 2P", monospace',
              fontSize: 10,
              padding: "2px 7px",
              borderRadius: 6,
              background: (snapshot?.multiplier ?? 1) > 1 ? "rgba(20,241,149,0.25)" : "rgba(255,255,255,0.12)",
              color: (snapshot?.multiplier ?? 1) > 1 ? "#14F195" : "#cbd5e1",
              border: `1px solid ${(snapshot?.multiplier ?? 1) > 1 ? "#14F195" : "rgba(255,255,255,0.2)"}`,
            }}
          >
            x{snapshot?.multiplier ?? 1}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, justifyContent: "flex-end", marginTop: 8 }}>
          {/* Pixel-art wind gauge — fill frame follows the tier, shimmering
              between two adjacent frames so it reads as live wind. */}
          <img
            src={`${KITE_UI}/wind_power${windFrame}.png`}
            width={68} height={34} alt="" draggable={false}
            style={PIXELATED}
          />
          <img
            src={`${KITE_UI}/ico_arrow.png`}
            width={22} height={11} alt={snapshot?.windDirection === "left" ? "Wind left" : "Wind right"}
            draggable={false}
            style={{
              ...PIXELATED,
              transform: snapshot?.windDirection === "left" ? "scaleX(-1)" : "none",
            }}
          />
          <span style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 7, color: "#fff" }}>
            WIND SPEED: {snapshot?.windTier ?? "LOW"}
          </span>
        </div>
      </div>

      {/* Bottom-right: line length + a small decorative sparkle, matching the reference's corner accent */}
      <div style={{ position: "absolute", bottom: 90, right: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontFamily: '"Press Start 2P", monospace',
            fontSize: 9,
            color: "#fff",
            textShadow: "0 2px 0 #000, 2px 0 0 #000, -2px 0 0 #000, 0 -2px 0 #000",
          }}
        >
          LINE LENGTH: {snapshot?.lineLength ?? 0}m
        </span>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>✦</span>
      </div>

      {/* Center: READY! overlay */}
      {snapshot?.phase === "ready" && (
        <div
          className="kc-ready"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              fontFamily: '"Press Start 2P", monospace',
              fontSize: 22,
              color: "rgba(255,255,255,0.45)",
              textShadow: "0 4px 12px rgba(0,0,0,0.5)",
              letterSpacing: 2,
            }}
          >
            READY!
          </span>
        </div>
      )}

      {/* Transient cut/event message */}
      {snapshot?.cutMessage && snapshot.phase === "playing" && (
        <div
          style={{
            position: "absolute",
            top: "30%",
            left: "50%",
            transform: "translateX(-50%)",
            fontFamily: '"Press Start 2P", monospace',
            fontSize: 11,
            color: "#FFD700",
            textShadow: "0 2px 6px rgba(0,0,0,0.7)",
            pointerEvents: "none",
          }}
        >
          {snapshot.cutMessage}
        </div>
      )}

      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: "absolute",
          top: 14,
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(0,0,0,0.35)",
          border: "1px solid rgba(255,255,255,0.2)",
          color: "#cbd5e1",
          fontSize: 8,
          borderRadius: 6,
          padding: "4px 10px",
          cursor: "pointer",
        }}
      >
        ESC — Close
      </button>

      {/* Controls hint — desktop only (on mobile the touch buttons replace this) */}
      {!isTouch && (
        <div
          style={{
            position: "absolute",
            bottom: 14,
            left: 16,
            fontSize: 8,
            color: snapshot?.nearbyOpponent ? "#FFD700" : "rgba(255,255,255,0.55)",
            lineHeight: 1.5,
          }}
        >
          WASD/Arrows: move
          <br />
          {snapshot?.nearbyOpponent ? (
            <span style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 8 }}>
              ✂ HOLD SPACE TO CUT!
            </span>
          ) : (
            "Cross your line over a rival's (orange) at a similar depth, then hold Space to cut it"
          )}
        </div>
      )}

      {/* Touch controls — only on mobile */}
      {isTouch && snapshot?.phase === "playing" && (
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          display: "flex", justifyContent: "space-between", alignItems: "flex-end",
          padding: "0 20px max(env(safe-area-inset-bottom, 0px), 20px)",
          pointerEvents: "none",
        }}>
          {/* Left — kite joystick */}
          <div
            onPointerDown={onJoyDown}
            onPointerMove={onJoyMove}
            onPointerUp={onJoyRelease}
            onPointerCancel={onJoyRelease}
            style={{
              width: 110, height: 110, borderRadius: "50%",
              background: "rgba(153,69,255,0.12)",
              border: "2px solid rgba(153,69,255,0.35)",
              display: "flex", alignItems: "center", justifyContent: "center",
              touchAction: "none", userSelect: "none", pointerEvents: "auto",
            }}
          >
            <div ref={joystickThumbRef} style={{
              width: 40, height: 40, borderRadius: "50%",
              background: "rgba(153,69,255,0.55)",
              border: "2px solid rgba(153,69,255,0.85)",
              pointerEvents: "none", willChange: "transform",
            }} />
          </div>

          {/* Right — REEL / CUT hold button */}
          <button
            onPointerDown={(e) => { e.preventDefault(); engineRef.current?.setTouchReel(true); }}
            onPointerUp={() => engineRef.current?.setTouchReel(false)}
            onPointerCancel={() => engineRef.current?.setTouchReel(false)}
            style={{
              width: 90, height: 90, borderRadius: "50%",
              background: snapshot?.nearbyOpponent
                ? "rgba(255,107,53,0.35)"
                : "rgba(20,241,149,0.18)",
              border: `2px solid ${snapshot?.nearbyOpponent ? "#FF6B35" : "rgba(20,241,149,0.5)"}`,
              color: snapshot?.nearbyOpponent ? "#FF6B35" : "#14F195",
              fontSize: "7px",
              fontFamily: '"Press Start 2P", monospace',
              cursor: "pointer",
              touchAction: "none",
              userSelect: "none",
              pointerEvents: "auto",
              display: "flex", alignItems: "center", justifyContent: "center",
              textAlign: "center", lineHeight: 1.4,
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {snapshot?.nearbyOpponent ? "✂ CUT" : "REEL"}
          </button>
        </div>
      )}

      {/* End screen */}
      {snapshot?.phase === "ended" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            background: "rgba(6,10,20,0.72)",
          }}
        >
          <div style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 15, color: "#ff6b6b" }}>
            LINE CUT!
          </div>
          <div style={{ fontSize: 10, color: "#e2e8f0" }}>
            Final score: <span style={{ color: "#FFD700" }}>{snapshot.score}</span>
          </div>
          <button
            onClick={() => engineRef.current?.relaunch()}
            style={{
              background: "linear-gradient(135deg, #9945FF, #c084fc)",
              border: "none",
              borderRadius: 8,
              padding: "10px 24px",
              color: "#0a0a14",
              fontFamily: '"Press Start 2P", monospace',
              fontSize: 9,
              cursor: "pointer",
            }}
          >
            RELAUNCH
          </button>
          <button
            onClick={() => {
              onResult({ success: snapshot.score > 0, metadata: { score: snapshot.score } }).catch(() => undefined);
              onClose();
            }}
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 8,
              padding: "8px 20px",
              color: "#cbd5e1",
              fontSize: 8,
              cursor: "pointer",
            }}
          >
            Leave
          </button>
        </div>
      )}
    </div>
  );
}
