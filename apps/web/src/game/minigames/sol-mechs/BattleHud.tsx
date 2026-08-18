"use client";

/**
 * Sol Mechs — battle HUD, rebuilt from the Unity battle scene.
 *
 * The layout here is not a guess. `3_PilotMechBattleV1.unity` was parsed for
 * its RectTransforms against a 1240x1080 reference canvas, and the arrangement
 * it describes is:
 *
 *   - the arena is the full-width BACKDROP, not a boxed-off picture;
 *   - PlayerHUD sits at 14% x 24% of the canvas, EnemyHUD mirrored at 86%,
 *     both OVER the arena;
 *   - each HUD is a `profile.png` plate (250x100 units) above four 160x20
 *     part bars stacked 25 units apart;
 *   - the action buttons and the combat log share a strip across the bottom.
 *
 * Two earlier passes got this wrong in opposite directions: one stacked each
 * side's bars into narrow columns flanking the arena, the other ran both
 * sides' bars mirrored across the full width. Neither is what the game does,
 * and the second left the arena as a postage stamp in a wide black box.
 *
 * Kept from those passes because they are strictly more informative than the
 * original: numeric HP beside every bar, and a marker on the limbs that still
 * seal the Matrix.
 */
import { useEffect, useRef } from "react";
import { drawMech, DOLL_WIDTH, DOLL_HEIGHT, preloadBuild } from "@/game/solmechs/render/MechPaperDoll";
import { canAttackMatrix } from "@/game/solmechs/engine/BattleEngine";
import type { MechUnit, ModuleSlot, MechBuild } from "@/game/solmechs/data/types";
import { C, T, MONO, PIXELATED } from "./theme";

const UI = "/assets/minigames/sol-mechs/ui";

/** Matrix first, then the limbs — the Unity order. */
const HUD_SLOTS: ModuleSlot[] = ["matrix", "rightArm", "leftArm", "lowerBody"];

const SLOT_TITLE: Record<ModuleSlot, string> = {
  matrix: "MATRIX",
  rightArm: "R.ARM",
  leftArm: "L.ARM",
  lowerBody: "LEGS",
};

/**
 * Hotspots inside `profile.png`, as percentages of the plate.
 *
 * Found by flood-filling the plate's dark fillable regions on the imported
 * 344x136 copy — the frame draws a portrait square, a name banner and a
 * status bar with a clock face beside it, and these are those three holes.
 * Percentages rather than pixels because the plate scales with the stage.
 */
const PLATE = {
  src: `${UI}/profile.png`,
  aspect: 344 / 136,
  portrait: { outer: "3.5%", top: "8.8%", w: "32.3%", h: "81.6%" },
  name: { outer: "37.8%", inner: "4.4%", top: "14.7%", h: "33.1%" },
  clock: { outer: "38.5%", inner: "23.0%", top: "57.4%", h: "24.2%" },
} as const;

/**
 * Unity runs the bars at 160 units against the plate's 250 (64%) and writes the
 * part name ON the bar. Ours carries the name and the number BESIDE it, which
 * needs the full width to stay readable at this scale.
 */
const BAR_WIDTH = "100%";

export interface UnitPanelProps {
  unit: MechUnit;
  /** Player name shown on the plate's banner. */
  name: string;
  clock: string;
  /** This side is currently spending time. */
  live: boolean;
  /** Under the warning threshold. */
  low: boolean;
  /** The rival's panel mirrors, as it does in Unity. */
  align?: "right";
}

