"use client";

/**
 * Sol Mechs — match clock.
 *
 * A chess clock with Fischer increment, shown for both sides. See
 * data/clock.ts for why it is a bank rather than a per-round timer, and for
 * the constants a settlement program has to agree with.
 */
import { useEffect, useRef, useState } from "react";
import { addIncrement, formatClock, type ClockConfig } from "@/game/solmechs/data/clock";
import type { PlayerSide } from "@/game/solmechs/engine/BattleEngine";
import { C, T, SP, R, MONO, eyebrow } from "./theme";

export interface ClockState {
  p1: number;
  p2: number;
}

export interface UseChessClockOptions {
  config: ClockConfig;
  /**
   * Which sides are currently ON the clock. Empty while the round resolves —
   * time must not run during animation, or a long knockout sequence would
   * charge both players for watching it.
   */
  thinking: PlayerSide[];
  /** Stops everything: battle over, screen closing. */
  paused: boolean;
  /** Fired once, with the side that ran out. */
  onTimeout: (side: PlayerSide) => void;
}

/** ms between ticks. Fine enough for a tenth-second readout, cheap enough to ignore. */
const TICK = 100;

export function useChessClock({ config, thinking, paused, onTimeout }: UseChessClockOptions) {
  const [clock, setClock] = useState<ClockState>({ p1: config.bankMs, p2: config.bankMs });
  // Refs so the interval reads current values without being torn down and
  // rebuilt on every tick.
  const thinkingRef = useRef(thinking);
  const pausedRef = useRef(paused);
  const firedRef = useRef(false);
  const onTimeoutRef = useRef(onTimeout);
  thinkingRef.current = thinking;
  pausedRef.current = paused;
  onTimeoutRef.current = onTimeout;

  useEffect(() => {
    const id = setInterval(() => {
      if (pausedRef.current || firedRef.current) return;
      const active = thinkingRef.current;
      if (active.length === 0) return;

      setClock((prev) => {
        const next: ClockState = { ...prev };
        for (const side of active) next[side] = Math.max(0, next[side] - TICK);

        // Report at most once. Ties go to whoever is listed first, which is
        // deterministic; both sides hitting zero on the same 100ms tick is not
        // a case worth a coin flip.
        if (!firedRef.current) {
          const out = active.find((s) => next[s] <= 0);
          if (out) {
            firedRef.current = true;
            // Defer: firing mid-setState would update another component while
            // this one is still rendering.
            setTimeout(() => onTimeoutRef.current(out), 0);
          }
        }
        return next;
      });
    }, TICK);
    return () => clearInterval(id);
  }, []);

  /** Hand back the increment for a side that just submitted. */
  const credit = (side: PlayerSide) => {
    setClock((prev) => ({ ...prev, [side]: addIncrement(prev[side], config) }));
  };

  return { clock, credit };
}

export function ClockBar({ clock, config, thinking, side, label, align }: {
  clock: ClockState;
  config: ClockConfig;
  thinking: PlayerSide[];
  side: PlayerSide;
  label: string;
  align?: "right";
}) {
  const ms = clock[side];
  const live = thinking.includes(side);
  const low = ms <= config.warnAtMs;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: SP.sm,
      flexDirection: align === "right" ? "row-reverse" : "row",
    }}>
      <span style={{ ...eyebrow, color: C.faint }}>{label}</span>
      <span style={{
        fontFamily: MONO,
        fontSize: T.lead,
        fontWeight: 800,
        letterSpacing: 1,
        color: low ? C.bad : live ? C.teal : C.dim,
        background: C.ink,
        border: `1px solid ${low ? C.bad : live ? C.teal : C.line}`,
        borderRadius: R.sm,
        padding: "4px 12px",
        minWidth: 84,
        textAlign: "center",
        // A quiet pulse only while this side is actually spending time.
        opacity: live ? 1 : 0.65,
        transition: "color .2s, border-color .2s, opacity .2s",
      }}>
        {formatClock(ms)}
      </span>
    </div>
  );
}
