"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { MiniGameComponentProps, FoodCartContext } from "../types";

// ─── Data ────────────────────────────────────────────────────────────────────

const BASE = "/assets/minigames/food-cart/";

type IngId =
  | "salmon-nigiri" | "tuna-nigiri"    | "shrimp-nigiri"
  | "salmon-sashimi"| "tuna-sashimi"   | "white-fish"
  | "cucumber-maki" | "avocado-maki"   | "inari";

interface Ingredient { id: IngId; label: string; }

const INGREDIENTS: Ingredient[] = [
  { id: "salmon-nigiri",  label: "Salmon Nigiri"  },
  { id: "tuna-nigiri",    label: "Tuna Nigiri"    },
  { id: "shrimp-nigiri",  label: "Shrimp Nigiri"  },
  { id: "salmon-sashimi", label: "Salmon Sashimi" },
  { id: "tuna-sashimi",   label: "Tuna Sashimi"   },
  { id: "white-fish",     label: "White Fish"     },
  { id: "cucumber-maki",  label: "Cucumber Maki"  },
  { id: "avocado-maki",   label: "Avocado Maki"   },
  { id: "inari",          label: "Inari"          },
];
const ING: Record<IngId, Ingredient> = Object.fromEntries(
  INGREDIENTS.map(i => [i.id, i])
) as Record<IngId, Ingredient>;

interface Recipe { id: string; name: string; steps: IngId[]; }

const RECIPES: Recipe[] = [
  { id: "classic",  name: "Classic Set",     steps: ["salmon-nigiri", "tuna-nigiri", "cucumber-maki", "inari"] },
  { id: "sashimi",  name: "Sashimi Plate",   steps: ["salmon-sashimi", "tuna-sashimi", "white-fish"] },
  { id: "special",  name: "Chef's Special",  steps: ["shrimp-nigiri", "salmon-nigiri", "avocado-maki"] },
  { id: "deluxe",   name: "Deluxe Set",      steps: ["tuna-nigiri", "shrimp-nigiri", "cucumber-maki", "tuna-sashimi"] },
];

// ─── Types ───────────────────────────────────────────────────────────────────

type Phase = "playing" | "order_complete" | "all_done" | "failure" | "settling";

