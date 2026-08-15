"use client";

/**
 * Sol Mechs — Workshop.
 *
 * The build editor, ported from Unity's EditorController.cs. Same model:
 * pick a chassis, then cycle each limb slot with prev/next arrows while a
 * live paper doll and a stat readout update underneath.
 *
 * Two deliberate departures from the Unity original are called out inline
 * where they bite: cross-family mixing is allowed by default (see
 * getSelectableParts), and the stat panel distinguishes the stats that
 * actually drive damage from the ones that only look like they do.
 *
 * Visual language follows the Unity Workshop comps (Sprites/Interface
 * guidance/MechEditorSprites/Workshop): near-black violet ground, grid
 * interior, teal and purple neon edges. Those comps are 5k-wide mockups, so
 * the chrome is rebuilt in CSS and only the small slot-tab icons ship as art.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { drawMech, MECH_FRAME_SIZE, preloadBuild } from "@/game/solmechs/render/MechPaperDoll";
import {
  MATRICES, getMatrixById, getPart, getSelectableParts, familyOf, PRESET_BUILDS,
} from "@/game/solmechs/data/catalog";
import type { MechBuild, MechId, MechPart, StatBlock, ModuleSlot } from "@/game/solmechs/data/types";
import { addStats, ZERO_STATS } from "@/game/solmechs/data/types";
import { loadHangar, setBuild as persistBuild, resetBuild, getBuild } from "@/game/solmechs/hangar";

const UI = "/assets/minigames/sol-mechs/ui";
const PIXELATED: React.CSSProperties = { imageRendering: "pixelated" };

/** The three editable slots, in the order the Unity editor listed them. */
type LimbSlot = Exclude<ModuleSlot, "matrix">;
const LIMB_ORDER: LimbSlot[] = ["rightArm", "leftArm", "lowerBody"];

const SLOT_META: Record<LimbSlot, { label: string; icon: string }> = {
  rightArm:  { label: "Right Arm", icon: "rightarm" },
  leftArm:   { label: "Left Arm",  icon: "leftarm" },
  lowerBody: { label: "Legs",      icon: "legs" },
};

const PREVIEW_SCALE = 3;
const PREVIEW_SIZE = MECH_FRAME_SIZE * PREVIEW_SCALE;

/**
 * Stats shown in the readout.
 *
 * `drivesDamage` is the honest part. BattleEngine.calculateDamage — faithful
 * to LocalBattleManager — reads ATK/DEF/ENG/SYS from the *chassis base stats
 * only*, so a part's contribution to those four changes the number displayed
 * here but not a single point of damage in a fight. HP is the exception:
 * each part's HP is that limb's real hit points. Unity's editor showed the
 * combined totals with no such distinction, which quietly invited players to
 * optimize a stat that does nothing.
 */
const STAT_ROWS: Array<{ key: keyof StatBlock; label: string; drivesDamage: boolean }> = [
  { key: "HP",  label: "HP",  drivesDamage: true },
  { key: "ATK", label: "ATK", drivesDamage: false },
  { key: "DEF", label: "DEF", drivesDamage: false },
  { key: "ENG", label: "ENG", drivesDamage: false },
  { key: "SYS", label: "SYS", drivesDamage: false },
  { key: "SPD", label: "SPD", drivesDamage: false },
];

/** Visual ceilings for the bars, with headroom over the best build available. */
const STAT_MAX: Record<string, number> = {
  HP: 700, ATK: 160, DEF: 160, ENG: 180, SYS: 160, SPD: 140,
};

export interface WorkshopProps {
  /** Mech open when the Workshop is entered. */
  initialMech: MechId;
  /** Called with the saved build when the player confirms. */
  onSaved?: (mech: MechId, build: MechBuild) => void;
  onClose: () => void;
}

