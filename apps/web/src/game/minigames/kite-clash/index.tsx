"use client";

import { useEffect, useRef, useState } from "react";
import { KiteClashEngine, type EngineSnapshot } from "./KiteClashEngine";
import type { MiniGameComponentProps } from "../types";
import type { MiniGameBaseContext } from "../types";

const WIND_BARS: Record<EngineSnapshot["windTier"], number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };

/**
 * Kite Clash — single-player MVP. Renders the animated scene on a <canvas>
 * (owned by KiteClashEngine) with the score/wind/line-length HUD as a DOM
 * overlay on top, matching the existing minigame overlays' convention of
 * crisp DOM text over a game canvas rather than canvas-drawn text.
 */
export default function KiteClashGame({ onResult, onClose }: MiniGameComponentProps<MiniGameBaseContext>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<KiteClashEngine | null>(null);
  const lastUiUpdateRef = useRef(0);
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null);

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

  const windArrow = snapshot?.windDirection === "left" ? "←" : "→";
  const windBars = snapshot ? WIND_BARS[snapshot.windTier] : 1;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "#0a0a14",
        fontFamily: '"Fira Code", monospace',
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
            fontSize: 13,
            color: "#7CFC4D",
            textShadow: "0 2px 0 #000, 2px 0 0 #000, -2px 0 0 #000, 0 -2px 0 #000",
          }}
        >
          PLAYER 1
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 4 }}>
          <span style={{ fontSize: 13 }}>✦</span>
          <span style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 10, color: "#fff" }}>
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
              fontSize: 16,
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
              fontSize: 13,
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
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 14 }}>
            {[1, 2, 3, 4, 5, 6].map((bar) => (
              <div
                key={bar}
                style={{
                  width: 4,
                  height: `${Math.min(14, bar * 2 + 2)}px`,
                  background: bar <= windBars * 2 ? "#2b3a4a" : "rgba(43,58,74,0.3)",
                  border: "1px solid #000",
                }}
              />
            ))}
          </div>
          <span style={{ fontSize: 14 }}>{windArrow}</span>
          <span style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 9, color: "#fff" }}>
            WIND SPEED: {snapshot?.windTier ?? "LOW"}
          </span>
        </div>
      </div>

      {/* Bottom-right: line length + a small decorative sparkle, matching the reference's corner accent */}
      <div style={{ position: "absolute", bottom: 90, right: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontFamily: '"Press Start 2P", monospace',
            fontSize: 12,
            color: "#fff",
            textShadow: "0 2px 0 #000, 2px 0 0 #000, -2px 0 0 #000, 0 -2px 0 #000",
          }}
        >
          LINE LENGTH: {snapshot?.lineLength ?? 0}m
        </span>
        <span style={{ fontSize: 14, color: "rgba(255,255,255,0.7)" }}>✦</span>
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
              fontSize: 32,
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
            fontSize: 14,
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
          fontSize: 11,
          borderRadius: 6,
          padding: "4px 10px",
          cursor: "pointer",
        }}
      >
        ESC — Close
      </button>

      {/* Controls hint */}
      <div
        style={{
          position: "absolute",
          bottom: 14,
          left: 16,
          fontSize: 10,
          color: "rgba(255,255,255,0.55)",
          lineHeight: 1.5,
        }}
      >
        WASD/Arrows: move<br />
        Hold Space: reel in (and cut, if crossing a rival's line)
      </div>

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
          <div style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 20, color: "#ff6b6b" }}>
            LINE CUT!
          </div>
          <div style={{ fontSize: 13, color: "#e2e8f0" }}>
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
              fontSize: 12,
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
              fontSize: 11,
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
