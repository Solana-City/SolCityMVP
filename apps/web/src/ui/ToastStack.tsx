"use client";

import { PixelImg, ICON, AchievementIcon } from "@/ui/PixelIcons";
import { useEffect, useState } from "react";
import { progressionBus, type ProgressionEvent } from "@/game/progression/progressionBus";
import { TIER_COLORS, ACHIEVEMENTS } from "@/game/progression/achievementRegistry";
import { chamferBox } from "@/ui/chamfer";
import ChamferGlow from "@/ui/ChamferGlow";

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
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  color: string;
  lifetime: number;
}

const MAX_TOASTS = 5;

/**
 * Cards on screen at once. A phone's game view is ~390px tall and the NPC's text
 * sits along its bottom, so two cards (of any kind but the little +N) is what
 * fits above it; on a desktop only the big achievement cards are counted, and
 * three fit. The rest wait their turn, so several unlocked together are each
 * read instead of being stacked over one another.
 */
const CARDS_AT_ONCE = { touch: 2, desktop: 3 };

/** The phone's own HUD: the rail on the left, the profile and map card on the right. */
const TOUCH_BAND_LEFT = 64;
const TOUCH_BAND_RIGHT = 230;

function useIsTouch(): boolean {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    setTouch(mq.matches);
    const on = (e: MediaQueryListEvent) => setTouch(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return touch;
}

export default function ToastStack() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const touch = useIsTouch();

  useEffect(() => {
    let nextId = 1;
    let cardsUp = 0;
    const waiting: Omit<Toast, "id">[] = [];
    const limit = touch ? CARDS_AT_ONCE.touch : CARDS_AT_ONCE.desktop;
    const counts = (t: Omit<Toast, "id">) => touch ? t.variant !== "score" : t.variant === "achievement";

    const show = (t: Omit<Toast, "id">) => {
      const id = nextId++;
      const counted = counts(t);
      if (counted) cardsUp++;
      setToasts((list) => {
        const next = [...list, { ...t, id }];
        return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
      });
      setTimeout(() => {
        setToasts((list) => list.filter((x) => x.id !== id));
        if (!counted) return;
        cardsUp--;
        const next = waiting.shift();
        if (next) show(next);
      }, t.lifetime);
    };

    const addToast = (t: Omit<Toast, "id">) => {
      if (counts(t) && cardsUp >= limit) { waiting.push(t); return; }
      show(t);
    };

    const handler = (event: ProgressionEvent) => {
      switch (event.type) {
        case "score-gained":
          addToast({
            variant: "score",
            title: `+${event.amount}`,
            color: "#B7E928",
            lifetime: 1800,
          });
          break;

        case "achievement-unlocked": {
          const def = ACHIEVEMENTS.find((a) => a.id === event.id);
          const color = def ? TIER_COLORS[def.tier] : "#B7E928";
          addToast({
            variant: "achievement",
            // The art key, not the rung id. Since achievements became tracks an
            // id looks like "dog:3" while the sprite is still filed under the
            // family's old id, so passing the id would silently fall back to
            // the trophy for every unlock.
            icon: <AchievementIcon id={def?.art ?? event.id} size={40} />,
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
            icon: <PixelImg src={ICON.wardrobe} size={20} />,
            title: "Outfit unlocked",
            subtitle: event.outfitName,
            color: "#9945FF",
            lifetime: 4000,
          });
          break;

        case "friend-online":
          addToast({
            variant: "npc-first",
            icon: <PixelImg src={ICON.chat} size={20} />,
            title: `${event.name} is here`,
            color: "#B7E928",
            lifetime: 3500,
          });
          break;

        case "npc-visited":
          if (event.firstTime) {
            addToast({
              variant: "npc-first",
              icon: <PixelImg src={ICON.chat} size={20} />,
              title: `Met ${event.npcName}`,
              color: "#14F0C6",
              lifetime: 2500,
            });
          }
          break;
      }
    };

    const unsub = progressionBus.on("*", handler);
    return () => unsub();
  }, [touch]);

  // On a phone the stack hangs from the top edge, in the strip between the rail
  // on the left and the profile/map on the right, and never reaches the NPC's
  // text along the bottom. On a desktop it keeps its place below the top.
  return (
    <div
      className="fixed z-40 flex flex-col items-center pointer-events-none"
      style={touch ? {
        top: "calc(env(safe-area-inset-top, 0px) + 8px)",
        left: `calc(50% + ${(TOUCH_BAND_LEFT - TOUCH_BAND_RIGHT) / 2}px)`,
        transform: "translateX(-50%)",
        width: `min(420px, calc(100vw - ${TOUCH_BAND_LEFT + TOUCH_BAND_RIGHT}px))`,
        gap: 8,
        fontFamily: '"Press Start 2P", monospace',
      } : {
        top: 80, left: "50%", transform: "translateX(-50%)", gap: 12,
        fontFamily: '"Press Start 2P", monospace',
      }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} compact={touch} />
      ))}
    </div>
  );
}

