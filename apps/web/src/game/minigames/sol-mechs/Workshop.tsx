"use client";

/**
 * Sol Mechs — Workshop.
 *
 * The build editor, ported from Unity's EditorController.cs: four slots, each
 * cycled with prev/next arrows, over a live paper doll and a stat readout.
 *
 * The MATRIX is a slot here, exactly as it was in Unity (ImgMatrix sat
 * alongside the three limb images). That is what makes the chassis
 * swappable — an earlier pass exposed chassis only through a separate
 * "owned mechs" chip row, which showed a single entry and left no way to
 * change it.
 *
 * Cycling the matrix in solo mode LOADS that mech's stored loadout, because
 * picking a chassis is picking which mech you are working on. Carrying the
 * previous mech's limbs across instead made the screen show a build that
 * wasn't the selected mech's, and saving then overwrote whatever that mech
 * really had stored.
 *
 * Palette and chrome are lifted from the Unity Workshop comps
 * (Sprites/Interface guidance/MechEditorSprites/Workshop): the four brand
 * colours below are sampled straight out of bar.png, and that same file is
 * used as a 9-slice frame for the stat bars. The big section frames in that
 * folder are 5k-wide mockups, so panel chrome is rebuilt in CSS to stay
 * responsive.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { drawMech, DOLL_WIDTH, DOLL_HEIGHT, preloadAll, preloadBuild } from "@/game/solmechs/render/MechPaperDoll";
import {
  MATRICES, getMatrixById, getPart, getMatrix, getSelectableParts, familyOf,
  PRESET_BUILDS, REFERENCE_OPPONENT,
} from "@/game/solmechs/data/catalog";
import type { MechBuild, MechId, StatBlock, ModuleSlot, MechPart } from "@/game/solmechs/data/types";
import { addStats } from "@/game/solmechs/data/types";
import { createUnit, calculateDamage } from "@/game/solmechs/engine/BattleEngine";
import { loadHangar, setBuild as persistBuild, resetBuild, getBuild } from "@/game/solmechs/hangar";

const UI = "/assets/minigames/sol-mechs/ui";
const PIXELATED: React.CSSProperties = { imageRendering: "pixelated" };

/** Sampled from the Unity Workshop art (bar.png) so the chrome matches. */
const C = {
  teal:    "#21dda0",
  purple:  "#9a46fe",
  blue:    "#6686db",
  steel:   "#4656a5",
  ink:     "#0b0616",
  panel:   "#150c2b",
  panelHi: "#1d1140",
  line:    "#33235c",
  text:    "#e8e2f7",
  dim:     "#9d8fc4",
  faint:   "#6b5c92",
  danger:  "#ff5468",
};

/** All four editable sockets, matrix first — Unity's slot order. */
const SLOTS: ModuleSlot[] = ["matrix", "rightArm", "leftArm", "lowerBody"];

const SLOT_META: Record<ModuleSlot, { label: string; icon: string }> = {
  matrix:    { label: "Matrix",    icon: "matrix" },
  rightArm:  { label: "Right Arm", icon: "rightarm" },
  leftArm:   { label: "Left Arm",  icon: "leftarm" },
  lowerBody: { label: "Legs",      icon: "legs" },
};

const PREVIEW_SCALE = 4;

/** Each stat, with the job it actually does in combat. */
const STAT_ROWS: Array<{ key: keyof StatBlock; label: string; role: string }> = [
  { key: "HP",  label: "HP",  role: "Limb hit points" },
  { key: "ATK", label: "ATK", role: "Physical damage dealt" },
  { key: "DEF", label: "DEF", role: "Physical damage taken" },
  { key: "ENG", label: "ENG", role: "Energy damage dealt" },
  { key: "SYS", label: "SYS", role: "Energy damage taken" },
  { key: "SPD", label: "SPD", role: "Moves first" },
];

/** Bar ceilings, with headroom over the strongest build in the catalog. */
const STAT_MAX: Record<string, number> = {
  HP: 700, ATK: 170, DEF: 160, ENG: 190, SYS: 170, SPD: 140,
};

