"use client";

/**
 * Sol Mechs — battle HUD, laid out after the Unity original.
 *
 * The Unity build put both players' bars across the FULL width, mirrored, so
 * they drain toward the centre and the two sides can be compared at a glance
 * on the same row. An earlier pass here stacked each side's bars into a narrow
 * column flanking the arena, which made comparing "my right arm vs theirs"
 * a matter of looking back and forth across the screen.
 *
 * Kept from that pass, because they are strictly more informative than the
 * original: numeric HP beside every bar, the slot icons, and a marker on the
 * limbs that still seal the Matrix.
 */
import { useEffect, useRef } from "react";
import { drawMech, DOLL_WIDTH, DOLL_HEIGHT, preloadBuild } from "@/game/solmechs/render/MechPaperDoll";
import { canAttackMatrix } from "@/game/solmechs/engine/BattleEngine";
import type { MechUnit, ModuleSlot, MechBuild } from "@/game/solmechs/data/types";
import { C, T, SP, R, MONO, PIXELATED } from "./theme";

/** Matrix first, then the limbs — the Unity order. */
const HUD_SLOTS: ModuleSlot[] = ["matrix", "rightArm", "leftArm", "lowerBody"];

const SLOT_TITLE: Record<ModuleSlot, string> = {
  matrix: "Matrix",
  rightArm: "Right Arm",
  leftArm: "Left Arm",
  lowerBody: "Inferior",
};

const SLOT_ICON: Record<ModuleSlot, string> = {
  matrix: "/assets/minigames/sol-mechs/ui/slotmini-matrix.png",
  rightArm: "/assets/minigames/sol-mechs/ui/slotmini-rightarm.png",
  leftArm: "/assets/minigames/sol-mechs/ui/slotmini-leftarm.png",
  lowerBody: "/assets/minigames/sol-mechs/ui/slotmini-legs.png",
};

const PORTRAIT_SCALE = 1;

/**
 * The Unity name plates (`arena/Player1.png` and `player2.png`), 360x133 with a
 * portrait disc on the outer side and a name banner on the inner side.
 *
 * The two are exact mirrors, so one set of percentages describes both — read
 * from the outer edge inward, and which physical edge that is flips with
 * `align`. Percentages rather than pixels because the plate is scaled to
 * PLATE_H: the art is fixed-aspect, so anything measured in source pixels
 * would drift the moment that constant changed.
 */
const PLATE = {
  left: "/assets/minigames/sol-mechs/ui/hud-left.png",
  right: "/assets/minigames/sol-mechs/ui/hud-right.png",
  aspect: 360 / 133,
  /** Portrait disc, measured off the art. */
  disc: { outer: "1.7%", top: "4.5%", size: "48.1%", height: "90.2%" },
  /** Name banner. */
  banner: { outer: "51%", inner: "4%", top: "21.8%", bottom: "18.8%" },
} as const;

/** Plate height in px. Everything else on the plate derives from it. */
const PLATE_H = 92;

