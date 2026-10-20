"use client";

/**
 * Pumpkin Carving's how-to: three cards, one picture and one line each, the
 * same shape as the Food Cart's and Kite Clash's. Opens by itself on the first
 * visit and from the "?" button after that.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useButtonFeel, feelStyle } from "@/ui/useButtonFeel";
import { chamferBox } from "@/ui/chamfer";
import { CARVE_SECONDS, PASS_ACCURACY, PATTERN } from "./pattern";
import { PUMPKINS_PER_HUNT } from "@/game/halloween/pumpkinHunt";

/** The same prop the pumpkins in the street are drawn with. */
const PUMPKIN_ICON = "/assets/sprites/world/pumpkin.png";

const FONT = '"Press Start 2P", monospace';
const SEEN_KEY = "solcity:pumpkinCarving:howToSeen";

export function readHowToSeen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return true; }
}

function markHowToSeen(): void {
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* storage blocked */ }
}

const pts = (shape: readonly (readonly [number, number])[]) => shape.map((p) => p.join(",")).join(" ");
const path = (shape: readonly (readonly [number, number])[]) => `M${shape.map((p) => p.join(" ")).join(" L")} Z`;

/**
 * The city, with the five pumpkins waiting in it: a map-shaped frame and the
 * real prop, the last one lighting up as the player reaches it.
 */
function HuntScene() {
  const spots = [
    { x: 18, y: 26 }, { x: 52, y: 16 }, { x: 88, y: 34 },
    { x: 34, y: 58 }, { x: 74, y: 62 },
  ];
  return (
    <svg viewBox="0 0 112 80" style={{ height: 104 }}>
      <rect x="2" y="2" width="108" height="76" fill="#0b1020" stroke="#2a2a45" strokeWidth="1" />
      {/* Two streets, so the frame reads as a city and not as a box. */}
      <path d="M2 40 H110 M62 2 V78" stroke="#1d2340" strokeWidth="6" fill="none" />
      {spots.map((p, i) => (
        <image
          key={i}
          href={PUMPKIN_ICON}
          x={p.x - 7}
          y={p.y - 7}
          width={14}
          height={14}
          style={{ imageRendering: "pixelated" }}
        >
          <animate
            attributeName="opacity"
            values="1;1;0.35;1"
            dur="2.8s"
            begin={`${i * 0.25}s`}
            repeatCount="indefinite"
          />
        </image>
      ))}
    </svg>
  );
}

/** One pumpkin in, one carve out: the trade the whole quest runs on. */
function TradeScene({ hat }: { hat: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <img src={PUMPKIN_ICON} alt="" width={44} height={44} style={{ imageRendering: "pixelated" }} />
      <span style={{ color: "#64748b", fontSize: 14 }}>&gt;</span>
      <svg viewBox="22 40 86 74" style={{ height: 64 }}>
        <ellipse cx="64" cy="76" rx="49" ry="43" fill="#d86830" stroke="#0a0808" strokeWidth="2" />
        {PATTERN.map((shape, i) => (
          <polygon key={i} points={pts(shape)} fill="none" stroke="#2a0d02" strokeWidth="1.2" strokeDasharray="2 2" />
        ))}
      </svg>
      <span style={{ color: "#64748b", fontSize: 14 }}>&gt;</span>
      {hat}
    </div>
  );
}

/** The face, dashed, with a knife tip running round the left eye. */
function TraceScene() {
  return (
    <svg viewBox="22 40 86 74" style={{ height: 104 }}>
      <ellipse cx="64" cy="76" rx="49" ry="43" fill="#d86830" stroke="#0a0808" strokeWidth="2" />
      {PATTERN.map((shape, i) => (
        <polygon key={i} points={pts(shape)} fill="none" stroke="#2a0d02" strokeWidth="1.2" strokeDasharray="2 2" />
      ))}
      <path d={path(PATTERN[0])} fill="none" stroke="#ffd88f" strokeWidth="1.6" strokeDasharray="60" strokeDashoffset="60">
        <animate attributeName="stroke-dashoffset" values="60;0;0" dur="2.4s" repeatCount="indefinite" />
      </path>
      <circle r="2.2" fill="#f4f8fc" stroke="#120c08" strokeWidth="0.8">
        <animateMotion dur="2.4s" repeatCount="indefinite" keyPoints="0;1;1" keyTimes="0;0.8;1" calcMode="linear" path={path(PATTERN[0])} />
      </circle>
    </svg>
  );
}

/** A corner taken slowly (on the line) next to one rushed (cut across). */
function SlowScene() {
  const corner = "M6 40 L30 10 L54 40";
  return (
    <div style={{ display: "flex", gap: 22, alignItems: "center" }}>
      <svg viewBox="0 0 60 48" style={{ height: 72 }}>
        <path d={corner} fill="none" stroke="#9AA4B2" strokeWidth="2" strokeDasharray="3 3" />
        <path d={corner} fill="none" stroke="#14F195" strokeWidth="3" strokeLinejoin="miter" />
      </svg>
      <svg viewBox="0 0 60 48" style={{ height: 72 }}>
        <path d={corner} fill="none" stroke="#9AA4B2" strokeWidth="2" strokeDasharray="3 3" />
        <path d="M6 40 L24 18 Q30 12 38 22 L54 40" fill="none" stroke="#FF4D6D" strokeWidth="3" />
      </svg>
    </div>
  );
}

