"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { track } from "@/game/telemetry/track";
import { KiteClashEngine, type EngineSnapshot } from "./KiteClashEngine";
import type { MiniGameComponentProps } from "../types";
import { fetchBoard, invalidateBoard, type BoardResult } from "@/game/leaderboards/boards";
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
const HOW_TO_PLAY_SEEN_KEY = "solcity.kiteClash.howToPlaySeen";
/** Set only when the player reaches the last card, not when they skip. */
const HOW_TO_PLAY_DONE_KEY = "solcity.kiteClash.howToPlayDone";

function readHowToPlayDone(): boolean {
  try { return localStorage.getItem(HOW_TO_PLAY_DONE_KEY) === "1"; } catch { return false; }
}
function markHowToPlayDone(): void {
  try { localStorage.setItem(HOW_TO_PLAY_DONE_KEY, "1"); } catch { /* storage blocked */ }
}

function readHowToPlaySeen(): boolean {
  try { return localStorage.getItem(HOW_TO_PLAY_SEEN_KEY) === "1"; } catch { return false; }
}
function markHowToPlaySeen(): void {
  try { localStorage.setItem(HOW_TO_PLAY_SEEN_KEY, "1"); } catch { /* storage blocked */ }
}

const OUTLINE = "0 2px 0 #000, 2px 0 0 #000, -2px 0 0 #000, 0 -2px 0 #000";

const BOARD = "game:kite-clash";

