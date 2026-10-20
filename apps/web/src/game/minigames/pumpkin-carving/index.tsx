"use client";

/**
 * Pumpkin Carving (Jack O' Lantern, Halloween): the face is marked on the
 * pumpkin and stays there; the player traces it with a finger or the mouse
 * against a one minute clock. When the carve ends an accuracy meter fills up,
 * and 80% or better is a clean carve that pays the Pumpkin Head. The review
 * then marks every slip in red, because the pattern never changes and the next
 * attempt is where that knowledge pays.
 *
 * The knife is heavy (see KNIFE_SPEED): it cuts where its tip is, and the tip
 * trails a pointer that moves too fast. Each shape cut all the way round pops
 * its piece out. Placeholder art is painted in code (art.ts) until the sheets
 * exist. One fixed pattern, free attempts, instant retry.
 *
 * Layout: the pumpkin and a side panel, side by side. The city runs landscape
 * on phones, so the pumpkin is sized off the screen HEIGHT and the panel sits
 * beside it; on a narrow portrait screen the panel wraps underneath.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { MiniGameComponentProps } from "../types";
import { useLeaveStake } from "../leaveGuard";
import { CloseButton, RankBadge } from "@/ui/PixelIcons";
import { useButtonFeel, feelStyle, type ButtonFeel } from "@/ui/useButtonFeel";
import { chamferBox, chamferClip } from "@/ui/chamfer";
import { removeChroma, CROPS } from "@/ui/AvatarPortrait";
import { CATEGORY_META } from "@/game/minimap/categories";
import { fetchBoard, invalidateBoard, type BoardResult } from "@/game/leaderboards/boards";
import { profileManager } from "@/game/config/profileManager";
import { isVariantUnlocked } from "@/game/config/wardrobeUnlocks";
import {
  DIRECTION_ROW,
  SPRITE_FRAME_WIDTH as FW,
  SPRITE_FRAME_HEIGHT as FH,
  getVariant,
} from "@/game/config/paperDoll";
import { ART, CARVE_SECONDS, PASS_ACCURACY, PATTERN } from "./pattern";
import { CarvingEngine } from "./CarvingEngine";
import { soundManager } from "@/game/audio/SoundManager";
import { track } from "@/game/telemetry/track";
import { HowToPlay, readHowToSeen } from "./HowToPlay";
import { attemptsLeft, spendAttempt, foundCount, PUMPKINS_PER_HUNT } from "@/game/halloween/pumpkinHunt";

const FONT = '"Press Start 2P", monospace';
/** A mini-game's window wears the map legend's "Mini-games" colour, like the rest of the games. */
const ACCENT = CATEGORY_META.games.color;
/** Text on top of ACCENT: dark, so it reads. */
const ON_ACCENT = "#1a1405";
const GOOD = "#14F195";
const BAD = "#FF4D6D";

const BOARD = "game:pumpkin-carving";
/** The reward, as a paper-doll variant. Same pair outfitRewards grants. */
const REWARD_CATEGORY = "hat" as const;
const REWARD_ID = "Pumpkin_head";
/** How long the accuracy meter takes to fill before the verdict. */
const METER_MS = 1600;

const STYLES = `
@keyframes pc-urgent { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .65; transform: scale(1.1); } }
@keyframes pc-pop { 0% { opacity: 0; transform: scale(.8); } 60% { opacity: 1; transform: scale(1.08); } 100% { transform: scale(1); } }
@keyframes pc-ring { 0% { transform: translate(-50%,-50%) scale(.6); opacity: 1; } 100% { transform: translate(-50%,-50%) scale(1.8); opacity: 0; } }
.pc-urgent { animation: pc-urgent .65s ease-in-out infinite; }
.pc-pop { animation: pc-pop .35s ease-out; }
.pc-ring { animation: pc-ring 1.1s ease-out infinite; }
@keyframes pc-stamp { 0% { opacity: 0; transform: scale(2.2) rotate(-8deg); } 70% { opacity: 1; transform: scale(.94) rotate(-4deg); } 100% { transform: scale(1) rotate(-4deg); } }
@keyframes pc-shine { 0% { transform: translateX(-120%) skewX(-20deg); } 60%, 100% { transform: translateX(260%) skewX(-20deg); } }
.pc-stamp { animation: pc-stamp .4s cubic-bezier(.2,.9,.3,1.2) both; display: inline-block; }
.pc-shine { position: absolute; top: 0; bottom: 0; width: 40%; background: linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent); animation: pc-shine 2.4s ease-in-out .3s infinite; pointer-events: none; }
`;

