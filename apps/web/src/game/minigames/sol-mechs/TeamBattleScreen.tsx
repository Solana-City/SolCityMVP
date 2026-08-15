"use client";

/**
 * Sol Mechs — 3v3 battle screen.
 *
 * Same scene renderer as the 1v1; it is handed the two ACTIVE mechs and never
 * learns there are reserves. Everything team-specific lives here: the squad
 * bar, the substitute picker, and the forced swap after a mech goes down.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createTeamBattle, resolveTeamAction, activeUnit, switchableIndices,
  type TeamBattleState, type TeamAction, type TeamEvent,
} from "@/game/solmechs/engine/TeamBattle";
import { availableMoves, legalTargets, calculateDamage, isDefeated } from "@/game/solmechs/engine/BattleEngine";
import type { PlayerSide } from "@/game/solmechs/engine/BattleEngine";
import { BattleRenderer, CANVAS_W, CANVAS_H } from "@/game/solmechs/render/BattleRenderer";
import { preloadBuild } from "@/game/solmechs/render/MechPaperDoll";
import type { TeamBuild } from "@/game/solmechs/data/team";
import type { ModuleSlot, MoveDefinition } from "@/game/solmechs/data/types";
import { BattleLog } from "./BattleLog";

/**
 * Narrows the team log to the events BattleRenderer understands. Switches and
 * KOs are team-level concepts with no scene animation of their own.
 */
const BATTLE_EVENT_TYPES = new Set([
  "attack", "damage", "heal", "stage", "part-broken", "matrix-unlocked",
]);
function isBattleEvent(e: TeamEvent): e is Extract<TeamEvent, { type: string }> & BattleEventLike {
  return BATTLE_EVENT_TYPES.has(e.type);
}
type BattleEventLike = Parameters<BattleRenderer["playEvents"]>[0][number];

const C = {
  teal: "#21dda0", ink: "#0b0616", panel: "#150c2b", panelHi: "#1d1140",
  line: "#33235c", text: "#e8e2f7", dim: "#9d8fc4", faint: "#6b5c92",
  danger: "#ff5468", blue: "#6686db",
};

const SLOT_LABEL: Record<ModuleSlot, string> = {
  rightArm: "R.Arm", leftArm: "L.Arm", lowerBody: "Legs", matrix: "MATRIX",
};

/** ms the AI "thinks" for, so its turn is legible rather than instant. */
const AI_DELAY = 620;

export interface TeamBattleScreenProps {
  playerTeam: TeamBuild;
  enemyTeam: TeamBuild;
  onFinished: (playerWon: boolean, state: TeamBattleState) => void;
  onClose: () => void;
}

