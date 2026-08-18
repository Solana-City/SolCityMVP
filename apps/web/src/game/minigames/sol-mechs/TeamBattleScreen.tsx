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
  createTeamBattle, resolveTeamRound, resolveForcedSwitches, forfeitTeam, activeUnit, switchableIndices,
  type TeamBattleState, type TeamAction, type TeamEvent, type TeamRoundActions,
} from "@/game/solmechs/engine/TeamBattle";
import { availableMoves, legalTargets, calculateDamage, isDefeated } from "@/game/solmechs/engine/BattleEngine";
import type { PlayerSide } from "@/game/solmechs/engine/BattleEngine";
import { BattleRenderer, splitIntoBeats, CANVAS_W, CANVAS_H } from "@/game/solmechs/render/BattleRenderer";
import { preloadBuild } from "@/game/solmechs/render/MechPaperDoll";
import type { TeamBuild } from "@/game/solmechs/data/team";
import type { ModuleSlot, MoveDefinition } from "@/game/solmechs/data/types";
import { BattleLog } from "./BattleLog";
import { useChessClock } from "./ClockBar";
import { UnitPanel } from "./BattleHud";
import { SQUAD_CLOCK, formatClock } from "@/game/solmechs/data/clock";
import { C, T, SP, R, W, PANEL_HEIGHT, actionButton } from "./theme";

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


const SLOT_LABEL: Record<ModuleSlot, string> = {
  rightArm: "R.Arm", leftArm: "L.Arm", lowerBody: "Legs", matrix: "MATRIX",
};