/** Name plate with the mech's doll as its portrait, and the match clock. */
export function PlayerCard({ unit, label, clock, live, low, align }: {
  unit: MechUnit;
  label: string;
  clock: string;
  /** This side is currently spending time. */
  live: boolean;
  /** Under the warning threshold. */
  low: boolean;
  align?: "right";
}) {
  const right = align === "right";
  // The plate art already mirrors; these place the two hotspots against
  // whichever edge is the outer one for this side.
  const disc = right ? { right: PLATE.disc.outer } : { left: PLATE.disc.outer };
  const banner = right
    ? { right: PLATE.banner.outer, left: PLATE.banner.inner }
    : { left: PLATE.banner.outer, right: PLATE.banner.inner };

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: SP.md, minWidth: 0, flex: 1,
      flexDirection: right ? "row-reverse" : "row",
    }}>
      <div style={{
        position: "relative", flexShrink: 0,
        height: PLATE_H, width: PLATE_H * PLATE.aspect,
        backgroundImage: `url(${right ? PLATE.right : PLATE.left})`,
        backgroundSize: "100% 100%", backgroundRepeat: "no-repeat",
        ...PIXELATED,
      }}>
        <div style={{
          position: "absolute", ...disc,
          top: PLATE.disc.top, width: PLATE.disc.size, height: PLATE.disc.height,
          // Clipped to the disc so a long limb can't spill over the neon ring.
          borderRadius: "50%", overflow: "hidden",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Portrait build={unit.build} />
        </div>

        <div style={{
          position: "absolute", ...banner,
          top: PLATE.banner.top, bottom: PLATE.banner.bottom,
          display: "flex", flexDirection: "column", justifyContent: "center",
          textAlign: right ? "right" : "left", overflow: "hidden",
        }}>
          <div style={{
            fontSize: T.body, fontWeight: 800, color: C.text, lineHeight: 1.15,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {label}
          </div>
          <div style={{
            fontSize: T.eyebrow, color: C.teal, lineHeight: 1.2,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {unit.matrix.matrixName}
          </div>
        </div>
      </div>

      <div style={{
        fontFamily: MONO, fontSize: T.title, fontWeight: 800, letterSpacing: 1,
        color: low ? C.bad : live ? C.teal : C.dim,
        background: C.ink,
        border: `2px solid ${low ? C.bad : live ? C.teal : C.line}`,
        borderRadius: R.sm, padding: "4px 12px", minWidth: 96, textAlign: "center",
        flexShrink: 0, transition: "color .2s, border-color .2s",
      }}>
        {clock}
      </div>
    </div>
  );
}

function Portrait({ build }: { build: MechBuild }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  useEffect(() => {
    preloadBuild(build);
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const loop = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      drawMech(ctx, build, { x: 0, y: 0, scale: PORTRAIT_SCALE });
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [build]);

  return (
    <canvas
      ref={ref}
      width={DOLL_WIDTH * PORTRAIT_SCALE}
      height={DOLL_HEIGHT * PORTRAIT_SCALE}
      // Sized by HEIGHT: the doll is taller than it is wide, so fitting the
      // width would leave it swimming in the disc.
      style={{ ...PIXELATED, height: "88%", width: "auto", display: "block" }}
    />
  );
}

/**
 * Both mechs' bars on shared rows, draining toward the centre.
 *
 * `flexDirection: row-reverse` on the right side is what mirrors it: the fill
 * grows from the outer edge inward, so the two sides read symmetrically
 * instead of both marching left-to-right.
 */
export function MirroredBars({ p1, p2 }: { p1: MechUnit; p2: MechUnit }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, flexShrink: 0 }}>
      {HUD_SLOTS.map((slot) => (
        <div key={slot} style={{ display: "flex", alignItems: "center", gap: SP.md }}>
          <SideBar unit={p1} slot={slot} />
          <span style={{
            width: 26, flexShrink: 0, textAlign: "center",
            fontSize: T.eyebrow, color: C.faint,
          }}>
            <img
              src={SLOT_ICON[slot]}
              alt={SLOT_TITLE[slot]}
              title={SLOT_TITLE[slot]}
              style={{ ...PIXELATED, height: slot === "matrix" ? 16 : 20, width: "auto", display: "block", margin: "0 auto" }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          </span>
          <SideBar unit={p2} slot={slot} mirrored />
        </div>
      ))}
    </div>
  );
}

function SideBar({ unit, slot, mirrored }: { unit: MechUnit; slot: ModuleSlot; mirrored?: boolean }) {
  const st = unit.partStatuses[slot];
  const pct = st.maxHP > 0 ? Math.max(0, st.currentHP / st.maxHP) * 100 : 0;
  const dead = st.currentHP <= 0;
  const sealed = slot === "matrix" && !canAttackMatrix(unit);
  // An arm still standing is what keeps the core sealed — worth marking, since
  // it is the difference between a legal target and an illegal one.
  const sealing = (slot === "rightArm" || slot === "leftArm") && !dead && sealed;

  return (
    <div style={{
      flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: SP.sm,
      flexDirection: mirrored ? "row-reverse" : "row",
    }}>
      <span style={{
        fontSize: T.eyebrow, fontWeight: 700, fontFamily: MONO,
        color: dead ? C.faint : C.dim, width: 66, flexShrink: 0,
        textAlign: mirrored ? "left" : "right",
        textDecoration: dead ? "line-through" : "none",
      }}>
        {SLOT_TITLE[slot]}
      </span>

      <span style={{
        fontSize: T.small, fontFamily: MONO, color: dead ? C.faint : C.body,
        width: 34, flexShrink: 0, textAlign: mirrored ? "left" : "right",
      }}>
        {st.currentHP}
      </span>

      {/* 9-slice of the Unity bar frame, same chrome as the Workshop. */}
      <div style={{
        flex: 1, minWidth: 0,
        borderStyle: "solid", borderWidth: "2px 4px 5px",
        borderImage: `url(/assets/minigames/sol-mechs/ui/bar.png) 20 60 80 fill / 2px 4px 5px / 0 stretch`,
      }}>
        <div style={{
          height: 10, background: "#000", overflow: "hidden",
          display: "flex", flexDirection: mirrored ? "row-reverse" : "row",
        }}>
          <div style={{
            width: `${pct}%`, height: "100%", transition: "width .3s",
            background: dead
              ? "#4a2030"
              : slot === "matrix"
                ? (sealed ? C.teal : C.warn)
                : C.blue,
          }} />
        </div>
      </div>

      {sealing && (
        <span
          title="This arm is sealing the Matrix"
          style={{ fontSize: T.eyebrow, color: C.teal, flexShrink: 0, lineHeight: 1 }}
        >
          🔒
        </span>
      )}
    </div>
  );
}