export default function Workshop({ initialMech, onSaved, onClose }: WorkshopProps) {
  const hangar = useMemo(() => loadHangar(), []);
  const [mech, setMech] = useState<MechId>(initialMech);
  const [build, setBuildState] = useState<MechBuild>(() => getBuild(loadHangar(), initialMech));
  const [activeSlot, setActiveSlot] = useState<LimbSlot>("rightArm");
  const [lockToFamily, setLockToFamily] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);

  const matrix = getMatrixById(mech);

  // Owned mechs only — the roster is what the player has unlocked, not the
  // whole catalog.
  const ownedMatrices = useMemo(
    () => MATRICES.filter((m) => hangar.owned.includes(m.id)),
    [hangar.owned],
  );

  const equipped = useMemo(() => ({
    rightArm: getPart(build.rightArm),
    leftArm: getPart(build.leftArm),
    lowerBody: getPart(build.lowerBody),
  }), [build]);

  const totals: StatBlock = useMemo(() => {
    if (!matrix) return { ...ZERO_STATS };
    let t: StatBlock = { ...matrix.baseStats };
    for (const slot of LIMB_ORDER) {
      const part = equipped[slot];
      if (part) t = addStats(t, part.statModifiers);
    }
    return t;
  }, [matrix, equipped]);

  // Live paper doll. Redrawn on a rAF loop rather than once per state change
  // because the layer images decode asynchronously — a single draw on mount
  // would land before the sprites are ready and leave the panel empty.
  useEffect(() => {
    preloadBuild(build);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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

  const switchMech = useCallback((next: MechId) => {
    // Each mech keeps its own saved loadout, so switching chassis loads that
    // mech's build rather than carrying limbs across.
    setMech(next);
    setBuildState(getBuild(loadHangar(), next));
    setDirty(false);
  }, []);

  const cycle = useCallback((slot: LimbSlot, dir: -1 | 1) => {
    const options = getSelectableParts(slot, build.matrixCode, lockToFamily);
    if (options.length === 0) return;
    const currentCode = build[slot];
    const idx = options.findIndex((p) => p.partCode === currentCode);
    // Wrap in both directions; a missing current part starts the cycle at 0.
    const nextIdx = ((idx < 0 ? 0 : idx) + dir + options.length) % options.length;
    setBuildState({ ...build, [slot]: options[nextIdx].partCode });
    setDirty(true);
  }, [build, lockToFamily]);

  const save = useCallback(() => {
    persistBuild(mech, build);
    setDirty(false);
    setSavedFlash(true);
    onSaved?.(mech, build);
    window.setTimeout(() => setSavedFlash(false), 1400);
  }, [mech, build, onSaved]);

  const revert = useCallback(() => {
    resetBuild(mech);
    setBuildState(PRESET_BUILDS[mech]);
    setDirty(false);
  }, [mech]);

  if (!matrix) return null;

  const activeOptions = getSelectableParts(activeSlot, build.matrixCode, lockToFamily);
  const activePart = equipped[activeSlot];
  const activeIndex = activeOptions.findIndex((p) => p.partCode === build[activeSlot]);

  return (
    <div style={sx.backdrop}>
      <div style={sx.frame}>
        {/* neon corner accents, echoing the Unity comp's bracketed frame */}
        <span style={{ ...sx.corner, top: -2, left: -2, borderWidth: "2px 0 0 2px" }} />
        <span style={{ ...sx.corner, top: -2, right: -2, borderWidth: "2px 2px 0 0" }} />
        <span style={{ ...sx.corner, bottom: -2, left: -2, borderWidth: "0 0 2px 2px" }} />
        <span style={{ ...sx.corner, bottom: -2, right: -2, borderWidth: "0 2px 2px 0" }} />

        <div style={sx.header}>
          <h2 style={sx.title}>WORKSHOP</h2>
          <button onClick={onClose} style={sx.close} aria-label="Close">×</button>
        </div>

        {/* ── chassis roster ─────────────────────────────────────────── */}
        <div style={sx.sectionLabel}>CHASSIS</div>
        <div style={sx.chassisRow}>
          {ownedMatrices.map((m) => (
            <button
              key={m.matrixCode}
              onClick={() => switchMech(m.id)}
              style={{
                ...sx.chassisChip,
                borderColor: m.id === mech ? "#2ee6a8" : "#3d2a63",
                background: m.id === mech ? "#25184a" : "#170e2e",
                color: m.id === mech ? "#2ee6a8" : "#9d8fc4",
              }}
            >
              {m.matrixName}
            </button>
          ))}
          {ownedMatrices.length < MATRICES.length && (
            <span style={sx.lockedNote}>
              {MATRICES.length - ownedMatrices.length} chassis locked
            </span>
          )}
        </div>

        <div style={sx.body}>
          {/* ── live paper doll ──────────────────────────────────────── */}
          <div style={sx.previewPanel}>
            <canvas
              ref={canvasRef}
              width={PREVIEW_SIZE}
              height={PREVIEW_SIZE}
              style={{ ...PIXELATED, width: "100%", height: "auto", display: "block" }}
            />
            <div style={sx.previewName}>{matrix.matrixName}</div>
            <div style={sx.previewRole}>{matrix.role}</div>
            <div style={sx.passives}>
              <span style={sx.passive}>{matrix.passive1}</span>
              <span style={sx.passive}>{matrix.passive2}</span>
            </div>
          </div>

          {/* ── slot editor ──────────────────────────────────────────── */}
          <div style={sx.editorPanel}>
            <div style={sx.slotTabs}>
              {LIMB_ORDER.map((slot) => {
                const on = slot === activeSlot;
                return (
                  <button
                    key={slot}
                    onClick={() => setActiveSlot(slot)}
                    style={{ ...sx.slotTab, borderColor: on ? "#2ee6a8" : "transparent" }}
                    title={SLOT_META[slot].label}
                  >
                    <img
                      src={`${UI}/slot-${SLOT_META[slot].icon}-${on ? "on" : "off"}.png`}
                      alt={SLOT_META[slot].label}
                      style={{ ...PIXELATED, width: 34, height: 38, display: "block" }}
                    />
                  </button>
                );
              })}
              <div style={{ flex: 1 }} />
              <label style={sx.lockToggle} title="Unity's EditorController shipped with this on, which leaves one part per slot.">
                <input
                  type="checkbox"
                  checked={lockToFamily}
                  onChange={(e) => setLockToFamily(e.target.checked)}
                  style={{ accentColor: "#2ee6a8" }}
                />
                Family lock
              </label>
            </div>

            {/* selected slot: arrows + part name */}
            <div style={sx.cycler}>
              <ArrowButton dir="left" onClick={() => cycle(activeSlot, -1)} disabled={activeOptions.length < 2} />
              <div style={sx.cyclerBody}>
                <div style={sx.slotLabel}>{SLOT_META[activeSlot].label}</div>
                <div style={sx.partName}>{activePart?.partName ?? "—"}</div>
                <div style={sx.partMeta}>
                  {activePart?.partCode}
                  {activePart && familyOf(activePart.partCode) !== familyOf(build.matrixCode) && (
                    // Worth surfacing: a cross-family limb is legal here but
                    // would have been unreachable in the Unity editor.
                    <span style={sx.crossFamily}> · cross-chassis</span>
                  )}
                  {activeOptions.length > 1 && (
                    <span style={sx.counter}>
                      {activeIndex + 1}/{activeOptions.length}
                    </span>
                  )}
                </div>
              </div>
              <ArrowButton dir="right" onClick={() => cycle(activeSlot, 1)} disabled={activeOptions.length < 2} />
            </div>

            {lockToFamily && activeOptions.length < 2 && (
              <div style={sx.hint}>
                Family lock leaves one part per slot — turn it off to mix chassis.
              </div>
            )}

            {/* moves granted by the equipped part */}
            <div style={sx.sectionLabel}>MOVES</div>
            <div style={sx.moveList}>
              {activePart?.moves.map((mv) => (
                <div key={mv.name} style={sx.moveRow}>
                  <div>
                    <div style={sx.moveName}>{mv.name}</div>
                    <div style={sx.moveMeta}>
                      {mv.damageType}
                      {mv.targetType !== "single" && ` · ${mv.targetType}`}
                      {mv.effect && ` · ${mv.effect}`}
                    </div>
                  </div>
                  <div style={sx.moveDmg}>{mv.baseDamage > 0 ? mv.baseDamage : "—"}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── stat readout ─────────────────────────────────────────── */}
          <div style={sx.statsPanel}>
            <div style={sx.sectionLabel}>STATS</div>
            {STAT_ROWS.map((row) => {
              const total = totals[row.key];
              const base = matrix.baseStats[row.key];
              const fromParts = total - base;
              const max = STAT_MAX[row.key] ?? 200;
              return (
                <div key={row.key} style={{ marginBottom: 7 }}>
                  <div style={sx.statHead}>
                    <span style={{ color: row.drivesDamage ? "#c3b8e0" : "#7a68a8" }}>{row.label}</span>
                    <span style={sx.statValue}>
                      {total}
                      {fromParts !== 0 && (
                        <span style={{ color: fromParts > 0 ? "#2ee6a8" : "#ff5468", fontSize: 9 }}>
                          {" "}{fromParts > 0 ? "+" : ""}{fromParts}
                        </span>
                      )}
                    </span>
                  </div>
                  <div style={sx.statTrack}>
                    {/* chassis contribution solid, parts' contribution ghosted
                        on top — makes it visible at a glance how much of a
                        stat is the chassis versus the limbs */}
                    <div style={{ ...sx.statFillBase, width: `${Math.min(100, (base / max) * 100)}%` }} />
                    <div style={{
                      ...sx.statFillParts,
                      left: `${Math.min(100, (base / max) * 100)}%`,
                      width: `${Math.min(100 - (base / max) * 100, Math.max(0, (fromParts / max) * 100))}%`,
                    }} />
                  </div>
                </div>
              );
            })}
            <div style={sx.statFootnote}>
              Damage is computed from <strong style={{ color: "#c3b8e0" }}>chassis</strong> ATK/DEF/ENG/SYS
              only — limbs contribute their <strong style={{ color: "#c3b8e0" }}>HP</strong> and their moves.
            </div>
          </div>
        </div>

        {/* ── actions ────────────────────────────────────────────────── */}
        <div style={sx.footer}>
          <button onClick={revert} style={sx.btnGhost}>RESET TO STOCK</button>
          <div style={{ flex: 1 }} />
          {savedFlash && <span style={sx.savedFlash}>Build saved</span>}
          <button
            onClick={save}
            disabled={!dirty}
            style={{
              ...sx.btnPrimary,
              opacity: dirty ? 1 : 0.4,
              cursor: dirty ? "pointer" : "default",
            }}
          >
            SAVE BUILD
          </button>
        </div>
      </div>
    </div>
  );
}

function ArrowButton({ dir, onClick, disabled }: { dir: "left" | "right"; onClick: () => void; disabled?: boolean }) {
  const [pressed, setPressed] = useState(false);
  const src = `${UI}/arrow-${dir}${pressed ? "-pressed" : ""}.png`;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        background: "none", border: "none", padding: 4,
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.25 : 1,
      }}
      aria-label={dir === "left" ? "Previous part" : "Next part"}
    >
      <img src={src} alt="" style={{ ...PIXELATED, width: 22, height: 40, display: "block" }} />
    </button>
  );
}