export default function KiteClashGame({ context, onResult, onClose }: MiniGameComponentProps<MiniGameBaseContext>) {
  const wallet = context?.wallet?.toBase58() ?? null;
  const [board, setBoard] = useState<BoardResult | null>(null);
  /** Runs already reported, so RELAUNCH can never report one twice. */
  const reportedRun = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<KiteClashEngine | null>(null);
  const lastUiUpdateRef = useRef(0);
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null);
  const [isTouch, setIsTouch] = useState(false);
  const [windShimmer, setWindShimmer] = useState(false);
  const [howToOpen, setHowToOpen] = useState(false);
  /** Highlight the tutorial button until the player has been through it. */
  const [howToDone, setHowToDone] = useState(true);
  useEffect(() => { setHowToDone(readHowToPlayDone()); }, []);

  const openHowTo = useCallback(() => {
    track("tutorial", "kite-clash", { value: 1, label: "opened" });
    setHowToOpen(true);
    engineRef.current?.setBriefing(true);
  }, []);
  const closeHowTo = useCallback((completed = false) => {
    track("tutorial", "kite-clash", {
      success: completed,
      label: completed ? "finished" : "closed early",
    });
    markHowToPlaySeen();
    if (completed) {
      markHowToPlayDone();
      setHowToDone(true);
    }
    setHowToOpen(false);
    engineRef.current?.setBriefing(false);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setWindShimmer((v) => !v), 350);
    return () => clearInterval(id);
  }, []);

  // The score is reported when the RUN ends, not when the player leaves:
  // RELAUNCH used to throw the run away without it ever reaching the board.
  // `keepOpen` leaves the end screen up, the way Sol Mechs does.
  useEffect(() => {
    if (snapshot?.phase !== "ended") return;
    const run = snapshot.runNumber;
    if (reportedRun.current === run) return;
    reportedRun.current = run;
    const score = snapshot.score;
    onResult({ success: score > 0, metadata: { score, keepOpen: true } })
      .catch(() => undefined)
      .finally(() => {
        // Our own score has just landed, so the cached board is stale.
        invalidateBoard(BOARD);
        fetchBoard(BOARD, { wallet, limit: 5, force: true }).then(setBoard).catch(() => undefined);
      });
  }, [snapshot?.phase, snapshot?.runNumber, snapshot?.score, onResult, wallet]);

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
    // First visit: the run waits behind the how-to-play card.
    if (!readHowToPlaySeen()) {
      setHowToOpen(true);
      engine.setBriefing(true);
    }
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
      // The card steps itself with Space/Enter/arrows; Escape skips it.
      if (howToOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          closeHowTo();
        }
        return;
      }
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose, howToOpen, closeHowTo]);

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
        @keyframes kc-glow { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,215,0,0.75); } 50% { box-shadow: 0 0 0 9px rgba(255,215,0,0); } }
        @keyframes kc-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        .kc-howto-glow { animation: kc-glow 1.3s ease-out infinite; }
        .kc-howto-bob { animation: kc-bob 0.9s ease-in-out infinite; }
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
      {snapshot?.phase === "ready" && !howToOpen && !snapshot.briefing && (
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

      {/* The lines cross but the kites fly at different depths, so nothing
          happens. Without this the ring just never filled. */}
      {snapshot?.phase === "playing" && snapshot.depthBlocked && (
        <div
          style={{
            position: "absolute",
            top: "26%",
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: 9,
            color: "#fff",
            textShadow: OUTLINE,
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          {snapshot.depthBlocked === "let-out"
            ? "TOO FAR APART — LET LINE OUT TO REACH THEM"
            : "TOO FAR APART — REEL IN TO REACH THEM"}
        </div>
      )}

      {/* Rival cut warning: mirrors the red ring at the crossing point */}
      {snapshot?.phase === "playing" && snapshot.rivalThreat > 0 && (
        <div
          style={{
            position: "absolute",
            top: "22%",
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: 10,
            color: "#ff5a5a",
            textShadow: OUTLINE,
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          RIVAL IS CUTTING YOUR LINE! MOVE AWAY
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
        ESC to close
      </button>
      {/* Tutorial button: labelled, orange, and pulsing with a pointer until
          the player has finished the cards once. */}
      {snapshot?.phase !== "ended" && <div style={{ position: "absolute", top: 44, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, zIndex: 3 }}>
        <button
          onClick={openHowTo}
          aria-label="How to play"
          className={howToDone ? undefined : "kc-howto-glow"}
          style={{
            display: "flex", alignItems: "center", gap: 7,
            background: howToDone ? "rgba(0,0,0,0.45)" : "#FFA94D",
            border: `2px solid ${howToDone ? "rgba(255,169,77,0.6)" : "#FFD700"}`,
            color: howToDone ? "#FFA94D" : "#0a0a14",
            fontFamily: '"Press Start 2P", monospace',
            fontSize: 9, borderRadius: 8, padding: "7px 12px", cursor: "pointer",
          }}
        >
          <span style={{
            width: 16, height: 16, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: howToDone ? "#FFA94D" : "#0a0a14", color: howToDone ? "#0a0a14" : "#FFA94D", fontSize: 9,
          }}>?</span>
          HOW TO PLAY
        </button>
        {!howToDone && !howToOpen && (
          <span className="kc-howto-bob" style={{
            fontSize: 7, color: "#FFD700", textShadow: OUTLINE, whiteSpace: "nowrap", pointerEvents: "none",
          }}>
            ▲ NEW? START HERE
          </span>
        )}
      </div>}

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
              ✂ HOLD SPACE — KEEP HOLDING TO CUT
            </span>
          ) : (
            "Cross the orange line, hold Space"
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
            onContextMenu={(e) => e.preventDefault()}
            style={{
              width: 110, height: 110, borderRadius: "50%",
              background: "rgba(153,69,255,0.12)",
              border: "2px solid rgba(153,69,255,0.35)",
              display: "flex", alignItems: "center", justifyContent: "center",
              touchAction: "none", userSelect: "none", pointerEvents: "auto",
              WebkitUserSelect: "none", WebkitTouchCallout: "none",
            }}
          >
            <div ref={joystickThumbRef} style={{
              width: 40, height: 40, borderRadius: "50%",
              background: "rgba(153,69,255,0.55)",
              border: "2px solid rgba(153,69,255,0.85)",
              pointerEvents: "none", willChange: "transform",
            }} />
          </div>

          {/* Right — REEL / CUT hold button. Pointer capture keeps the hold
              alive when the finger drifts off the button, and suppressing the
              context menu / touch callout stops the OS long-press gesture
              from firing pointercancel mid-hold — which silently dropped the
              reel before the 500ms cut roll could ever resolve on mobile. */}
          <button
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              engineRef.current?.setTouchReel(true);
            }}
            onPointerUp={() => engineRef.current?.setTouchReel(false)}
            onPointerCancel={() => engineRef.current?.setTouchReel(false)}
            onContextMenu={(e) => e.preventDefault()}
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
              WebkitUserSelect: "none",
              WebkitTouchCallout: "none",
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

      {howToOpen && (
        <HowToPlayCard isTouch={isTouch} onStart={closeHowTo} />
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
          <div style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 15, color: "#ff6b6b", textAlign: "center", padding: "0 16px" }}>
            {snapshot.endReason?.title ?? "LINE CUT!"}
          </div>
          {snapshot.endReason && (
            <>
              {/* The reason as a picture, with one short tip under it. */}
              <div style={{
                position: "relative", width: "min(280px, 70vw)", aspectRatio: "2 / 1", overflow: "hidden",
                borderRadius: 8, border: "2px solid rgba(255,90,90,0.6)",
                backgroundImage: `url(${KITE}/background.png)`, backgroundSize: "cover",
                backgroundPosition: "center 30%", imageRendering: "pixelated",
              }}>
                {snapshot.endReason.kind === "rival" ? <CrossScene ring="threat" /> : <ReelScene />}
              </div>
              <div style={{ fontSize: 9, color: "#FFD700", textAlign: "center", padding: "0 20px" }}>
                {snapshot.endReason.detail}
              </div>
            </>
          )}
          <div style={{ fontSize: 10, color: "#e2e8f0" }}>
            SCORE <span style={{ color: "#FFD700", fontSize: 14 }}>{snapshot.score}</span>
          </div>

          {board && (board.rows.length > 0 || board.mine) && (
            <div style={{ width: "min(280px, 76vw)", fontSize: 8, lineHeight: 1.9 }}>
              <div style={{ color: "#8ab4f8", marginBottom: 4 }}>BEST KITES IN THE CITY</div>
              {board.rows.map((row, i) => (
                <div
                  key={row.wallet}
                  style={{
                    display: "flex", gap: 8,
                    color: wallet && row.wallet === wallet ? "#FFD700" : "#cbd5e1",
                  }}
                >
                  <span style={{ width: 14, color: "#64748b" }}>{i + 1}</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {row.name ?? `${row.wallet.slice(0, 4)}…${row.wallet.slice(-4)}`}
                  </span>
                  <span>{row.value}</span>
                </div>
              ))}
              {board.mine && (
                <div style={{ color: "#94a3b8", marginTop: 4 }}>
                  Your best {board.mine.value}
                  {board.mine.rank ? ` · #${board.mine.rank}` : ""}
                </div>
              )}
              {!wallet && (
                <div style={{ color: "#64748b", marginTop: 4 }}>
                  Connect a wallet to take your place on the board.
                </div>
              )}
            </div>
          )}
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
            onClick={openHowTo}
            className={howToDone ? undefined : "kc-howto-glow"}
            style={{
              background: howToDone ? "transparent" : "#FFA94D",
              border: `1px solid ${howToDone ? "rgba(255,169,77,0.6)" : "#FFD700"}`,
              borderRadius: 8, padding: "8px 18px", cursor: "pointer",
              color: howToDone ? "#FFA94D" : "#0a0a14",
              fontFamily: '"Press Start 2P", monospace', fontSize: 8,
            }}
          >
            ? HOW TO PLAY
          </button>
          <button
            onClick={onClose}
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

const KITE = "/assets/minigames/kite";

interface HowToStep {
  key: string;
  text: string;
  scene: React.ReactNode;
  warning?: boolean;
}

/**
 * How to play, one idea per card: a small scene built from the game's own
 * art on top, the key and its sentence under it, NEXT to move on.
 */
function HowToPlayCard({ isTouch, onStart }: { isTouch: boolean; onStart: (completed?: boolean) => void }) {
  const steps: HowToStep[] = [
    {
      key: isTouch ? "JOYSTICK" : "WASD / ARROWS",
      text: "Steer your kite around the sky.",
      scene: <SteerScene isTouch={isTouch} />,
    },
    {
      key: isTouch ? "HOLD REEL" : "HOLD SPACE",
      text: "Reel your line in. Release to let it out: more line = more points, but riskier.",
      scene: <ReelScene />,
    },
    {
      key: isTouch ? "HOLD CUT" : "SPACE TO CUT",
      text: isTouch
        ? "Cross the orange line and hold the button: a ring fills. Full ring = their line is cut."
        : "Cross the orange line and hold Space: a ring fills. Full ring = their line is cut.",
      scene: <CrossScene ring="cut" />,
    },
    {
      key: "SAME HEIGHT",
      text: "Only kites flying at a similar line length can touch. If the crossing shows a dashed ring and an arrow, match their line: the arrow says reel in or let out.",
      scene: <CrossScene ring="cut" />,
    },
    {
      key: "RING COLOUR",
      text: "Green ring: your line is tight and the cut is safe. Orange: you have a lot of line out and it may snap yours instead. Let go and the ring empties.",
      scene: <CrossScene ring="cut" />,
    },
    {
      key: "WATCH OUT",
      text: "While the lines stay crossed, a RED RING fills around the crossing. When it closes the rival cuts you. Steer away to reset it.",
      scene: <CrossScene ring="threat" />,
      warning: true,
    },
  ];
  const [i, setI] = useState(0);
  const last = i === steps.length - 1;
  const step = steps[i];
  const next = useCallback(() => { if (last) onStart(true); else setI((n) => n + 1); }, [last, onStart]);
  const back = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight" || e.key === "e" || e.key === "E") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, back]);

  const accent = step.warning ? "#ff5a5a" : "#FFA94D";

  return (
    <div
      style={{
        position: "absolute", inset: 0, zIndex: 5, padding: 16,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(6,10,20,0.78)",
      }}
    >
      <div
        style={{
          width: "100%", maxWidth: 440, maxHeight: "100%", overflowY: "auto",
          background: "rgba(10,14,30,0.97)", border: `2px solid ${accent}`, borderRadius: 12,
          padding: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "#FFA94D", textShadow: OUTLINE }}>HOW TO PLAY</span>
          <span style={{ marginLeft: "auto", fontSize: 8, color: "#94a3b8" }}>{i + 1} / {steps.length}</span>
        </div>

        <div key={i} className="kc-step" style={{
          position: "relative", width: "100%", aspectRatio: "2 / 1", overflow: "hidden",
          borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)",
          backgroundImage: `url(${KITE}/background.png)`, backgroundSize: "cover",
          backgroundPosition: "center 30%", imageRendering: "pixelated",
        }}>
          {step.scene}
        </div>

        <div style={{ display: "flex", justifyContent: "center", margin: "12px 0 8px" }}>
          <span style={{
            fontSize: 8, color: "#0a0a14", background: step.warning ? "#ff5a5a" : "#FFD700",
            borderRadius: 4, padding: "5px 8px",
          }}>
            {step.key}
          </span>
        </div>
        <p style={{
          margin: 0, minHeight: "5.4em", fontSize: 8, lineHeight: 1.8, textAlign: "center",
          color: step.warning ? "#fca5a5" : "#e2e8f0",
        }}>
          {step.text}
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <button onClick={back} disabled={i === 0} style={{ ...navBtn, visibility: i === 0 ? "hidden" : "visible" }}>
            BACK
          </button>
          <div style={{ flex: 1, display: "flex", justifyContent: "center", gap: 6 }}>
            {steps.map((_, n) => (
              <span key={n} style={{
                width: n === i ? 16 : 6, height: 6, borderRadius: 3, transition: "width .2s",
                background: n === i ? accent : n < i ? "#64748b" : "#334155",
              }} />
            ))}
          </div>
          <button onClick={next} style={{
            ...navBtn, border: "none", color: "#0a0a14",
            background: "linear-gradient(135deg, #9945FF, #c084fc)",
          }}>
            {last ? "PLAY" : "NEXT"}
          </button>
        </div>
        {!last && (
          <button onClick={() => onStart(false)} style={{
            display: "block", margin: "10px auto 0", background: "none", border: "none",
            color: "#64748b", fontFamily: '"Press Start 2P", monospace', fontSize: 7, cursor: "pointer",
          }}>
            SKIP TUTORIAL
          </button>
        )}
      </div>
      <style>{`
        @keyframes kc-step-in { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: none; } }
        .kc-step { animation: kc-step-in .22s ease; }
        @keyframes kc-steer { 0%,100% { left: 34%; } 50% { left: 66%; } }
        @keyframes kc-reel { 0%,100% { height: 26px; top: 24%; } 50% { height: 50px; top: 34%; } }
        @keyframes kc-ring { from { stroke-dashoffset: 94; } to { stroke-dashoffset: 0; } }
        @keyframes kc-pulse { 0%,100% { opacity: .95; } 50% { opacity: .5; } }
      `}</style>
    </div>
  );
}

const navBtn: React.CSSProperties = {
  fontFamily: '"Press Start 2P", monospace', fontSize: 8, borderRadius: 8, padding: "9px 14px",
  cursor: "pointer", background: "transparent", border: "1px solid rgba(255,255,255,0.25)", color: "#cbd5e1",
};

const PIX: React.CSSProperties = { position: "absolute", imageRendering: "pixelated" };

function KeyCap({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 22, height: 20, borderRadius: 4,
      background: "#f8fafc", color: "#0a0a14", fontSize: 8,
      boxShadow: "0 3px 0 #64748b",
    }}>
      {children}
    </span>
  );
}

function SceneTag({ children, color, left }: { children: React.ReactNode; color: string; left?: boolean }) {
  return (
    <span style={{
      position: "absolute", top: 8, [left ? "left" : "right"]: 8,
      fontSize: 7, color, textShadow: OUTLINE,
    }}>
      {children}
    </span>
  );
}

/** Kite gliding left and right, with the steering keys (or joystick) under it. */
function SteerScene({ isTouch }: { isTouch: boolean }) {
  return (
    <>
      <img src={`${KITE}/kites/kite_brazil.png`} alt="" style={{
        ...PIX, top: "12%", height: 54, transform: "translateX(-50%)",
        animation: "kc-steer 2.6s ease-in-out infinite",
      }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 10, display: "flex", justifyContent: "center" }}>
        {isTouch ? (
          <span style={{
            width: 44, height: 44, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(153,69,255,0.3)", border: "2px solid rgba(153,69,255,0.85)",
          }}>
            <span style={{ width: 18, height: 18, borderRadius: "50%", background: "rgba(153,69,255,0.95)" }} />
          </span>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 22px)", gap: 4, justifyItems: "center" }}>
            <span />
            <KeyCap>W</KeyCap>
            <span />
            <KeyCap>A</KeyCap>
            <KeyCap>S</KeyCap>
            <KeyCap>D</KeyCap>
          </div>
        )}
      </div>
    </>
  );
}

/** The spool in hand, the kite drawing near (bigger) and drifting out (smaller). */
function ReelScene() {
  return (
    <>
      <svg viewBox="0 0 100 50" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <line x1="50" y1="42" x2="50" y2="16" stroke="rgba(255,255,255,0.85)" strokeWidth="0.4" />
      </svg>
      <img src={`${KITE}/kites/kite_brazil.png`} alt="" style={{
        ...PIX, left: "50%", transform: "translateX(-50%)",
        animation: "kc-reel 2.4s ease-in-out infinite",
      }} />
      <img src={`${KITE}/hands/hands_human.png`} alt="" style={{
        ...PIX, left: "50%", bottom: -4, transform: "translateX(-50%)", height: 60,
      }} />
      <SceneTag color="#fff" left>HOLD = REEL IN</SceneTag>
      <SceneTag color="#FFD700">RELEASE = POINTS</SceneTag>
    </>
  );
}

/** Your line crossing the rival's dashed orange line, with the cut circle or the red ring. */
function CrossScene({ ring }: { ring: "cut" | "threat" }) {
  return (
    <>
      <svg viewBox="0 0 200 100" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <line x1="100" y1="104" x2="72" y2="30" stroke="rgba(255,255,255,0.9)" strokeWidth="1.2" />
        <line x1="20" y1="104" x2="128" y2="32" stroke="rgba(255,107,53,0.95)" strokeWidth="1.2" strokeDasharray="4 3" />
        {ring === "cut" ? (
          <circle cx="84" cy="61.4" r="9" fill="rgba(255,215,0,0.45)" stroke="#FFD700" strokeWidth="1.6"
            style={{ animation: "kc-pulse 0.9s ease-in-out infinite" }} />
        ) : (
          <>
            <circle cx="84" cy="61.4" r="15" fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth="3" />
            <circle cx="84" cy="61.4" r="15" fill="none" stroke="#ff3b3b" strokeWidth="3"
              strokeDasharray="94" transform="rotate(-90 84 61.4)"
              style={{ animation: "kc-ring 2.2s linear infinite" }} />
          </>
        )}
      </svg>
      <img src={`${KITE}/kites/kite_brazil.png`} alt="" style={{
        ...PIX, left: "36%", top: "30%", height: 44, transform: "translate(-50%, -85%)",
      }} />
      <img src={`${KITE}/kites/kite_stb.png`} alt="" style={{
        ...PIX, left: "64%", top: "32%", height: 36, transform: "translate(-50%, -85%)",
      }} />
      {ring === "threat"
        ? <SceneTag color="#ff5a5a">MOVE AWAY!</SceneTag>
        : <SceneTag color="#FFD700">CUT HERE</SceneTag>}
    </>
  );
}
