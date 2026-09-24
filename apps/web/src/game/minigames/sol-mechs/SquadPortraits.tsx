"use client";

/**
 * Sol Mechs — a squad as a row of mech portraits.
 *
 * The squad bar used to be bordered name chips, which read as buttons nobody
 * could press. A portrait says which mech it is at a glance, carries its core
 * HP as a strip under it, and hovering (or tapping, on touch) opens the parts
 * it is wearing with each part's HP, reserves included.
 */
import { useEffect, useRef, useState } from "react";
import { drawMech, mechBounds, preloadBuild, DOLL_WIDTH, DOLL_HEIGHT } from "@/game/solmechs/render/paperDoll";
import { isDefeated } from "@/game/solmechs/engine/BattleEngine";
import type { TeamSide } from "@/game/solmechs/engine/TeamBattle";
import type { MechBuild, MechUnit, ModuleSlot } from "@/game/solmechs/data/types";
import { C, MONO } from "./theme";

const SIZE = 38;
const SLOTS: ModuleSlot[] = ["matrix", "rightArm", "leftArm", "lowerBody"];
const SLOT_LABEL: Record<ModuleSlot, string> = {
  matrix: "MATRIX", rightArm: "R.ARM", leftArm: "L.ARM", lowerBody: "LEGS",
};

