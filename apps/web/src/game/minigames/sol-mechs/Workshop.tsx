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
import {
  drawMech, DOLL_WIDTH, DOLL_HEIGHT, preloadAll, preloadBuild, mechBounds,
  type MechBounds,
} from "@/game/solmechs/render/paperDoll";
import {
  MATRICES, getMatrixById, getPart, getMatrix, getSelectableParts, familyOf,
  PRESET_BUILDS, REFERENCE_OPPONENT,
} from "@/game/solmechs/data/catalog";
import type { MechBuild, MechId, StatBlock, ModuleSlot, MechPart } from "@/game/solmechs/data/types";
import { addStats } from "@/game/solmechs/data/types";
import { createUnit, calculateDamage } from "@/game/solmechs/engine/BattleEngine";
import { loadHangar, setBuild as persistBuild, resetBuild, getBuild } from "@/game/solmechs/hangar";
import { C, T, SP, R, MONO, W, PANEL_HEIGHT, DISPLAY, frame } from "./theme";

const UI = "/assets/minigames/sol-mechs/ui";
const PIXELATED: React.CSSProperties = { imageRendering: "pixelated" };

/** Sampled from the Unity Workshop art (bar.png) so the chrome matches. */

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

  /**
   * The canvas is cropped to the mech, not to the doll box — see mechBounds.
   * The full box is only the starting guess, replaced as soon as the sprites
   * have decoded and the real bounds can be measured.
   */
  const [crop, setCrop] = useState<MechBounds>({ x: 0, y: 0, w: DOLL_WIDTH, h: DOLL_HEIGHT });

  // Live doll. Driven on rAF because the sprites decode asynchronously — a
  // single draw on mount would land before the art is ready.
  useEffect(() => {
    preloadBuild(build);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const loop = () => {
      const box = mechBounds(build);
      if (box && (box.x !== crop.x || box.y !== crop.y || box.w !== crop.w || box.h !== crop.h)) {
        setCrop(box);
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawMech(ctx, build, {
        x: -crop.x * PREVIEW_SCALE,
        y: -crop.y * PREVIEW_SCALE,
        scale: PREVIEW_SCALE,
      });
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [build, crop]);

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
          <img
            src="/assets/minigames/sol-mechs/ui/logo.png"
            alt="Sol Mechs"
            style={{ imageRendering: "pixelated", height: 24, width: "auto", display: "block" }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
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
                width={crop.w * PREVIEW_SCALE}
                height={crop.h * PREVIEW_SCALE}
                // `width: auto`, not `100%`: stretching the canvas to the
                // column was the other half of the oversized preview, blowing
                // a 55px-wide mech up to whatever width the column happened to
                // have. It draws at its own size now, capped by the viewport.
                style={{
                  ...PIXELATED, display: "block", margin: "0 auto",
                  width: "auto", height: "auto",
                  maxWidth: "100%", maxHeight: "23vh",
                }}
              />
            </div>
            <div style={sx.mechName}>{matrix.matrixName}</div>
            <div style={sx.mechRole}>{matrix.role}</div>
          </section>

          {/* ── modules: every slot on screen, each with its own arrows ── */}
          <section style={sx.editorPanel}>
            <div style={sx.colTitle}>Module</div>
            {SLOTS.map((slot) => {
              const opts = optionsFor(slot);
              const code = slot === "matrix" ? build.matrixCode : build[slot];
              const current = opts.find((o) => o.code === code);
              const i = opts.findIndex((o) => o.code === code);
              return (
                <SlotRow
                  key={slot}
                  slot={slot}
                  selected={slot === activeSlot}
                  name={current?.name ?? "—"}
                  position={opts.length > 1 ? `${i + 1}/${opts.length}` : ""}
                  canCycle={opts.length > 1}
                  onSelect={() => setActiveSlot(slot)}
                  onCycle={(d) => cycle(slot, d)}
                />
              );
            })}

            <label style={sx.lock} title="Unity shipped with this on, which leaves one part per slot.">
              <input
                type="checkbox"
                checked={lockToFamily}
                onChange={(e) => setLockToFamily(e.target.checked)}
                style={{ accentColor: C.teal, margin: 0 }}
              />
              Family lock
            </label>
            {lockToFamily && (
              <p style={sx.warn}>Family lock keeps every part on one chassis.</p>
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
                <div key={row.key} style={sx.statRow} title={row.role}>
                  <span style={sx.statLabel}>{row.label}</span>
                  <div style={sx.barFrame}>
                    <div style={sx.barTrack}>
                      <div style={{ ...sx.barBase, width: `${basePct}%` }} />
                      <div style={{ ...sx.barLimb, left: `${basePct}%`, width: `${limbPct}%` }} />
                    </div>
                  </div>
                  <span style={sx.statNums}>
                    <span style={sx.statTotal}>{total}</span>
                    {fromLimbs !== 0 && (
                      <span style={{
                        // What the limbs add is the number the editor exists to
                        // move, so it reads as a figure, not a footnote.
                        color: fromLimbs > 0 ? C.teal : C.bad,
                        fontSize: 12, fontWeight: 800,
                      }}>
                        {fromLimbs > 0 ? "+" : ""}{fromLimbs}
                      </span>
                    )}
                  </span>
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

        {/* ── the selected module's abilities, always on screen ─────── */}
        <section style={sx.movePanel}>
          <div style={sx.moveTag}>{activeSlot === "matrix" ? "PASSIVES" : "MOVE"}</div>
          <div style={sx.moveCards}>
            {activeSlot === "matrix" ? (
              [matrix.passive1, matrix.passive2].map((name) => (
                <div key={name} style={sx.moveCard}>
                  <div style={sx.moveCardName}>{name}</div>
                  <div style={sx.moveCardSrc}>{matrix.matrixName}</div>
                  <div style={sx.moveCardNote}>Not simulated yet — shown for reference.</div>
                </div>
              ))
            ) : equipped[activeSlot]?.moves.length ? (
              equipped[activeSlot]!.moves.map((mv, i) => {
                const hit = preview.perMove.get(`${activeSlot}:${i}`);
                return (
                  <div key={mv.name} style={sx.moveCard}>
                    <div style={sx.moveCardName}>{mv.name}</div>
                    <div style={sx.moveCardSrc}>{equipped[activeSlot]?.partName}</div>
                    <dl style={sx.moveSpecs}>
                      <div style={sx.spec}>
                        <dt style={sx.specKey}>Damage</dt>
                        <dd style={sx.specVal}>{hit ?? 0}</dd>
                      </div>
                      <div style={sx.spec}>
                        <dt style={sx.specKey}>Type</dt>
                        <dd style={sx.specVal}>{mv.damageType.toUpperCase()}</dd>
                      </div>
                      <div style={sx.spec}>
                        <dt style={sx.specKey}>Target</dt>
                        <dd style={sx.specVal}>{mv.targetType.toUpperCase()}</dd>
                      </div>
                      {mv.effect && (
                        <div style={sx.spec}>
                          <dt style={sx.specKey}>Effect</dt>
                          <dd style={{ ...sx.specVal, color: C.teal }}>{mv.effect}</dd>
                        </div>
                      )}
                    </dl>
                  </div>
                );
              })
            ) : (
              <div style={sx.moveCard}><div style={sx.moveCardSrc}>No moves on this part.</div></div>
            )}
          </div>
          {activeSlot !== "matrix" && (
            <p style={sx.note}>
              Damage vs a stock {getMatrixById(REFERENCE_OPPONENT)?.matrixName} (median defences).
            </p>
          )}
        </section>

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

/**
 * One module slot: arrows either side of the Unity row panel.
 *
 * The arrows change the part directly, so a slot never has to be selected
 * before it can be edited — the old screen made you pick a tab first, which
 * turned a four-part loadout into four separate trips. Selecting a row still
 * matters, but only to say which part's abilities the panel below describes.
 *
 * The panel art already carries its own slot glyph, so nothing is overlaid on
 * the disc; only the part name is drawn, into the dark bar the sprite leaves
 * for it (25%-98% across, 28%-67% down, measured off the imported sprite).
 */
function SlotRow({ slot, selected, name, position, canCycle, onSelect, onCycle }: {
  slot: ModuleSlot;
  selected: boolean;
  name: string;
  position: string;
  canCycle: boolean;
  onSelect: () => void;
  onCycle: (dir: -1 | 1) => void;
}) {
  return (
    <div style={sx.slotRowWrap}>
      <Arrow dir="left" onClick={() => onCycle(-1)} disabled={!canCycle} />
      <button
        onClick={onSelect}
        title={SLOT_META[slot].label}
        style={{
          ...sx.rowPanel,
          backgroundImage: `url(${UI}/row-${SLOT_META[slot].icon}.png)`,
          // Selection is a glow, not a border: the sprite is not a rectangle,
          // so a box around it would not follow its shape.
          filter: selected ? "brightness(1.25)" : "none",
        }}
      >
        <span style={{ ...sx.rowName, color: selected ? C.text : C.body }}>{name}</span>
        {position && <span style={sx.rowPos}>{position}</span>}
      </button>
      <Arrow dir="right" onClick={() => onCycle(1)} disabled={!canCycle} />
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
        background: "none", border: "none", padding: "2px 0", flexShrink: 0,
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.2 : 1,
      }}
      aria-label={dir === "left" ? "Previous" : "Next"}
    >
      <img
        src={`${UI}/arrow-${dir}${down ? "-pressed" : ""}.png`}
        alt=""
        style={{ ...PIXELATED, width: 18, height: 32, display: "block" }}
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
    padding: 14,
    // Sized to fit the viewport outright, and no wider than the columns can
    // use — an earlier pass forced a min-width per column, which is what
    // produced the horizontal scrollbar.
    width: W.editor,
    // maxHeight, not height. Forcing the panel to fill the viewport spread
    // three short columns over 850px and left air between the mech and its
    // name; fitting the content removes the gap AND the scrollbar at once.
    maxHeight: PANEL_HEIGHT,
    display: "flex", flexDirection: "column", gap: 10,
    overflow: "hidden",
    boxShadow: `0 0 0 1px ${C.teal}33, 0 16px 60px rgba(0,0,0,.65)`,
    fontFamily: "system-ui,sans-serif",
  },
  header: { display: "flex", alignItems: "center", gap: 10, flexShrink: 0 },
  teamTag: {
    fontSize: 12, color: C.purple, border: `1px solid ${C.purple}`,
    borderRadius: 4, padding: "3px 8px", letterSpacing: 2, fontWeight: 700,
  },
  teamHint: { fontSize: 12, color: C.faint, margin: "-6px 0 0", lineHeight: 1.5 },
  title: { margin: 0, fontSize: 16, color: C.teal, letterSpacing: 4, fontWeight: 800, fontFamily: DISPLAY },
  close: {
    background: "none", border: "none", color: C.dim, fontSize: 22,
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
    /*
     * Proportional tracks, not three equal ones. auto-fit gave the preview the
     * same width as the editor and the stats, so the mech sat in a box several
     * times its own size while the columns that carry text were cramped.
     *
     * A cropped mech is ~55x79, so the preview is the narrowest track; the
     * module rows are capped at 270 whatever they are given, so the editor is
     * next; the stat bars are the only thing that reads better wider.
     */
    gridTemplateColumns: "minmax(0, 0.72fr) minmax(0, 1fr) minmax(0, 1.15fr)",
    gap: 12,
    minHeight: 0,
    overflowX: "hidden",
    // Columns match the tallest one, so the panel does not jump in height
    // when a slot with moves replaces one without. This is safe now only
    // because the PANEL fits its content — it was the forced full height,
    // not the stretch, that spread everything out.
    alignItems: "stretch",
  },
  previewPanel: {
    background: C.ink, ...frame(), padding: 10, textAlign: "center", minWidth: 0,
    display: "flex", flexDirection: "column",
  },
  /**
   * `flex: 1` is what centres the mech. The wrap used to be sized by the
   * canvas alone, so the doll sat at the top of a taller panel with its
   * name and passives pushed under it.
   */
  /** flex:1 centres the mech in whatever height the column ends up with. */
  dollWrap: {
    flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
    minWidth: 0, minHeight: 0,
  },
  mechName: { color: C.text, fontSize: 16, fontWeight: 800, letterSpacing: 1, marginTop: 4, fontFamily: DISPLAY },
  mechRole: { color: C.teal, fontSize: 11, letterSpacing: 2, marginBottom: 2 },
  passives: { display: "flex", flexDirection: "column", gap: 4 },
  passive: {
    fontSize: 12, color: C.dim, background: C.raised,
    border: `1px solid ${C.line}`, borderRadius: 4, padding: "5px 6px",
  },
  editorPanel: {
    background: C.ink, ...frame(),
    padding: 10, minWidth: 0, display: "flex", flexDirection: "column",
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
    fontSize: 12, color: C.faint, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
  },
  cycler: { display: "flex", alignItems: "center", gap: 6, marginBottom: 10 },
  cyclerBody: { flex: 1, textAlign: "center", minWidth: 0 },
  slotLabel: { fontSize: 12, color: C.faint, letterSpacing: 2, textTransform: "uppercase" },
  partName: { fontSize: 19, color: C.text, fontWeight: 700, lineHeight: 1.25, wordBreak: "break-word" },
  partMeta: { fontSize: 12, fontFamily: "monospace", marginTop: 2 },
  warn: { fontSize: 12, color: C.warn, margin: "0 0 8px", lineHeight: 1.5 },
  sectionLabel: { fontSize: 12, color: C.faint, letterSpacing: 3, margin: "0 0 4px" },
  moveList: { display: "flex", flexDirection: "column", gap: 6 },
  moveRow: {
    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
    background: C.raised, border: `1px solid ${C.line}`, borderRadius: 6, padding: "9px 11px",
  },
  moveName: { fontSize: 14, color: C.text, fontWeight: 600 },
  moveMeta: { fontSize: 12, color: C.dim, marginTop: 2 },
  moveDmg: { fontSize: 24, color: C.teal, fontWeight: 800, fontFamily: "monospace", lineHeight: 1 },
  moveDmgTag: { fontSize: 12, color: C.faint, letterSpacing: 2 },
  moveSupport: { fontSize: 12, color: C.blue, letterSpacing: 2, fontWeight: 700, flexShrink: 0 },
  note: { fontSize: 12, color: C.faint, lineHeight: 1.5, margin: "4px 0 0" },
  /** Column heading, in the game face — "Module", "SOL Mech". */
  colTitle: {
    fontSize: 14, fontWeight: 800, letterSpacing: 3, color: C.text,
    fontFamily: DISPLAY, textAlign: "center", marginBottom: 2,
  },

  /**
   * One module slot: arrow, panel, arrow.
   *
   * Capped and centred rather than filled to the column. The panel keeps the
   * sprite's 198x58, so its HEIGHT follows its width — across a full column it
   * came out at ~139px a row, and four of those were most of the reason the
   * editor needed scrolling. 270 puts the art back near its native 58.
   */
  slotRowWrap: {
    display: "flex", alignItems: "center", gap: 2,
    width: "100%", maxWidth: 270, margin: "0 auto 4px",
  },
  /**
   * The Unity row sprite (198x58). Its own glyph is baked in on the left, so
   * only the name is drawn — into the dark bar the art leaves at 25%-98%.
   */
  rowPanel: {
    position: "relative", flex: 1, minWidth: 0,
    aspectRatio: "198 / 58",
    // `background` is a SHORTHAND and resets every background-* longhand, so
    // it has to come FIRST — declared after, it silently wiped the size and
    // repeat rules and the sprite tiled across the row.
    background: "transparent",
    backgroundSize: "100% 100%",
    backgroundRepeat: "no-repeat",
    border: "none", padding: 0,
    cursor: "pointer", imageRendering: "pixelated",
    transition: "filter .12s",
  },
  rowName: {
    position: "absolute", left: "27%", right: "13%", top: "28%", height: "39%",
    display: "flex", alignItems: "center",
    fontSize: 12, fontWeight: 700, fontFamily: DISPLAY, letterSpacing: 0.5,
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  },
  rowPos: {
    position: "absolute", right: "6%", top: "28%", height: "39%",
    display: "flex", alignItems: "center",
    fontSize: 10, fontFamily: MONO, color: C.faint,
  },

  /** Abilities of whichever module is selected, across the full width. */
  movePanel: {
    ...frame(), background: C.ink, padding: "6px 10px", flexShrink: 0,
    display: "flex", flexDirection: "column", gap: 4,
  },
  moveTag: {
    fontSize: 13, fontWeight: 800, letterSpacing: 4,
    color: C.teal, fontFamily: DISPLAY,
  },
  moveCards: {
    display: "grid", gap: 8,
    gridTemplateColumns: "repeat(auto-fit, minmax(min(230px, 100%), 1fr))",
  },
  moveCard: {
    background: C.panel, border: `1px solid ${C.line}`, borderRadius: 6,
    padding: "6px 10px", minWidth: 0,
  },
  moveCardName: { fontSize: 14, fontWeight: 800, color: C.text, fontFamily: DISPLAY },
  moveCardSrc: { fontSize: 12, color: C.purple, fontWeight: 700, marginBottom: 4 },
  moveCardNote: { fontSize: 11, color: C.faint, lineHeight: 1.5 },
  /** Key/value grid, so the four specs line up across cards. */
  moveSpecs: {
    margin: 0, display: "grid", gap: "2px 10px",
    gridTemplateColumns: "auto 1fr",
  },
  spec: { display: "contents" },
  specKey: { fontSize: 12, color: C.faint, margin: 0 },
  specVal: { fontSize: 12, color: C.body, margin: 0, fontFamily: MONO, fontWeight: 700 },

  statsPanel: {
    background: C.ink, ...frame(), padding: 10, minWidth: 0,
  },
  /**
   * One line per stat: label, bar, value. Each stat used to take three lines —
   * a header row, the bar, then a description — which made six stats taller
   * than the column they live in.
   */
  statRow: {
    display: "flex", alignItems: "center", gap: 8, marginBottom: 4,
  },
  statTop: { display: "flex", justifyContent: "space-between", alignItems: "baseline" },
  statLabel: { width: 34, flexShrink: 0, fontSize: 13, color: C.text, fontWeight: 700, letterSpacing: 1, fontFamily: DISPLAY },
  statNums: { display: "flex", alignItems: "baseline", justifyContent: "flex-end", gap: 4, width: 62, flexShrink: 0, fontFamily: DISPLAY },
  /** The number is the thing being compared, so it stays the biggest type. */
  statTotal: { fontSize: 17, color: C.text, fontWeight: 800, letterSpacing: 1 },
  /** 9-slice of the original bar.png: 20px top, 60px sides, 80px bottom. */
  barFrame: {
    flex: 1, minWidth: 0,
    borderStyle: "solid",
    borderWidth: "3px 5px 6px",
    borderImage: `url(${UI}/bar.png) 20 60 80 fill / 3px 5px 6px / 0 stretch`,
    padding: 0, marginTop: 3,
  },
  barTrack: { position: "relative", height: 9, background: "#000", overflow: "hidden" },
  barBase: { position: "absolute", left: 0, top: 0, height: "100%", background: C.blue },
  barLimb: { position: "absolute", top: 0, height: "100%", background: C.teal },
  statRole: { fontSize: 11, color: C.faint, marginTop: 1, lineHeight: 1.2 },
  initiative: {
    marginTop: 6, padding: "4px 6px", borderRadius: 5, border: "1px solid",
    fontSize: 12, fontWeight: 800, textAlign: "center", letterSpacing: 1,
  },
  legend: {
    display: "flex", gap: 14, justifyContent: "center",
    fontSize: 12, color: C.faint, marginTop: 6,
  },
  swatch: { display: "inline-block", width: 9, height: 9, marginRight: 4, verticalAlign: "middle" },
  footer: { display: "flex", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap" },
  btnGhost: {
    background: "none", border: `1px solid ${C.line}`, color: C.dim,
    borderRadius: 6, padding: "8px 14px", fontSize: 12, fontWeight: 700,
    cursor: "pointer", letterSpacing: 1,
  },
  btnPrimary: {
    background: C.teal, border: "none", color: C.ink,
    borderRadius: 6, padding: "9px 22px", fontSize: 13, fontWeight: 800, letterSpacing: 1,
  },
};
