"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { MiniGameComponentProps, FoodCartContext } from "../types";

// ─── CSS animations ───────────────────────────────────────────────────────────

const STYLES = `
@keyframes sc-bounce {
  0%   { transform: scale(1); }
  30%  { transform: scale(1.25); }
  65%  { transform: scale(0.92); }
  100% { transform: scale(1); }
}
@keyframes sc-shake {
  0%,100% { transform: translateX(0) scale(0.95); }
  20%     { transform: translateX(-6px) rotate(-3deg) scale(0.95); }
  40%     { transform: translateX(6px)  rotate(3deg)  scale(0.95); }
  60%     { transform: translateX(-4px) rotate(-2deg) scale(0.95); }
  80%     { transform: translateX(4px)  rotate(2deg)  scale(0.95); }
}
@keyframes sc-urgent {
  0%,100% { opacity: 1; transform: scale(1); }
  50%     { opacity: 0.65; transform: scale(1.1); }
}
@keyframes sc-float-up {
  0%   { opacity: 1; transform: translateY(0)     scale(1);    }
  60%  { opacity: 1; transform: translateY(-30px) scale(1.05); }
  100% { opacity: 0; transform: translateY(-52px) scale(0.9);  }
}
@keyframes sc-slide-in {
  0%   { opacity: 0; transform: translateY(16px) scale(0.95); }
  100% { opacity: 1; transform: translateY(0)    scale(1);    }
}
@keyframes sc-flash-green {
  0%,100% { background: transparent; }
  35%     { background: rgba(20,241,149,0.18); }
}
@keyframes sc-flash-red {
  0%,100% { background: transparent; }
  35%     { background: rgba(255,50,50,0.22); }
}
@keyframes sc-glow-pulse {
  0%,100% { box-shadow: 0 0 0 0   rgba(153,69,255,0); }
  50%     { box-shadow: 0 0 22px 5px rgba(153,69,255,0.38); }
}
@keyframes sc-order-flash {
  0%   { box-shadow: 0 0 0   0  rgba(20,241,149,0); border-color: rgba(20,241,149,0.25); }
  40%  { box-shadow: 0 0 28px 8px rgba(20,241,149,0.35); border-color: rgba(20,241,149,0.8); }
  100% { box-shadow: 0 0 0   0  rgba(20,241,149,0); border-color: rgba(20,241,149,0.25); }
}
.sc-panel { scrollbar-width: none; -ms-overflow-style: none; }
.sc-panel::-webkit-scrollbar { display: none; }
.sc-correct   { animation: sc-bounce   0.34s ease-out; }
.sc-wrong     { animation: sc-shake    0.46s ease-in-out; }
.sc-urgent    { animation: sc-urgent   0.65s ease-in-out infinite; }
.sc-float     { animation: sc-float-up 0.95s ease-out forwards; pointer-events: none; }
.sc-slide     { animation: sc-slide-in 0.28s ease-out; }
.sc-glow      { animation: sc-glow-pulse  1.6s ease-in-out infinite; }
.sc-order-ok  { animation: sc-order-flash 0.7s ease-out; }
.sc-flash-g   { animation: sc-flash-green 0.65s ease-out; }
.sc-flash-r   { animation: sc-flash-red   0.65s ease-out; }
`;

// ─── Data ────────────────────────────────────────────────────────────────────

const BASE = "/assets/minigames/food-cart/";

type IngId =
  | "salmon-nigiri" | "tuna-nigiri"    | "shrimp-nigiri"
  | "salmon-sashimi"| "tuna-sashimi"   | "white-fish"
  | "cucumber-maki" | "avocado-maki"   | "inari";

interface Ingredient { id: IngId; label: string; hotkey: string; }

const INGREDIENTS: Ingredient[] = [
  { id: "salmon-nigiri",  label: "Salmon Nigiri",  hotkey: "1" },
  { id: "tuna-nigiri",    label: "Tuna Nigiri",    hotkey: "2" },
  { id: "shrimp-nigiri",  label: "Shrimp Nigiri",  hotkey: "3" },
  { id: "salmon-sashimi", label: "Salmon Sashimi", hotkey: "4" },
  { id: "tuna-sashimi",   label: "Tuna Sashimi",   hotkey: "5" },
  { id: "white-fish",     label: "White Fish",     hotkey: "6" },
  { id: "cucumber-maki",  label: "Cucumber Maki",  hotkey: "7" },
  { id: "avocado-maki",   label: "Avocado Maki",   hotkey: "8" },
  { id: "inari",          label: "Inari",          hotkey: "9" },
];

const ING: Record<IngId, Ingredient> = Object.fromEntries(
  INGREDIENTS.map(i => [i.id, i])
) as Record<IngId, Ingredient>;

const KEY_MAP: Record<string, IngId> = Object.fromEntries(
  INGREDIENTS.map(i => [i.hotkey, i.id])
);

interface Recipe { id: string; name: string; steps: IngId[]; }

const RECIPES: Recipe[] = [
  { id: "classic",  name: "Classic Set",     steps: ["salmon-nigiri",  "tuna-nigiri",   "cucumber-maki", "inari"        ] },
  { id: "sashimi",  name: "Sashimi Plate",   steps: ["salmon-sashimi", "tuna-sashimi",  "white-fish"                    ] },
  { id: "special",  name: "Chef's Special",  steps: ["shrimp-nigiri",  "salmon-nigiri", "avocado-maki"                  ] },
  { id: "deluxe",   name: "Deluxe Set",      steps: ["tuna-nigiri",    "shrimp-nigiri", "cucumber-maki", "tuna-sashimi" ] },
];