export function SquadPortraits({ side, label, align, size = SIZE, substitutable, onSubstitute }: {
  side: TeamSide; label: string; align?: "right"; size?: number;
  /** Reserves that can be sent in right now, by index in the squad. */
  substitutable?: number[];
  /** Given, a reserve card carries a button that sends that mech in. */
  onSubstitute?: (index: number) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const right = align === "right";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, minWidth: 0,
      flexDirection: right ? "row-reverse" : "row",
    }}>
      <div style={{ fontSize: 11, color: C.faint, letterSpacing: 2 }}>{label}</div>
      <div style={{ display: "flex", gap: 5, flexDirection: right ? "row-reverse" : "row" }}>
        {side.units.map((u, i) => {
          const canSwap = !!onSubstitute && (substitutable?.includes(i) ?? false);
          return (
            <div
              key={i}
              style={{ position: "relative" }}
              onMouseEnter={() => setOpen(i)}
              onMouseLeave={() => setOpen((cur) => (cur === i ? null : cur))}
              onClick={() => setOpen((cur) => (cur === i ? null : i))}
            >
              <Portrait unit={u} active={i === side.activeIndex} size={size} swappable={canSwap} />
              {open === i && (
                <PartsCard
                  unit={u}
                  index={i}
                  active={i === side.activeIndex}
                  right={right}
                  top={size + 10}
                  onSubstitute={canSwap && onSubstitute ? () => { setOpen(null); onSubstitute(i); } : undefined}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Portrait({ unit, active, size: SIZE, swappable }: {
  unit: MechUnit; active: boolean; size: number; swappable?: boolean;
}) {
  const down = isDefeated(unit);
  const hp = unit.matrixMaxHP > 0 ? Math.max(0, unit.matrixHP / unit.matrixMaxHP) : 0;
  return (
    <div
      aria-label={`${unit.matrix.matrixName}${down ? ", down" : active ? ", on the field" : ", reserve"}`}
      style={{
        position: "relative", width: SIZE, height: SIZE + 5,
        cursor: swappable ? "pointer" : "help",
        opacity: down ? 0.45 : 1,
        filter: down ? "grayscale(1)" : "none",
      }}
    >
      <div style={{
        width: SIZE, height: SIZE, borderRadius: "50%", overflow: "hidden",
        background: active ? "#12302e" : "#140b24",
        boxShadow: active
          ? `0 0 0 2px ${C.teal}, 0 0 10px ${C.teal}66`
          : swappable ? `0 0 0 2px ${C.blue}66` : `0 0 0 1px ${C.line}`,
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}>
        <Bust build={unit.build} size={SIZE} />
      </div>
      {/* Core HP: the number that decides whether this mech can still fight. */}
      <div style={{
        position: "absolute", left: 4, right: 4, bottom: 0, height: 3,
        background: "#000", borderRadius: 2, overflow: "hidden",
      }}>
        <div style={{
          width: `${hp * 100}%`, height: "100%",
          background: hp > 0.5 ? C.teal : hp > 0.2 ? C.warn : C.bad,
        }} />
      </div>
      {down && (
        <span style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
          color: C.bad, fontSize: 22, fontWeight: 900, lineHeight: 1, pointerEvents: "none",
        }}>
          ✕
        </span>
      )}
    </div>
  );
}

/** Head and shoulders of the assembled mech, drawn once its art has decoded. */
export function Bust({ build, size = SIZE }: { build: MechBuild; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    preloadBuild(build);
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const off = document.createElement("canvas");
    off.width = DOLL_WIDTH;
    off.height = DOLL_HEIGHT;
    const octx = off.getContext("2d");
    let raf = 0;
    const tryDraw = () => {
      const box = mechBounds(build);
      if (!octx || !box || !drawMech(octx, build, { x: 0, y: 0, scale: 1 })) {
        raf = requestAnimationFrame(tryDraw);
        return;
      }
      // A square off the top of the mech, a bit over half its height: the
      // head and shoulders, big enough to tell the chassis apart.
      const side = Math.round(Math.min(box.w, box.h * 0.58));
      const sx = box.x + (box.w - side) / 2;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, sx, box.y - 1, side, side, 0, 0, c.width, c.height);
    };
    tryDraw();
    return () => cancelAnimationFrame(raf);
  }, [build, size]);
  return (
    <canvas
      ref={ref}
      width={size * 2}
      height={size * 2}
      style={{ width: size, height: size, imageRendering: "pixelated", display: "block", flexShrink: 0 }}
    />
  );
}

function PartsCard({ unit, index, active, right, top, onSubstitute }: {
  unit: MechUnit; index: number; active: boolean; right: boolean; top: number;
  onSubstitute?: () => void;
}) {
  const down = isDefeated(unit);
  return (
    <div style={{
      position: "absolute", top, [right ? "right" : "left"]: 0, zIndex: 20,
      // The card only takes the pointer when there is something to press on
      // it; otherwise it would swallow clicks meant for the arena behind it.
      width: 210, padding: "8px 10px", pointerEvents: onSubstitute ? "auto" : "none",
      background: "rgba(8,4,16,.97)", border: `1px solid ${C.lineBright}`, borderRadius: 6,
      boxShadow: "0 10px 30px rgba(0,0,0,.65)",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 6 }}>
        <strong style={{ fontSize: 13, color: C.text }}>{unit.matrix.matrixName}</strong>
        <span style={{ fontSize: 10, color: down ? C.bad : active ? C.teal : C.faint, letterSpacing: 1, marginLeft: "auto" }}>
          {down ? "DOWN" : active ? "ON FIELD" : index === 0 ? "LEADS" : `RESERVE ${index}`}
        </span>
      </div>
      {SLOTS.map((slot) => {
        const st = unit.partStatuses[slot];
        const pct = st.maxHP > 0 ? Math.max(0, st.currentHP / st.maxHP) : 0;
        const broken = st.currentHP <= 0;
        return (
          <div key={slot} style={{ marginBottom: 4 }}>
            <div style={{ display: "flex", gap: 6, fontSize: 11, alignItems: "baseline" }}>
              <span style={{ width: 44, flexShrink: 0, fontFamily: MONO, fontSize: 9, color: C.faint }}>{SLOT_LABEL[slot]}</span>
              <span style={{
                color: broken ? C.bad : C.body, minWidth: 0,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                textDecoration: broken ? "line-through" : "none",
              }}>
                {slot === "matrix" ? unit.matrix.matrixName : st.partName}
              </span>
              <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, color: broken ? C.bad : C.text, flexShrink: 0 }}>
                {st.currentHP}/{st.maxHP}
              </span>
            </div>
            <div style={{ height: 3, background: "#000", marginLeft: 50, marginTop: 2 }}>
              <div style={{ width: `${pct * 100}%`, height: "100%", background: slot === "matrix" ? C.teal : C.blue }} />
            </div>
          </div>
        );
      })}
      {onSubstitute && (
        <button
          onClick={(e) => { e.stopPropagation(); onSubstitute(); }}
          style={{
            width: "100%", marginTop: 6, padding: "6px 0",
            background: "rgba(95,160,255,.12)", border: `1px solid ${C.blue}`, borderRadius: 4,
            color: C.blue, fontFamily: "inherit", fontSize: 11, fontWeight: 700, letterSpacing: 1,
            cursor: "pointer",
          }}
        >
          SUBSTITUTE
        </button>
      )}
    </div>
  );
}
