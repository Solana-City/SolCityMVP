"use client";

/**
 * Sol Mechs rules, as a short sequence of card pages.
 *
 * Each rule is a card: the game's own art for the idea, a short title and a
 * sentence or two. Nine cards at once was a wall of text, so they come three
 * at a time: the basics, how a round plays, then tactics.
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

/** Pages of three, in the order a new player needs them. */
const PAGES: Array<{ title: string; rules: string[] }> = [
  { title: "THE BASICS", rules: ["YOUR SQUAD", "4 PARTS", "KNOCKOUT"] },
  { title: "A ROUND", rules: ["VICTORY", "ROUNDS", "LOST ATTACKS"] },
  { title: "TACTICS", rules: ["SWAPPING", "DAMAGE", "AIM ANYWHERE"] },
];

export interface RulesScreenProps {
  onClose: () => void;
}

export default function RulesScreen({ onClose }: RulesScreenProps) {
  // Short or narrow screens (a phone in landscape) get one card per page:
  // three side by side there leaves each card a sliver.
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px), (max-height: 560px)");
    const read = () => setCompact(mq.matches);
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);
  const pages = compact
    ? PAGES.flatMap((g, gi) => g.rules.map((r, ri) => ({ title: `${g.title} ${ri + 1}/${g.rules.length}`, rules: [r], group: gi })))
    : PAGES.map((g, gi) => ({ ...g, group: gi }));

  const [page, setPageRaw] = useState(0);
  // Keep the page in range when the layout switches between modes.
  const setPage = (fn: (n: number) => number) => setPageRaw((n) => Math.min(pages.length - 1, Math.max(0, fn(n))));
  useEffect(() => { setPageRaw((n) => Math.min(n, pages.length - 1)); }, [pages.length]);
  const last = page >= pages.length - 1;
  const next = () => (last ? onClose() : setPage((n) => n + 1));
  const prev = () => setPage((n) => n - 1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === "Enter" || e.key === "e" || e.key === "E") {
        // Like NEXT: on the last page it closes the rules.
        setPageRaw((n) => {
          if (n >= pages.length - 1) { onClose(); return n; }
          return n + 1;
        });
      }
      else if (e.key === "ArrowLeft") setPage((n) => n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, pages.length]);

  const current = pages[Math.min(page, pages.length - 1)];
  const rules = current.rules.map((t) => RULES.find((r) => r.title === t)!);
  const iconScale = compact ? 1 : 1.35;

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
          <span style={sx.pageTitle}>{current.title}</span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={button("ghost")}>CLOSE</button>
        </header>

        <div key={page} style={{ ...sx.grid, gridTemplateColumns: compact ? "minmax(0, 1fr)" : sx.grid.gridTemplateColumns }}>
          {rules.map((rule) => (
            <section key={rule.title} style={sx.card}>
              <div style={sx.icons}>
                {rule.icons.map((icon, i) => ("word" in icon ? (
                  <span key={`word-${i}`} style={sx.word}>{icon.word}</span>
                ) : "mech" in icon ? (
                  <MechIcon key={`${icon.mech}-${i}`} mech={icon.mech} h={icon.h * iconScale} />
                ) : (
                  <img
                    key={`${icon.src}-${i}`}
                    src={icon.src}
                    alt=""
                    style={{
                      ...PIXELATED,
                      height: icon.h * iconScale, width: "auto", display: "block",
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

        <footer style={sx.footer}>
          <button onClick={prev} style={{ ...button("ghost"), visibility: page === 0 ? "hidden" : "visible" }}>
            ◂ BACK
          </button>
          <div style={sx.dots}>
            {pages.map((p, n) => (
              <button
                key={p.title}
                onClick={() => setPage(() => n)}
                aria-label={`Rules page ${n + 1}: ${p.title}`}
                style={{
                  ...sx.dot,
                  width: n === page ? 22 : compact ? 6 : 8,
                  background: n === page ? C.teal : n < page ? C.dim : C.line,
                }}
              />
            ))}
          </div>
          <button onClick={next} style={button("primary")}>{last ? "GOT IT" : "NEXT ▸"}</button>
        </footer>
      </div>
      <style>{`@keyframes sm-rules-in { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }`}</style>
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
    gap: 12,
    minHeight: 0,
    animation: "sm-rules-in .22s ease",
  },
  pageTitle: { fontFamily: DISPLAY, fontSize: 12, fontWeight: 800, letterSpacing: 2, color: C.dim },
  footer: { display: "flex", alignItems: "center", gap: SP.md, flexShrink: 0 },
  dots: { flex: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: 6 },
  dot: { height: 8, borderRadius: 4, border: "none", padding: 0, cursor: "pointer", transition: "width .2s" },
  card: {
    ...frame(),
    background: C.ink,
    padding: "22px 18px",
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    gap: 10, textAlign: "center", minWidth: 0, minHeight: 0,
  },
  icons: { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 60 },
  word: { fontFamily: DISPLAY, fontSize: 12, fontWeight: 800, letterSpacing: 1, color: C.warn, margin: "0 6px" },
  cardTitle: { fontFamily: DISPLAY, fontSize: 16, fontWeight: 800, letterSpacing: 2, color: C.teal },
  text: { margin: 0, fontSize: T.body, color: C.body, lineHeight: 1.5, maxWidth: 300 },
};