export default function TeamBattleScreen({ playerTeam, enemyTeam, onFinished, onClose }: TeamBattleScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<BattleRenderer | null>(null);
  const stateRef = useRef<TeamBattleState | null>(null);

  const [state, setState] = useState<TeamBattleState>(() => {
    const s = createTeamBattle(playerTeam, enemyTeam, {
      p1Name: "You", p2Name: "Rival", firstMove: "speed",
    });
    stateRef.current = s;
    return s;
  });
  const [log, setLog] = useState<string[]>(["Squad battle — 3 v 3."]);
  const [pending, setPending] = useState<{ slot: Exclude<ModuleSlot, "matrix">; moveIndex: number } | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  /** True while the renderer is mid-sequence; blocks input and the rival. */
  const [animating, setAnimating] = useState(false);
  const settledRef = useRef(false);

  useEffect(() => {
    for (const b of [...playerTeam.mechs, ...enemyTeam.mechs]) preloadBuild(b);
  }, [playerTeam, enemyTeam]);

  const describe = useCallback((e: TeamEvent, s: TeamBattleState): string | null => {
    const who = (side: PlayerSide) => (side === "p1" ? "You" : "Rival");
    switch (e.type) {
      case "attack": return `${who(e.side)} used ${e.moveName}.`;
      case "damage": return `  ${who(e.side)} ${SLOT_LABEL[e.targetSlot]} −${e.amount} (${e.remaining} left).`;
      case "heal": return `  ${who(e.side)} ${SLOT_LABEL[e.targetSlot]} +${e.amount}.`;
      case "stage": return `  ${who(e.side)} ${SLOT_LABEL[e.targetSlot]} ${e.stat} ${e.delta > 0 ? "up" : "down"}.`;
      case "part-broken": return `  ** ${e.partName} destroyed.`;
      case "matrix-unlocked": return `  ** ${who(e.side)} MATRIX exposed.`;
      case "switch": return `${who(e.side)} sent out ${e.mechName}.`;
      case "mech-down":
        return `  ** ${who(e.side)} #${e.index + 1} ${e.mechName} is down (${
          e.cause === "matrix-destroyed" ? "core destroyed" : "all limbs stripped"
        }).`;
      case "must-switch": return `${who(e.side)} must substitute.`;
      case "victory": return `=== ${who(e.winner)} win${e.winner === "p1" ? "" : "s"}! ===`;
      case "rejected": return `  ${e.reason}.`;
      default: return null;
    }
  }, []);

  const apply = useCallback((action: TeamAction) => {
    const cur = stateRef.current;
    if (!cur) return;

    // Resolve the move from the PRE-resolution state so the renderer can pick
    // its effect; after resolution that limb may already be gone.
    let move: MoveDefinition | undefined;
    if (action.kind === "move") {
      const side = action.side === "p1" ? cur.p1 : cur.p2;
      move = activeUnit(side).parts[action.sourceSlot]?.moves[action.moveIndex];
    }

    const { state: next, events } = resolveTeamAction(cur, action);
    const lines = events.map((e) => describe(e, next)).filter((l): l is string => l !== null);
    setLog((prev) => [...lines.reverse(), ...prev].slice(0, 60));

    const renderer = rendererRef.current;
    // The renderer only ever sees the two mechs on the field, and only the
    // battle-level events — switches and KOs are team concepts it has no
    // notion of, and are narrated in the log instead.
    renderer?.setState({ p1: activeUnit(next.p1), p2: activeUnit(next.p2) });
    renderer?.playEvents(events.filter(isBattleEvent), move);
    stateRef.current = next;
    setState(next);

    const wait = renderer?.remainingMs() ?? 0;
    if (wait > 0) {
      setAnimating(true);
      window.setTimeout(() => setAnimating(false), wait);
    }
  }, [describe]);

  // Renderer lifetime.
  useEffect(() => {
    const canvas = canvasRef.current;
    const init = stateRef.current;
    if (!canvas || !init) return;
    const r = new BattleRenderer(canvas, { p1: activeUnit(init.p1), p2: activeUnit(init.p2) });
    rendererRef.current = r;
    r.start();
    return () => { r.destroy(); rendererRef.current = null; };
  }, []);

  // The rival: forced substitutions first, then its move.
  useEffect(() => {
    if (state.status.kind === "finished") return;
    const isRivalSwitch = state.status.kind === "awaiting-switch" && state.status.side === "p2";
    const isRivalTurn = state.status.kind === "active" && state.status.turn === "p2";
    if (!isRivalSwitch && !isRivalTurn) return;
    // Let the player's hit finish playing before the rival answers.
    if (animating) return;

    let cancelled = false;
    setBusy(true);
    const t = setTimeout(() => {
      if (cancelled) return;
      const s = stateRef.current;
      if (!s) return;

      if (s.status.kind === "awaiting-switch" && s.status.side === "p2") {
        const opts = switchableIndices(s.p2);
        if (opts.length) apply({ kind: "switch", side: "p2", toIndex: opts[0] });
        setBusy(false);
        return;
      }

      const me = activeUnit(s.p2);
      const foe = activeUnit(s.p1);
      const opts = availableMoves(me).filter((o) => o.move.targetType !== "self");
      if (opts.length === 0) {
        // Nothing offensive left — substitute if there's anyone to send.
        const sw = switchableIndices(s.p2);
        if (sw.length) apply({ kind: "switch", side: "p2", toIndex: sw[0] });
        else {
          const all = availableMoves(me);
          if (all.length) {
            apply({ kind: "move", side: "p2", sourceSlot: all[0].slot, moveIndex: all[0].moveIndex, targetSlot: all[0].slot });
          }
        }
        setBusy(false);
        return;
      }

      const targets = legalTargets(foe);
      let best: { a: TeamAction; sc: number } | null = null;
      for (const o of opts) for (const t2 of targets) {
        let sc = calculateDamage(o.move, me, foe, o.slot, t2);
        if (t2 === "matrix") sc *= 2;
        if (sc >= foe.partStatuses[t2].currentHP) sc += 45;
        if (!best || sc > best.sc) {
          best = { a: { kind: "move", side: "p2", sourceSlot: o.slot, moveIndex: o.moveIndex, targetSlot: t2 }, sc };
        }
      }
      if (best) apply(best.a);
      setBusy(false);
    }, AI_DELAY);

    return () => { cancelled = true; clearTimeout(t); setBusy(false); };
  }, [state, apply, animating]);

  // Settle once, when it's over.
  useEffect(() => {
    if (state.status.kind !== "finished" || settledRef.current) return;
    settledRef.current = true;
    onFinished(state.status.winner === "p1", state);
  }, [state, onFinished]);

  const myTurn = state.status.kind === "active" && state.status.turn === "p1" && !busy && !animating;
  const mustSwitch = state.status.kind === "awaiting-switch" && state.status.side === "p1";
  const me = activeUnit(state.p1);
  const foe = activeUnit(state.p2);
  const moves = useMemo(() => availableMoves(me), [me]);
  const targets = useMemo(() => legalTargets(foe), [foe]);
  const bench = switchableIndices(state.p1);

  const finished = state.status.kind === "finished";
  const won = finished && state.status.kind === "finished" && state.status.winner === "p1";

  return (
    <div style={sx.backdrop}>
      <div style={sx.frame}>
        <header style={sx.header}>
          <h2 style={sx.title}>SQUAD BATTLE</h2>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={sx.close} aria-label="Close">×</button>
        </header>

        <div style={sx.squadRow}>
          <SquadBar state={state} side="p1" label="YOUR SQUAD" />
          <SquadBar state={state} side="p2" label="RIVAL" align="right" />
        </div>

        <div style={sx.statusRow}>
          <UnitBars unit={me} />
          <UnitBars unit={foe} align="right" />
        </div>

        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          style={{ imageRendering: "pixelated", width: "100%", borderRadius: 8, border: `2px solid ${C.line}`, display: "block" }}
        />

        <div style={sx.controls}>
          {finished ? (
            <div style={{ textAlign: "center", width: "100%" }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: won ? C.teal : C.danger }}>
                {won ? "SQUAD VICTORY" : "SQUAD DEFEATED"}
              </div>
              <div style={{ color: C.faint, fontSize: 12, margin: "4px 0 12px" }}>
                {state.history.length} actions
              </div>
              <button onClick={onClose} style={sx.btnPrimary}>LEAVE</button>
            </div>
          ) : mustSwitch ? (
            <>
              <div style={sx.prompt}>Your mech is down — send out a replacement (free).</div>
              <div style={sx.btnRow}>
                {bench.map((i) => (
                  <button key={i} onClick={() => apply({ kind: "switch", side: "p1", toIndex: i })} style={sx.btn}>
                    <div style={sx.btnTitle}>#{i + 1} {state.p1.units[i].matrix.matrixName}</div>
                    <div style={sx.btnSub}>Matrix {state.p1.units[i].partStatuses.matrix.currentHP}</div>
                  </button>
                ))}
              </div>
            </>
          ) : !myTurn ? (
            <div style={sx.prompt}>Rival is choosing…</div>
          ) : picking ? (
            <>
              <div style={sx.prompt}>
                {state.rules.switchCost === "turn"
                  ? "Substitute — costs your turn."
                  : "Substitute — free, then act with the new mech."}
              </div>
              <div style={sx.btnRow}>
                {bench.map((i) => (
                  <button
                    key={i}
                    onClick={() => { setPicking(false); apply({ kind: "switch", side: "p1", toIndex: i }); }}
                    style={sx.btn}
                  >
                    <div style={sx.btnTitle}>#{i + 1} {state.p1.units[i].matrix.matrixName}</div>
                    <div style={sx.btnSub}>Matrix {state.p1.units[i].partStatuses.matrix.currentHP}</div>
                  </button>
                ))}
                <button onClick={() => setPicking(false)} style={sx.btn}>
                  <div style={sx.btnTitle}>Back</div>
                </button>
              </div>
            </>
          ) : pending ? (
            <>
              <div style={sx.prompt}>Target for {me.parts[pending.slot].moves[pending.moveIndex].name}</div>
              <div style={sx.btnRow}>
                {targets.map((slot) => (
                  <button
                    key={slot}
                    onClick={() => {
                      apply({ kind: "move", side: "p1", sourceSlot: pending.slot, moveIndex: pending.moveIndex, targetSlot: slot });
                      setPending(null);
                    }}
                    style={{ ...sx.btn, background: slot === "matrix" ? "#5c1830" : C.panelHi }}
                  >
                    <div style={sx.btnTitle}>{SLOT_LABEL[slot]}</div>
                    <div style={sx.btnSub}>{foe.partStatuses[slot].currentHP} HP</div>
                  </button>
                ))}
                <button onClick={() => setPending(null)} style={sx.btn}>
                  <div style={sx.btnTitle}>Back</div>
                </button>
              </div>
              {!targets.includes("matrix") && (
                <div style={sx.hint}>Matrix sealed — break an arm, or strip all three limbs.</div>
              )}
            </>
          ) : (
            <>
              <div style={sx.prompt}>Choose an action</div>
              <div style={sx.btnRow}>
                {moves.map((o) => (
                  <button
                    key={`${o.slot}-${o.moveIndex}`}
                    onClick={() => {
                      if (o.move.targetType === "self") {
                        apply({ kind: "move", side: "p1", sourceSlot: o.slot, moveIndex: o.moveIndex, targetSlot: o.slot });
                      } else {
                        setPending({ slot: o.slot, moveIndex: o.moveIndex });
                      }
                    }}
                    style={sx.btn}
                  >
                    <div style={sx.btnTitle}>{o.move.name}</div>
                    <div style={sx.btnSub}>
                      {SLOT_LABEL[o.slot]} · {o.move.baseDamage > 0 ? `${o.move.baseDamage} ${o.move.damageType}` : o.move.effect || "Effect"}
                    </div>
                  </button>
                ))}
                {bench.length > 0 && !(state.rules.switchCost === "free" && state.freeSwitchUsed) && (
                  <button onClick={() => setPicking(true)} style={{ ...sx.btn, borderColor: C.blue }}>
                    <div style={{ ...sx.btnTitle, color: C.blue }}>SUBSTITUTE</div>
                    {/* Reads the live rule rather than asserting one, so the
                        label can't lie if the default is changed. */}
                    <div style={sx.btnSub}>
                      {state.rules.switchCost === "turn" ? "costs your turn" : "free · then act"}
                    </div>
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <BattleLog lines={log} turns={state.history.length} />
      </div>
    </div>
  );
}

function SquadBar({ state, side, label, align }: {
  state: TeamBattleState; side: PlayerSide; label: string; align?: "right";
}) {
  const s = side === "p1" ? state.p1 : state.p2;
  return (
    <div style={{ flex: 1, textAlign: align ?? "left", minWidth: 0 }}>
      <div style={sx.squadLabel}>{label}</div>
      <div style={{ display: "flex", gap: 4, justifyContent: align ? "flex-end" : "flex-start" }}>
        {s.units.map((u, i) => {
          const down = isDefeated(u);
          const active = i === s.activeIndex;
          return (
            <span
              key={i}
              title={u.matrix.matrixName}
              style={{
                fontSize: 10, padding: "3px 7px", borderRadius: 4, fontWeight: 700,
                border: `1px solid ${active ? C.teal : down ? "#4a2030" : C.line}`,
                background: active ? "#25184a" : down ? "#2a0f18" : C.panelHi,
                color: down ? "#7a4a58" : active ? C.teal : C.dim,
                textDecoration: down ? "line-through" : "none",
                whiteSpace: "nowrap",
              }}
            >
              {u.matrix.matrixName}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function UnitBars({ unit, align }: { unit: TeamBattleState["p1"]["units"][number]; align?: "right" }) {
  const rows: ModuleSlot[] = ["matrix", "rightArm", "leftArm", "lowerBody"];
  return (
    <div style={{ flex: 1, textAlign: align ?? "left", minWidth: 0 }}>
      {rows.map((slot) => {
        const st = unit.partStatuses[slot];
        const pct = st.maxHP > 0 ? Math.max(0, st.currentHP / st.maxHP) * 100 : 0;
        const dead = st.currentHP <= 0;
        return (
          <div key={slot} style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
            <span style={{ fontSize: 9, color: dead ? "#5a4a7a" : C.faint, width: 44, fontFamily: "monospace" }}>
              {SLOT_LABEL[slot]}
            </span>
            <div style={{ flex: 1, height: 6, background: "#120a24", borderRadius: 3, overflow: "hidden" }}>
              <div style={{
                width: `${pct}%`, height: "100%", transition: "width .25s",
                background: dead ? "#5a2a3a" : slot === "matrix" ? C.teal : C.blue,
              }} />
            </div>
            <span style={{ fontSize: 9, color: C.faint, width: 28, fontFamily: "monospace" }}>{st.currentHP}</span>
          </div>
        );
      })}
    </div>
  );
}

const sx: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed", inset: 0, background: "rgba(4,2,10,.9)", zIndex: 1000,
    display: "flex", alignItems: "center", justifyContent: "center", padding: 12,
  },
  frame: {
    background: C.panel, border: `2px solid ${C.line}`, borderRadius: 10, padding: 16,
    width: "min(760px, 100%)", maxHeight: "100%", overflowY: "auto", overflowX: "hidden",
    display: "flex", flexDirection: "column", gap: 8, fontFamily: "system-ui,sans-serif",
  },
  header: { display: "flex", alignItems: "center", gap: 10 },
  title: { margin: 0, fontSize: 16, color: C.teal, letterSpacing: 4, fontWeight: 800 },
  close: { background: "none", border: "none", color: C.dim, fontSize: 24, cursor: "pointer", lineHeight: 1, padding: 0 },
  squadRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  squadLabel: { fontSize: 9, color: C.faint, letterSpacing: 2, marginBottom: 3 },
  statusRow: { display: "flex", gap: 12, flexWrap: "wrap" },
  controls: { minHeight: 74 },
  prompt: { fontSize: 11, color: C.dim, marginBottom: 6, letterSpacing: 1 },
  btnRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  btn: {
    background: C.panelHi, color: C.text, border: `1px solid ${C.line}`, borderRadius: 6,
    padding: "8px 12px", cursor: "pointer", textAlign: "left", minWidth: 104,
  },
  btnTitle: { fontSize: 12, fontWeight: 700 },
  btnSub: { fontSize: 10, color: C.faint, marginTop: 1 },
  hint: { fontSize: 10, color: C.faint, marginTop: 6 },
  btnPrimary: {
    background: C.teal, border: "none", color: C.ink, borderRadius: 6,
    padding: "11px 24px", fontSize: 13, fontWeight: 800, letterSpacing: 1, cursor: "pointer",
  },
  log: {
    height: 84, overflowY: "auto", background: "#120a24", border: `1px solid ${C.line}`,
    borderRadius: 6, padding: 8, fontSize: 11, fontFamily: "monospace",
    color: "#c3b8e0", lineHeight: 1.6,
  },
};
