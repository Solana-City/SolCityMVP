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

interface Recipe { id: string; name: string; emoji: string; steps: IngId[]; }

const RECIPES: Recipe[] = [
  { id: "classic",  name: "Classic Set",     emoji: "🍱", steps: ["salmon-nigiri",  "tuna-nigiri",   "cucumber-maki", "inari"        ] },
  { id: "sashimi",  name: "Sashimi Plate",   emoji: "🐟", steps: ["salmon-sashimi", "tuna-sashimi",  "white-fish"                    ] },
  { id: "special",  name: "Chef's Special",  emoji: "⭐", steps: ["shrimp-nigiri",  "salmon-nigiri", "avocado-maki"                  ] },
  { id: "deluxe",   name: "Deluxe Set",      emoji: "👑", steps: ["tuna-nigiri",    "shrimp-nigiri", "cucumber-maki", "tuna-sashimi" ] },
];

// ─── Types ───────────────────────────────────────────────────────────────────

type Phase = "playing" | "order_complete" | "result_success" | "result_failure" | "settling";

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
  const [phase, setPhase]               = useState<Phase>("playing");
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

  // Countdown — only while playing
  useEffect(() => {
    if (phase !== "playing") return;
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
  }, [phase]);

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
    if (phase !== "playing" || !currentRecipe || pickedId) return;
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
  }, [phase, currentRecipe, currentStep, orderIdx, pickedId, triggerFlash]);

  // Keyboard: 1–9 for ingredients, Escape to dismiss
  useEffect(() => {
    if (phase !== "playing") return;
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      const ingId = KEY_MAP[e.key];
      if (ingId) handlePick(ingId);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase, onClose, handlePick]);

  const handleSettle = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    const ok = phase === "result_success";
    setPhase("settling");
    void onResult({ success: ok, metadata: { completedOrders: doneCount, orderType: context.orderType } });
  }, [phase, doneCount, context.orderType, onResult]);

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

      {/* Backdrop dismiss (playing only) */}
      {phase === "playing" && (
        <div className="absolute inset-0" onClick={onClose} />
      )}

      <div
        className="relative flex flex-col rounded-2xl overflow-hidden sc-slide"
        style={{
          width: "min(700px, 96vw)",
          maxHeight: "92vh",
          overflowY: "auto",
          background: "rgba(8,8,22,0.99)",
          border: "1px solid rgba(153,69,255,0.3)",
          fontFamily: '"Fira Code", monospace',
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
            <div style={{ color: "#9945FF", fontSize: 10, letterSpacing: 3, textTransform: "uppercase" }}>
              Mini Game
            </div>
            <div style={{ color: "#fff", fontSize: 17, fontWeight: "bold", marginTop: 1 }}>
              🍣 Sushi Station
            </div>
          </div>
          <div className="flex items-center gap-5">
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "#6666aa", fontSize: 10, letterSpacing: 1 }}>ORDERS</div>
              <div style={{ color: "#14F195", fontSize: 15, fontWeight: "bold" }}>
                {doneCount}<span style={{ color: "#444466" }}>/{orders.length}</span>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "#6666aa", fontSize: 10, letterSpacing: 1 }}>TIME</div>
              <div
                className={urgent ? "sc-urgent" : ""}
                style={{
                  color: urgent ? "#ff4444" : "#ffffff",
                  fontSize: 24,
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
            className="flex flex-col gap-2 p-4 shrink-0"
            style={{
              width: 210,
              borderRight: "1px solid rgba(153,69,255,0.12)",
              background: "rgba(0,0,0,0.18)",
            }}
          >
            <div style={{ color: "#444466", fontSize: 9, letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 2 }}>
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
                  <div style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: 1.5, color: isActive ? "#9945FF" : isDone ? "#14F195" : "#444466", marginBottom: 3 }}>
                    {isDone ? "✓ Done" : isActive ? "● Active" : "Queued"}
                  </div>
                  <div style={{ color: isDone ? "#14F195" : "#ccccee", fontSize: 10, fontWeight: "bold" }}>
                    {ord.recipe.emoji} {ord.recipe.name}
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
          <div className="flex-1 p-4 flex flex-col gap-3 min-w-0">
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
                        fontSize: 12,
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
                  <div style={{ color: "#9945FF", fontSize: 9, letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 3 }}>
                    Serve Next
                  </div>
                  <div style={{ color: "#ffffff", fontSize: 18, fontWeight: "bold", lineHeight: 1.2 }}>
                    {ING[nextIngId].label}
                  </div>
                  <div style={{ color: "#6644aa", fontSize: 11, marginTop: 4 }}>
                    Step {currentStep + 1}/{currentRecipe?.steps.length} · {currentRecipe?.name}
                  </div>
                  <div style={{ color: "#333355", fontSize: 10, marginTop: 3 }}>
                    Press{" "}
                    <kbd style={{
                      background: "rgba(153,69,255,0.15)",
                      border: "1px solid rgba(153,69,255,0.3)",
                      borderRadius: 3,
                      padding: "1px 5px",
                      color: "#9945FF",
                      fontSize: 10,
                    }}>
                      {INGREDIENTS.find(i => i.id === nextIngId)?.hotkey}
                    </kbd>
                    {" "}or click
                  </div>
                </div>
              </div>
            )}

            {/* Recipe strip */}
            <div style={{ color: "#444466", fontSize: 9, letterSpacing: 2.5, textTransform: "uppercase" }}>
              {currentRecipe?.emoji} {currentRecipe?.name}
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
                      <span style={{ color: done ? "#14F195" : active ? "#ccaaff" : "#444466", fontSize: 11 }}>
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
                <span style={{ fontSize: 22 }}>⭐</span>
                <div>
                  <div style={{ color: "#14F195", fontSize: 14, fontWeight: "bold" }}>Order Complete!</div>
                  <div style={{ color: "#6666aa", fontSize: 11 }}>
                    {orderIdx + 1 < orders.length ? "Next order coming up..." : "Last one done!"}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Ingredient grid ───────────────────────────────────────────── */}
        <div className="p-4 shrink-0">
          <div style={{ color: "#444466", fontSize: 9, letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 10 }}>
            Ingredients
            <span style={{ color: "#222244", marginLeft: 8 }}>(keys 1–9)</span>
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
                    fontFamily: '"Fira Code", monospace',
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
                    fontSize: 8,
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
                      fontSize: 9,
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
            style={{ color: "#1e1e38", fontSize: 10, borderTop: "1px solid rgba(255,255,255,0.03)" }}
          >
            click outside · Esc to dismiss
          </div>
        )}
      </div>

      {/* ── Result overlays ─────────────────────────────────────────────── */}
      {(phase === "result_success" || (phase === "settling" && failReason === null)) && (
        <SuccessCard
          completed={doneCount}
          total={orders.length}
          settling={phase === "settling"}
          onContinue={handleSettle}
        />
      )}
      {(phase === "result_failure" || (phase === "settling" && failReason !== null)) && (
        <FailureCard
          reason={failReason}
          wrongId={wrongId}
          settling={phase === "settling"}
          onContinue={handleSettle}
        />
      )}
    </div>
  );
}