const sx: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed", inset: 0, background: "rgba(5,2,12,.9)", zIndex: 1000,
    display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
  },
  frame: {
    position: "relative", background: "#150c2b",
    // grid interior, matching the Workshop comp's plotting-paper ground
    backgroundImage:
      "linear-gradient(#1e1440 1px, transparent 1px), linear-gradient(90deg, #1e1440 1px, transparent 1px)",
    backgroundSize: "24px 24px",
    border: "2px solid #3d2a63", borderRadius: 10, padding: 16,
    width: "min(860px,100%)", maxHeight: "100%", overflowY: "auto",
    fontFamily: "system-ui,sans-serif",
    boxShadow: "0 0 0 1px #2ee6a833, 0 12px 48px rgba(0,0,0,.6)",
  },
  corner: {
    position: "absolute", width: 16, height: 16,
    borderStyle: "solid", borderColor: "#2ee6a8", pointerEvents: "none",
  },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  title: { margin: 0, fontSize: 16, color: "#2ee6a8", letterSpacing: 3, fontWeight: 800 },
  close: { background: "none", border: "none", color: "#9d8fc4", fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 0 },
  sectionLabel: { fontSize: 9, color: "#7a68a8", letterSpacing: 2, margin: "0 0 6px" },
  chassisRow: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 14 },
  chassisChip: {
    padding: "6px 12px", borderRadius: 6, border: "1px solid #3d2a63",
    fontSize: 12, fontWeight: 700, cursor: "pointer",
  },
  lockedNote: { fontSize: 10, color: "#5a4a7a", marginLeft: 4 },
  body: { display: "grid", gridTemplateColumns: "minmax(150px,1fr) minmax(220px,1.5fr) minmax(170px,1.1fr)", gap: 12 },
  previewPanel: {
    background: "#120a24", border: "1px solid #2a1c4d", borderRadius: 8,
    padding: 10, textAlign: "center",
  },
  previewName: { color: "#fff", fontSize: 14, fontWeight: 700, marginTop: 4 },
  previewRole: { color: "#2ee6a8", fontSize: 10, marginBottom: 6 },
  passives: { display: "flex", flexDirection: "column", gap: 3 },
  passive: { fontSize: 9, color: "#9d8fc4", background: "#1a1030", borderRadius: 4, padding: "3px 5px" },
  editorPanel: { background: "#120a24", border: "1px solid #2a1c4d", borderRadius: 8, padding: 10 },
  slotTabs: { display: "flex", alignItems: "center", gap: 4, marginBottom: 10 },
  slotTab: {
    background: "none", border: "2px solid transparent", borderRadius: 6,
    padding: 2, cursor: "pointer", lineHeight: 0,
  },
  lockToggle: {
    display: "flex", alignItems: "center", gap: 4,
    fontSize: 9, color: "#7a68a8", cursor: "pointer", userSelect: "none",
  },
  cycler: { display: "flex", alignItems: "center", gap: 4, marginBottom: 8 },
  cyclerBody: { flex: 1, textAlign: "center", minWidth: 0 },
  slotLabel: { fontSize: 9, color: "#7a68a8", letterSpacing: 1 },
  partName: { fontSize: 14, color: "#fff", fontWeight: 700, lineHeight: 1.3 },
  partMeta: { fontSize: 9, color: "#5a4a7a", fontFamily: "monospace" },
  crossFamily: { color: "#ffa726" },
  counter: { color: "#7a68a8", marginLeft: 6 },
  hint: { fontSize: 9, color: "#ffa726", marginBottom: 8, lineHeight: 1.5 },
  moveList: { display: "flex", flexDirection: "column", gap: 4 },
  moveRow: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    background: "#1a1030", borderRadius: 5, padding: "6px 8px",
  },
  moveName: { fontSize: 11, color: "#c3b8e0", fontWeight: 600 },
  moveMeta: { fontSize: 9, color: "#7a68a8" },
  moveDmg: { fontSize: 14, color: "#2ee6a8", fontWeight: 700, fontFamily: "monospace" },
  statsPanel: { background: "#120a24", border: "1px solid #2a1c4d", borderRadius: 8, padding: 10 },
  statHead: { display: "flex", justifyContent: "space-between", fontSize: 10, fontFamily: "monospace" },
  statValue: { color: "#fff", fontWeight: 700 },
  statTrack: { position: "relative", height: 6, background: "#1a1030", borderRadius: 3, overflow: "hidden", marginTop: 2 },
  statFillBase: { position: "absolute", left: 0, top: 0, height: "100%", background: "#6b8cff" },
  statFillParts: { position: "absolute", top: 0, height: "100%", background: "#2ee6a8", opacity: 0.65 },
  statFootnote: { fontSize: 9, color: "#5a4a7a", lineHeight: 1.5, marginTop: 8 },
  footer: { display: "flex", alignItems: "center", gap: 8, marginTop: 14 },
  btnGhost: {
    background: "none", border: "1px solid #3d2a63", color: "#9d8fc4",
    borderRadius: 6, padding: "9px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer",
  },
  btnPrimary: {
    background: "#2ee6a8", border: "none", color: "#0d0718",
    borderRadius: 6, padding: "10px 20px", fontSize: 12, fontWeight: 800,
  },
  savedFlash: { fontSize: 10, color: "#2ee6a8" },
};
