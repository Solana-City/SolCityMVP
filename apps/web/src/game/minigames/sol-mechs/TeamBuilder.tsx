"use client";

/**
 * Sol Mechs — squad builder for 3v3.
 *
 * Three slots, each edited through the same Workshop used for solo builds.
 * The Workshop is handed the codes the other two mechs already carry and marks
 * them IN USE rather than hiding them, so every part stays visible and can be
 * moved between mechs.
 *
 * That makes the validator the rule's only enforcement: a clashing squad is
 * flagged card by card and DEPLOY is blocked, rather than the team being
 * silently rewritten underneath the player.
 */
import { useCallback, useMemo, useState } from "react";
import {
  drawMech, DOLL_WIDTH, DOLL_HEIGHT, preloadAll, preloadBuild, stableBounds,
  type MechBounds,
} from "@/game/solmechs/render/paperDoll";
import { useEffect, useRef } from "react";
import { getMatrix } from "@/game/solmechs/data/catalog";
import {
  validateTeam, takenBy, squadPositionLabel, TEAM_SIZE, type TeamBuild, type TeamViolation,
} from "@/game/solmechs/data/team";
import { getPart } from "@/game/solmechs/data/catalog";
import { createUnit, availableMoves } from "@/game/solmechs/engine/BattleEngine";
import type { MechBuild, ModuleSlot } from "@/game/solmechs/data/types";
import { loadHangar, setTeam } from "@/game/solmechs/hangar";
import Workshop from "./Workshop";
import { C, T, SP, R, MONO, W, PANEL_HEIGHT, DISPLAY, frame } from "./theme";


const SLOTS: ModuleSlot[] = ["matrix", "rightArm", "leftArm", "lowerBody"];
const CARD_SCALE = 2;
const PART_SLOT_LABEL: Record<ModuleSlot, string> = {
  matrix: "MTX", rightArm: "R.ARM", leftArm: "L.ARM", lowerBody: "LEGS",
};

export interface TeamBuilderProps {
  onDeploy: (team: TeamBuild) => void;
  onClose: () => void;
  /** Primary button text — "DEPLOY SQUAD" against the CPU, "FIND MATCH" for PvP. */
  deployLabel?: string;
  /** Shown above the footer, e.g. why PvP cannot start yet. */
  notice?: string | null;
}

