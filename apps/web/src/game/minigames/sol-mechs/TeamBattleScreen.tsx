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
  type TeamBattleState, type TeamAction, type TeamEvent, type TeamRoundActions, type TeamResolveResult,
} from "@/game/solmechs/engine/TeamBattle";
import {
  availableMoves, legalTargets, legalSelfTargets, isDefeated,
} from "@/game/solmechs/engine/BattleEngine";
import type { SquadOpponent } from "@/game/solmechs/opponent/SquadOpponent";
import type { PlayerSide } from "@/game/solmechs/engine/BattleEngine";
import { BattleRenderer, splitIntoBeats, CANVAS_W, CANVAS_H } from "@/game/solmechs/render/BattleRenderer";
import { preloadBuild } from "@/game/solmechs/render/paperDoll";
import type { TeamBuild } from "@/game/solmechs/data/team";
import type { ModuleSlot, MoveDefinition } from "@/game/solmechs/data/types";
import { BattleLog } from "./BattleLog";
import { useChessClock } from "./ClockBar";
import { UnitPanel } from "./BattleHud";
import { SQUAD_CLOCK, formatClock } from "@/game/solmechs/data/clock";
import { C, T, SP, R, W, PANEL_HEIGHT, actionButton, frame, DISPLAY } from "./theme";

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
  /** The CPU, or another player over a PvP transport. */
  opponent: SquadOpponent;
  onFinished: (playerWon: boolean, state: TeamBattleState) => void;
  onClose: () => void;
}