const HOW_TO_KEY = "solcity:foodCart:howToSeen";

// ─── Types ───────────────────────────────────────────────────────────────────

type Phase = "intro" | "playing" | "order_complete" | "result_success" | "result_failure" | "settling";

interface Order { recipe: Recipe; step: number; done: boolean; }
interface FloatText { id: number; text: string; }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pickOrders(n: number): Order[] {
  const shuffled = [...RECIPES].sort(() => Math.random() - 0.5);
  return Array.from({ length: n }, (_, i) => ({
    recipe: shuffled[i % shuffled.length],
    step: 0,
    done: false,
  }));
}

function Sprite({ id, size = 56 }: { id: IngId; size?: number }) {
  return (
    <img
      src={`${BASE}${id}.png`}
      alt={ING[id].label}
      width={size}
      height={size}
      style={{ objectFit: "contain", imageRendering: "pixelated", display: "block" }}
      draggable={false}
    />
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function FoodCartGame({
  context,
  onResult,
  onClose,
}: MiniGameComponentProps<FoodCartContext>) {
  const totalSeconds = Math.max(15, context.expiresAt - Math.floor(Date.now() / 1000));

  const [orders, setOrders]             = useState<Order[]>(() => pickOrders(3));
  const [orderIdx, setOrderIdx]         = useState(0);
  // First visit opens on the how-to cards; the timer only starts after them.
  const [phase, setPhase]               = useState<Phase>(() => {
    try { return localStorage.getItem(HOW_TO_KEY) === "1" ? "playing" : "intro"; } catch { return "playing"; }
  });
  const [helpOpen, setHelpOpen]         = useState(false);
  /**
   * Phones (landscape is ~844x390): the desktop panel stacks queue, recipe
   * and the ingredient grid, which left the grid below the fold while the
   * clock ran. The compact board puts the order on the left and all nine
   * pieces on the right, so the whole game fits one screen.
   */
  const [compact, setCompact]           = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-height: 560px), (max-width: 720px)");
    const read = () => setCompact(mq.matches);
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);
  const [timeLeft, setTimeLeft]         = useState(totalSeconds);
  const [pickedId, setPickedId]         = useState<{ id: IngId; correct: boolean } | null>(null);
  const [failReason, setFailReason]     = useState<"timeout" | "wrong" | null>(null);
  const [wrongId, setWrongId]           = useState<IngId | null>(null);
  const [doneCount, setDoneCount]       = useState(0);
  const [floats, setFloats]             = useState<FloatText[]>([]);
  const [flash, setFlash]               = useState<{ key: number; cls: string } | null>(null);
  const [orderBanner, setOrderBanner]   = useState(false);
  const [orderBannerKey, setOrderBannerKey] = useState(0);
  const settledRef                      = useRef(false);
  const floatIdRef                      = useRef(0);
  const flashCounterRef                 = useRef(0);

  const currentOrder  = orders[orderIdx];
  const currentRecipe = currentOrder?.recipe;
  const currentStep   = currentOrder?.step ?? 0;
  const nextIngId     = currentRecipe?.steps[currentStep] as IngId | undefined;
  const urgent        = timeLeft <= 10 && phase === "playing";
  const timerPct      = (timeLeft / totalSeconds) * 100;

  // Inject styles once
  useEffect(() => {
    if (document.getElementById("sc-minigame-styles")) return;
    const s = document.createElement("style");
    s.id = "sc-minigame-styles";
    s.textContent = STYLES;
    document.head.appendChild(s);
    return () => { document.getElementById("sc-minigame-styles")?.remove(); };
  }, []);

  // Countdown — only while playing, and not while the help cards are open
  useEffect(() => {
    if (phase !== "playing" || helpOpen) return;
    const tick = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(tick);
          setFailReason("timeout");
          setFlash({ key: ++flashCounterRef.current, cls: "sc-flash-r" });
          setPhase("result_failure");
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [phase, helpOpen]);

  // Pause between orders
  useEffect(() => {
    if (phase !== "order_complete") return;
    setOrderBanner(true);
    setOrderBannerKey(k => k + 1);
    const t = setTimeout(() => {
      setOrderBanner(false);
      const next = orderIdx + 1;
      if (next >= orders.length) {
        setPhase("result_success");
      } else {
        setOrderIdx(next);
        setPhase("playing");
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [phase, orderIdx, orders.length]);

  const triggerFlash = useCallback((cls: "sc-flash-g" | "sc-flash-r") => {
    const key = ++flashCounterRef.current;
    setFlash({ key, cls });
    setTimeout(() => setFlash(f => f?.key === key ? null : f), 700);
  }, []);

  const handlePick = useCallback((id: IngId) => {
    if (phase !== "playing" || helpOpen || !currentRecipe || pickedId) return;
    const expected = currentRecipe.steps[currentStep];

    if (id === expected) {
      setPickedId({ id, correct: true });
      triggerFlash("sc-flash-g");

      const fid = ++floatIdRef.current;
      const nextStep = currentStep + 1;
      const done = nextStep >= currentRecipe.steps.length;
      setFloats(f => [...f, { id: fid, text: done ? "Order Done! ✓" : "✓" }]);
      setTimeout(() => setFloats(f => f.filter(x => x.id !== fid)), 950);

      setTimeout(() => {
        setPickedId(null);
        setOrders(prev => {
          const u = [...prev];
          u[orderIdx] = { ...u[orderIdx], step: nextStep, done };
          return u;
        });
        if (done) {
          setDoneCount(c => c + 1);
          setPhase("order_complete");
        }
      }, 320);
    } else {
      setPickedId({ id, correct: false });
      setWrongId(id);
      setFailReason("wrong");
      triggerFlash("sc-flash-r");
      setTimeout(() => {
        setPickedId(null);
        setPhase("result_failure");
      }, 620);
    }
  }, [phase, helpOpen, currentRecipe, currentStep, orderIdx, pickedId, triggerFlash]);

  // Keyboard: 1–9 for ingredients, Escape to dismiss
  useEffect(() => {
    if (phase !== "playing" || helpOpen) return;
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      const ingId = KEY_MAP[e.key];
      if (ingId) handlePick(ingId);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase, helpOpen, onClose, handlePick]);

  const handleSettle = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    const ok = phase === "result_success";
    void onResult({ success: ok, metadata: { completedOrders: doneCount, orderType: context.orderType } });
  }, [phase, doneCount, context.orderType, onResult]);

  const finishIntro = useCallback(() => {
    try { localStorage.setItem(HOW_TO_KEY, "1"); } catch { /* storage blocked */ }
    setHelpOpen(false);
    setPhase((p) => (p === "intro" ? "playing" : p));
  }, []);

  // ─── Layout ──────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(4,6,16,0.92)" }}
    >
      {/* Full-screen pick flash — key forces animation restart */}
      {flash && (
        <div
          key={flash.key}
          className={`absolute inset-0 pointer-events-none z-[60] ${flash.cls}`}
        />
      )}

      {/* Backdrop dismiss (playing only; not on phones, where a stray tap
          beside the board would quit mid-order) */}
      {phase === "playing" && !compact && (
        <div className="absolute inset-0" onClick={onClose} />
      )}

      {compact ? (
        <CompactBoard
          orders={orders}
          orderIdx={orderIdx}
          currentStep={currentStep}
          nextIngId={nextIngId}
          phase={phase}
          pickedId={pickedId}
          doneCount={doneCount}
          timeLeft={timeLeft}
          timerPct={timerPct}
          urgent={urgent}
          floats={floats}
          orderBanner={orderBanner}
          onPick={handlePick}
          onHelp={() => setHelpOpen(true)}
          onClose={onClose}
        />
      ) : (
      <div
        className="relative flex flex-col rounded-2xl overflow-hidden sc-slide sc-panel"
        style={{
          width: "min(720px, 96vw)",
          maxHeight: "94vh",
          overflowY: "auto",
          background: "rgba(8,8,22,0.99)",
          border: "1px solid rgba(153,69,255,0.3)",
          fontFamily: '"Press Start 2P", monospace',
          zIndex: 1,
          boxShadow: "0 0 80px rgba(153,69,255,0.12), inset 0 1px 0 rgba(255,255,255,0.04)",
        }}
      >
        {/* ── Header ────────────────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between px-5 py-3 shrink-0"
          style={{ borderBottom: "1px solid rgba(153,69,255,0.18)", background: "rgba(153,69,255,0.05)" }}
        >
          <div>
            <div style={{ color: "#9945FF", fontSize: 8, letterSpacing: 3, textTransform: "uppercase" }}>
              Mini Game
            </div>
            <div style={{ color: "#fff", fontSize: 12, fontWeight: "bold", marginTop: 1 }}>
              Sushi Station
            </div>
          </div>
          <div className="flex items-center gap-5">
            <button
              onClick={() => setHelpOpen(true)}
              style={{
                background: "rgba(255,107,53,0.12)", border: "1px solid rgba(255,107,53,0.6)", color: "#FFA06B",
                borderRadius: 8, padding: "6px 9px", cursor: "pointer", fontFamily: '"Press Start 2P", monospace', fontSize: 7,
              }}
            >
              ? HOW TO PLAY
            </button>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "#6666aa", fontSize: 8, letterSpacing: 1 }}>ORDERS</div>
              <div style={{ color: "#14F195", fontSize: 11, fontWeight: "bold" }}>
                {doneCount}<span style={{ color: "#444466" }}>/{orders.length}</span>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "#6666aa", fontSize: 8, letterSpacing: 1 }}>TIME</div>
              <div
                className={urgent ? "sc-urgent" : ""}
                style={{
                  color: urgent ? "#ff4444" : "#ffffff",
                  fontSize: 17,
                  fontWeight: "bold",
                  lineHeight: 1,
                  minWidth: 52,
                }}
              >
                {String(Math.floor(timeLeft / 60)).padStart(2, "0")}:
                {String(timeLeft % 60).padStart(2, "0")}
              </div>
            </div>
          </div>
        </div>

        {/* ── Timer bar ─────────────────────────────────────────────────── */}
        <div style={{ height: 4, background: "rgba(255,255,255,0.05)", flexShrink: 0 }}>
          <div
            style={{
              height: "100%",
              width: `${timerPct}%`,
              background: timerPct > 40 ? "#14F195" : timerPct > 20 ? "#ffaa00" : "#ff4444",
              transition: "width 0.95s linear, background 0.4s",
              boxShadow: timerPct <= 20 ? "0 0 8px 2px rgba(255,68,68,0.5)" : "none",
            }}
          />
        </div>

        {/* ── Middle: queue | hero + recipe ─────────────────────────────── */}
        <div
          className="flex shrink-0"
          style={{ borderBottom: "1px solid rgba(153,69,255,0.12)" }}
        >
          {/* Order queue (left) */}
          <div
            className="flex flex-col gap-2 p-3 shrink-0"
            style={{
              width: 210,
              borderRight: "1px solid rgba(153,69,255,0.12)",
              background: "rgba(0,0,0,0.18)",
            }}
          >
            <div style={{ color: "#444466", fontSize: 7, letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 2 }}>
              Queue
            </div>
            {orders.map((ord, i) => {
              const isActive = i === orderIdx && !ord.done;
              const isDone   = ord.done;
              const isFuture = i > orderIdx && !ord.done;
              return (
                <div
                  key={i}
                  className={isDone ? "sc-order-ok" : ""}
                  style={{
                    borderRadius: 10,
                    padding: "9px 10px",
                    background: isActive
                      ? "rgba(153,69,255,0.1)"
                      : isDone
                      ? "rgba(20,241,149,0.05)"
                      : "rgba(255,255,255,0.02)",
                    border: `1px solid ${isActive ? "rgba(153,69,255,0.5)" : isDone ? "rgba(20,241,149,0.25)" : "rgba(255,255,255,0.06)"}`,
                    opacity: isFuture ? 0.45 : 1,
                    transition: "all 0.35s",
                  }}
                >
                  <div style={{ fontSize: 7, textTransform: "uppercase", letterSpacing: 1.5, color: isActive ? "#9945FF" : isDone ? "#14F195" : "#444466", marginBottom: 3 }}>
                    {isDone ? "✓ Done" : isActive ? "● Active" : "Queued"}
                  </div>
                  <div style={{ color: isDone ? "#14F195" : "#ccccee", fontSize: 8, fontWeight: "bold" }}>
                    {ord.recipe.name}
                  </div>
                  <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                    {ord.recipe.steps.map((sid, si) => {
                      const placed = si < ord.step;
                      return (
                        <div
                          key={si}
                          style={{
                            width: 30, height: 30, borderRadius: 6,
                            background: placed ? "rgba(20,241,149,0.12)" : "rgba(255,255,255,0.04)",
                            border: `1px solid ${placed ? "rgba(20,241,149,0.35)" : isActive && si === ord.step ? "rgba(153,69,255,0.5)" : "rgba(255,255,255,0.08)"}`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}
                        >
                          <Sprite id={sid} size={22} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right: hero + recipe strip */}
          <div className="flex-1 p-3 flex flex-col gap-2 min-w-0">
            {/* "Serve Next" hero panel */}
            {nextIngId && phase === "playing" && (
              <div
                className="sc-glow rounded-2xl flex items-center gap-4 px-4 py-3 shrink-0"
                style={{
                  background: "rgba(153,69,255,0.07)",
                  border: "1px solid rgba(153,69,255,0.42)",
                }}
              >
                {/* Large sprite with floating text anchored to it */}
                <div style={{ position: "relative", width: 76, height: 76, flexShrink: 0 }}>
                  <div
                    style={{
                      width: "100%", height: "100%",
                      borderRadius: 14,
                      background: "rgba(153,69,255,0.12)",
                      border: "1px solid rgba(153,69,255,0.35)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <Sprite id={nextIngId} size={62} />
                  </div>
                  {/* Floating text stack */}
                  {floats.map(f => (
                    <span
                      key={f.id}
                      className="sc-float"
                      style={{
                        position: "absolute",
                        top: -6, left: "50%",
                        transform: "translateX(-50%)",
                        color: "#14F195",
                        fontSize: 9,
                        fontWeight: "bold",
                        whiteSpace: "nowrap",
                        textShadow: "0 0 10px #14F195",
                        zIndex: 10,
                      }}
                    >
                      {f.text}
                    </span>
                  ))}
                </div>
                <div>
                  <div style={{ color: "#9945FF", fontSize: 7, letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 3 }}>
                    Serve Next
                  </div>
                  <div style={{ color: "#ffffff", fontSize: 13, fontWeight: "bold", lineHeight: 1.2 }}>
                    {ING[nextIngId].label}
                  </div>
                  <div style={{ color: "#6644aa", fontSize: 8, marginTop: 4 }}>
                    Step {currentStep + 1}/{currentRecipe?.steps.length} · {currentRecipe?.name}
                  </div>
                  <div style={{ color: "#333355", fontSize: 8, marginTop: 3 }}>
                    Press{" "}
                    <kbd style={{
                      background: "rgba(153,69,255,0.15)",
                      border: "1px solid rgba(153,69,255,0.3)",
                      borderRadius: 3,
                      padding: "1px 5px",
                      color: "#9945FF",
                      fontSize: 8,
                    }}>
                      {INGREDIENTS.find(i => i.id === nextIngId)?.hotkey}
                    </kbd>
                    {" "}or click
                  </div>
                </div>
              </div>
            )}

            {/* Recipe strip */}
            <div style={{ color: "#444466", fontSize: 7, letterSpacing: 2.5, textTransform: "uppercase" }}>
              {currentRecipe?.name}
            </div>
            {currentRecipe && (
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                {currentRecipe.steps.map((sid, si) => {
                  const done   = si < currentStep;
                  const active = si === currentStep && phase === "playing";
                  return (
                    <div
                      key={si}
                      style={{
                        display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                        borderRadius: 10, padding: "10px 8px",
                        background: done ? "rgba(20,241,149,0.06)" : active ? "rgba(153,69,255,0.1)" : "rgba(255,255,255,0.02)",
                        border: `1px solid ${done ? "rgba(20,241,149,0.25)" : active ? "rgba(153,69,255,0.5)" : "rgba(255,255,255,0.05)"}`,
                        opacity: si > currentStep ? 0.45 : 1,
                        transition: "all 0.25s",
                        minWidth: 72,
                      }}
                    >
                      <Sprite id={sid} size={42} />
                      <span style={{ color: done ? "#14F195" : active ? "#ccaaff" : "#444466", fontSize: 8 }}>
                        {done ? "✓" : active ? "→" : `${si + 1}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Order-complete banner */}
            {orderBanner && (
              <div
                key={orderBannerKey}
                className="sc-slide rounded-xl px-4 py-3 flex items-center gap-3 shrink-0"
                style={{ background: "rgba(20,241,149,0.1)", border: "1px solid rgba(20,241,149,0.35)" }}
              >
                {currentRecipe && <Sprite id={currentRecipe.steps[0]} size={28} />}
                <div>
                  <div style={{ color: "#14F195", fontSize: 11, fontWeight: "bold" }}>Order Complete!</div>
                  <div style={{ color: "#6666aa", fontSize: 8 }}>
                    {orderIdx + 1 < orders.length ? "Next order coming up..." : "Last one done!"}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Ingredient grid ───────────────────────────────────────────── */}
        <div className="p-3 shrink-0">
          <div style={{ color: "#444466", fontSize: 7, letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 10 }}>
            Ingredients
            <span style={{ color: "#222244", marginLeft: 8 }}>(keys 1-9)</span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(86px, 1fr))",
              gap: 7,
            }}
          >
            {INGREDIENTS.map(ing => {
              const isPicked   = pickedId?.id === ing.id;
              const isCorrect  = isPicked && pickedId?.correct;
              const isWrong    = isPicked && !pickedId?.correct;
              const isNext     = ing.id === nextIngId && phase === "playing" && !pickedId;
              const isDisabled = phase !== "playing" || !!pickedId;
              return (
                <button
                  key={ing.id}
                  onClick={() => handlePick(ing.id)}
                  disabled={isDisabled}
                  spellCheck={false}
                  className={`rounded-xl flex flex-col items-center py-2.5 px-2 ${isCorrect ? "sc-correct" : isWrong ? "sc-wrong" : ""}`}
                  style={{
                    gap: 5,
                    background: isWrong
                      ? "rgba(255,50,50,0.2)"
                      : isCorrect
                      ? "rgba(20,241,149,0.15)"
                      : isNext
                      ? "rgba(153,69,255,0.13)"
                      : "rgba(153,69,255,0.06)",
                    border: `1px solid ${
                      isWrong   ? "rgba(255,50,50,0.65)"  :
                      isCorrect ? "rgba(20,241,149,0.55)" :
                      isNext    ? "rgba(153,69,255,0.5)"  :
                                  "rgba(153,69,255,0.18)"
                    }`,
                    cursor: isDisabled ? "default" : "pointer",
                    opacity: isDisabled && !isPicked ? 0.45 : 1,
                    transition: "background 0.1s, border-color 0.1s, opacity 0.2s, transform 0.1s",
                    fontFamily: '"Press Start 2P", monospace',
                    position: "relative",
                  }}
                  onMouseEnter={e => {
                    if (!isDisabled) (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.06)";
                  }}
                  onMouseLeave={e => {
                    if (!isPicked) (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
                  }}
                >
                  {/* Hotkey badge */}
                  <span style={{
                    position: "absolute", top: 4, right: 5,
                    color: isNext ? "#9945FF" : "#2a2a44",
                    fontSize: 7,
                    fontWeight: "bold",
                    transition: "color 0.15s",
                  }}>
                    {ing.hotkey}
                  </span>
                  <div style={{ height: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Sprite id={ing.id} size={46} />
                  </div>
                  <span
                    style={{
                      fontSize: 7,
                      textAlign: "center",
                      lineHeight: 1.3,
                      color: isWrong ? "#ff7777" : isNext ? "#ccaaff" : "#888aaa",
                    }}
                  >
                    {ing.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Dismiss hint */}
        {phase === "playing" && (
          <div
            className="text-center py-2 shrink-0"
            style={{ color: "#1e1e38", fontSize: 8, borderTop: "1px solid rgba(255,255,255,0.03)" }}
          >
            click outside · Esc to dismiss
          </div>
        )}
      </div>
      )}

      {/* ── Result overlays ─────────────────────────────────────────────── */}
      {phase === "result_success" && (
        <SuccessCard completed={doneCount} total={orders.length} onContinue={handleSettle} />
      )}
      {phase === "result_failure" && (
        <FailureCard reason={failReason} wrongId={wrongId} onContinue={handleSettle} />
      )}
      {(phase === "intro" || helpOpen) && <HowToPlay onDone={finishIntro} />}
    </div>
  );
}

// ─── Compact board (phones) ───────────────────────────────────────────────────

function CompactBoard({
  orders, orderIdx, currentStep, nextIngId, phase, pickedId, doneCount,
  timeLeft, timerPct, urgent, floats, orderBanner, onPick, onHelp, onClose,
}: {
  orders: Order[];
  orderIdx: number;
  currentStep: number;
  nextIngId: IngId | undefined;
  phase: Phase;
  pickedId: { id: IngId; correct: boolean } | null;
  doneCount: number;
  timeLeft: number;
  timerPct: number;
  urgent: boolean;
  floats: FloatText[];
  orderBanner: boolean;
  onPick: (id: IngId) => void;
  onHelp: () => void;
  onClose: () => void;
}) {
  const recipe = orders[orderIdx]?.recipe;
  const PIX = '"Press Start 2P", monospace';
  return (
    <div
      className="relative flex flex-col rounded-2xl overflow-hidden sc-slide"
      style={{
        width: "min(820px, calc(100vw - 16px))",
        height: "min(380px, calc(100dvh - 16px))",
        background: "rgba(8,8,22,0.99)",
        border: "1px solid rgba(153,69,255,0.3)",
        fontFamily: PIX,
        zIndex: 1,
      }}
    >
      {/* One slim header row */}
      <div className="flex items-center shrink-0" style={{ gap: 10, padding: "6px 10px", borderBottom: "1px solid rgba(153,69,255,0.18)" }}>
        <span style={{ color: "#fff", fontSize: 9 }}>SUSHI STATION</span>
        <div style={{ display: "flex", gap: 4 }}>
          {orders.map((o, i) => (
            <span key={i} style={{
              width: 22, height: 8, borderRadius: 4,
              background: o.done ? "#14F195" : i === orderIdx ? "#9945FF" : "rgba(255,255,255,0.12)",
            }} />
          ))}
        </div>
        <span style={{ color: "#14F195", fontSize: 8 }}>{doneCount}/{orders.length}</span>
        <div style={{ flex: 1 }} />
        <span className={urgent ? "sc-urgent" : ""} style={{ color: urgent ? "#ff4444" : "#fff", fontSize: 13 }}>
          {String(Math.floor(timeLeft / 60)).padStart(2, "0")}:{String(timeLeft % 60).padStart(2, "0")}
        </span>
        <button
          onClick={onHelp}
          aria-label="How to play"
          style={{
            width: 30, height: 30, borderRadius: 8, background: "rgba(255,107,53,0.14)",
            border: "1px solid rgba(255,107,53,0.6)", color: "#FFA06B", fontFamily: PIX, fontSize: 10, touchAction: "manipulation",
          }}
        >
          ?
        </button>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            width: 30, height: 30, borderRadius: 8, background: "transparent",
            border: "1px solid rgba(255,255,255,0.15)", color: "#8888aa", fontSize: 16, lineHeight: 1, touchAction: "manipulation",
          }}
        >
          ×
        </button>
      </div>
      <div style={{ height: 4, background: "rgba(255,255,255,0.05)", flexShrink: 0 }}>
        <div style={{
          height: "100%", width: `${timerPct}%`,
          background: timerPct > 40 ? "#14F195" : timerPct > 20 ? "#ffaa00" : "#ff4444",
          transition: "width 0.95s linear, background 0.4s",
        }} />
      </div>

      <div className="flex flex-1 min-h-0" style={{ gap: 10, padding: 10 }}>
        {/* Left: the order being made */}
        <div className="flex flex-col min-w-0" style={{ width: "38%", gap: 8 }}>
          <div style={{ color: "#9945FF", fontSize: 7, letterSpacing: 1.5 }}>{recipe?.name.toUpperCase()}</div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {recipe?.steps.map((sid, si) => {
              const done = si < currentStep;
              const active = si === currentStep && phase === "playing";
              return (
                <div key={si} style={{
                  width: 46, height: 46, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center",
                  background: done ? "rgba(20,241,149,0.12)" : active ? "rgba(153,69,255,0.16)" : "rgba(255,255,255,0.03)",
                  border: `2px solid ${done ? "rgba(20,241,149,0.5)" : active ? "#9945FF" : "rgba(255,255,255,0.08)"}`,
                  opacity: si > currentStep ? 0.45 : 1,
                }}>
                  <Sprite id={sid} size={34} />
                </div>
              );
            })}
          </div>

          {/* The next piece, big */}
          <div className="sc-glow flex items-center flex-1 min-h-0" style={{
            gap: 10, padding: 8, borderRadius: 12,
            background: "rgba(153,69,255,0.07)", border: "1px solid rgba(153,69,255,0.42)",
            position: "relative",
          }}>
            {orderBanner ? (
              <div style={{ width: "100%", textAlign: "center", color: "#14F195", fontSize: 10 }}>ORDER DONE!</div>
            ) : nextIngId && phase === "playing" ? (
              <>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <Sprite id={nextIngId} size={64} />
                  {floats.map(f => (
                    <span key={f.id} className="sc-float" style={{
                      position: "absolute", top: -4, left: "50%", transform: "translateX(-50%)",
                      color: "#14F195", fontSize: 9, whiteSpace: "nowrap", textShadow: "0 0 10px #14F195",
                    }}>
                      {f.text}
                    </span>
                  ))}
                </div>
                <div className="min-w-0">
                  <div style={{ color: "#9945FF", fontSize: 7, marginBottom: 5 }}>NEXT</div>
                  <div style={{ color: "#fff", fontSize: 9, lineHeight: 1.5 }}>{ING[nextIngId].label}</div>
                </div>
              </>
            ) : null}
          </div>
        </div>

        {/* Right: all nine pieces, sized to fill the height */}
        <div className="flex-1 min-w-0" style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "repeat(3, 1fr)", gap: 6,
        }}>
          {INGREDIENTS.map(ing => {
            const isPicked = pickedId?.id === ing.id;
            const isCorrect = isPicked && pickedId?.correct;
            const isWrong = isPicked && !pickedId?.correct;
            const isNext = ing.id === nextIngId && phase === "playing" && !pickedId;
            const isDisabled = phase !== "playing" || !!pickedId;
            return (
              <button
                key={ing.id}
                onClick={() => onPick(ing.id)}
                disabled={isDisabled}
                className={`flex flex-col items-center justify-center ${isCorrect ? "sc-correct" : isWrong ? "sc-wrong" : ""}`}
                style={{
                  gap: 3, borderRadius: 10, minHeight: 0, padding: 2, touchAction: "manipulation",
                  background: isWrong ? "rgba(255,50,50,0.2)" : isCorrect ? "rgba(20,241,149,0.15)" : isNext ? "rgba(153,69,255,0.16)" : "rgba(153,69,255,0.06)",
                  border: `2px solid ${isWrong ? "rgba(255,50,50,0.65)" : isCorrect ? "rgba(20,241,149,0.55)" : isNext ? "#9945FF" : "rgba(153,69,255,0.18)"}`,
                  opacity: isDisabled && !isPicked ? 0.5 : 1,
                  fontFamily: PIX,
                }}
              >
                <Sprite id={ing.id} size={40} />
                <span style={{ fontSize: 6, color: isNext ? "#ccaaff" : "#8888aa", lineHeight: 1.2, textAlign: "center" }}>
                  {ing.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Result cards ─────────────────────────────────────────────────────────────
// No money in this game: results are the orders you served, nothing else.

const CHEF = "/assets/sprites/Sushi Man.png";

function Chef({ size }: { size: number }) {
  return (
    <div aria-hidden style={{
      width: size, height: size, backgroundImage: `url("${CHEF}")`,
      backgroundSize: `${size * 4}px ${size * 4}px`, backgroundPosition: "0 0", imageRendering: "pixelated",
    }} />
  );
}

function ResultShell({ tone, children }: { tone: "good" | "bad"; children: React.ReactNode }) {
  const good = tone === "good";
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center" style={{ background: good ? "rgba(4,14,10,0.85)" : "rgba(12,4,4,0.85)" }}>
      <div
        className="rounded-2xl flex flex-col items-center gap-5 p-8 sc-slide"
        style={{
          background: good ? "rgba(10,24,16,0.99)" : "rgba(22,8,8,0.99)",
          border: `1px solid ${good ? "rgba(20,241,149,0.45)" : "rgba(255,60,60,0.38)"}`,
          minWidth: 280, maxWidth: 360, fontFamily: '"Press Start 2P", monospace',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function SuccessCard({ completed, total, onContinue }: { completed: number; total: number; onContinue: () => void }) {
  return (
    <ResultShell tone="good">
      <Chef size={96} />
      <div style={{ textAlign: "center" }}>
        <div style={{ color: "#14F195", fontSize: 14, fontWeight: "bold" }}>ALL ORDERS SERVED</div>
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 12 }}>
          {Array.from({ length: total }, (_, i) => (
            <div key={i} style={{
              width: 34, height: 34, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
              background: i < completed ? "rgba(20,241,149,0.14)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${i < completed ? "rgba(20,241,149,0.5)" : "rgba(255,255,255,0.1)"}`,
            }}>
              <Sprite id={RECIPES[i % RECIPES.length].steps[0]} size={26} />
            </div>
          ))}
        </div>
      </div>
      <button
        onClick={onContinue}
        style={{
          width: "100%", padding: "12px 24px", borderRadius: 12, background: "#14F195", color: "#021a0e",
          fontSize: 10, fontFamily: '"Press Start 2P", monospace', border: "none", cursor: "pointer",
        }}
      >
        CONTINUE
      </button>
    </ResultShell>
  );
}

function FailureCard({ reason, wrongId, onContinue }: { reason: "timeout" | "wrong" | null; wrongId: IngId | null; onContinue: () => void }) {
  return (
    <ResultShell tone="bad">
      {reason === "wrong" && wrongId ? (
        <div style={{ position: "relative", width: 76, height: 76, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Sprite id={wrongId} size={70} />
          <svg viewBox="0 0 76 76" style={{ position: "absolute", inset: 0 }}>
            <path d="M 14 14 L 62 62 M 62 14 L 14 62" stroke="#ff4d4d" strokeWidth="7" strokeLinecap="round" />
          </svg>
        </div>
      ) : (
        <div style={{ width: 150, height: 14, borderRadius: 7, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,60,60,0.5)", overflow: "hidden" }}>
          <div style={{ width: "0%", height: "100%", background: "#ff4444" }} />
        </div>
      )}
      <div style={{ textAlign: "center" }}>
        <div style={{ color: "#ff5555", fontSize: 14, fontWeight: "bold" }}>
          {reason === "timeout" ? "TIME'S UP" : "WRONG PIECE"}
        </div>
        <div style={{ color: "#aa7777", fontSize: 8, marginTop: 8, lineHeight: 1.6 }}>
          {reason === "timeout" ? "Serve faster next time." : "Follow the glowing piece."}
        </div>
      </div>
      <button
        onClick={onContinue}
        style={{
          width: "100%", padding: "11px 24px", borderRadius: 12, background: "rgba(255,60,60,0.12)", color: "#ff9999",
          fontSize: 10, fontFamily: '"Press Start 2P", monospace', border: "1px solid rgba(255,60,60,0.35)", cursor: "pointer",
        }}
      >
        CLOSE
      </button>
    </ResultShell>
  );
}

// ─── How to play ──────────────────────────────────────────────────────────────

interface HowStep { title: string; line: string; scene: React.ReactNode; }

function HowToPlay({ onDone }: { onDone: () => void }) {
  const [touch, setTouch] = useState(false);
  useEffect(() => { setTouch(window.matchMedia("(pointer: coarse)").matches); }, []);
  const [i, setI] = useState(0);

  const example = RECIPES[0];
  const tile = (id: IngId, state: "done" | "next" | "todo" | "wrong", size = 40) => (
    <div style={{
      width: size + 12, height: size + 12, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
      background: state === "done" ? "rgba(20,241,149,0.12)" : state === "next" ? "rgba(153,69,255,0.16)" : state === "wrong" ? "rgba(255,50,50,0.18)" : "rgba(255,255,255,0.03)",
      border: `2px solid ${state === "done" ? "rgba(20,241,149,0.5)" : state === "next" ? "#9945FF" : state === "wrong" ? "rgba(255,50,50,0.7)" : "rgba(255,255,255,0.08)"}`,
      opacity: state === "todo" ? 0.5 : 1, position: "relative",
    }} className={state === "next" ? "sc-glow" : undefined}>
      <Sprite id={id} size={size} />
    </div>
  );

  const steps: HowStep[] = [
    {
      title: "TAKE THE ORDER",
      line: "Each order is a set of sushi pieces, served left to right.",
      scene: <div style={{ display: "flex", gap: 6 }}>{example.steps.map((id) => <div key={id}>{tile(id, "todo")}</div>)}</div>,
    },
    {
      title: "SERVE THE GLOWING PIECE",
      line: touch ? "Tap the piece that glows. Then the next one." : "Click the piece that glows, or press its number key.",
      scene: (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {tile(example.steps[0], "done")}
          {tile(example.steps[1], "next")}
          {tile(example.steps[2], "todo")}
          {!touch && (
            <span style={{
              marginLeft: 10, minWidth: 26, height: 26, borderRadius: 5, background: "#f8fafc", color: "#0a0a14",
              display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, boxShadow: "0 3px 0 #64748b",
            }}>
              {ING[example.steps[1]].hotkey}
            </span>
          )}
        </div>
      ),
    },
    {
      title: "NO WRONG PIECES",
      line: "Serve a wrong piece and the order is ruined.",
      scene: (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {tile(example.steps[0], "done")}
          <div style={{ position: "relative" }}>
            {tile("white-fish", "wrong")}
            <svg viewBox="0 0 52 52" style={{ position: "absolute", inset: 0 }}>
              <path d="M 12 12 L 40 40 M 40 12 L 12 40" stroke="#ff4d4d" strokeWidth="5" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      ),
    },
    {
      title: "BEAT THE CLOCK",
      line: "Serve all 3 orders before the timer runs out.",
      scene: (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {RECIPES.slice(0, 3).map((r) => <div key={r.id}>{tile(r.steps[0], "todo", 30)}</div>)}
          </div>
          <div style={{ width: 200, height: 10, borderRadius: 5, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
            <div className="sc-timer-demo" style={{ height: "100%", background: "#14F195" }} />
          </div>
        </div>
      ),
    },
  ];
  const step = steps[i];
  const last = i === steps.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "e" || e.key === "E" || e.key === "Enter" || e.key === "ArrowRight") {
        e.preventDefault();
        if (last) onDone(); else setI((n) => n + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setI((n) => Math.max(0, n - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last, onDone]);

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(4,6,16,0.9)", zIndex: 70, padding: 16 }}>
      <style>{`@keyframes sc-timer { from { width: 100%; background: #14F195; } 70% { background: #ffaa00; } to { width: 8%; background: #ff4444; } } .sc-timer-demo { animation: sc-timer 3s linear infinite; }`}</style>
      <div className="rounded-2xl sc-slide" style={{
        width: "min(440px, 100%)", maxHeight: "100%", overflowY: "auto", padding: 16,
        background: "rgba(8,8,22,0.99)", border: "1px solid rgba(255,107,53,0.55)", fontFamily: '"Press Start 2P", monospace',
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <Chef size={36} />
          <span style={{ color: "#FFA06B", fontSize: 9 }}>HOW TO PLAY</span>
          <span style={{ marginLeft: "auto", color: "#555566", fontSize: 7 }}>{i + 1}/{steps.length}</span>
        </div>
        <div key={i} className="sc-slide" style={{
          height: 120, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(255,107,53,0.06)", border: "1px solid rgba(255,107,53,0.2)",
        }}>
          {step.scene}
        </div>
        <div style={{ textAlign: "center", color: "#fff", fontSize: 9, margin: "12px 0 6px" }}>{step.title}</div>
        <div style={{ textAlign: "center", color: "#b9b9cc", fontSize: 8, lineHeight: 1.7, minHeight: "3.4em", marginBottom: 12 }}>{step.line}</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => setI((n) => Math.max(0, n - 1))}
            style={{ background: "transparent", border: "1px solid #333344", color: "#888899", borderRadius: 8, padding: "9px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 7, visibility: i === 0 ? "hidden" : "visible" }}
          >
            BACK
          </button>
          <div style={{ flex: 1, display: "flex", justifyContent: "center", gap: 5 }}>
            {steps.map((s, n) => (
              <span key={s.title} style={{ width: n === i ? 16 : 6, height: 6, borderRadius: 3, background: n === i ? "#FF6B35" : "#333344", transition: "width .2s" }} />
            ))}
          </div>
          <button
            onClick={() => (last ? onDone() : setI((n) => n + 1))}
            style={{ background: "#FF6B35", color: "#0a0a14", border: "none", borderRadius: 8, padding: "10px 16px", cursor: "pointer", fontFamily: "inherit", fontSize: 7 }}
          >
            {last ? "COOK!" : "NEXT"}
          </button>
        </div>
      </div>
    </div>
  );
}