/** ms the AI "thinks" for, so its turn is legible rather than instant. */
const AI_DELAY = 620;
/** Pause after a substitution so the replacement registers before it is hit. */
const SWITCH_LEAD_IN = 420;

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
    const s = createTeamBattle(playerTeam, enemyTeam, { p1Name: "You", p2Name: "Rival" });
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

  /** Runs while the round is being chosen; stops while it resolves. */
  const thinking: PlayerSide[] =
    state.status.kind === "active" && !animating && !busy ? ["p1", "p2"] : [];

  const { clock, credit } = useChessClock({
    config: SQUAD_CLOCK,
    thinking,
    paused: state.status.kind === "finished",
    onTimeout: (side) => {
      const cur = stateRef.current;
      if (!cur || cur.status.kind === "finished") return;
      const { state: ended } = forfeitTeam(cur, side, "timeout");
      setLog((prev) => [`  ** ${side === "p1" ? "You" : "Rival"} ran out of time.`, ...prev]);
      stateRef.current = ended;
      setState(ended);
    },
  });

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
      case "forfeit": return `  ** ${who(e.side)} ran out of time.`;
      case "victory": return `=== ${who(e.winner)} win${e.winner === "p1" ? "" : "s"}! ===`;
      case "rejected": return `  ${e.reason}.`;
      default: return null;
    }
  }, []);

  /** The rival's pick for a round, chosen WITHOUT seeing the player's. */
  const rivalChoice = useCallback((s: TeamBattleState): TeamAction | null => {
    const me = activeUnit(s.p2);
    const foe = activeUnit(s.p1);
    const opts = availableMoves(me).filter((o) => o.move.targetType !== "self");
    if (opts.length === 0) {
      const sw = switchableIndices(s.p2);
      if (sw.length) return { kind: "switch", side: "p2", toIndex: sw[0] };
      const all = availableMoves(me);
      return all.length
        ? { kind: "move", side: "p2", sourceSlot: all[0].slot, moveIndex: all[0].moveIndex, targetSlot: all[0].slot }
        : null;
    }
    const targets = legalTargets(foe);
    let best: { a: TeamAction; sc: number } | null = null;
    for (const o of opts) for (const t of targets) {
      let sc = calculateDamage(o.move, me, foe, o.slot, t);
      if (t === "matrix") sc *= 2;
      if (sc >= foe.partStatuses[t].currentHP) sc += 45;
      if (!best || sc > best.sc) {
        best = { a: { kind: "move", side: "p2", sourceSlot: o.slot, moveIndex: o.moveIndex, targetSlot: t }, sc };
      }
    }
    return best?.a ?? null;
  }, []);

  const play = useCallback((
    result: { state: TeamBattleState; events: TeamEvent[] },
    moves: Partial<Record<PlayerSide, MoveDefinition | undefined>> = {},
  ) => {
    const lines = result.events.map((e) => describe(e, result.state)).filter((l): l is string => l !== null);
    setLog((prev) => [...lines.reverse(), ...prev].slice(0, 60));

    const renderer = rendererRef.current;
    const after = { p1: activeUnit(result.state.p1), p2: activeUnit(result.state.p2) };

    // Substitutions resolve before any attack, so the replacement has to be on
    // screen before the beats that follow it — but NOT before the round starts,
    // or the outgoing mech never gets to be seen leaving.
    const switched = result.events.some((e) => e.type === "switch");
    const beats = splitIntoBeats(result.events.filter(isBattleEvent), moves);
    if (beats.length === 0) {
      renderer?.setState(after);
    } else {
      renderer?.playRound(
        beats.map((b, i) => (i === 0 && switched
          ? { ...b, unitsAt: after, leadIn: SWITCH_LEAD_IN }
          : i === 0 ? { ...b, unitsAt: after } : b)),
      );
    }
    stateRef.current = result.state;
    setState(result.state);

    const wait = renderer?.remainingMs() ?? 0;
    setAnimating(true);
    window.setTimeout(() => { setAnimating(false); setBusy(false); }, Math.max(wait, 200));
  }, [describe]);

  /** Player commits their action; the rival commits blind; the round resolves. */
  const submitRound = useCallback((action: TeamAction | null) => {
    const cur = stateRef.current;
    if (!cur || cur.status.kind !== "active") return;
    setBusy(true);
    credit("p1");
    credit("p2");
    const rival = rivalChoice(cur);
    const round: TeamRoundActions = { p1: action, p2: rival };
    // Moves are read from the PRE-round state; afterwards the limb that fired
    // may already be gone, or the mech may have been substituted out.
    const moveOf = (a: TeamAction | null, side: PlayerSide) =>
      a?.kind === "move"
        ? activeUnit(side === "p1" ? cur.p1 : cur.p2).parts[a.sourceSlot]?.moves[a.moveIndex]
        : undefined;
    play(resolveTeamRound(cur, round), { p1: moveOf(action, "p1"), p2: moveOf(rival, "p2") });
  }, [rivalChoice, play, credit]);

  /** Forced substitution after a KO — free, and both sides send in together. */
  const submitForced = useCallback((myIndex?: number) => {
    const cur = stateRef.current;
    if (!cur || cur.status.kind !== "awaiting-switch") return;
    setBusy(true);
    const picks: Partial<Record<"p1" | "p2", number>> = {};
    if (cur.status.sides.includes("p1") && myIndex !== undefined) picks.p1 = myIndex;
    if (cur.status.sides.includes("p2")) {
      const opts = switchableIndices(cur.p2);
      if (opts.length) picks.p2 = opts[0];
    }
    play(resolveForcedSwitches(cur, picks));
  }, [play]);

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

  // A forced substitution the player doesn't owe (only the rival lost a mech)
  // resolves itself, so the match never waits on a choice nobody has to make.
  useEffect(() => {
    if (state.status.kind !== "awaiting-switch" || animating || busy) return;
    if (state.status.sides.includes("p1")) return;
    const t = setTimeout(() => submitForced(), AI_DELAY);
    return () => clearTimeout(t);
  }, [state, animating, busy, submitForced]);

  // Settle once, when it's over.
  useEffect(() => {
    if (state.status.kind !== "finished" || settledRef.current) return;
    settledRef.current = true;
    onFinished(state.status.winner === "p1", state);
  }, [state, onFinished]);

  const canAct = state.status.kind === "active" && !busy && !animating;
  const mustSwitch = state.status.kind === "awaiting-switch" && state.status.sides.includes("p1") && !busy && !animating;
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

        {/* Same arrangement as the 1v1: the arena is the backdrop and the two
            HUDs sit over its top corners. See BattleHud for the measurements. */}
        <div style={sx.stage}>
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            style={sx.canvas}
          />
          <div style={sx.hudLeft}>
            <UnitPanel
              unit={me}
              name="You"
              clock={formatClock(clock.p1)}
              live={thinking.includes("p1")}
              low={clock.p1 <= SQUAD_CLOCK.warnAtMs}
            />
          </div>
          <span style={sx.roundChip}>ROUND {state.round}</span>
          <div style={sx.hudRight}>
            <UnitPanel
              unit={foe}
              name="Rival"
              clock={formatClock(clock.p2)}
              live={thinking.includes("p2")}
              low={clock.p2 <= SQUAD_CLOCK.warnAtMs}
              align="right"
            />
          </div>
        </div>

        <div style={sx.footRow}>
        <div style={sx.controls}>
          {finished ? (
            <div style={{ textAlign: "center", width: "100%" }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: won ? C.teal : C.bad }}>
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
                  <button key={i} onClick={() => submitForced(i)} style={sx.btn}>
                    <div style={sx.btnTitle}>#{i + 1} {state.p1.units[i].matrix.matrixName}</div>
                    <div style={sx.btnSub}>Matrix {state.p1.units[i].partStatuses.matrix.currentHP}</div>
                  </button>
                ))}
              </div>
            </>
          ) : !canAct ? (
            <div style={sx.prompt}>Resolving…</div>
          ) : picking ? (
            <>
              <div style={sx.prompt}>
                Substitute — this is your action for the round.
              </div>
              <div style={sx.btnRow}>
                {bench.map((i) => (
                  <button
                    key={i}
                    onClick={() => { setPicking(false); submitForced(i); }}
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
                      submitRound({ kind: "move", side: "p1", sourceSlot: pending.slot, moveIndex: pending.moveIndex, targetSlot: slot });
                      setPending(null);
                    }}
                    style={{ ...sx.btn, background: slot === "matrix" ? "#5c1830" : C.raised }}
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
                        submitRound({ kind: "move", side: "p1", sourceSlot: o.slot, moveIndex: o.moveIndex, targetSlot: o.slot });
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
                {bench.length > 0 && (
                  <button onClick={() => setPicking(true)} style={{ ...sx.btn, borderColor: C.blue }}>
                    <div style={{ ...sx.btnTitle, color: C.blue }}>SUBSTITUTE</div>
                    {/* Reads the live rule rather than asserting one, so the
                        label can't lie if the default is changed. */}
                    <div style={sx.btnSub}>your action this round</div>
                  </button>
                )}
              </div>
            </>
          )}
        </div>

          <div style={sx.logColumn}>
            <BattleLog lines={log} turns={state.history.length} />
          </div>
        </div>
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
                fontSize: 12, padding: "3px 7px", borderRadius: 4, fontWeight: 700,
                border: `1px solid ${active ? C.teal : down ? "#4a2030" : C.line}`,
                background: active ? C.raised : down ? "#2a0f18" : C.raised,
                color: down ? C.faint : active ? C.teal : C.dim,
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