/** The clock, the meter with its pass mark, and the prize. */
function GoalScene({ hat }: { hat: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 14, color: "#fff" }}>{`0${CARVE_SECONDS / 60}:00`}</span>
        {hat}
      </div>
      <div style={{ position: "relative", width: 190, height: 12, background: "rgba(255,255,255,0.06)", border: "2px solid rgba(0,0,0,0.5)" }}>
        <div className="pc-howto-fill" style={{ height: "100%", background: "#14F195" }} />
        <div style={{ position: "absolute", top: -5, bottom: -5, left: `${PASS_ACCURACY}%`, width: 2, background: "#FFD700" }} />
        <span style={{ position: "absolute", top: -16, left: `${PASS_ACCURACY}%`, transform: "translateX(-50%)", fontSize: 7, color: "#FFD700" }}>
          {PASS_ACCURACY}%
        </span>
      </div>
    </div>
  );
}

export function HowToPlay({ accent, hat, touch, onDone }: { accent: string; hat: ReactNode; touch: boolean; onDone: () => void }) {
  const [i, setI] = useState(0);
  const steps = [
    {
      title: `FIND ${PUMPKINS_PER_HUNT} PUMPKINS`,
      line: `Hidden around the city. Walk into one to pick it up, and ${PUMPKINS_PER_HUNT} more turn up every day.`,
      scene: <HuntScene />,
    },
    {
      title: "ONE PUMPKIN, ONE CARVE",
      line: "Each pumpkin buys one go at the knife. Botch it and it is gone.",
      scene: <TradeScene hat={hat} />,
    },
    { title: "TRACE THE LINES", line: touch ? "Drag your finger along the dashed face." : "Drag the knife along the dashed face.", scene: <TraceScene /> },
    { title: "SLOW KNIFE, CLEAN CUT", line: "Rush a corner and the knife cuts across it.", scene: <SlowScene /> },
    { title: `${PASS_ACCURACY}% IN ONE MINUTE`, line: "The clock starts on your first cut.", scene: <GoalScene hat={hat} /> },
  ];
  const step = steps[i];
  const last = i === steps.length - 1;
  const backFeel = useButtonFeel();
  const nextFeel = useButtonFeel();

  const close = () => { markHowToSeen(); onDone(); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); }
      else if (e.key === "e" || e.key === "E" || e.key === "Enter" || e.key === "ArrowRight") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (last) close(); else setI((n) => n + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setI((n) => Math.max(0, n - 1));
      }
    };
    // Capture, so the game's own Escape (which leaves) never sees it.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(6,10,20,0.88)", zIndex: 5, padding: 12 }}>
      <style>{`@keyframes pc-howto-fill { from { width: 0; } 70%, to { width: 92%; } } .pc-howto-fill { animation: pc-howto-fill 2.6s ease-out infinite; }`}</style>
      <div className="pc-pop" style={chamferBox(12, {
        width: "min(400px, 100%)", maxHeight: "100%", overflowY: "auto", padding: 14,
        background: "#141a2b", border: `3px solid ${accent}`, fontFamily: FONT,
      })}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <span style={{ color: accent, fontSize: 9 }}>HOW TO PLAY</span>
          <span style={{ marginLeft: "auto", color: "#64748b", fontSize: 7 }}>{i + 1}/{steps.length}</span>
        </div>
        <div key={i} className="pc-pop" style={{
          height: 120, display: "flex", alignItems: "center", justifyContent: "center",
          background: "#0b1020", border: "1px solid rgba(255,255,255,0.06)",
        }}>
          {step.scene}
        </div>
        <div style={{ color: "#fff", fontSize: 9, margin: "12px 0 6px" }}>{step.title}</div>
        <div style={{ color: "#b9b9cc", fontSize: 8, lineHeight: 1.7, minHeight: "3.4em", marginBottom: 10 }}>{step.line}</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => setI((n) => Math.max(0, n - 1))}
            {...backFeel.handlers}
            style={{
              background: "transparent", border: "1px solid #333344", color: "#888899", padding: "9px 12px",
              fontFamily: FONT, fontSize: 7, visibility: i === 0 ? "hidden" : "visible", ...feelStyle(backFeel),
            }}
          >
            BACK
          </button>
          <div style={{ flex: 1, display: "flex", justifyContent: "center", gap: 5 }}>
            {steps.map((s, n) => (
              <span key={s.title} style={{ width: n === i ? 16 : 6, height: 6, background: n === i ? accent : "#333344", transition: "width .2s" }} />
            ))}
          </div>
          <button
            onClick={() => (last ? close() : setI((n) => n + 1))}
            {...nextFeel.handlers}
            style={chamferBox(6, {
              background: accent, color: "#1a1405", border: "none", padding: "10px 16px",
              fontFamily: FONT, fontSize: 8, ...feelStyle(nextFeel),
            })}
          >
            {last ? "CARVE!" : "NEXT"}
          </button>
        </div>
      </div>
    </div>
  );
}