// ─── Success card ─────────────────────────────────────────────────────────────

function SuccessCard({
  completed,
  total,
  settling,
  onContinue,
}: {
  completed: number;
  total: number;
  settling: boolean;
  onContinue: () => void;
}) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center"
      style={{ background: "rgba(4,14,10,0.85)" }}
    >
      <div
        className="rounded-2xl flex flex-col items-center gap-5 p-8 sc-slide"
        style={{
          background: "linear-gradient(160deg, rgba(10,28,18,0.99) 0%, rgba(8,18,12,0.99) 100%)",
          border: "1px solid rgba(20,241,149,0.45)",
          boxShadow: "0 0 80px rgba(20,241,149,0.18), inset 0 1px 0 rgba(20,241,149,0.1)",
          minWidth: 300,
          maxWidth: 380,
          fontFamily: '"Fira Code", monospace',
        }}
      >
        <div style={{ fontSize: 64, lineHeight: 1, filter: "drop-shadow(0 0 24px rgba(20,241,149,0.55))" }}>
          🎉
        </div>

        <div style={{ textAlign: "center" }}>
          <div style={{ color: "#14F195", fontSize: 22, fontWeight: "bold", letterSpacing: -0.5 }}>
            All Orders Delivered!
          </div>
          <div style={{ color: "#446655", fontSize: 13, marginTop: 6 }}>
            {completed} of {total} completed
          </div>
        </div>

        {/* Reward breakdown */}
        <div
          className="w-full rounded-xl p-4 flex flex-col gap-2"
          style={{ background: "rgba(20,241,149,0.06)", border: "1px solid rgba(20,241,149,0.15)" }}
        >
          <div className="flex justify-between items-center">
            <span style={{ color: "#446655", fontSize: 12 }}>Order revenue</span>
            <span style={{ color: "#14F195", fontSize: 13, fontWeight: "bold" }}>+0.01 SOL</span>
          </div>
          <div className="flex justify-between items-center">
            <span style={{ color: "#446655", fontSize: 12 }}>Customer refund</span>
            <span style={{ color: "#aaaacc", fontSize: 13 }}>−0.005 SOL</span>
          </div>
          <div className="flex justify-between items-center">
            <span style={{ color: "#446655", fontSize: 12 }}>Treasury (5%)</span>
            <span style={{ color: "#aaaacc", fontSize: 13 }}>−0.0005 SOL</span>
          </div>
          <div
            className="flex justify-between items-center pt-2 mt-1"
            style={{ borderTop: "1px solid rgba(20,241,149,0.15)" }}
          >
            <span style={{ color: "#14F195", fontSize: 13, fontWeight: "bold" }}>You keep</span>
            <span style={{ color: "#14F195", fontSize: 17, fontWeight: "bold" }}>+0.0045 SOL</span>
          </div>
        </div>

        {settling ? (
          <div
            className="flex items-center gap-2 rounded-lg px-3 py-2"
            style={{ background: "rgba(153,69,255,0.08)", border: "1px solid rgba(153,69,255,0.2)" }}
          >
            <span style={{ fontSize: 12 }}>⛓</span>
            <span style={{ color: "#7755aa", fontSize: 11 }}>Settling on-chain...</span>
          </div>
        ) : (
          <button
            onClick={onContinue}
            style={{
              width: "100%",
              padding: "12px 24px",
              borderRadius: 12,
              background: "linear-gradient(135deg, #14F195, #0cbe75)",
              color: "#021a0e",
              fontSize: 15,
              fontWeight: "bold",
              fontFamily: '"Fira Code", monospace',
              border: "none",
              cursor: "pointer",
              boxShadow: "0 0 28px rgba(20,241,149,0.35)",
              transition: "transform 0.1s, box-shadow 0.1s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.04)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
          >
            Collect Reward ✓
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Failure card ─────────────────────────────────────────────────────────────

function FailureCard({
  reason,
  wrongId,
  settling,
  onContinue,
}: {
  reason: "timeout" | "wrong" | null;
  wrongId: IngId | null;
  settling: boolean;
  onContinue: () => void;
}) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center"
      style={{ background: "rgba(12,4,4,0.85)" }}
    >
      <div
        className="rounded-2xl flex flex-col items-center gap-5 p-8 sc-slide"
        style={{
          background: "linear-gradient(160deg, rgba(22,8,8,0.99) 0%, rgba(16,6,6,0.99) 100%)",
          border: "1px solid rgba(255,60,60,0.38)",
          boxShadow: "0 0 80px rgba(255,60,60,0.12), inset 0 1px 0 rgba(255,60,60,0.08)",
          minWidth: 300,
          maxWidth: 380,
          fontFamily: '"Fira Code", monospace',
        }}
      >
        <div style={{ fontSize: 64, lineHeight: 1 }}>
          {reason === "timeout" ? "⏱️" : "❌"}
        </div>

        <div style={{ textAlign: "center" }}>
          <div style={{ color: "#ff5555", fontSize: 22, fontWeight: "bold", letterSpacing: -0.5 }}>
            {reason === "timeout" ? "Time's Up!" : "Wrong Ingredient!"}
          </div>
          <div style={{ color: "#664444", fontSize: 13, marginTop: 6 }}>
            {reason === "timeout"
              ? "The customer waited too long."
              : "That's not what they ordered."}
          </div>
        </div>

        {reason === "wrong" && wrongId && (
          <div
            className="flex items-center gap-4 rounded-xl px-4 py-3 w-full"
            style={{ background: "rgba(255,60,60,0.08)", border: "1px solid rgba(255,60,60,0.22)" }}
          >
            <div
              style={{
                width: 52, height: 52, borderRadius: 10, flexShrink: 0,
                background: "rgba(255,60,60,0.1)",
                border: "1px solid rgba(255,60,60,0.25)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <Sprite id={wrongId} size={44} />
            </div>
            <div>
              <div style={{ color: "#886666", fontSize: 11 }}>You served</div>
              <div style={{ color: "#ffaaaa", fontSize: 15, fontWeight: "bold" }}>{ING[wrongId].label}</div>
            </div>
          </div>
        )}

        {/* Penalty breakdown */}
        <div
          className="w-full rounded-xl p-4 flex flex-col gap-2"
          style={{ background: "rgba(255,60,60,0.05)", border: "1px solid rgba(255,60,60,0.12)" }}
        >
          <div className="flex justify-between items-center">
            <span style={{ color: "#664444", fontSize: 12 }}>Customer refund (escrow)</span>
            <span style={{ color: "#ff8888", fontSize: 13, fontWeight: "bold" }}>−0.02 SOL</span>
          </div>
          <div
            className="flex justify-between items-center pt-2 mt-1"
            style={{ borderTop: "1px solid rgba(255,60,60,0.12)" }}
          >
            <span style={{ color: "#ff5555", fontSize: 13, fontWeight: "bold" }}>Net impact</span>
            <span style={{ color: "#ff5555", fontSize: 17, fontWeight: "bold" }}>−0.02 SOL</span>
          </div>
        </div>

        {settling ? (
          <div
            className="flex items-center gap-2 rounded-lg px-3 py-2"
            style={{ background: "rgba(153,69,255,0.08)", border: "1px solid rgba(153,69,255,0.2)" }}
          >
            <span style={{ fontSize: 12 }}>⛓</span>
            <span style={{ color: "#7755aa", fontSize: 11 }}>Settling on-chain...</span>
          </div>
        ) : (
          <button
            onClick={onContinue}
            style={{
              width: "100%",
              padding: "11px 24px",
              borderRadius: 12,
              background: "rgba(255,60,60,0.12)",
              color: "#ff9999",
              fontSize: 14,
              fontWeight: "bold",
              fontFamily: '"Fira Code", monospace',
              border: "1px solid rgba(255,60,60,0.35)",
              cursor: "pointer",
              transition: "transform 0.1s, background 0.1s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.04)"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,60,60,0.2)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,60,60,0.12)"; }}
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}