function ToastItem({ toast, compact }: { toast: Toast; compact: boolean }) {
  if (toast.variant === "score") return <ScoreToast toast={toast} />;
  if (toast.variant === "achievement") return <AchievementFrame toast={toast} compact={compact} />;
  return <SmallCard toast={toast} compact={compact} />;
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

function SmallCard({ toast, compact }: { toast: Toast; compact: boolean }) {
  return (
    <ChamferGlow glow={`drop-shadow(0 0 10px ${toast.color}66) drop-shadow(0 4px 8px rgba(0,0,0,0.4))`}
      style={compact ? { maxWidth: "100%" } : undefined}>
    <div
      className={`toast-small ${compact ? "px-3 py-2" : "px-4 py-3"} flex items-center gap-3`}
      style={chamferBox(12, {
        // No backdrop blur: invisible behind 97% opacity, and re-blurred every
        // frame while it sat over the moving canvas.
        background: "rgba(10,10,30,0.97)",
        border: `2px solid ${toast.color}`,
        minWidth: compact ? 0 : 260,
        maxWidth: 400,
      })}
    >
      {toast.icon && <div style={{ flexShrink: 0, lineHeight: 0 }}>{toast.icon}</div>}
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
    </ChamferGlow>
  );
}

/**
 * Achievement frame: the "big moment" card. Square corners with an L of the
 * tier colour at each, a glow, and its "ACHIEVEMENT UNLOCKED" label as a strip
 * along the top of the card itself. (It used to hang off the top edge, over
 * whatever was above it: the card before it in the stack, or the game.) Enters
 * with scale + blur, holds ~3.5s, exits with shrink + blur + fade. `compact` is
 * the phone's: tighter, and as wide as the strip it hangs in.
 */
function AchievementFrame({ toast, compact }: { toast: Toast; compact: boolean }) {
  return (
    <div
      className="achievement-wrapper"
      style={{ position: "relative", ...(compact ? { width: "100%" } : { minWidth: 380, maxWidth: 480 }) }}
    >
      <div
        style={{
          background: "#061A3A",
          border: `2px solid ${toast.color}`,
          boxShadow: `
            0 0 30px ${toast.color}66,
            0 0 60px ${toast.color}33,
            inset 0 0 20px ${toast.color}11,
            0 6px 24px rgba(0,0,0,0.5)
          `,
          position: "relative",
        }}
      >
        <div
          style={{
            background: toast.color,
            color: "#0a0a1e",
            fontFamily: '"Press Start 2P", monospace',
            fontSize: "7px",
            letterSpacing: "0.1em",
            padding: compact ? "3px 8px" : "4px 10px",
            textAlign: "center",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          ★ ACHIEVEMENT UNLOCKED ★
        </div>

        <div
          style={{
            padding: compact ? "8px 12px" : "16px 20px",
            display: "flex",
            alignItems: "center",
            gap: compact ? 10 : 16,
          }}
        >
          <div
            className="achievement-icon"
            style={{
              width: compact ? 44 : 56,
              height: compact ? 44 : 56,
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
                fontSize: compact ? "9px" : "10px",
                color: toast.color,
                letterSpacing: "0.03em",
                textShadow: `0 0 8px ${toast.color}66`,
                marginBottom: compact ? 4 : 6,
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

        <Corner color={toast.color} pos="tl" />
        <Corner color={toast.color} pos="tr" />
        <Corner color={toast.color} pos="bl" />
        <Corner color={toast.color} pos="br" />
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

/** An L in the tier colour on one corner of the card, laid over its 2px border. */
function Corner({ color, pos }: { color: string; pos: "tl" | "tr" | "bl" | "br" }) {
  const positions = {
    tl: { top: -2, left: -2, borderTop: `3px solid ${color}`, borderLeft: `3px solid ${color}` },
    tr: { top: -2, right: -2, borderTop: `3px solid ${color}`, borderRight: `3px solid ${color}` },
    bl: { bottom: -2, left: -2, borderBottom: `3px solid ${color}`, borderLeft: `3px solid ${color}` },
    br: { bottom: -2, right: -2, borderBottom: `3px solid ${color}`, borderRight: `3px solid ${color}` },
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