export interface WorkshopProps {
  initialMech: MechId;
  onSaved?: (mech: MechId, build: MechBuild) => void;
  /**
   * Fired as soon as the player cycles to a different chassis, before any
   * save. Lets the hangar's selection track the Workshop so leaving without
   * saving doesn't snap back to the mech they started on.
   */
  onMechChange?: (mech: MechId) => void;
  onClose: () => void;
  /**
   * Team mode. When present the Workshop edits THIS build instead of the
   * hangar's per-mech loadout, and codes already claimed by the rest of the
   * squad are removed from every cycler — the uniqueness rule is enforced by
   * simply not offering the clash, rather than by letting the player build
   * something the team screen then rejects.
   */
  teamContext?: {
    build: MechBuild;
    /** Codes taken by the OTHER team members, per slot. */
    taken: Partial<Record<ModuleSlot, Set<string>>>;
    label: string;
    onChange: (build: MechBuild) => void;
  };
}

export default function Workshop({ initialMech, onSaved, onMechChange, onClose, teamContext }: WorkshopProps) {
  const [build, setBuildState] = useState<MechBuild>(
    () => teamContext?.build ?? getBuild(loadHangar(), initialMech),
  );
  const [activeSlot, setActiveSlot] = useState<ModuleSlot>("matrix");
  const [lockToFamily, setLockToFamily] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);

  // The mech being edited follows the equipped matrix, so cycling the matrix
  // slot really does change chassis instead of desyncing from a stored id.
  const matrix = getMatrix(build.matrixCode);
  const mech: MechId | undefined = matrix?.id;

  useEffect(() => { preloadAll(); }, []);

  const equipped = useMemo(() => ({
    rightArm: getPart(build.rightArm),
    leftArm: getPart(build.leftArm),
    lowerBody: getPart(build.lowerBody),
  }), [build]);

  const totals: StatBlock | null = useMemo(() => {
    if (!matrix) return null;
    let t: StatBlock = { ...matrix.baseStats };
    for (const slot of ["rightArm", "leftArm", "lowerBody"] as const) {
      const part = equipped[slot];
      if (part) t = addStats(t, part.statModifiers);
    }
    return t;
  }, [matrix, equipped]);

  /**
   * Real damage per equipped move against the stock reference mech, plus who
   * wins the opening turn. Runs the actual engine rather than a copy of the
   * formula, so these numbers cannot drift from what a battle produces.
   */
  const preview = useMemo(() => {
    try {
      const me = createUnit("preview", build);
      const ref = createUnit("ref", PRESET_BUILDS[REFERENCE_OPPONENT]);
      const perMove = new Map<string, number>();
      for (const slot of ["rightArm", "leftArm", "lowerBody"] as const) {
        me.parts[slot].moves.forEach((mv, i) => {
          if (mv.baseDamage > 0) perMove.set(`${slot}:${i}`, calculateDamage(mv, me, ref, slot, "rightArm"));
        });
      }
      return { perMove, movesFirst: me.totalStats.SPD >= ref.totalStats.SPD, refSpd: ref.totalStats.SPD };
    } catch {
      return { perMove: new Map<string, number>(), movesFirst: false, refSpd: 0 };
    }
  }, [build]);

  // Live doll. Driven on rAF because the sprites decode asynchronously — a
  // single draw on mount would land before the art is ready.
  useEffect(() => {
    preloadBuild(build);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const loop = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawMech(ctx, build, { x: 0, y: 0, scale: PREVIEW_SCALE });
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [build]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Options for a slot — every matrix, or the parts legal for this chassis. */
  const optionsFor = useCallback((slot: ModuleSlot): Array<{ code: string; name: string }> => {
    const all = slot === "matrix"
      ? MATRICES.map((m) => ({ code: m.matrixCode, name: m.matrixName }))
      : getSelectableParts(slot, build.matrixCode, lockToFamily)
          .map((p: MechPart) => ({ code: p.partCode, name: p.partName }));

    const taken = teamContext?.taken[slot];
    if (!taken) return all;
    // Keep whatever is currently equipped even if a teammate also holds it,
    // so an already-clashing squad can still be cycled OUT of the clash
    // instead of trapping the player on a code they can't move off.
    const current = slot === "matrix" ? build.matrixCode : build[slot];
    return all.filter((o) => o.code === current || !taken.has(o.code));
  }, [build, lockToFamily, teamContext]);

  const currentCode = activeSlot === "matrix" ? build.matrixCode : build[activeSlot];

  const cycle = useCallback((slot: ModuleSlot, dir: -1 | 1) => {
    const options = optionsFor(slot);
    if (options.length < 2) return;
    const code = slot === "matrix" ? build.matrixCode : build[slot];
    const idx = options.findIndex((o) => o.code === code);
    const next = options[(((idx < 0 ? 0 : idx) + dir) + options.length) % options.length].code;

    // Changing the MATRIX is changing which mech you're working on, so in solo
    // mode it loads that mech's stored loadout. Carrying the previous mech's
    // limbs across meant selecting a chassis showed someone else's build and
    // saving then overwrote whatever that mech actually had stored.
    //
    // Team mode keeps the carry-across: there a slot is one build being
    // assembled, and pulling in a per-mech save would fight the squad the
    // player is composing.
    if (slot === "matrix" && !teamContext) {
      const nextMech = getMatrix(next)?.id;
      const loaded = nextMech ? getBuild(loadHangar(), nextMech) : { ...build, matrixCode: next };
      setBuildState(loaded);
      // Freshly loaded from storage, so there is nothing to save yet.
      setDirty(false);
      // Tell the hangar straight away, so its selection follows the Workshop
      // even if the player leaves without saving.
      if (nextMech) onMechChange?.(nextMech);
      return;
    }

    const updated = slot === "matrix" ? { ...build, matrixCode: next } : { ...build, [slot]: next };
    setBuildState(updated);
    setDirty(true);
    // In team mode the parent owns the squad, so every edit is reported live
    // rather than waiting for a save — the team screen has to re-check
    // uniqueness as you go.
    teamContext?.onChange(updated);
  }, [build, optionsFor, teamContext, onMechChange]);

  const save = useCallback(() => {
    if (teamContext) {
      teamContext.onChange(build);
      setDirty(false);
      onClose();
      return;
    }
    if (!mech) return;
    persistBuild(mech, build);
    setDirty(false);
    setSaved(true);
    onSaved?.(mech, build);
    window.setTimeout(() => setSaved(false), 1500);
  }, [mech, build, onSaved, teamContext, onClose]);

  const revert = useCallback(() => {
    if (!mech) return;
    if (teamContext) {
      setBuildState(PRESET_BUILDS[mech]);
      teamContext.onChange(PRESET_BUILDS[mech]);
      setDirty(true);
      return;
    }
    resetBuild(mech);
    setBuildState(PRESET_BUILDS[mech]);
    setDirty(false);
  }, [mech, teamContext]);

  if (!matrix || !totals) return null;

  const options = optionsFor(activeSlot);
  const index = options.findIndex((o) => o.code === currentCode);
  const activePart = activeSlot === "matrix" ? null : equipped[activeSlot];
  const crossChassis = activeSlot !== "matrix" && activePart
    && familyOf(activePart.partCode) !== familyOf(build.matrixCode);

  return (
    <div style={sx.backdrop} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={sx.frame}>
        <Corner top left /><Corner top /><Corner left /><Corner />

        <header style={sx.header}>
          <h2 style={sx.title}>WORKSHOP</h2>
          {teamContext && <span style={sx.teamTag}>{teamContext.label}</span>}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={sx.close} aria-label="Close">×</button>
        </header>
        {teamContext && (
          <p style={sx.teamHint}>
            Parts already carried by the rest of the squad are hidden — each part may
            appear once per team.
          </p>
        )}

        <div style={sx.body}>
          {/* ── preview ─────────────────────────────────────────────── */}
          <section style={sx.previewPanel}>
            <div style={sx.dollWrap}>
              <canvas
                ref={canvasRef}
                width={DOLL_WIDTH * PREVIEW_SCALE}
                height={DOLL_HEIGHT * PREVIEW_SCALE}
                // Capped so a short viewport doesn't let the doll crowd the
                // name and passives out of the panel.
                style={{
                  ...PIXELATED, display: "block",
                  width: "100%", height: "auto",
                  maxHeight: "42vh", objectFit: "contain",
                }}
              />
            </div>
            <div style={sx.mechName}>{matrix.matrixName}</div>
            <div style={sx.mechRole}>{matrix.role}</div>
            <div style={sx.passives}>
              <span style={sx.passive}>{matrix.passive1}</span>
              <span style={sx.passive}>{matrix.passive2}</span>
            </div>
          </section>

          {/* ── slots + moves ───────────────────────────────────────── */}
          <section style={sx.editorPanel}>
            <div style={sx.slotRow}>
              {SLOTS.map((slot) => {
                const on = slot === activeSlot;
                return (
                  <button
                    key={slot}
                    onClick={() => setActiveSlot(slot)}
                    style={{
                      ...sx.slotTab,
                      borderColor: on ? C.teal : "transparent",
                      background: on ? C.panelHi : "transparent",
                    }}
                    title={SLOT_META[slot].label}
                  >
                    <img
                      src={`${UI}/slot-${SLOT_META[slot].icon}-${on ? "on" : "off"}.png`}
                      alt={SLOT_META[slot].label}
                      style={{ ...PIXELATED, width: 40, height: 44, display: "block" }}
                    />
                  </button>
                );
              })}
              <div style={{ flex: 1 }} />
              <label style={sx.lock} title="Unity shipped with this on, which leaves one part per slot.">
                <input
                  type="checkbox"
                  checked={lockToFamily}
                  onChange={(e) => setLockToFamily(e.target.checked)}
                  style={{ accentColor: C.teal, margin: 0 }}
                />
                Family lock
              </label>
            </div>

            <div style={sx.cycler}>
              <Arrow dir="left" onClick={() => cycle(activeSlot, -1)} disabled={options.length < 2} />
              <div style={sx.cyclerBody}>
                <div style={sx.slotLabel}>{SLOT_META[activeSlot].label}</div>
                <div style={sx.partName}>
                  {options[index]?.name ?? "—"}
                </div>
                <div style={sx.partMeta}>
                  <span style={{ color: C.faint }}>{currentCode}</span>
                  {crossChassis && <span style={{ color: "#ffa726" }}> · cross-chassis</span>}
                  {options.length > 1 && (
                    <span style={{ color: C.faint }}> · {index + 1}/{options.length}</span>
                  )}
                </div>
              </div>
              <Arrow dir="right" onClick={() => cycle(activeSlot, 1)} disabled={options.length < 2} />
            </div>

            {lockToFamily && options.length < 2 && (
              <p style={sx.warn}>Family lock leaves one part per slot — turn it off to mix chassis.</p>
            )}

            <div style={sx.sectionLabel}>
              {activeSlot === "matrix" ? "CHASSIS PASSIVES" : "MOVES"}
            </div>

            {activeSlot === "matrix" ? (
              <div style={sx.moveList}>
                {[matrix.passive1, matrix.passive2].map((p) => (
                  <div key={p} style={sx.moveRow}>
                    <span style={sx.moveName}>{p}</span>
                  </div>
                ))}
                <p style={sx.note}>
                  Passives are not simulated yet — they are shown for reference only.
                </p>
              </div>
            ) : (
              <div style={sx.moveList}>
                {activePart?.moves.map((mv, i) => {
                  const hit = preview.perMove.get(`${activeSlot}:${i}`);
                  return (
                    <div key={mv.name} style={sx.moveRow}>
                      <div style={{ minWidth: 0 }}>
                        <div style={sx.moveName}>{mv.name}</div>
                        <div style={sx.moveMeta}>
                          {mv.damageType}
                          {mv.targetType !== "single" && ` · ${mv.targetType}`}
                          {mv.effect && ` · ${mv.effect}`}
                        </div>
                      </div>
                      {hit !== undefined ? (
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={sx.moveDmg}>{hit}</div>
                          <div style={sx.moveDmgTag}>DMG</div>
                        </div>
                      ) : (
                        <div style={sx.moveSupport}>SUPPORT</div>
                      )}
                    </div>
                  );
                })}
                <p style={sx.note}>
                  Damage vs a stock {getMatrixById(REFERENCE_OPPONENT)?.matrixName} (median defences).
                </p>
              </div>
            )}
          </section>

          {/* ── stats ───────────────────────────────────────────────── */}
          <section style={sx.statsPanel}>
            <div style={sx.sectionLabel}>STATS</div>
            {STAT_ROWS.map((row) => {
              const total = totals[row.key];
              const base = matrix.baseStats[row.key];
              const fromLimbs = total - base;
              const max = STAT_MAX[row.key] ?? 200;
              const basePct = Math.min(100, (base / max) * 100);
              const limbPct = Math.min(100 - basePct, Math.max(0, (fromLimbs / max) * 100));
              return (
                <div key={row.key} style={sx.statRow}>
                  <div style={sx.statTop}>
                    <span style={sx.statLabel}>{row.label}</span>
                    <span style={sx.statNums}>
                      <span style={sx.statTotal}>{total}</span>
                      {fromLimbs !== 0 && (
                        <span style={{ color: fromLimbs > 0 ? C.teal : C.danger, fontSize: 11 }}>
                          {fromLimbs > 0 ? "+" : ""}{fromLimbs}
                        </span>
                      )}
                    </span>
                  </div>
                  <div style={sx.barFrame}>
                    <div style={sx.barTrack}>
                      <div style={{ ...sx.barBase, width: `${basePct}%` }} />
                      <div style={{ ...sx.barLimb, left: `${basePct}%`, width: `${limbPct}%` }} />
                    </div>
                  </div>
                  <div style={sx.statRole}>{row.role}</div>
                </div>
              );
            })}

            <div style={{
              ...sx.initiative,
              borderColor: preview.movesFirst ? C.teal : C.line,
              color: preview.movesFirst ? C.teal : C.dim,
            }}>
              {preview.movesFirst ? "▲ MOVES FIRST" : "▼ MOVES SECOND"}
              <span style={{ color: C.faint, fontWeight: 400 }}> · ref SPD {preview.refSpd}</span>
            </div>

            <div style={sx.legend}>
              <span><i style={{ ...sx.swatch, background: C.blue }} /> chassis</span>
              <span><i style={{ ...sx.swatch, background: C.teal }} /> limbs</span>
            </div>
          </section>
        </div>

        <footer style={sx.footer}>
          <button onClick={revert} style={sx.btnGhost}>RESET TO STOCK</button>
          <div style={{ flex: 1 }} />
          {saved && <span style={{ color: C.teal, fontSize: 12, fontWeight: 700 }}>SAVED</span>}
          <button
            onClick={save}
            // Team edits already propagate live, so the button is a "done"
            // rather than a commit and stays enabled.
            disabled={!teamContext && !dirty}
            style={{
              ...sx.btnPrimary,
              opacity: teamContext || dirty ? 1 : 0.35,
              cursor: teamContext || dirty ? "pointer" : "default",
            }}
          >
            {teamContext ? "DONE" : "SAVE BUILD"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Corner({ top, left }: { top?: boolean; left?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        position: "absolute", width: 18, height: 18, pointerEvents: "none",
        borderStyle: "solid", borderColor: C.teal,
        [top ? "top" : "bottom"]: -2, [left ? "left" : "right"]: -2,
        borderWidth: `${top ? 2 : 0}px ${left ? 0 : 2}px ${top ? 0 : 2}px ${left ? 2 : 0}px`,
      } as React.CSSProperties}
    />
  );
}

function Arrow({ dir, onClick, disabled }: { dir: "left" | "right"; onClick: () => void; disabled?: boolean }) {
  const [down, setDown] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onPointerDown={() => setDown(true)}
      onPointerUp={() => setDown(false)}
      onPointerLeave={() => setDown(false)}
      style={{
        background: "none", border: "none", padding: "4px 2px", flexShrink: 0,
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.2 : 1,
      }}
      aria-label={dir === "left" ? "Previous" : "Next"}
    >
      <img
        src={`${UI}/arrow-${dir}${down ? "-pressed" : ""}.png`}
        alt=""
        style={{ ...PIXELATED, width: 26, height: 46, display: "block" }}
      />
    </button>
  );
}

const sx: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed", inset: 0, background: "rgba(4,2,10,.9)", zIndex: 1000,
    display: "flex", alignItems: "center", justifyContent: "center", padding: 12,
  },
  frame: {
    position: "relative",
    background: C.panel,
    // Plotting-grid interior, as in the Workshop comp.
    backgroundImage:
      `linear-gradient(${C.line}55 1px, transparent 1px), linear-gradient(90deg, ${C.line}55 1px, transparent 1px)`,
    backgroundSize: "26px 26px",
    border: `2px solid ${C.line}`, borderRadius: 10,
    padding: 18,
    // Sized to fit the viewport outright — the previous版 forced a min-width
    // per column, which is what produced the horizontal scrollbar.
    width: "min(1080px, 100%)", maxHeight: "100%",
    display: "flex", flexDirection: "column", gap: 14,
    overflow: "hidden",
    boxShadow: `0 0 0 1px ${C.teal}33, 0 16px 60px rgba(0,0,0,.65)`,
    fontFamily: "system-ui,sans-serif",
  },
  header: { display: "flex", alignItems: "center", gap: 12, flexShrink: 0 },
  teamTag: {
    fontSize: 11, color: C.purple, border: `1px solid ${C.purple}`,
    borderRadius: 4, padding: "3px 8px", letterSpacing: 2, fontWeight: 700,
  },
  teamHint: { fontSize: 11, color: C.faint, margin: "-6px 0 0", lineHeight: 1.5 },
  title: { margin: 0, fontSize: 20, color: C.teal, letterSpacing: 5, fontWeight: 800 },
  close: {
    background: "none", border: "none", color: C.dim, fontSize: 26,
    cursor: "pointer", lineHeight: 1, padding: 0,
  },
  body: {
    display: "grid",
    /**
     * auto-fit + minmax reflows three columns down to two or one as the
     * viewport narrows, instead of squeezing three fixed tracks until their
     * contents push the panel sideways. `min(280px, 100%)` is the part that
     * actually kills the horizontal scrollbar: a bare 280px floor still
     * overflows once the container is narrower than that, which is what was
     * left over after the previous pass.
     */
    gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))",
    gap: 12,
    minHeight: 0,
    // Vertical only — any horizontal overflow is a layout bug to fix, never
    // something to hand the user a scrollbar for.
    overflowY: "auto",
    overflowX: "hidden",
    // Panels take their natural height rather than being stretched to the
    // tallest one — stretching is what clipped the preview's passives.
    alignItems: "start",
  },
  previewPanel: {
    background: C.ink, border: `1px solid ${C.line}`, borderRadius: 8,
    padding: 12, textAlign: "center", minWidth: 0,
    display: "flex", flexDirection: "column",
  },
  dollWrap: { display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0 },
  mechName: { color: C.text, fontSize: 22, fontWeight: 800, letterSpacing: 1, marginTop: 6 },
  mechRole: { color: C.teal, fontSize: 12, letterSpacing: 2, marginBottom: 10 },
  passives: { display: "flex", flexDirection: "column", gap: 4 },
  passive: {
    fontSize: 11, color: C.dim, background: C.panelHi,
    border: `1px solid ${C.line}`, borderRadius: 4, padding: "5px 6px",
  },
  editorPanel: {
    background: C.ink, border: `1px solid ${C.line}`, borderRadius: 8,
    padding: 12, minWidth: 0, display: "flex", flexDirection: "column",
  },
  /**
   * Wraps. Four 40px tabs plus the nowrap "Family lock" label add up to ~307px
   * of unshrinkable content against a 280px minimum column — that difference
   * was the last thing still pushing a horizontal scrollbar onto the panel.
   */
  slotRow: { display: "flex", alignItems: "center", gap: 4, marginBottom: 10, flexWrap: "wrap" },
  slotTab: { border: "2px solid transparent", borderRadius: 8, padding: 3, cursor: "pointer", lineHeight: 0 },
  lock: {
    display: "flex", alignItems: "center", gap: 5,
    fontSize: 10, color: C.faint, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
  },
  cycler: { display: "flex", alignItems: "center", gap: 6, marginBottom: 10 },
  cyclerBody: { flex: 1, textAlign: "center", minWidth: 0 },
  slotLabel: { fontSize: 10, color: C.faint, letterSpacing: 2, textTransform: "uppercase" },
  partName: { fontSize: 19, color: C.text, fontWeight: 700, lineHeight: 1.25, wordBreak: "break-word" },
  partMeta: { fontSize: 11, fontFamily: "monospace", marginTop: 2 },
  warn: { fontSize: 10, color: "#ffa726", margin: "0 0 8px", lineHeight: 1.5 },
  sectionLabel: { fontSize: 10, color: C.faint, letterSpacing: 3, margin: "2px 0 8px" },
  moveList: { display: "flex", flexDirection: "column", gap: 6 },
  moveRow: {
    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
    background: C.panelHi, border: `1px solid ${C.line}`, borderRadius: 6, padding: "9px 11px",
  },
  moveName: { fontSize: 14, color: C.text, fontWeight: 600 },
  moveMeta: { fontSize: 11, color: C.dim, marginTop: 2 },
  moveDmg: { fontSize: 24, color: C.teal, fontWeight: 800, fontFamily: "monospace", lineHeight: 1 },
  moveDmgTag: { fontSize: 8, color: C.faint, letterSpacing: 2 },
  moveSupport: { fontSize: 10, color: C.blue, letterSpacing: 2, fontWeight: 700, flexShrink: 0 },
  note: { fontSize: 10, color: C.faint, lineHeight: 1.5, margin: "4px 0 0" },
  statsPanel: {
    background: C.ink, border: `1px solid ${C.line}`, borderRadius: 8,
    padding: 12, minWidth: 0,
  },
  statRow: { marginBottom: 11 },
  statTop: { display: "flex", justifyContent: "space-between", alignItems: "baseline" },
  statLabel: { fontSize: 13, color: C.text, fontWeight: 700, letterSpacing: 1, fontFamily: "monospace" },
  statNums: { display: "flex", alignItems: "baseline", gap: 5, fontFamily: "monospace" },
  statTotal: { fontSize: 17, color: C.text, fontWeight: 800 },
  /** 9-slice of the original bar.png: 20px top, 60px sides, 80px bottom. */
  barFrame: {
    borderStyle: "solid",
    borderWidth: "3px 5px 6px",
    borderImage: `url(${UI}/bar.png) 20 60 80 fill / 3px 5px 6px / 0 stretch`,
    padding: 0, marginTop: 3,
  },
  barTrack: { position: "relative", height: 9, background: "#000", overflow: "hidden" },
  barBase: { position: "absolute", left: 0, top: 0, height: "100%", background: C.blue },
  barLimb: { position: "absolute", top: 0, height: "100%", background: C.teal },
  statRole: { fontSize: 10, color: C.faint, marginTop: 3 },
  initiative: {
    marginTop: 12, padding: "8px 6px", borderRadius: 5, border: "1px solid",
    fontSize: 12, fontWeight: 800, textAlign: "center", letterSpacing: 1,
  },
  legend: {
    display: "flex", gap: 14, justifyContent: "center",
    fontSize: 10, color: C.faint, marginTop: 8,
  },
  swatch: { display: "inline-block", width: 9, height: 9, marginRight: 4, verticalAlign: "middle" },
  footer: { display: "flex", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap" },
  btnGhost: {
    background: "none", border: `1px solid ${C.line}`, color: C.dim,
    borderRadius: 6, padding: "11px 16px", fontSize: 12, fontWeight: 700,
    cursor: "pointer", letterSpacing: 1,
  },
  btnPrimary: {
    background: C.teal, border: "none", color: C.ink,
    borderRadius: 6, padding: "12px 26px", fontSize: 14, fontWeight: 800, letterSpacing: 1,
  },
};
