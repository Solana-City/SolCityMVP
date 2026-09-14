"use client";

/**
 * Sol Mechs rules, as one screen of cards.
 *
 * Each rule is a card: the game's own art for the idea, a short title and a
 * sentence or two. It covers what a player needs before a first battle and
 * nothing more, and fits on screen without scrolling.
 */
import { useEffect, useRef, useState } from "react";
import {
  drawMech, DOLL_WIDTH, DOLL_HEIGHT, preloadBuild, mechBounds, type MechBounds,
} from "@/game/solmechs/render/paperDoll";
import { PRESET_BUILDS } from "@/game/solmechs/data/catalog";
import type { MechId } from "@/game/solmechs/data/types";
import { C, T, SP, DISPLAY, PIXELATED, W, PANEL_HEIGHT, backdrop, panel, frame, button } from "./theme";

const A = "/assets/minigames/sol-mechs";

type Icon =
  | {
      src: string;
      /** Rendered height in px; width follows the art. */
      h: number;
      /** Greyed out, for a part that is destroyed or sealed. */
      dim?: boolean;
    }
  /** A stock mech, assembled by the same paper doll the battles draw. */
  | { mech: MechId; h: number }
  /** A short word between icons, e.g. "OR". */
  | { word: string };

interface Rule {
  title: string;
  icons: Icon[];
  text: string;
}

const RULES: Rule[] = [
  {
    title: "YOUR SQUAD",
    icons: [
      { mech: "titan", h: 42 },
      { mech: "striker", h: 42 },
      { mech: "solus", h: 42 },
    ],
    text: "Pick 3 mechs. One fights at a time while the other two wait in reserve. Each part can be used only once per squad.",
  },
  {
    title: "4 PARTS",
    icons: [
      { src: `${A}/ui/slotmini-matrix.png`, h: 32 },
      { src: `${A}/ui/slotmini-rightarm.png`, h: 32 },
      { src: `${A}/ui/slotmini-leftarm.png`, h: 32 },
      { src: `${A}/ui/slotmini-legs.png`, h: 32 },
    ],
    text: "Every mech has a Matrix, a right arm, a left arm and legs, each with its own HP. Each limb has one move.",
  },
  {
    title: "KNOCKOUT",
    // Both ways a mech goes down: its Matrix, or all three limbs.
    icons: [
      { src: `${A}/ui/slotmini-matrix.png`, h: 28 },
      { src: `${A}/ui/arrow-right.png`, h: 20 },
      { src: `${A}/vfx/boom/3.png`, h: 36 },
      { word: "OR" },
      { src: `${A}/ui/slotmini-rightarm.png`, h: 28 },
      { src: `${A}/ui/slotmini-leftarm.png`, h: 28 },
      { src: `${A}/ui/slotmini-legs.png`, h: 28 },
      { src: `${A}/ui/arrow-right.png`, h: 20 },
      { src: `${A}/vfx/boom/3.png`, h: 36 },
    ],
    text: "The Matrix is sealed until an arm is destroyed. Destroy the Matrix, or all 3 limbs, to knock the mech out.",
  },
  {
    title: "VICTORY",
    icons: [
      { src: `${A}/ui/win-trophy.png`, h: 44 },
      { src: `${A}/ui/lose-rip.png`, h: 40 },
    ],
    text: "Knock out all 3 rival mechs to win. If your clock runs out, you lose.",
  },
  {
    title: "ROUNDS",
    icons: [{ src: `${A}/vfx/stat/SPD_Up.png`, h: 42 }],
    text: "Both players choose at the same time. Swaps go first, then attacks in order of speed. A speed tie is a coin flip.",
  },
  {
    title: "LOST ATTACKS",
    icons: [
      { src: `${A}/ui/slotmini-rightarm.png`, h: 32 },
      { src: `${A}/vfx/boom/2.png`, h: 40 },
    ],
    text: "If an arm is destroyed before it acts, its attack does not happen that round.",
  },
  {
    title: "SWAPPING",
    icons: [
      { src: `${A}/ui/arrow-left.png`, h: 30 },
      { mech: "heartcore", h: 42 },
      { src: `${A}/ui/arrow-right.png`, h: 30 },
    ],
    text: "Swapping uses your round. A mech comes back with its damage, but its buffs reset. After a knockout, the next mech comes in for free.",
  },
  {
    title: "DAMAGE",
    icons: [
      { src: `${A}/vfx/stat/ATK_Up.png`, h: 32 },
      { src: `${A}/vfx/stat/DEF_Up.png`, h: 32 },
      { src: `${A}/vfx/stat/ENG_Up.png`, h: 32 },
      { src: `${A}/vfx/stat/SYS_Up.png`, h: 32 },
    ],
    text: "Physical moves use ATK against DEF. Energy moves use ENG against SYS. Some moves raise or lower a part's stats.",
  },
  {
    title: "AIM ANYWHERE",
    icons: [
      { src: `${A}/ui/slotmini-leftarm.png`, h: 32, dim: true },
      { src: `${A}/ui/arrow-right.png`, h: 26 },
      { src: `${A}/ui/slotmini-leftarm.png`, h: 32 },
    ],
    text: "You can target a part already destroyed on the mech in front of you. It only lands if the rival swaps in a mech that still has it.",
  },
];