interface Order { recipe: Recipe; step: number; done: boolean; }

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

  const [orders, setOrders]           = useState<Order[]>(() => pickOrders(3));
  const [orderIdx, setOrderIdx]       = useState(0);
  const [phase, setPhase]             = useState<Phase>("playing");
  const [timeLeft, setTimeLeft]       = useState(totalSeconds);
  const [wrongFlash, setWrongFlash]   = useState<IngId | null>(null);
  const [failReason, setFailReason]   = useState<"timeout" | "wrong" | null>(null);
  const [wrongId, setWrongId]         = useState<IngId | null>(null);
  const [doneCount, setDoneCount]     = useState(0);
  const settledRef                    = useRef(false);

  const currentOrder  = orders[orderIdx];
  const currentRecipe = currentOrder?.recipe;
  const currentStep   = currentOrder?.step ?? 0;

  // Countdown — only while playing
  useEffect(() => {
    if (phase !== "playing") return;
    const tick = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(tick); setFailReason("timeout"); setPhase("failure"); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [phase]);

  // Brief pause between orders before advancing
  useEffect(() => {
    if (phase !== "order_complete") return;
    const t = setTimeout(() => {
      const next = orderIdx + 1;
      if (next >= orders.length) { setPhase("all_done"); }
      else { setOrderIdx(next); setPhase("playing"); }
    }, 1000);
    return () => clearTimeout(t);
  }, [phase, orderIdx, orders.length]);

  // Settle on terminal phase
  useEffect(() => {
    if (phase !== "all_done" && phase !== "failure") return;
    if (settledRef.current) return;
    settledRef.current = true;
    const ok = phase === "all_done";
    setPhase("settling");
    void onResult({ success: ok, metadata: { completedOrders: doneCount, orderType: context.orderType } });
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePick = useCallback((id: IngId) => {
    if (phase !== "playing" || !currentRecipe || wrongFlash) return;
    const expected = currentRecipe.steps[currentStep];
    if (id === expected) {
      const next = currentStep + 1;
      const done = next >= currentRecipe.steps.length;
      setOrders(prev => {
        const u = [...prev];
        u[orderIdx] = { ...u[orderIdx], step: next, done };
        return u;
      });
      if (done) { setDoneCount(c => c + 1); setPhase("order_complete"); }
    } else {
      setWrongFlash(id);
      setWrongId(id);
      setFailReason("wrong");
      setTimeout(() => { setWrongFlash(null); setPhase("failure"); }, 600);
    }
  }, [phase, currentRecipe, currentStep, orderIdx, wrongFlash]);

  // Escape to dismiss while playing
  useEffect(() => {
    if (phase !== "playing") return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase, onClose]);

  const urgent = timeLeft <= 10 && phase === "playing";

  // ─── Layout ────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(4,6,16,0.92)" }}
    >
      {/* Backdrop dismiss — only while playing */}
      {phase === "playing" && (
        <div className="absolute inset-0" onClick={onClose} />
      )}

      <div
        className="relative flex flex-col rounded-2xl overflow-hidden"
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
        {/* ── Header ──────────────────────────────────────────────────────── */}
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
                style={{
                  color: urgent ? "#ff4444" : "#ffffff",
                  fontSize: 24,
                  fontWeight: "bold",
                  lineHeight: 1,
                  transition: "color 0.4s",
                  minWidth: 52,
                }}
              >
                {String(Math.floor(timeLeft / 60)).padStart(2, "0")}:
                {String(timeLeft % 60).padStart(2, "0")}
              </div>
            </div>
          </div>
        </div>

        {/* ── Main area: queue + recipe ────────────────────────────────── */}
        <div
          className="flex shrink-0"
          style={{ borderBottom: "1px solid rgba(153,69,255,0.12)" }}
        >
          {/* Order queue */}
          <div
            className="flex flex-col gap-2 p-4 shrink-0"
            style={{
              width: 190,
              borderRight: "1px solid rgba(153,69,255,0.12)",
              background: "rgba(0,0,0,0.15)",
            }}
          >
            <div style={{ color: "#444466", fontSize: 9, letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 2 }}>
              Order Queue
            </div>
            {orders.map((ord, i) => {
              const isActive = i === orderIdx && !ord.done;
              const isDone   = ord.done;
              const isFuture = i > orderIdx;
              return (
                <div
                  key={i}
                  className="rounded-xl p-3"
                  style={{
                    background: isActive
                      ? "rgba(153,69,255,0.1)"
                      : isDone
                      ? "rgba(20,241,149,0.05)"
                      : "rgba(255,255,255,0.02)",
                    border: `1px solid ${isActive ? "rgba(153,69,255,0.5)" : isDone ? "rgba(20,241,149,0.25)" : "rgba(255,255,255,0.06)"}`,
                    opacity: isFuture ? 0.5 : 1,
                    transition: "all 0.35s",
                  }}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span
                      style={{
                        fontSize: 9,
                        textTransform: "uppercase",
                        letterSpacing: 1.5,
                        color: isActive ? "#9945FF" : isDone ? "#14F195" : "#444466",
                      }}
                    >
                      {isDone ? "✓ Done" : isActive ? "● Active" : `Queued`}
                    </span>
                  </div>
                  <div style={{ color: isDone ? "#14F195" : "#ccccee", fontSize: 11, fontWeight: "bold", marginBottom: 8 }}>
                    {ord.recipe.name}
                  </div>
                  {/* Sprite preview strip */}
                  <div className="flex gap-1 flex-wrap">
                    {ord.recipe.steps.map((sid, si) => {
                      const placed = si < ord.step;
                      return (
                        <div
                          key={si}
                          className="rounded-lg overflow-hidden flex items-center justify-center"
                          style={{
                            width: 28, height: 28,
                            background: placed ? "rgba(20,241,149,0.12)" : "rgba(255,255,255,0.04)",
                            border: `1px solid ${placed ? "rgba(20,241,149,0.35)" : isActive && si === ord.step ? "rgba(153,69,255,0.5)" : "rgba(255,255,255,0.08)"}`,
                            opacity: isFuture ? 0.6 : 1,
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

          {/* Recipe steps */}
          <div className="flex-1 p-4">
            <div style={{ color: "#444466", fontSize: 9, letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 10 }}>
              {currentRecipe ? `Recipe — ${currentRecipe.name}` : "—"}
            </div>
            {currentRecipe && (
              <div className="flex flex-col gap-2">
                {currentRecipe.steps.map((sid, si) => {
                  const done    = si < currentStep;
                  const active  = si === currentStep && phase === "playing";
                  const pending = si > currentStep;
                  return (
                    <div
                      key={si}
                      className="flex items-center gap-3 rounded-xl px-3 py-2"
                      style={{
                        background: done
                          ? "rgba(20,241,149,0.06)"
                          : active
                          ? "rgba(153,69,255,0.1)"
                          : "rgba(255,255,255,0.02)",
                        border: `1px solid ${done ? "rgba(20,241,149,0.25)" : active ? "rgba(153,69,255,0.45)" : "rgba(255,255,255,0.05)"}`,
                        transition: "all 0.2s",
                        opacity: pending ? 0.55 : 1,
                      }}
                    >
                      <div
                        className="rounded-lg flex items-center justify-center shrink-0"
                        style={{
                          width: 44, height: 44,
                          background: done ? "rgba(20,241,149,0.1)" : "rgba(255,255,255,0.04)",
                        }}
                      >
                        <Sprite id={sid} size={36} />
                      </div>
                      <div className="flex-1">
                        <div style={{ color: done ? "#14F195" : active ? "#e8d8ff" : "#555577", fontSize: 13, fontWeight: active ? "bold" : "normal" }}>
                          {ING[sid].label}
                        </div>
                        <div style={{ color: done ? "rgba(20,241,149,0.5)" : active ? "rgba(153,69,255,0.7)" : "rgba(255,255,255,0.15)", fontSize: 10, marginTop: 2 }}>
                          {done ? "added" : active ? "add next →" : "waiting"}
                        </div>
                      </div>
                      <div style={{ fontSize: 18, color: done ? "#14F195" : active ? "#9945FF" : "#333355" }}>
                        {done ? "✓" : active ? "●" : "·"}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {phase === "order_complete" && (
              <div
                className="mt-3 rounded-xl px-4 py-3 flex items-center gap-3"
                style={{ background: "rgba(20,241,149,0.1)", border: "1px solid rgba(20,241,149,0.3)" }}
              >
                <span style={{ fontSize: 22 }}>⭐</span>
                <div>
                  <div style={{ color: "#14F195", fontSize: 14, fontWeight: "bold" }}>Order Complete!</div>
                  <div style={{ color: "#6666aa", fontSize: 11 }}>Next order loading...</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Ingredient grid ──────────────────────────────────────────── */}
        <div className="p-4 shrink-0">
          <div style={{ color: "#444466", fontSize: 9, letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 10 }}>
            Ingredients
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))",
              gap: 8,
            }}
          >
            {INGREDIENTS.map(ing => {
              const isWrong    = wrongFlash === ing.id;
              const isDisabled = phase !== "playing" || !!wrongFlash;
              return (
                <button
                  key={ing.id}
                  onClick={() => handlePick(ing.id)}
                  disabled={isDisabled}
                  className="rounded-xl flex flex-col items-center gap-1.5 py-3 px-2 transition-all"
                  style={{
                    background: isWrong
                      ? "rgba(255,50,50,0.2)"
                      : "rgba(153,69,255,0.07)",
                    border: `1px solid ${isWrong ? "rgba(255,50,50,0.6)" : "rgba(153,69,255,0.2)"}`,
                    cursor: isDisabled ? "default" : "pointer",
                    opacity: isDisabled && !isWrong ? 0.45 : 1,
                    transform: isWrong ? "scale(0.96)" : "scale(1)",
                    transition: "all 0.12s",
                    fontFamily: '"Fira Code", monospace',
                  }}
                  onMouseEnter={e => { if (!isDisabled) (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.06)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
                >
                  <div className="flex items-center justify-center" style={{ height: 52 }}>
                    <Sprite id={ing.id} size={48} />
                  </div>
                  <span
                    style={{
                      fontSize: 9,
                      textAlign: "center",
                      lineHeight: 1.3,
                      color: isWrong ? "#ff6666" : "#9999bb",
                    }}
                  >
                    {ing.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Dismiss hint ──────────────────────────────────────────────── */}
        {phase === "playing" && (
          <div
            className="text-center py-2 shrink-0"
            style={{ color: "#2a2a44", fontSize: 10, borderTop: "1px solid rgba(255,255,255,0.03)" }}
          >
            click outside or Esc to dismiss
          </div>
        )}
      </div>

      {/* ── Success card ────────────────────────────────────────────────── */}
      {(phase === "all_done" || (phase === "settling" && failReason === null)) && (
        <SuccessCard completed={doneCount} total={orders.length} />
      )}

      {/* ── Failure card ────────────────────────────────────────────────── */}
      {(phase === "failure" || (phase === "settling" && failReason !== null)) && (
        <FailureCard reason={failReason} wrongId={wrongId} settling={phase === "settling"} />
      )}
    </div>
  );
}

// ─── Success card ─────────────────────────────────────────────────────────────

function SuccessCard({ completed, total }: { completed: number; total: number }) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center"
      style={{ background: "rgba(4,12,8,0.78)" }}
    >
      <div
        className="rounded-2xl flex flex-col items-center gap-5 p-8"
        style={{
          background: "linear-gradient(160deg, rgba(10,28,18,0.99) 0%, rgba(8,18,12,0.99) 100%)",
          border: "1px solid rgba(20,241,149,0.45)",
          boxShadow: "0 0 80px rgba(20,241,149,0.15), inset 0 1px 0 rgba(20,241,149,0.1)",
          minWidth: 300,
          maxWidth: 380,
          fontFamily: '"Fira Code", monospace',
        }}
      >
        <div style={{ fontSize: 64, lineHeight: 1 }}>🎉</div>

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
            <span style={{ color: "#14F195", fontSize: 16, fontWeight: "bold" }}>+0.0045 SOL</span>
          </div>
        </div>

        <div
          className="flex items-center gap-2 rounded-lg px-3 py-2"
          style={{ background: "rgba(153,69,255,0.08)", border: "1px solid rgba(153,69,255,0.2)" }}
        >
          <span style={{ fontSize: 12 }}>⛓</span>
          <span style={{ color: "#7755aa", fontSize: 11 }}>Settling on-chain...</span>
        </div>
      </div>
    </div>
  );
}

// ─── Failure card ─────────────────────────────────────────────────────────────

function FailureCard({
  reason,
  wrongId,
  settling,
}: {
  reason: "timeout" | "wrong" | null;
  wrongId: IngId | null;
  settling: boolean;
}) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center"
      style={{ background: "rgba(12,4,4,0.78)" }}
    >
      <div
        className="rounded-2xl flex flex-col items-center gap-5 p-8"
        style={{
          background: "linear-gradient(160deg, rgba(22,8,8,0.99) 0%, rgba(16,6,6,0.99) 100%)",
          border: "1px solid rgba(255,60,60,0.35)",
          boxShadow: "0 0 80px rgba(255,60,60,0.1), inset 0 1px 0 rgba(255,60,60,0.08)",
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
              ? "The customer waited too long"
              : "That's not what they ordered"}
          </div>
        </div>

        {/* Wrong ingredient display */}
        {reason === "wrong" && wrongId && (
          <div
            className="flex items-center gap-4 rounded-xl px-4 py-3 w-full"
            style={{ background: "rgba(255,60,60,0.08)", border: "1px solid rgba(255,60,60,0.2)" }}
          >
            <div
              className="rounded-lg flex items-center justify-center shrink-0"
              style={{ width: 52, height: 52, background: "rgba(255,60,60,0.1)", border: "1px solid rgba(255,60,60,0.2)" }}
            >
              <Sprite id={wrongId} size={44} />
            </div>
            <div>
              <div style={{ color: "#886666", fontSize: 11 }}>You served</div>
              <div style={{ color: "#ffaaaa", fontSize: 15, fontWeight: "bold" }}>
                {ING[wrongId].label}
              </div>
            </div>
          </div>
        )}

        {/* Penalty breakdown */}
        <div
          className="w-full rounded-xl p-4 flex flex-col gap-2"
          style={{ background: "rgba(255,60,60,0.05)", border: "1px solid rgba(255,60,60,0.12)" }}
        >
          <div className="flex justify-between items-center">
            <span style={{ color: "#664444", fontSize: 12 }}>Customer refund</span>
            <span style={{ color: "#ff8888", fontSize: 13, fontWeight: "bold" }}>−0.02 SOL</span>
          </div>
          <div className="flex justify-between items-center">
            <span style={{ color: "#664444", fontSize: 12 }}>from your escrow</span>
            <span style={{ color: "#886666", fontSize: 11 }}>CartState PDA</span>
          </div>
          <div
            className="flex justify-between items-center pt-2 mt-1"
            style={{ borderTop: "1px solid rgba(255,60,60,0.12)" }}
          >
            <span style={{ color: "#ff5555", fontSize: 13, fontWeight: "bold" }}>Net impact</span>
            <span style={{ color: "#ff5555", fontSize: 16, fontWeight: "bold" }}>−0.02 SOL</span>
          </div>
        </div>

        {settling && (
          <div
            className="flex items-center gap-2 rounded-lg px-3 py-2"
            style={{ background: "rgba(153,69,255,0.08)", border: "1px solid rgba(153,69,255,0.2)" }}
          >
            <span style={{ fontSize: 12 }}>⛓</span>
            <span style={{ color: "#7755aa", fontSize: 11 }}>Settling on-chain...</span>
          </div>
        )}
      </div>
    </div>
  );
}