/** One side's corner HUD: profile plate over four part bars. */
export function UnitPanel({ unit, name, clock, live, low, align }: UnitPanelProps) {
  const right = align === "right";
  const portrait = right ? { right: PLATE.portrait.outer } : { left: PLATE.portrait.outer };
  const banner = right
    ? { right: PLATE.name.outer, left: PLATE.name.inner }
    : { left: PLATE.name.outer, right: PLATE.name.inner };
  const clockBox = right
    ? { right: PLATE.clock.outer, left: PLATE.clock.inner }
    : { left: PLATE.clock.outer, right: PLATE.clock.inner };

  return (
    <div style={{ width: "100%", pointerEvents: "none" }}>
      <div style={{
        position: "relative", width: "100%", aspectRatio: `${PLATE.aspect}`,
        backgroundImage: `url(${PLATE.src})`,
        backgroundSize: "100% 100%", backgroundRepeat: "no-repeat",
        // The plate art is drawn facing left; the rival's is the same sprite
        // flipped, which is how the scene does it too.
        transform: right ? "scaleX(-1)" : undefined,
        ...PIXELATED,
      }}>
        {/* Un-flipped so the text and portrait read normally on the mirrored plate. */}
        <div style={{
          position: "absolute", inset: 0,
          transform: right ? "scaleX(-1)" : undefined,
        }}>
          <div style={{
            position: "absolute", ...portrait,
            top: PLATE.portrait.top, width: PLATE.portrait.w, height: PLATE.portrait.h,
            overflow: "hidden", display: "flex", alignItems: "flex-end", justifyContent: "center",
          }}>
            <Portrait build={unit.build} />
          </div>

          <div style={{
            position: "absolute", ...banner,
            top: PLATE.name.top, height: PLATE.name.h,
            display: "flex", alignItems: "center",
            justifyContent: right ? "flex-end" : "flex-start",
            padding: "0 6%", overflow: "hidden",
          }}>
            <span style={{
              fontSize: T.small, fontWeight: 800, color: C.text, letterSpacing: 0.5,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {name}
            </span>
          </div>

          <div style={{
            position: "absolute", ...clockBox,
            top: PLATE.clock.top, height: PLATE.clock.h,
            display: "flex", alignItems: "center",
            justifyContent: right ? "flex-end" : "flex-start",
            padding: "0 6%", overflow: "hidden",
          }}>
            <span style={{
              fontFamily: MONO, fontSize: T.small, fontWeight: 800, letterSpacing: 1,
              color: low ? C.bad : live ? C.teal : C.dim,
              transition: "color .2s", whiteSpace: "nowrap",
            }}>
              {clock}
            </span>
          </div>
        </div>
      </div>

      {/* A scrim, which Unity does not have and does not need: its bars sit on
          the arena's dark upper stands, ours on a pale sky. Without it the
          labels wash out exactly where the horizon line crosses them. */}
      <div style={{
        marginTop: 3, display: "flex", flexDirection: "column", gap: 3,
        alignItems: right ? "flex-end" : "flex-start",
        background: "rgba(8,4,16,.62)", border: `1px solid ${C.line}`,
        borderRadius: 4, padding: "5px 6px",
      }}>
        {HUD_SLOTS.map((slot) => (
          <PartBar key={slot} unit={unit} slot={slot} mirrored={right} />
        ))}
      </div>
    </div>
  );
}

function PartBar({ unit, slot, mirrored }: { unit: MechUnit; slot: ModuleSlot; mirrored: boolean }) {
  const st = unit.partStatuses[slot];
  const pct = st.maxHP > 0 ? Math.max(0, st.currentHP / st.maxHP) * 100 : 0;
  const dead = st.currentHP <= 0;
  // Whether the core can be shot at all is the single most decision-relevant
  // fact on this panel, so it is spelled out on the Matrix row rather than
  // implied by a padlock on whichever arm happens to be holding it shut.
  const sealed = !canAttackMatrix(unit);

  return (
    <div style={{
      width: BAR_WIDTH, display: "flex", alignItems: "center", gap: 4,
      flexDirection: mirrored ? "row-reverse" : "row",
    }}>
      <span style={{
        fontSize: T.eyebrow, fontWeight: 700, fontFamily: MONO,
        color: dead ? C.faint : C.dim, flexShrink: 0,
        textDecoration: dead ? "line-through" : "none",
        // A shadow, not a panel: these sit directly on the arena art.
        textShadow: "0 1px 2px #000, 0 0 3px #000",
      }}>
        {SLOT_TITLE[slot]}
      </span>

      {/* 9-slice of the Unity bar frame, same chrome as the Workshop. */}
      <div style={{
        flex: 1, minWidth: 0,
        borderStyle: "solid", borderWidth: "2px 4px 5px",
        borderImage: `url(${UI}/bar.png) 20 60 80 fill / 2px 4px 5px / 0 stretch`,
      }}>
        <div style={{
          height: 8, background: "#000", overflow: "hidden",
          display: "flex", flexDirection: mirrored ? "row-reverse" : "row",
        }}>
          <div style={{
            width: `${pct}%`, height: "100%", transition: "width .3s",
            background: dead ? "#4a2030" : slot === "matrix" ? C.teal : C.blue,
          }} />
        </div>
      </div>

      <span style={{
        fontSize: T.eyebrow, fontFamily: MONO, fontWeight: 700,
        color: dead ? C.faint : C.body, flexShrink: 0, minWidth: 26,
        textAlign: mirrored ? "left" : "right",
        textShadow: "0 1px 2px #000, 0 0 3px #000",
      }}>
        {st.currentHP}
      </span>

      {slot === "matrix" && (
        <span
          title={sealed
            ? "Break an arm, or strip all three limbs, to expose the core"
            : "The core can be attacked directly"}
          style={{
            fontSize: 9, fontWeight: 800, letterSpacing: 0.5, flexShrink: 0,
            color: sealed ? C.teal : C.warn,
            border: `1px solid ${sealed ? C.teal : C.warn}`,
            borderRadius: 3, padding: "0 3px", lineHeight: "13px",
          }}
        >
          {sealed ? "SEALED" : "OPEN"}
        </span>
      )}
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
      drawMech(ctx, build, { x: 0, y: 0, scale: 1 });
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [build]);

  return (
    <canvas
      ref={ref}
      width={DOLL_WIDTH}
      height={DOLL_HEIGHT}
      // Sized by HEIGHT: the doll is taller than it is wide, so fitting the
      // width would leave it swimming in the square.
      style={{ ...PIXELATED, height: "94%", width: "auto", display: "block" }}
    />
  );
}