const sx: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed", inset: 0, background: "rgba(4,2,10,.9)", zIndex: 1000,
    display: "flex", alignItems: "center", justifyContent: "center", padding: 12,
  },
  frame: {
    background: C.panel, border: `2px solid ${C.line}`, borderRadius: 10, padding: 16,
    width: W.battle, height: PANEL_HEIGHT, overflow: "hidden",
    display: "flex", flexDirection: "column", gap: SP.sm, fontFamily: "system-ui,sans-serif",
  },
  header: { display: "flex", alignItems: "center", gap: SP.md, flexShrink: 0 },
  title: { margin: 0, fontSize: 16, color: C.teal, letterSpacing: 4, fontWeight: 800 },
  close: { background: "none", border: "none", color: C.dim, fontSize: 24, cursor: "pointer", lineHeight: 1, padding: 0 },
  squadRow: { display: "flex", gap: SP.md, flexWrap: "wrap", flexShrink: 0 },
  squadLabel: { fontSize: 12, color: C.faint, letterSpacing: 2, marginBottom: 3 },
  /**
   * The arena, sized to the canvas's own aspect so it fills the stage exactly
   * rather than being letterboxed into a wide box. See the 1v1 for why.
   */
  stage: {
    position: "relative", flex: 1, minHeight: 0, alignSelf: "center",
    aspectRatio: `${CANVAS_W} / ${CANVAS_H}`, maxWidth: "100%",
    overflow: "hidden", borderRadius: R.md,
    border: `2px solid ${C.line}`, background: C.ink,
  },
  canvas: {
    position: "absolute", inset: 0, width: "100%", height: "100%",
    objectFit: "contain", imageRendering: "pixelated", display: "block",
  },
  hudLeft: { position: "absolute", left: "1.5%", top: "2.5%", width: "31%" },
  hudRight: { position: "absolute", right: "1.5%", top: "2.5%", width: "31%" },
  roundChip: {
    position: "absolute", left: "50%", top: "3%", transform: "translateX(-50%)",
    fontSize: T.eyebrow, letterSpacing: 2, fontWeight: 700, color: C.text,
    background: "rgba(11,6,22,.82)", border: `1px solid ${C.line}`,
    borderRadius: R.pill, padding: "4px 12px", whiteSpace: "nowrap",
  },
  /** Actions on the left, combat log on the right — the Unity arrangement. */
  footRow: { display: "flex", gap: SP.md, flexShrink: 0, alignItems: "flex-start" },
  controls: { flex: "1 1 340px", minWidth: 0, minHeight: 96 },
  logColumn: { flex: "1 1 340px", minWidth: 0 },
  prompt: { fontSize: 12, color: C.dim, marginBottom: 6, letterSpacing: 1 },
  btnRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  btn: { ...actionButton(), minWidth: 112 },
  btnTitle: { fontSize: 12, fontWeight: 700 },
  btnSub: { fontSize: 12, color: C.faint, marginTop: 1 },
  hint: { fontSize: 12, color: C.faint, marginTop: 6 },
  btnPrimary: {
    background: C.teal, border: "none", color: C.ink, borderRadius: 6,
    padding: "11px 24px", fontSize: 13, fontWeight: 800, letterSpacing: 1, cursor: "pointer",
  },
};