type Phase = "ready" | "carving" | "scoring" | "done";
type RewardState = "new" | "owned" | "no-wallet";

function clock(s: number): string {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Android buzzes, everything else ignores it. */
function buzz(pattern: number | number[]): void {
  try { navigator.vibrate?.(pattern); } catch { /* not allowed here */ }
}

/**
 * The best carve on this device. The city board is per wallet and needs the
 * network; this is the player's own mark to beat, there from the first try.
 */
const BEST_KEY = "solcity:pumpkinCarving:best";
function readBest(): number {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; }
}
function saveBest(value: number): void {
  try { localStorage.setItem(BEST_KEY, String(value)); } catch { /* storage blocked */ }
}

/** The touch loupe: its size in css px, and how far above the finger it floats. */
const LOUPE_SIZE = 104;
const LOUPE_LIFT = 96;

/** Where the start ring sits: the first corner of the first shape, in %. */
/** The city prop, reused in the panel and the how-to so they match. */
export const PUMPKIN_ICON = "/assets/sprites/world/pumpkin.png";

const START = { left: `${(PATTERN[0][0][0] / ART) * 100}%`, top: `${(PATTERN[0][0][1] / ART) * 100}%` };

export default function PumpkinCarving({ onResult, onClose }: MiniGameComponentProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<CarvingEngine | null>(null);
  const pointerRef = useRef<number | null>(null);
  const deadlineRef = useRef(0);
  // A ref, so a new onResult from the page cannot restart the meter mid-fill.
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const [phase, setPhase] = useState<Phase>("ready");
  const phaseRef = useRef<Phase>("ready");
  phaseRef.current = phase;
  const [timeLeft, setTimeLeft] = useState(CARVE_SECONDS);
  const [timedOut, setTimedOut] = useState(false);
  const [accuracy, setAccuracy] = useState(0);
  const [shown, setShown] = useState(0);
  const [opened, setOpened] = useState<boolean[]>(() => PATTERN.map(() => false));
  const [reward, setReward] = useState<RewardState | null>(null);
  const [board, setBoard] = useState<BoardResult | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  /** The best before this carve (drawn on the meter), and whether this one beat it. */
  const [best, setBest] = useState(0);
  const [newBest, setNewBest] = useState(false);
  useEffect(() => { setBest(readBest()); }, []);
  const lastSecondRef = useRef(CARVE_SECONDS);

  const [touch, setTouch] = useState(false);
  useEffect(() => { setTouch(window.matchMedia("(pointer: coarse)").matches); }, []);
  /** First visit opens on the how-to cards, like the other games. */
  /**
   * Carves this player has left, one per pumpkin picked up in the city, or
   * null when the hunt does not apply and the knife is free: a guest, who
   * has no wallet to collect pumpkins against (see halloween/pumpkinHunt).
   */
  const [attempts, setAttempts] = useState<number | null>(() => attemptsLeft());
  const attemptsRef = useRef(attempts);
  attemptsRef.current = attempts;
  const outOfPumpkins = attempts === 0;
  const [howTo, setHowTo] = useState(false);
  const howToRef = useRef(false);
  howToRef.current = howTo;
  useEffect(() => { if (!readHowToSeen()) setHowTo(true); }, []);
  const openHowTo = useCallback(() => {
    track("tutorial", "pumpkin-carving", { value: 1, label: "opened" });
    setHowTo(true);
  }, []);
  const closeHowTo = useCallback(() => setHowTo(false), []);

  /** The touch loupe: shown and moved imperatively, never through state. */
  const loupeRef = useRef<HTMLDivElement>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null);
  const placeLoupe = (clientX: number, clientY: number) => {
    const el = loupeRef.current;
    if (!el) return;
    // Above the finger; beside it when the top of the screen is too close.
    const above = clientY - LOUPE_LIFT - LOUPE_SIZE / 2 > 4;
    const x = above ? clientX : clientX + (clientX > window.innerWidth / 2 ? -1 : 1) * LOUPE_LIFT;
    const y = above ? clientY - LOUPE_LIFT : Math.max(LOUPE_SIZE / 2 + 4, clientY);
    el.style.transform = `translate(${x - LOUPE_SIZE / 2}px, ${y - LOUPE_SIZE / 2}px)`;
  };

  useLeaveStake(phase === "carving" ? "You lose this pumpkin if you leave before it is carved." : null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new CarvingEngine(canvas, {
      onFirstCut: () => {
        // The pumpkin is spent the moment the knife goes in, not when the
        // carve is scored: leaving halfway through still costs it, which is
        // what the leave guard warns about.
        spendAttempt();
        setAttempts(attemptsLeft());
        // The clock starts on the first cut, not when the window opens.
        deadlineRef.current = performance.now() + CARVE_SECONDS * 1000;
        setPhase("carving");
      },
      onShapeOpened: () => setOpened([...engine.openedShapes()]),
    });
    engine.setLoupe(loupeCanvasRef.current);
    engineRef.current = engine;
    return () => { engine.destroy(); engineRef.current = null; };
  }, []);

  const toArt = (e: { clientX: number; clientY: number }, r: DOMRect) => ({
    x: ((e.clientX - r.left) / r.width) * ART,
    y: ((e.clientY - r.top) / r.height) * ART,
  });

  const finish = useCallback((byClock: boolean) => {
    if (phaseRef.current !== "carving") return;
    pointerRef.current = null;
    const score = engineRef.current?.stop();
    if (byClock) buzz(60);
    setTimedOut(byClock);
    setAccuracy(score?.accuracy ?? 0);
    setShown(0);
    setPhase("scoring");
  }, []);

  const onDown = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const p = phaseRef.current;
    if ((p !== "ready" && p !== "carving") || pointerRef.current !== null || howToRef.current) return;
    // Nothing to carve. The panel over the pumpkin says where to get one.
    if (attemptsRef.current === 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerRef.current = e.pointerId;
    const pt = toArt(e, e.currentTarget.getBoundingClientRect());
    engineRef.current?.press(pt.x, pt.y, e.pointerType);
    if (e.pointerType !== "mouse" && loupeRef.current) {
      placeLoupe(e.clientX, e.clientY);
      loupeRef.current.style.display = "block";
    }
  }, []);

  const onMove = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    // Hovering with a mouse moves the knife too; a second finger never does.
    if (pointerRef.current !== null && pointerRef.current !== e.pointerId) return;
    const pt = toArt(e, e.currentTarget.getBoundingClientRect());
    engineRef.current?.move(pt.x, pt.y);
    if (pointerRef.current === e.pointerId && e.pointerType !== "mouse") placeLoupe(e.clientX, e.clientY);
  }, []);

  const onUp = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (pointerRef.current !== e.pointerId) return;
    pointerRef.current = null;
    engineRef.current?.release();
    if (loupeRef.current) loupeRef.current.style.display = "none";
    if (e.pointerType !== "mouse") engineRef.current?.leave();
  }, []);

  // The one minute clock.
  useEffect(() => {
    if (phase !== "carving") return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadlineRef.current - performance.now()) / 1000));
      setTimeLeft(left);
      // The last five seconds tick out loud.
      if (left !== lastSecondRef.current) {
        lastSecondRef.current = left;
        if (left > 0 && left <= 5) soundManager.play("tick");
      }
      if (left <= 0) finish(true);
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [phase, finish]);

  // The meter fills, then the verdict, then the reward and the board. The
  // result is reported once per carve, at the very end: one board write a run.
  useEffect(() => {
    if (phase !== "scoring") return;
    let raf = 0;
    let lastShown = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / METER_MS);
      const value = Math.round(accuracy * (1 - (1 - t) ** 3));
      if (value !== lastShown && value % 4 === 0) soundManager.play("tick");
      lastShown = value;
      setShown(value);
      if (t < 1) { raf = requestAnimationFrame(step); return; }

      const success = accuracy >= PASS_ACCURACY;
      const w = profileManager.get().wallet;
      setWallet(w);
      if (success) {
        engineRef.current?.light();
        buzz([30, 60, 30]);
        const variant = getVariant(REWARD_CATEGORY, REWARD_ID);
        // Read BEFORE reporting: the grant lands as part of onResult.
        setReward(!w ? "no-wallet" : variant && isVariantUnlocked(w, REWARD_CATEGORY, variant) ? "owned" : "new");
      } else {
        engineRef.current?.showReview();
      }
      if (accuracy > best) {
        saveBest(accuracy);
        // Not on the very first carve: there was nothing to beat.
        setNewBest(best > 0);
      }
      setPhase("done");
      onResultRef.current({ success, metadata: { score: accuracy, keepOpen: true } })
        .catch(() => undefined)
        .finally(() => {
          invalidateBoard(BOARD);
          fetchBoard(BOARD, { wallet: w, limit: 5, force: true }).then(setBoard).catch(() => undefined);
        });
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [phase, accuracy, best]);

  /** Fresh pumpkin, same pattern. Instant, no walk back to Jack. */
  const again = useCallback(() => {
    engineRef.current?.reset();
    pointerRef.current = null;
    setTimeLeft(CARVE_SECONDS);
    setTimedOut(false);
    setAccuracy(0);
    setShown(0);
    setOpened(PATTERN.map(() => false));
    setReward(null);
    setBoard(null);
    setBest(readBest());
    setNewBest(false);
    lastSecondRef.current = CARVE_SECONDS;
    setAttempts(attemptsLeft());
    setPhase("ready");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (howToRef.current) return;
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.repeat || phaseRef.current !== "done") return;
      if (e.key === "e" || e.key === "E" || e.key === " " || e.key === "Enter") {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        again();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [again, onClose]);

  const doneFeel = useButtonFeel();
  const helpFeel = useButtonFeel();
  const againFeel = useButtonFeel();

  const urgent = phase === "carving" && timeLeft <= 10;
  const timerPct = (timeLeft / CARVE_SECONDS) * 100;
  const passed = accuracy >= PASS_ACCURACY;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(6,10,20,0.9)", fontFamily: FONT, padding: 8, touchAction: "manipulation" }}
    >
      <style>{STYLES}</style>
      <div
        ref={loupeRef}
        aria-hidden
        style={{
          position: "fixed", left: 0, top: 0, width: LOUPE_SIZE, height: LOUPE_SIZE, display: "none", zIndex: 80,
          borderRadius: "50%", overflow: "hidden", border: `3px solid ${ACCENT}`,
          boxShadow: "0 0 0 2px rgba(0,0,0,0.6), 0 6px 16px rgba(0,0,0,0.5)", pointerEvents: "none",
        }}
      >
        <canvas ref={loupeCanvasRef} width={96} height={96} style={{ width: "100%", height: "100%", display: "block", imageRendering: "pixelated" }} />
      </div>
      <div
        style={chamferBox(14, {
          width: "min(700px, 100%)",
          maxHeight: "100%",
          overflowY: "auto",
          background: "#141a2b",
          border: `3px solid ${ACCENT}`,
          padding: 10,
          position: "relative",
          color: "#fff",
          textAlign: "center",
        })}
      >
        <CloseButton onClick={onClose} size={20} color={ACCENT} style={{ position: "absolute", top: 8, right: 10, zIndex: 2 }} />
        {howTo && <HowToPlay accent={ACCENT} hat={<HatIcon size={40} />} touch={touch} onDone={closeHowTo} />}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center", alignItems: "stretch" }}>
          {/* The pumpkin. Sized off the screen height first, so a landscape
              phone keeps all of it on screen with the panel beside it. The 48px
              is the overlay's padding plus the card's padding and border. */}
          <div style={{
            position: "relative",
            width: "min(100%, calc(100dvh - 48px), 380px)",
            aspectRatio: "1 / 1",
            // A clean carve lights the stage around the pumpkin too.
            background: phase === "done" && passed
              ? "radial-gradient(circle at 50% 62%, rgba(255,150,30,0.42), rgba(11,16,32,1) 68%)"
              : "#0b1020",
            clipPath: chamferClip(8),
            flexShrink: 0,
          }}>
            <canvas
              ref={canvasRef}
              width={ART}
              height={ART}
              aria-label="Pumpkin to carve"
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onLostPointerCapture={onUp}
              onPointerLeave={() => { if (pointerRef.current === null) engineRef.current?.leave(); }}
              onContextMenu={(e) => e.preventDefault()}
              style={{
                width: "100%", height: "100%", display: "block", imageRendering: "pixelated",
                // The knife IS the cursor while there is something to cut.
                cursor: phase === "ready" || phase === "carving" ? "none" : "default",
                touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none",
              }}
            />
            {phase === "ready" && !outOfPumpkins && (
              // Where to put the knife first. Purely a hint: any cut starts.
              <div aria-hidden style={{ position: "absolute", ...START, pointerEvents: "none" }}>
                <div className="pc-ring" style={{
                  position: "absolute", width: 28, height: 28, borderRadius: "50%",
                  border: "3px solid #fff1c1", boxShadow: "0 0 0 2px rgba(0,0,0,0.6)",
                }} />
              </div>
            )}
            {phase === "ready" && outOfPumpkins && (
              // No pumpkin, no carve. The way back is the city, so the panel
              // leads with the count rather than with an apology.
              <div className="pc-pop" style={{
                position: "absolute", inset: 0, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 10, padding: 16,
                background: "rgba(6,10,20,0.86)", textAlign: "center",
              }}>
                <img
                  src={PUMPKIN_ICON}
                  alt=""
                  width={40}
                  height={40}
                  style={{ imageRendering: "pixelated", opacity: 0.45 }}
                />
                <div style={{ fontFamily: FONT, fontSize: 9, color: "#fff" }}>NO PUMPKIN</div>
                <div style={{ fontFamily: FONT, fontSize: 8, color: "#b9b9cc", lineHeight: 1.7 }}>
                  Find one in the city to carve it.
                </div>
                <div style={{ fontFamily: FONT, fontSize: 8, color: ACCENT }}>
                  {`${Math.min(foundCount(), PUMPKINS_PER_HUNT)}/${PUMPKINS_PER_HUNT} FOUND`}
                </div>
              </div>
            )}
            {phase === "scoring" && timedOut && (
              <div className="pc-pop" style={{
                position: "absolute", top: 10, left: 0, right: 0, fontSize: 14, color: "#ff4444",
                textShadow: "0 2px 0 #000", pointerEvents: "none",
              }}>
                TIME&apos;S UP!
              </div>
            )}
          </div>

          {/* The panel: clock, then whatever the phase needs. */}
          <div style={{
            width: "min(100%, 250px)",
            // Beside the pumpkin on a landscape phone the result scrolls in
            // here, so AGAIN never pushes the pumpkin off screen.
            maxHeight: "calc(100dvh - 48px)",
            overflowY: "auto",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
            paddingTop: 4,
          }}>
            <div style={{ color: ACCENT, fontSize: 11, lineHeight: 1.5, padding: "0 26px" }}>PUMPKIN CARVING</div>

            {/* Clock: the food cart's MM:SS and draining bar. */}
            <div style={{ width: "100%" }}>
              <div className={urgent ? "pc-urgent" : ""} style={{ color: urgent ? "#ff4444" : "#fff", fontSize: 18, marginBottom: 6 }}>
                {clock(timeLeft)}
              </div>
              <div style={{ height: 6, background: "rgba(255,255,255,0.08)" }}>
                <div style={{
                  height: "100%", width: `${timerPct}%`,
                  background: timerPct > 40 ? GOOD : timerPct > 20 ? "#ffaa00" : "#ff4444",
                  transition: "width 0.2s linear, background 0.4s",
                }} />
              </div>
            </div>

            {phase === "ready" && (
              <>
                <div style={{ color: "#9AA4B2", fontSize: 8, lineHeight: 1.7 }}>Trace the dashed lines!</div>
                <ShapeProgress opened={opened} />
                {/* The prize and its price, as a picture. */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <HatIcon size={48} />
                  <div style={{ fontSize: 14, color: "#FFD700" }}>{PASS_ACCURACY}%+</div>
                </div>
                {best > 0 && <div style={{ fontSize: 8, color: "#9AA4B2" }}>BEST {best}%</div>}
                <button
                  onClick={openHowTo}
                  {...helpFeel.handlers}
                  style={{
                    background: "transparent", border: "1px solid rgba(255,169,77,0.6)", color: "#FFA94D",
                    padding: "7px 12px", fontFamily: FONT, fontSize: 7, ...feelStyle(helpFeel),
                  }}
                >
                  ? HOW TO PLAY
                </button>
              </>
            )}

            {phase === "carving" && (
              <>
                <ShapeProgress opened={opened} />
                <div style={{ color: "#9AA4B2", fontSize: 8, lineHeight: 1.7 }}>Slow knife, clean cut!</div>
                <button onClick={() => finish(false)} {...doneFeel.handlers} style={btn(ACCENT, touch, doneFeel)}>DONE</button>
              </>
            )}

            {(phase === "scoring" || phase === "done") && (
              <>
                <div style={{ width: "100%" }}>
                  <div style={{ color: "#9AA4B2", fontSize: 8, marginBottom: 6 }}>ACCURACY</div>
                  <div style={{ fontSize: 22, marginBottom: 6, color: phase === "done" ? (passed ? GOOD : BAD) : "#fff" }}>{shown}%</div>
                  <AccuracyMeter value={shown} final={phase === "done"} passed={passed} best={best} />
                </div>

                {phase === "done" && (
                  <>
                    <div style={{ fontSize: 13, color: passed ? GOOD : BAD, textShadow: "0 2px 0 #000" }}>
                      <span className="pc-stamp">{passed ? "CLEAN CARVE!" : "TOO SLOPPY"}</span>
                    </div>
                    {newBest && <div className="pc-pop" style={{ fontSize: 8, color: "#FFD700" }}>NEW BEST!</div>}
                    {passed
                      ? reward && <RewardRow state={reward} />
                      : <div style={{ fontSize: 7, color: "#cbd5e1", lineHeight: 1.7 }}>Red marks are your slips.</div>}
                    <button onClick={again} {...againFeel.handlers} style={btn(ACCENT, touch, againFeel)}>
                      {touch ? "AGAIN" : "AGAIN (E)"}
                    </button>
                    {board && (board.rows.length > 0 || board.mine) && <BoardList board={board} wallet={wallet} />}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The four shapes as little silhouettes: dashed while there is cutting left,
 * lit once the piece is out. Progress without numbers, so the accuracy still
 * waits for the meter.
 */
function ShapeProgress({ opened }: { opened: readonly boolean[] }) {
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "center", alignItems: "center" }}>
      {PATTERN.map((shape, i) => {
        const xs = shape.map((p) => p[0]), ys = shape.map((p) => p[1]);
        const x0 = Math.min(...xs) - 2, y0 = Math.min(...ys) - 2;
        const w = Math.max(...xs) - x0 + 2, h = Math.max(...ys) - y0 + 2;
        const done = opened[i];
        return (
          <svg
            key={i + (done ? "-done" : "")}
            className={done ? "pc-pop" : undefined}
            viewBox={`${x0} ${y0} ${w} ${h}`}
            style={{ height: 22, width: (22 * w) / h, maxWidth: 70, overflow: "visible" }}
          >
            <polygon
              points={shape.map((p) => p.join(",")).join(" ")}
              fill={done ? "#ffcf3f" : "none"}
              stroke={done ? "#7a3510" : "#9AA4B2"}
              strokeWidth={done ? 1.5 : 1.2}
              strokeDasharray={done ? undefined : "2 2"}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        );
      })}
    </div>
  );
}

/** The meter, with the pass mark drawn on it. */
function AccuracyMeter({ value, final, passed, best }: { value: number; final: boolean; passed: boolean; best: number }) {
  const fill = !final ? "#ffaa00" : passed ? GOOD : BAD;
  return (
    <div style={{ position: "relative", width: "100%", paddingTop: 12, paddingBottom: best > 0 ? 12 : 0 }}>
      {best > 0 && (
        <>
          <div style={{ position: "absolute", top: 10, height: 22, left: `${best}%`, width: 2, background: "#fff", opacity: 0.7, zIndex: 1 }} />
          <div style={{ position: "absolute", bottom: 0, left: `${best}%`, transform: "translateX(-50%)", fontSize: 6, color: "#cbd5e1" }}>
            BEST
          </div>
        </>
      )}
      <div style={{ position: "absolute", top: 0, left: `${PASS_ACCURACY}%`, transform: "translateX(-50%)", fontSize: 6, color: "#FFD700" }}>
        {PASS_ACCURACY}%
      </div>
      <div style={{ position: "relative", height: 14, background: "rgba(255,255,255,0.06)", border: "2px solid rgba(0,0,0,0.5)" }}>
        <div style={{ height: "100%", width: `${value}%`, background: fill, transition: "background 0.3s" }} />
        <div style={{ position: "absolute", top: -4, bottom: -4, left: `${PASS_ACCURACY}%`, width: 2, background: "#FFD700" }} />
      </div>
    </div>
  );
}

/** The Pumpkin Head, cut from its own paper-doll sheet. */
function HatIcon({ size }: { size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const crop = CROPS.head;
  useEffect(() => {
    const variant = getVariant(REWARD_CATEGORY, REWARD_ID);
    if (!variant) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const frame = document.createElement("canvas");
      frame.width = FW;
      frame.height = FH;
      const fctx = frame.getContext("2d", { willReadFrequently: true })!;
      fctx.drawImage(img, 0, DIRECTION_ROW.down * FH, FW, FH, 0, 0, FW, FH);
      removeChroma(fctx, FW, FH);
      const ctx = ref.current?.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, crop.w, crop.h);
      ctx.drawImage(frame, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    };
    img.src = `/assets/sprites/paperdoll/${variant.file}`;
    return () => { cancelled = true; };
  }, [crop]);
  return (
    <canvas
      ref={ref}
      width={crop.w}
      height={crop.h}
      style={{ width: size, height: size, flexShrink: 0, imageRendering: "pixelated", background: "#0b1020", clipPath: chamferClip(6) }}
    />
  );
}

/** The prize, with one line on what happened to it. */
function RewardRow({ state }: { state: RewardState }) {
  const line = state === "new" ? "Unlocked! It is in your wardrobe."
    : state === "owned" ? "Already in your wardrobe."
    : "Connect a wallet to keep it.";
  return (
    <div className="pc-pop" style={{
      display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
      position: "relative", overflow: "hidden", padding: 6,
      background: "rgba(255,207,63,0.08)", border: "1px solid rgba(255,207,63,0.35)",
    }}>
      <div className="pc-shine" />
      <HatIcon size={48} />
      <div>
        <div style={{ fontSize: 9, color: ACCENT, marginBottom: 6 }}>PUMPKIN HEAD</div>
        <div style={{ fontSize: 7, color: "#cbd5e1", lineHeight: 1.6 }}>{line}</div>
      </div>
    </div>
  );
}

/** Same rows Kite Clash shows at the end of a run, with the city's rank badges. */
function BoardList({ board, wallet }: { board: BoardResult; wallet: string | null }) {
  return (
    <div style={{ width: "100%", fontSize: 8, lineHeight: 1.9, textAlign: "left" }}>
      <div style={{ color: "#8ab4f8", marginBottom: 4 }}>BEST CARVERS IN THE CITY</div>
      {board.rows.map((row, i) => (
        <div key={row.wallet} style={{ display: "flex", gap: 8, alignItems: "center", color: wallet && row.wallet === wallet ? "#FFD700" : "#cbd5e1" }}>
          <RankBadge rank={i + 1} size={14} />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {row.name ?? `${row.wallet.slice(0, 4)}…${row.wallet.slice(-4)}`}
          </span>
          <span>{row.value}%</span>
        </div>
      ))}
      {board.mine && (
        <div style={{ color: "#94a3b8", marginTop: 4 }}>
          Your best {board.mine.value}%{board.mine.rank ? ` · #${board.mine.rank}` : ""}
        </div>
      )}
      {!wallet && <div style={{ color: "#64748b", marginTop: 4 }}>Connect a wallet to take your place on the board.</div>}
    </div>
  );
}

function btn(bg: string, big = false, feel?: Pick<ButtonFeel, "hover" | "pressed">): CSSProperties {
  return chamferBox(8, {
    background: bg,
    color: bg === ACCENT ? ON_ACCENT : "#fff",
    fontFamily: FONT,
    fontSize: big ? 12 : 11,
    padding: big ? "12px 22px" : "10px 16px",
    border: "2px solid rgba(0,0,0,0.4)",
    ...(feel ? feelStyle(feel) : null),
  });
}