export interface RulesScreenProps {
  onClose: () => void;
}

export default function RulesScreen({ onClose }: RulesScreenProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={backdrop} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={sx.panel}>
        <header style={sx.header}>
          <img
            src={`${A}/ui/logo.png`}
            alt="Sol Mechs"
            style={{ ...PIXELATED, height: 26, width: "auto", display: "block" }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <h2 style={sx.title}>RULES</h2>
          <div style={{ flex: 1 }} />
          {/* In the header, not a footer: a footer row cost the height that let
              the last row of cards run under the button on short screens. */}
          <button onClick={onClose} style={button("primary")}>BACK</button>
        </header>

        <div style={sx.grid}>
          {RULES.map((rule) => (
            <section key={rule.title} style={sx.card}>
              <div style={sx.icons}>
                {rule.icons.map((icon, i) => ("word" in icon ? (
                  <span key={`word-${i}`} style={sx.word}>{icon.word}</span>
                ) : "mech" in icon ? (
                  <MechIcon key={`${icon.mech}-${i}`} mech={icon.mech} h={icon.h} />
                ) : (
                  <img
                    key={`${icon.src}-${i}`}
                    src={icon.src}
                    alt=""
                    style={{
                      ...PIXELATED,
                      height: icon.h, width: "auto", display: "block",
                      opacity: icon.dim ? 0.5 : 1,
                      filter: icon.dim ? "grayscale(1)" : undefined,
                    }}
                  />
                )))}
              </div>
              <div style={sx.cardTitle}>{rule.title}</div>
              <p style={sx.text}>{rule.text}</p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * A stock mech as a still icon, cropped to its artwork (see mechBounds) so it
 * fills the icon height instead of sitting small inside the padded doll box.
 * Draws once the sprites have decoded, then stops.
 */
function MechIcon({ mech, h }: { mech: MechId; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [crop, setCrop] = useState<MechBounds>({ x: 0, y: 0, w: DOLL_WIDTH, h: DOLL_HEIGHT });

  useEffect(() => {
    const build = PRESET_BUILDS[mech];
    preloadBuild(build);
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf = 0;
    const loop = () => {
      const box = mechBounds(build);
      if (box && (box.x !== crop.x || box.y !== crop.y || box.w !== crop.w || box.h !== crop.h)) {
        setCrop(box);
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const drawn = drawMech(ctx, build, { x: -crop.x, y: -crop.y, scale: 1 });
      if (!drawn || !box) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mech, crop]);

  return (
    <canvas
      ref={ref}
      width={crop.w}
      height={crop.h}
      style={{ ...PIXELATED, height: h, width: "auto", display: "block" }}
    />
  );
}

const sx: Record<string, React.CSSProperties> = {
  panel: {
    ...panel(W.wide),
    maxHeight: PANEL_HEIGHT,
    padding: SP.lg,
    display: "flex", flexDirection: "column", gap: SP.md,
    overflow: "hidden",
  },
  header: { display: "flex", alignItems: "center", gap: SP.md, flexShrink: 0 },
  title: { margin: 0, fontSize: 18, color: C.teal, letterSpacing: 4, fontWeight: 800, fontFamily: DISPLAY },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 10,
    minHeight: 0,
  },
  card: {
    ...frame(),
    background: C.ink,
    padding: "10px 14px",
    display: "flex", flexDirection: "column", alignItems: "center",
    gap: 5, textAlign: "center", minWidth: 0,
  },
  icons: { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, height: 44 },
  word: { fontFamily: DISPLAY, fontSize: 12, fontWeight: 800, letterSpacing: 1, color: C.warn, margin: "0 6px" },
  cardTitle: { fontFamily: DISPLAY, fontSize: 14, fontWeight: 800, letterSpacing: 2, color: C.teal },
  text: { margin: 0, fontSize: T.small, color: C.body, lineHeight: 1.45 },
};
