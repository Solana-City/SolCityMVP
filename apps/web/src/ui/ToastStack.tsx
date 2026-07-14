"use client";

import { useEffect, useState } from "react";
import { progressionBus, type ProgressionEvent } from "@/game/progression/progressionBus";
import { TIER_COLORS, ACHIEVEMENTS } from "@/game/progression/achievementRegistry";

/**
 * Feedback toast surface. Three visual languages:
 *   - "score":       small "+N" that rises and fades, lifetime ~1.8s
 *   - "achievement": distinctive banner — ornamental brackets, glowing tier
 *                    color, "ACHIEVEMENT UNLOCKED" label overhead. Stays
 *                    visible ~5s then fades out with blur + shrink.
 *   - "outfit" / "npc-first": small colored card, 2.5-4s.
 */

interface Toast {
  id: number;
  variant: "score" | "achievement" | "outfit" | "npc-first";
  icon?: string;
  title: string;
  subtitle?: string;
  color: string;
  lifetime: number;
}

const MAX_TOASTS = 5;

export default function ToastStack() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    let nextId = 1;

    const addToast = (t: Omit<Toast, "id">) => {
      const id = nextId++;
      setToasts((list) => {
        const next = [...list, { ...t, id }];
        return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
      });
      setTimeout(() => {
        setToasts((list) => list.filter((x) => x.id !== id));
      }, t.lifetime);
    };

    const handler = (event: ProgressionEvent) => {
      switch (event.type) {
        case "score-gained":
          addToast({
            variant: "score",
            title: `+${event.amount}`,
            color: "#14F195",
            lifetime: 1800,
          });
          break;

        case "achievement-unlocked": {
          const def = ACHIEVEMENTS.find((a) => a.id === event.id);
          const color = def ? TIER_COLORS[def.tier] : "#14F195";
          addToast({
            variant: "achievement",
            icon: event.icon,
            title: event.title,
            subtitle: event.description,
            color,
            lifetime: 5000,
          });
          break;
        }

        case "outfit-unlocked":
          addToast({
            variant: "outfit",
            icon: "👕",
            title: "Outfit unlocked",
            subtitle: event.outfitName,
            color: "#9945FF",
            lifetime: 4000,
          });
          break;

        case "npc-visited":
          if (event.firstTime) {
            addToast({
              variant: "npc-first",
              icon: "💬",
              title: `Met ${event.npcName}`,
              color: "#00D1FF",
              lifetime: 2500,
            });
          }
          break;
      }
    };

    const unsub = progressionBus.on("*", handler);
    return () => unsub();
  }, []);

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-3 pointer-events-none"
      style={{ top: 80, fontFamily: '"Press Start 2P", monospace' }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  if (toast.variant === "score") return <ScoreToast toast={toast} />;
  if (toast.variant === "achievement") return <AchievementFrame toast={toast} />;
  return <SmallCard toast={toast} />;
}