export default function TeamBuilder({ onDeploy, onClose, deployLabel = "DEPLOY SQUAD", notice }: TeamBuilderProps) {
  const [mechs, setMechs] = useState<MechBuild[]>(() => loadHangar().team.slice(0, TEAM_SIZE));
  const [editing, setEditing] = useState<number | null>(null);

  // Every part's art, so the shared preview crop (stableBounds) can resolve.
  useEffect(() => { preloadAll(); }, []);

  const team: TeamBuild = useMemo(() => ({ mechs }), [mechs]);
  const validation = useMemo(() => validateTeam(team), [team]);

  /** Each mech's clashes, so a card can mark the exact part, not the whole mech. */
  const clashesOf = useCallback(
    (i: number) => validation.violations.filter((v) => v.mechIndices.includes(i)),
    [validation],
  );

  const updateAt = useCallback((index: number, build: MechBuild) => {
    setMechs((prev) => prev.map((b, i) => (i === index ? build : b)));
  }, []);

  const deploy = useCallback(() => {
    if (!validation.ok) return;
    setTeam(mechs);
    onDeploy(team);
  }, [validation.ok, mechs, team, onDeploy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && editing === null) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, onClose]);

  if (editing !== null) {
    const build = mechs[editing];
    const taken: Partial<Record<ModuleSlot, Map<string, number>>> = {};
    for (const slot of SLOTS) taken[slot] = takenBy(team, editing, slot);

    return (
      <Workshop
        onClose={() => setEditing(null)}
        teamContext={{
          build,
          taken,
          label: `SQUAD ${editing + 1} / ${TEAM_SIZE}`,
          onChange: (b) => updateAt(editing, b),
        }}
      />
    );
  }

  return (
    <div style={sx.backdrop} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={sx.frame}>
        <header style={sx.header}>
            <img
            src="/assets/minigames/sol-mechs/ui/logo.png"
            alt="Sol Mechs"
            style={{ imageRendering: "pixelated", height: 24, width: "auto", display: "block" }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        <h2 style={sx.title}>SQUAD</h2>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={sx.close} aria-label="Close">×</button>
        </header>

        <p style={sx.blurb}>
          Three mechs, sent out one at a time. Substituting costs your turn, and a mech
          returns with the damage it left with. Only its stat buffs reset.
          <br />
          <strong style={{ color: C.text }}>Each part may appear once per squad</strong>, matrices
          included.
        </p>

        <div style={sx.grid}>
          {mechs.map((build, i) => (
            <SquadCard
              key={i}
              index={i}
              build={build}
              clashes={clashesOf(i)}
              onEdit={() => setEditing(i)}
            />
          ))}
        </div>

        {notice && <div style={sx.notice}>{notice}</div>}

        {!validation.ok && (
          <div style={sx.errors}>
            {validation.messages.map((m) => <div key={m}>· {m}</div>)}
          </div>
        )}

        <footer style={sx.footer}>
          <button onClick={onClose} style={sx.btnGhost}>BACK</button>
          <div style={{ flex: 1 }} />
          <button
            onClick={deploy}
            disabled={!validation.ok}
            style={{
              ...sx.btnPrimary,
              opacity: validation.ok ? 1 : 0.35,
              cursor: validation.ok ? "pointer" : "not-allowed",
            }}
          >
            {deployLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

function SquadCard({ index, build, clashes, onEdit }: {
  index: number; build: MechBuild; clashes: TeamViolation[]; onEdit: () => void;
}) {
  const flagged = clashes.length > 0;
  const ref = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  // Cropped to the mech rather than to the doll box, one box for every build
  // (see stableBounds) so swapping parts never rescales the mech. Stretched
  // to the card, the box put a 55px-wide mech in a 340px-tall picture and three
  // of those are what made this screen scroll.
  const [crop, setCrop] = useState<MechBounds>({ x: 0, y: 0, w: DOLL_WIDTH, h: DOLL_HEIGHT });

  useEffect(() => {
    preloadBuild(build);
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const loop = () => {
      const box = stableBounds();
      if (box && (box.x !== crop.x || box.y !== crop.y || box.w !== crop.w || box.h !== crop.h)) {
        setCrop(box);
      }
      ctx.clearRect(0, 0, c.width, c.height);
      drawMech(ctx, build, {
        x: -crop.x * CARD_SCALE,
        y: -crop.y * CARD_SCALE,
        scale: CARD_SCALE,
      });
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [build, crop]);

  const matrix = getMatrix(build.matrixCode);
  const unit = useMemo(() => {
    try { return createUnit("x", build); } catch { return null; }
  }, [build]);
  const stats = unit?.totalStats ?? null;
  /** Distinct damage types this mech can actually deal. */
  const damageTypes = useMemo(() => {
    if (!unit) return [] as string[];
    const seen = new Set<string>();
    for (const o of availableMoves(unit)) {
      if (o.move.baseDamage > 0 && o.move.damageType) seen.add(o.move.damageType);
    }
    return [...seen];
  }, [unit]);

  return (
    <button
      onClick={onEdit}
      style={{
        ...sx.card,
        // The card only gets a warning edge; the part rows below say exactly
        // which part clashes. A solid red card read as "this whole mech is
        // broken" when one part of it was shared with another mech.
        // An outline, not a border: swapping the frame art for a plain border
        // changed the border width and so the card's size.
        ...(flagged ? { outline: `2px solid ${C.warn}`, outlineOffset: -4 } : null),
      }}
    >
      <div style={sx.cardHead}>
        <span style={sx.cardIndex}>{squadPositionLabel(index).toUpperCase()}</span>
        <strong style={{ fontSize: 15, color: C.text }}>{matrix?.matrixName ?? "-"}</strong>
        {flagged && <span style={sx.clashTag}>{clashes.length === 1 ? "1 CLASH" : `${clashes.length} CLASHES`}</span>}
      </div>
      <canvas
        ref={ref}
        width={crop.w * CARD_SCALE}
        height={crop.h * CARD_SCALE}
        style={{
          imageRendering: "pixelated", display: "block", margin: "0 auto",
          width: "auto", height: "auto", maxWidth: "100%", maxHeight: "20vh",
        }}
      />
      {/* What this mech actually threatens with. With only two damage types
          in the game, a squad that brings one of them is a squad the other
          side's defence answers for free — so it is the first thing to show. */}
      <div style={sx.tagRow}>
        {matrix?.role && <span style={sx.roleTag}>{matrix.role}</span>}
        {damageTypes.map((d) => (
          <span key={d} style={{
            ...sx.dmgTag,
            color: d === "Physical" ? C.warn : C.cyan,
            borderColor: d === "Physical" ? C.warn : C.cyan,
          }}>
            {d.toUpperCase()}
          </span>
        ))}
      </div>
      {stats && (
        <div style={sx.cardStats}>
          HP {stats.HP} · SPD {stats.SPD}<br />
          ATK {stats.ATK} · DEF {stats.DEF} · ENG {stats.ENG} · SYS {stats.SYS}
        </div>
      )}
      <div style={sx.partList}>
        {SLOTS.map((slot) => {
          const code = slot === "matrix" ? build.matrixCode : build[slot];
          const clash = clashes.find((v) => v.slot === slot);
          const others = clash?.mechIndices.filter((m) => m !== index) ?? [];
          return (
            <div key={slot} style={{ ...sx.partRow, color: clash ? C.bad : C.faint }}>
              <span style={sx.partSlot}>{PART_SLOT_LABEL[slot]}</span>
              <span style={sx.partName}>
                {slot === "matrix" ? matrix?.matrixName ?? code : getPart(code)?.partName ?? code}
              </span>
              {clash && <span style={sx.partClash}>also on {others.map(squadPositionLabel).join(", ")}</span>}
            </div>
          );
        })}
      </div>
      <div style={sx.editHint}>EDIT ▸</div>
    </button>
  );
}

const sx: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed", inset: 0, background: "rgba(4,2,10,.9)", zIndex: 1000,
    display: "flex", alignItems: "center", justifyContent: "center", padding: 12,
  },
  frame: {
    position: "relative", background: C.panel,
    backgroundImage:
      `linear-gradient(${C.line}55 1px, transparent 1px), linear-gradient(90deg, ${C.line}55 1px, transparent 1px)`,
    backgroundSize: "26px 26px",
    ...frame(), padding: 14,
    width: W.editor, maxHeight: PANEL_HEIGHT,
    display: "flex", flexDirection: "column", gap: 10, overflow: "hidden",
    boxShadow: `0 16px 60px rgba(0,0,0,.65)`,
    fontFamily: "system-ui,sans-serif",
  },
  header: { display: "flex", alignItems: "center", gap: 10, flexShrink: 0 },
  title: { margin: 0, fontSize: 16, color: C.teal, letterSpacing: 4, fontWeight: 800, fontFamily: DISPLAY },
  close: { background: "none", border: "none", color: C.dim, fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 0 },
  blurb: { fontSize: 12, color: C.dim, margin: 0, lineHeight: 1.5, flexShrink: 0 },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
    flex: "0 1 auto", gap: 10, minHeight: 0, overflow: "hidden",
    alignItems: "start", alignContent: "start",
  },
  card: {
    background: C.ink, ...frame(), padding: 9,
    cursor: "pointer", textAlign: "left", display: "flex", flexDirection: "column",
    gap: 4, minWidth: 0,
  },
  cardHead: { display: "flex", alignItems: "baseline", gap: 6 },
  cardIndex: {
    fontSize: 11, letterSpacing: 1.5, fontWeight: 700,
    // The order is a real rule — #1 is on the platform when the match starts
    // — so it is spelled out rather than left as an ordinal to infer.
    color: C.teal, fontFamily: "monospace",
  },
  tagRow: { display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" },
  roleTag: {
    fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.dim,
    border: `1px solid ${C.line}`, borderRadius: 3, padding: "1px 6px",
  },
  dmgTag: {
    fontSize: 11, fontWeight: 800, letterSpacing: 1,
    border: "1px solid", borderRadius: 3, padding: "1px 6px",
  },
  clashTag: {
    marginLeft: "auto", fontSize: 12, color: C.warn, border: `1px solid ${C.warn}`,
    borderRadius: 3, padding: "1px 4px", letterSpacing: 1,
  },
  partList: { display: "flex", flexDirection: "column", gap: 1 },
  partRow: { display: "flex", gap: 6, fontSize: 11, alignItems: "baseline", minWidth: 0, whiteSpace: "nowrap" },
  partSlot: { width: 38, flexShrink: 0, fontFamily: "monospace", fontSize: 10 },
  partName: { overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 },
  partClash: { marginLeft: "auto", fontWeight: 700, flexShrink: 0 },
  cardStats: { fontSize: 11, color: C.dim, lineHeight: 1.45, fontFamily: "monospace" },
  editHint: { fontSize: 11, color: C.teal, letterSpacing: 2, marginTop: "auto", paddingTop: 3 },
  notice: {
    background: C.ink, border: `1px solid ${C.warn}`, borderRadius: 6,
    padding: 10, fontSize: 13, color: C.text, lineHeight: 1.5, flexShrink: 0,
  },
  errors: {
    background: "#2a0f18", border: `1px solid ${C.bad}`, borderRadius: 6,
    padding: 10, fontSize: 12, color: C.body, lineHeight: 1.7, flexShrink: 0,
  },
  footer: { display: "flex", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap" },
  btnGhost: {
    background: "none", border: `1px solid ${C.line}`, color: C.dim, borderRadius: 6,
    padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", letterSpacing: 1,
  },
  btnPrimary: {
    background: C.teal, border: "none", color: C.ink, borderRadius: 6,
    padding: "9px 22px", fontSize: 13, fontWeight: 800, letterSpacing: 1,
  },
};