export default function TeamBattleScreen({ playerTeam, enemyTeam, opponent, onFinished, onClose }: TeamBattleScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hudLeftRef = useRef<HTMLDivElement>(null);
  const hudRightRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<BattleRenderer | null>(null);
  const stateRef = useRef<TeamBattleState | null>(null);

  const [state, setState] = useState<TeamBattleState>(() => {
    const s = createTeamBattle(playerTeam, enemyTeam, {
      p1Name: "You", p2Name: opponent.name,
      // Both come from the opponent, so a remote match agrees on speed ties —
      // see TeamBattle `invertTies`.
      seed: opponent.seed,
      invertTies: opponent.invertTies,
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
  /** True while a remote opponent has not yet answered this step. */
  const [waiting, setWaiting] = useState(false);
  const [netError, setNetError] = useState<string | null>(null);

  /** Runs while the round is being chosen; stops while it resolves. */
  // A remote rival's clock runs on their own client; this one only sees its
  // own. Their timeout reaches us as them leaving the match.
  const thinking: PlayerSide[] =
    state.status.kind === "active" && !animating && !busy
      ? (opponent.remote ? ["p1"] : ["p1", "p2"])
      : [];

  const { clock, credit } = useChessClock({
    config: SQUAD_CLOCK,
    thinking,
    paused: state.status.kind === "finished",
    onTimeout: (side) => {
      const cur = stateRef.current;
      if (!cur || cur.status.kind === "finished") return;
      const { state: ended } = forfeitTeam(cur, side, "timeout");
      setLog((prev) => [`  ** ${side === "p1" ? "You" : opponent.name} ran out of time.`, ...prev]);
      stateRef.current = ended;
      setState(ended);
      if (side === "p1") opponent.resign();
    },
  });

  useEffect(() => {
    for (const b of [...playerTeam.mechs, ...enemyTeam.mechs]) preloadBuild(b);
  }, [playerTeam, enemyTeam]);

  const describe = useCallback((e: TeamEvent, s: TeamBattleState): string | null => {
    const who = (side: PlayerSide) => (side === "p1" ? "You" : opponent.name);
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
      // Engine reasons name slots by their code ("rightArm is broken"); the
      // log is player-facing, so they are swapped for the labels used on screen.
      case "rejected":
        return `  ${e.reason.replace(/\b(rightArm|leftArm|lowerBody)\b/g, (s) => SLOT_LABEL[s as ModuleSlot])}.`;
      default: return null;
    }
  }, [opponent]);

  const play = useCallback((
    result: TeamResolveResult,
    moves: Partial<Record<PlayerSide, MoveDefinition | undefined>> = {},
  ) => {
    const lines = result.events.map((e) => describe(e, result.state)).filter((l): l is string => l !== null);
    setLog((prev) => [...lines.reverse(), ...prev].slice(0, 60));

    const renderer = rendererRef.current;
    const switched = result.events.some((e) => e.type === "switch");

    /*
     * One beat per step, and the BOARD advances with each.
     *
     * The engine returns a snapshot after every acting side, so the screen
     * plays the faster mech's hit, registers its damage, and only then starts
     * the slower one. Applying the whole resolved round up front — which is
     * what this did — dropped both HP bars on the first frame, a second before
     * the animation that was meant to explain the second one.
     */
    const steps = result.steps;
    if (steps.length === 0) {
      renderer?.setState({ p1: activeUnit(result.state.p1), p2: activeUnit(result.state.p2) });
      stateRef.current = result.state;
      setState(result.state);
    } else {
      const starts = renderer?.playRound(steps.map((st, i) => {
        const units = { p1: activeUnit(st.state.p1), p2: activeUnit(st.state.p2) };
        const beat = { events: st.events.filter(isBattleEvent), move: moves[st.side], unitsAt: units };
        // A substitution needs a moment on screen before it is hit.
        return i === 0 && switched ? { ...beat, leadIn: SWITCH_LEAD_IN } : beat;
      })) ?? [];

      steps.forEach((st, i) => {
        window.setTimeout(() => {
          stateRef.current = st.state;
          setState(st.state);
        }, Math.max(0, starts[i] ?? 0));
      });
    }

    const wait = renderer?.remainingMs() ?? 0;
    setAnimating(true);
    window.setTimeout(() => {
      stateRef.current = result.state;
      setState(result.state);
      setAnimating(false);
      setBusy(false);
    }, Math.max(wait, 200));
  }, [describe]);

  /**
   * The player commits; the rival's action arrives through the opponent —
   * picked blind by the CPU, or exchanged commit–reveal with another player.
   */
  const submitRound = useCallback(async (action: TeamAction | null) => {
    const cur = stateRef.current;
    if (!cur || cur.status.kind !== "active") return;
    setBusy(true);
    credit("p1");
    credit("p2");
    let rival: TeamAction | null;
    try {
      setWaiting(opponent.remote);
      rival = await opponent.exchangeRound(cur, action);
    } catch (err) {
      setWaiting(false);
      if (stateRef.current?.status.kind !== "finished") setNetError((err as Error)?.message ?? String(err));
      return;
    }
    setWaiting(false);
    const round: TeamRoundActions = { p1: action, p2: rival };
    // Moves are read from the PRE-round state; afterwards the limb that fired
    // may already be gone, or the mech may have been substituted out.
    const moveOf = (a: TeamAction | null, side: PlayerSide) =>
      a?.kind === "move"
        ? activeUnit(side === "p1" ? cur.p1 : cur.p2).parts[a.sourceSlot]?.moves[a.moveIndex]
        : undefined;
    play(resolveTeamRound(cur, round), { p1: moveOf(action, "p1"), p2: moveOf(rival, "p2") });
  }, [opponent, play, credit]);

  /**
   * Forced substitution after a KO — free, and both sides send in together.
   * It is an exchange even when this side owes nothing, so a remote match
   * stays in step: both clients reach this state at the same moment.
   */
  const submitForced = useCallback(async (myIndex?: number) => {
    const cur = stateRef.current;
    if (!cur || cur.status.kind !== "awaiting-switch") return;
    setBusy(true);
    const owes = cur.status.sides.includes("p1");
    let theirs: number | undefined;
    try {
      setWaiting(opponent.remote);
      theirs = await opponent.exchangeForced(cur, owes ? myIndex : undefined);
    } catch (err) {
      setWaiting(false);
      if (stateRef.current?.status.kind !== "finished") setNetError((err as Error)?.message ?? String(err));
      return;
    }
    setWaiting(false);
    const picks: Partial<Record<"p1" | "p2", number>> = {};
    if (owes && myIndex !== undefined) picks.p1 = myIndex;
    if (cur.status.sides.includes("p2") && theirs !== undefined) picks.p2 = theirs;
    play(resolveForcedSwitches(cur, picks));
  }, [opponent, play]);

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

  // Tell the renderer where the HUD ends, so the mechs can be as big as the
  // arena allows without a head ever running under the stat bars. Measured,
  // not assumed: the HUD is a fixed pixel size while the arena scales with the
  // window, so the share of the arena it covers changes with every resize.
  useEffect(() => {
    const canvas = canvasRef.current;
    const huds = [hudLeftRef.current, hudRightRef.current].filter((h): h is HTMLDivElement => h !== null);
    if (!canvas || huds.length === 0) return;
    const HEAD_GAP = 8;
    const update = () => {
      const top = canvas.getBoundingClientRect().top;
      const bottom = Math.max(...huds.map((h) => h.getBoundingClientRect().bottom));
      rendererRef.current?.setTopInset(bottom - top + HEAD_GAP);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(canvas);
    for (const h of huds) ro.observe(h);
    return () => ro.disconnect();
  }, []);

  // A forced substitution the player doesn't owe (only the rival lost a mech)
  // resolves itself, so the match never waits on a choice nobody has to make.
  useEffect(() => {
    if (state.status.kind !== "awaiting-switch" || animating || busy) return;
    if (state.status.sides.includes("p1")) return;
    const t = setTimeout(() => { void submitForced(); }, opponent.remote ? 150 : AI_DELAY);
    return () => clearTimeout(t);
  }, [state, animating, busy, submitForced, opponent]);

  // A remote opponent leaving — resigning, closing the tab, running out of
  // their own clock — ends the match in this player's favour.
  useEffect(() => opponent.onGone(() => {
    const cur = stateRef.current;
    if (!cur || cur.status.kind === "finished") return;
    const { state: ended } = forfeitTeam(cur, "p2", "abandoned");
    setLog((prev) => [`  ** ${opponent.name} left the match.`, ...prev]);
    setNetError(null);
    setWaiting(false);
    stateRef.current = ended;
    setState(ended);
  }), [opponent]);

  useEffect(() => opponent.onDesync(() => {
    setLog((prev) => ["  ** Warning: your board and your opponent's disagree (desync).", ...prev]);
  }), [opponent]);

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
  const selfTargets = useMemo(() => legalSelfTargets(me), [me]);

  /**
   * A pending move may be pointed at the rival OR at your own mech.
   *
   * Stages are per-limb, so a buff has to ask which limb — aiming it at the
   * firing limb automatically meant the legs' buff could only ever buff the
   * legs, and the arm you were about to swing with could never be the one you
   * powered up.
   */
  const pendingMove = pending ? me.parts[pending.slot].moves[pending.moveIndex] : null;
  const pendingSelf = pendingMove?.targetType === "self";
  const pendingTargets = pendingSelf ? selfTargets : targets;
  const pendingUnit = pendingSelf ? me : foe;
  const bench = switchableIndices(state.p1);

  const finished = state.status.kind === "finished";
  const won = finished && state.status.kind === "finished" && state.status.winner === "p1";

  return (
    <div style={sx.backdrop}>
      <div style={sx.frame}>
        {/* One line: the squads ride in the header rather than a row of their
            own, and the arena gets that height back. */}
        <header style={sx.header}>
          <h2 style={sx.title}>SQUAD BATTLE</h2>
          <SquadBar state={state} side="p1" label="YOU" />
          <div style={{ flex: 1 }} />
          <SquadBar state={state} side="p2" label="RIVAL" align="right" />
          <button onClick={onClose} style={sx.close} aria-label="Close">×</button>
        </header>

        {/* Same arrangement as the 1v1: the arena is the backdrop and the two
            HUDs sit over its top corners. See BattleHud for the measurements. */}
        <div style={sx.stageWrap}>
        <div style={sx.stage}>
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            style={sx.canvas}
          />
          <div ref={hudLeftRef} style={sx.hudLeft}>
            <UnitPanel
              unit={me}
              name="You"
              clock={formatClock(clock.p1)}
              live={thinking.includes("p1")}
              low={clock.p1 <= SQUAD_CLOCK.warnAtMs}
            />
          </div>
          <span style={sx.roundChip}>ROUND {state.round}</span>
          {finished && (
            <ResultCard won={won} actions={state.history.length} onLeave={onClose} />
          )}
          <div ref={hudRightRef} style={sx.hudRight}>
            <UnitPanel
              unit={foe}
              name={opponent.name}
              clock={opponent.remote ? "LIVE" : formatClock(clock.p2)}
              live={opponent.remote ? waiting : thinking.includes("p2")}
              low={!opponent.remote && clock.p2 <= SQUAD_CLOCK.warnAtMs}
              align="right"
            />
          </div>
        </div>
        </div>

        <div style={sx.footRow}>
        <div style={sx.controls}>
          {finished ? (
            <div style={sx.prompt}>Match over.</div>
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
            <div style={sx.prompt}>
              {netError
                ? `Connection problem: ${netError}`
                : waiting ? `Waiting for ${opponent.name}…` : "Resolving…"}
            </div>
          ) : picking ? (
            <>
              <div style={sx.promptRow}>
                <span style={sx.promptText}>Substitute — this is your action for the round.</span>
                <button onClick={() => setPicking(false)} style={sx.back}>◂ BACK</button>
              </div>
              <div style={sx.btnRow}>
                {bench.map((i) => (
                  <button
                    key={i}
                    // A VOLUNTARY substitution is a normal round action, not a
                    // forced one: submitForced bails unless the battle is
                    // already awaiting a switch, so routing this through it
                    // silently did nothing at all — the picker closed and the
                    // round never resolved.
                    onClick={() => {
                      setPicking(false);
                      submitRound({ kind: "switch", side: "p1", toIndex: i });
                    }}
                    style={sx.btn}
                  >
                    <div style={sx.btnTitle}>#{i + 1} {state.p1.units[i].matrix.matrixName}</div>
                    <div style={sx.btnSub}>Matrix {state.p1.units[i].partStatuses.matrix.currentHP}</div>
                  </button>
                ))}
              </div>
            </>
          ) : pending ? (
            <>
              <div style={sx.promptRow}>
                <span style={sx.promptText}>
                  {pendingSelf ? "Apply " : "Target for "}
                  {pendingMove?.name}
                  {pendingSelf ? " to which part?" : ""}
                </span>
                {!pendingSelf && !targets.includes("matrix") && (
                  <span style={sx.hint}>Matrix sealed — break an arm, or strip all three limbs.</span>
                )}
                <button onClick={() => setPending(null)} style={sx.back}>◂ BACK</button>
              </div>
              <div style={sx.btnRow}>
                {pendingTargets.map((slot) => (
                  <button
                    key={slot}
                    onClick={() => {
                      submitRound({ kind: "move", side: "p1", sourceSlot: pending.slot, moveIndex: pending.moveIndex, targetSlot: slot });
                      setPending(null);
                    }}
                    style={{
                      ...sx.btn,
                      // Own mech reads blue, the rival's core red — so the two
                      // pickers can't be confused for each other at a glance.
                      background: pendingSelf ? C.raised : slot === "matrix" ? "#5c1830" : C.raised,
                      borderColor: pendingSelf ? C.blue : undefined,
                    }}
                  >
                    <div style={sx.btnTitle}>{SLOT_LABEL[slot]}</div>
                    <div style={sx.btnSub}>{pendingUnit.partStatuses[slot].currentHP} HP</div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div style={sx.prompt}>Choose an action</div>
              <div style={sx.btnRow}>
                {moves.map((o) => (
                  <button
                    key={`${o.slot}-${o.moveIndex}`}
                    // Self-targeting moves go through the same picker now, so
                    // the part being buffed is chosen rather than assumed.
                    onClick={() => setPending({ slot: o.slot, moveIndex: o.moveIndex })}
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
            <BattleLog lines={log} turns={state.history.length} fill />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * End of match, over the arena.
 *
 * This existed only as a line of text inside the actions card, which is a
 * 46%-wide box under a full-height arena — the match ended and nothing on
 * screen changed enough to notice. Sprites are Unity's own
 * `arena/WinLoseCard` art (cub1 / defeat), reduced to their native pixel grid.
 */
function ResultCard({ won, actions, onLeave }: {
  won: boolean; actions: number; onLeave: () => void;
}) {
  return (
    <div style={sx.resultScrim}>
      <div style={{ ...sx.resultCard, borderColor: won ? C.teal : C.bad }}>
        <img
          src={`/assets/minigames/sol-mechs/ui/${won ? "win-trophy" : "lose-rip"}.png`}
          alt=""
          style={{
            imageRendering: "pixelated", display: "block", margin: "0 auto",
            height: 108, width: "auto",
          }}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
        <div style={{ ...sx.resultTitle, color: won ? C.teal : C.bad }}>
          {won ? "SQUAD VICTORY" : "SQUAD DEFEATED"}
        </div>
        <div style={sx.resultMeta}>{actions} {actions === 1 ? "action" : "actions"}</div>
        <button onClick={onLeave} style={sx.btnPrimary}>LEAVE</button>
      </div>
    </div>
  );
}

function SquadBar({ state, side, label, align }: {
  state: TeamBattleState; side: PlayerSide; label: string; align?: "right";
}) {
  const s = side === "p1" ? state.p1 : state.p2;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6, minWidth: 0,
      flexDirection: align ? "row-reverse" : "row",
    }}>
      <div style={sx.squadLabel}>{label}</div>
      <div style={{ display: "flex", gap: 4 }}>
        {s.units.map((u, i) => {
          const down = isDefeated(u);
          const active = i === s.activeIndex;
          return (
            <span
              key={i}
              title={u.matrix.matrixName}
              style={{
                fontSize: 11, padding: "2px 6px", borderRadius: 4, fontWeight: 700,
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

/** Matches the 1v1's footer cards. */
const CARD: React.CSSProperties = {
  background: "rgba(8,4,16,.93)",
  border: `1px solid ${C.lineBright}`,
  borderRadius: R.md,
  padding: SP.sm,
  boxShadow: "0 10px 30px rgba(0,0,0,.65)",
};

/**
 * Widest the arena is allowed to get.
 *
 * The backdrop is stretched to the stage, so this is a distortion budget: the
 * art is natively 1.177 and Unity itself displays it at 1.485, so 2.0 is
 * already generous. It also sets how much vertical room the mechs get, which
 * is what keeps them clear of the HUD.
 */
const MAX_ASPECT = 2;

/** One-line action button, border included. */
const BTN_H = 38;
/** Prompt line (+ its gap) above the buttons. */
const PROMPT_H = 18 + 5;

/**
 * Height of the actions + log strip — see footRow. Exactly the prompt line
 * and two rows of buttons inside the card's padding, so nothing sits empty
 * under the last row.
 */
const FOOT_H = PROMPT_H + 2 * BTN_H + 6 + 2 * SP.sm + 2;

const sx: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed", inset: 0, background: "rgba(4,2,10,.9)", zIndex: 1000,
    display: "flex", alignItems: "center", justifyContent: "center", padding: 12,
  },
  frame: {
    background: C.panel, border: `2px solid ${C.line}`, borderRadius: 10, padding: 12,
    // The whole window, less the backdrop's padding. The shared PANEL_HEIGHT
    // leaves 6% spare for menus; here every pixel of height is arena width.
    width: W.wide, height: "min(calc(100vh - 24px), 1000px)", overflow: "hidden",
    display: "flex", flexDirection: "column", gap: SP.sm, fontFamily: "system-ui,sans-serif",
  },
  header: { display: "flex", alignItems: "center", gap: SP.md, flexShrink: 0 },
  title: { margin: 0, fontSize: 16, color: C.teal, letterSpacing: 4, fontWeight: 800 },
  close: { background: "none", border: "none", color: C.dim, fontSize: 24, cursor: "pointer", lineHeight: 1, padding: 0 },
  squadRow: { display: "flex", gap: SP.md, flexWrap: "wrap", flexShrink: 0 },
  squadLabel: { fontSize: 11, color: C.faint, letterSpacing: 2 },
  /**
   * Centres the stage and gives it the height left over by the footer.
   */
  stageWrap: {
    flex: 1, minHeight: 0, display: "flex", justifyContent: "center",
  },
  /**
   * The arena, with its width driven by its HEIGHT and capped at MAX_ASPECT.
   *
   * See the 1v1 for why the cap exists.
   */
  stage: {
    position: "relative", height: "100%", aspectRatio: `${MAX_ASPECT}`,
    maxWidth: "100%", overflow: "hidden", borderRadius: R.md,
    border: `2px solid ${C.line}`, background: C.ink,
  },
  canvas: {
    position: "absolute", inset: 0, width: "100%", height: "100%",
    imageRendering: "pixelated", display: "block",
  },
  hudLeft: { position: "absolute", left: "1.2%", top: "2%", width: "min(232px, 23%)" },
  hudRight: { position: "absolute", right: "1.2%", top: "2%", width: "min(232px, 23%)" },
  roundChip: {
    position: "absolute", left: "50%", top: "3%", transform: "translateX(-50%)",
    fontSize: T.eyebrow, letterSpacing: 2, fontWeight: 700, color: C.text,
    background: "rgba(11,6,22,.82)", border: `1px solid ${C.line}`,
    borderRadius: R.pill, padding: "4px 12px", whiteSpace: "nowrap",
  },
  /** Actions left, log right, both raised onto cards. See the 1v1 for why. */
  /**
   * Fixed height. Sized by its content, this strip grew and shrank as the
   * panel switched between the action list, a target picker with its hint
   * line and "Resolving…" — and since the arena takes whatever height is left,
   * the whole scene rescaled every time a move was picked. Every state now
   * fits one prompt line and at most two rows of buttons: Back and the sealed
   * hint live on the prompt line instead of taking a cell or a row.
   */
  footRow: { display: "flex", gap: SP.md, flexShrink: 0, alignItems: "stretch", height: FOOT_H },
  controls: { ...CARD, flex: "1 1 46%", minWidth: 0, overflow: "hidden" },
  logColumn: { ...CARD, flex: "1 1 54%", minWidth: 0, display: "flex", flexDirection: "column" },
  prompt: {
    fontSize: 11, color: C.dim, letterSpacing: 1,
    height: 18, lineHeight: "18px", marginBottom: 5,
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  },
  promptRow: { display: "flex", alignItems: "center", gap: 10, height: 18, marginBottom: 5, minWidth: 0 },
  promptText: {
    fontSize: 11, color: C.dim, letterSpacing: 1,
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0,
  },
  back: {
    marginLeft: "auto", flexShrink: 0, padding: 0,
    background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
    color: C.teal, fontSize: 11, fontWeight: 700, letterSpacing: 1,
  },
  /**
   * Two up, two down. A single row across a card this wide left the actions
   * tiny against a lot of empty card, and the strip grew every time a mech
   * had a fourth option.
   */
  btnRow: {
    display: "grid", gap: 6,
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gridAutoRows: `${BTN_H}px`,
  },
  /**
   * One line: name, then its detail in the same row. Title over subtitle made
   * each button ~60px tall, and four of them took more of the screen than the
   * information on them was worth.
   */
  btn: {
    ...actionButton(), minWidth: 0,
    height: BTN_H, boxSizing: "border-box", padding: "0 10px",
    display: "flex", alignItems: "center", gap: 8,
    whiteSpace: "nowrap", overflow: "hidden",
  },
  btnTitle: { fontSize: 12, fontWeight: 700, flexShrink: 0 },
  btnSub: { fontSize: 11, color: C.faint, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  hint: { fontSize: 11, color: C.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 },
  btnPrimary: {
    background: C.teal, border: "none", color: C.ink, borderRadius: 6,
    padding: "9px 20px", fontSize: 13, fontWeight: 800, letterSpacing: 1, cursor: "pointer",
  },

  /** Dims the arena so the card is the only thing being read. */
  resultScrim: {
    position: "absolute", inset: 0, zIndex: 2,
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "rgba(4,2,10,.72)",
  },
  resultCard: {
    ...frame(), background: C.ink,
    padding: "20px 40px", textAlign: "center",
    display: "flex", flexDirection: "column", gap: 8, alignItems: "center",
    boxShadow: "0 18px 60px rgba(0,0,0,.7)",
  },
  resultTitle: { fontSize: 26, fontWeight: 800, letterSpacing: 4, fontFamily: DISPLAY },
  resultMeta: { color: C.faint, fontSize: 12, letterSpacing: 1 },
};
