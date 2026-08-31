"use client";

/**
 * Sol Mechs — squad builder for 3v3.
 *
 * Three slots, each edited through the same Workshop used for solo builds.
 * The uniqueness rule is enforced by *omission*: the Workshop is handed the
 * codes the other two mechs already carry and simply doesn't offer them, so
 * a clash normally can't be created in the first place.
 *
 * The validator still runs on top of that, because a squad saved under an
 * older catalog — or one the player loaded from elsewhere — can arrive
 * already broken. When it does, the offending mechs are flagged and DEPLOY is
 * blocked rather than the team being silently rewritten underneath them.
 */
import { useCallback, useMemo, useState } from "react";
import { drawMech, DOLL_WIDTH, DOLL_HEIGHT, preloadBuild } from "@/game/solmechs/render/MechPaperDoll";
import { useEffect, useRef } from "react";
import { getMatrix } from "@/game/solmechs/data/catalog";
import { validateTeam, takenCodes, TEAM_SIZE, type TeamBuild } from "@/game/solmechs/data/team";
import { createUnit, availableMoves } from "@/game/solmechs/engine/BattleEngine";
import type { MechBuild, ModuleSlot } from "@/game/solmechs/data/types";
import { loadHangar, setTeam } from "@/game/solmechs/hangar";
import Workshop from "./Workshop";
import { C, T, SP, R, MONO, W, PANEL_HEIGHT, DISPLAY, frame } from "./theme";


const SLOTS: ModuleSlot[] = ["matrix", "rightArm", "leftArm", "lowerBody"];
const CARD_SCALE = 2;

export interface TeamBuilderProps {
  onDeploy: (team: TeamBuild) => void;
  onClose: () => void;
}

export default function TeamBuilder({ onDeploy, onClose }: TeamBuilderProps) {
  const [mechs, setMechs] = useState<MechBuild[]>(() => loadHangar().team.slice(0, TEAM_SIZE));
  const [editing, setEditing] = useState<number | null>(null);

  const team: TeamBuild = useMemo(() => ({ mechs }), [mechs]);
  const validation = useMemo(() => validateTeam(team), [team]);

  /** Mech indices involved in any clash, for badging the cards. */
  const flagged = useMemo(() => {
    const s = new Set<number>();
    for (const v of validation.violations) for (const i of v.mechIndices) s.add(i);
    return s;
  }, [validation]);

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
    const matrix = getMatrix(build.matrixCode);
    const taken: Partial<Record<ModuleSlot, Set<string>>> = {};
    for (const slot of SLOTS) taken[slot] = takenCodes(team, editing, slot);

    return (
      <Workshop
        initialMech={matrix?.id ?? "titan"}
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
            style={{ imageRendering: "pixelated", height: 30, width: "auto", display: "block" }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        <h2 style={sx.title}>SQUAD</h2>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={sx.close} aria-label="Close">×</button>
        </header>

        <p style={sx.blurb}>
          Three mechs, sent out one at a time. Substituting costs your turn, and a mech
          returns with the damage it left with — only its stat buffs reset.
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
              flagged={flagged.has(i)}
              onEdit={() => setEditing(i)}
            />
          ))}
        </div>

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
            DEPLOY SQUAD
          </button>
        </footer>
      </div>
    </div>
  );
}

function SquadCard({ index, build, flagged, onEdit }: {
  index: number; build: MechBuild; flagged: boolean; onEdit: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);

  useEffect(() => {
    preloadBuild(build);
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const loop = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      drawMech(ctx, build, { x: 0, y: 0, scale: CARD_SCALE });
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [build]);

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
        // A clash is a rule violation, so it overrides the frame art entirely
        // rather than tinting it.
        ...(flagged ? { borderImage: "none", border: `2px solid ${C.bad}` } : null),
      }}
    >
      <div style={sx.cardHead}>
        <span style={sx.cardIndex}>{index === 0 ? "LEADS" : `RESERVE ${index}`}</span>
        <strong style={{ fontSize: 15, color: C.text }}>{matrix?.matrixName ?? "—"}</strong>
        {flagged && <span style={sx.clashTag}>CLASH</span>}
      </div>
      <canvas
        ref={ref}
        width={DOLL_WIDTH * CARD_SCALE}
        height={DOLL_HEIGHT * CARD_SCALE}
        style={{ imageRendering: "pixelated", width: "100%", height: "auto", display: "block" }}
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
      <div style={sx.codes}>
        {build.rightArm} · {build.leftArm} · {build.lowerBody}
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
    ...frame(), padding: 18,
    width: W.wide, height: PANEL_HEIGHT,
    display: "flex", flexDirection: "column", gap: 12, overflow: "hidden",
    boxShadow: `0 16px 60px rgba(0,0,0,.65)`,
    fontFamily: "system-ui,sans-serif",
  },
  header: { display: "flex", alignItems: "center", gap: 12, flexShrink: 0 },
  title: { margin: 0, fontSize: 18, color: C.teal, letterSpacing: 4, fontWeight: 800, fontFamily: DISPLAY },
  close: { background: "none", border: "none", color: C.dim, fontSize: 26, cursor: "pointer", lineHeight: 1, padding: 0 },
  blurb: { fontSize: 12, color: C.dim, margin: 0, lineHeight: 1.65, flexShrink: 0 },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))",
    flex: 1, gap: 10, overflowY: "auto", overflowX: "hidden", minHeight: 0,
    // Centred, not top-pinned: three fixed-height cards in a full-height panel
    // otherwise leave the bottom half of the screen empty.
    alignItems: "start", alignContent: "center",
  },
  card: {
    background: C.ink, ...frame(), padding: 10,
    cursor: "pointer", textAlign: "left", display: "flex", flexDirection: "column",
    gap: 5, minWidth: 0,
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
    marginLeft: "auto", fontSize: 12, color: C.bad, border: `1px solid ${C.bad}`,
    borderRadius: 3, padding: "1px 4px", letterSpacing: 1,
  },
  codes: { fontSize: 12, color: C.faint, fontFamily: "monospace" },
  cardStats: { fontSize: 12, color: C.dim, lineHeight: 1.55, fontFamily: "monospace" },
  editHint: { fontSize: 12, color: C.teal, letterSpacing: 2, marginTop: "auto", paddingTop: 4 },
  errors: {
    background: "#2a0f18", border: `1px solid ${C.bad}`, borderRadius: 6,
    padding: 10, fontSize: 12, color: C.body, lineHeight: 1.7, flexShrink: 0,
  },
  footer: { display: "flex", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap" },
  btnGhost: {
    background: "none", border: `1px solid ${C.line}`, color: C.dim, borderRadius: 6,
    padding: "11px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer", letterSpacing: 1,
  },
  btnPrimary: {
    background: C.teal, border: "none", color: C.ink, borderRadius: 6,
    padding: "12px 26px", fontSize: 14, fontWeight: 800, letterSpacing: 1,
  },
};