function ScoreToast({ toast }: { toast: Toast }) {
  return (
    <div
      className="toast-score"
      style={{
        fontFamily: '"Press Start 2P", monospace',
        color: toast.color,
        fontSize: "15px",
        textShadow: `0 0 10px ${toast.color}88, 0 2px 4px rgba(0,0,0,0.8)`,
      }}
    >
      {toast.title}
      <style jsx>{`
        .toast-score {
          animation: scoreToast 1.8s ease-out forwards;
        }
        @keyframes scoreToast {
          0%   { transform: translateY(0) scale(0.8); opacity: 0; }
          15%  { transform: translateY(-10px) scale(1.1); opacity: 1; }
          70%  { transform: translateY(-30px) scale(1); opacity: 1; }
          100% { transform: translateY(-60px) scale(0.9); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function SmallCard({ toast }: { toast: Toast }) {
  return (
    <div
      className="toast-small rounded-xl px-4 py-3 flex items-center gap-3"
      style={{
        background: "rgba(10,10,30,0.97)",
        border: `2px solid ${toast.color}`,
        boxShadow: `0 0 20px ${toast.color}44, 0 4px 16px rgba(0,0,0,0.4)`,
        backdropFilter: "blur(4px)",
        minWidth: 260,
        maxWidth: 400,
      }}
    >
      {toast.icon && <div style={{ fontSize: "17px", flexShrink: 0 }}>{toast.icon}</div>}
      <div className="min-w-0">
        <div
          style={{
            fontFamily: '"Press Start 2P", monospace',
            fontSize: "8px",
            color: toast.color,
            letterSpacing: "0.05em",
          }}
        >
          {toast.title}
        </div>
        {toast.subtitle && (
          <div style={{ fontSize: "8px", color: "#aaaacc", marginTop: 4 }}>
            {toast.subtitle}
          </div>
        )}
      </div>
      <style jsx>{`
        .toast-small {
          animation: smallIn 0.4s ease-out forwards;
        }
        @keyframes smallIn {
          0%   { transform: translateY(-15px) scale(0.9); opacity: 0; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

/**
 * Achievement frame — the "big moment" visual. Ornamental corner
 * brackets, glowing tier color, "ACHIEVEMENT UNLOCKED" label, icon
 * with a radial spotlight. Enters with scale + blur, holds ~3.5s,
 * exits with shrink + blur + fade.
 */
function AchievementFrame({ toast }: { toast: Toast }) {
  return (
    <div
      className="achievement-wrapper"
      style={{ position: "relative", minWidth: 380, maxWidth: 480 }}
    >
      <div
        style={{
          position: "absolute",
          top: -14,
          left: "50%",
          transform: "translateX(-50%)",
          background: toast.color,
          color: "#0a0a1e",
          fontFamily: '"Press Start 2P", monospace',
          fontSize: "7px",
          letterSpacing: "0.1em",
          padding: "3px 10px",
          borderRadius: 3,
          whiteSpace: "nowrap",
          boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          zIndex: 2,
        }}
      >
        ★ ACHIEVEMENT UNLOCKED ★
      </div>

      <div
        style={{
          background: `linear-gradient(135deg, rgba(10,10,30,0.97) 0%, ${toast.color}22 100%)`,
          border: `2px solid ${toast.color}`,
          borderRadius: 8,
          padding: "16px 20px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          boxShadow: `
            0 0 30px ${toast.color}66,
            0 0 60px ${toast.color}33,
            inset 0 0 20px ${toast.color}11,
            0 6px 24px rgba(0,0,0,0.5)
          `,
          backdropFilter: "blur(6px)",
          position: "relative",
        }}
      >
        <Corner color={toast.color} pos="tl" />
        <Corner color={toast.color} pos="tr" />
        <Corner color={toast.color} pos="bl" />
        <Corner color={toast.color} pos="br" />

        <div
          className="achievement-icon"
          style={{
            width: 56,
            height: 56,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            fontSize: "26px",
            background: `radial-gradient(circle, ${toast.color}33 0%, transparent 70%)`,
            borderRadius: "50%",
          }}
        >
          {toast.icon}
        </div>

        <div className="min-w-0 flex-1">
          <div
            style={{
              fontFamily: '"Press Start 2P", monospace',
              fontSize: "10px",
              color: toast.color,
              letterSpacing: "0.03em",
              textShadow: `0 0 8px ${toast.color}66`,
              marginBottom: 6,
            }}
          >
            {toast.title}
          </div>
          {toast.subtitle && (
            <div style={{ fontSize: "8px", color: "#ccccdd", lineHeight: 1.4 }}>
              {toast.subtitle}
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .achievement-wrapper {
          animation: achWrapper 5s ease-in-out forwards;
        }
        @keyframes achWrapper {
          0%   { transform: scale(0.6); opacity: 0; filter: blur(4px); }
          8%   { transform: scale(1.08); opacity: 1; filter: blur(0); }
          15%  { transform: scale(1);    opacity: 1; filter: blur(0); }
          78%  { transform: scale(1);    opacity: 1; filter: blur(0); }
          100% { transform: scale(0.85); opacity: 0; filter: blur(8px); }
        }
        .achievement-icon {
          animation: iconPulse 2s ease-in-out infinite;
        }
        @keyframes iconPulse {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.08); }
        }
      `}</style>
    </div>
  );
}

function Corner({ color, pos }: { color: string; pos: "tl" | "tr" | "bl" | "br" }) {
  const positions = {
    tl: { top: -1, left: -1, borderTop: `3px solid ${color}`, borderLeft: `3px solid ${color}` },
    tr: { top: -1, right: -1, borderTop: `3px solid ${color}`, borderRight: `3px solid ${color}` },
    bl: { bottom: -1, left: -1, borderBottom: `3px solid ${color}`, borderLeft: `3px solid ${color}` },
    br: { bottom: -1, right: -1, borderBottom: `3px solid ${color}`, borderRight: `3px solid ${color}` },
  }[pos];
  return (
    <div
      style={{
        position: "absolute",
        width: 14,
        height: 14,
        pointerEvents: "none",
        ...positions,
      }}
    />
  );
}
