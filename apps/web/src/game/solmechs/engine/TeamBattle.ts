/**
 * Sol Mechs — 3v3 team battle with substitution.
 *
 * One mech per side is active at a time; the other two wait in reserve. A
 * side loses when all three of its mechs are out. Individual mechs are
 * defeated by the same two routes as in a 1v1 — core destroyed, or all three
 * limbs stripped.
 *
 * Every rule about moves, damage and legality is imported from BattleEngine
 * rather than restated here, so the two formats cannot drift apart.
 *
 * ## Conventions taken from Pokémon, since that's the reference
 *
 *  - **Switching costs your turn.** Free switching would make every bad
 *    matchup escapable and reduce lead choice to a coin flip.
 *  - **A switch after a KO is free.** You lost the turn that lost the mech;
 *    charging a second one compounds the same mistake.
 *  - **Stat stages reset on switch-out.** They are per-limb buffs on a
 *    machine that just walked off the field.
 *  - **Damage does NOT reset.** A mech returns with exactly the limbs it left
 *    with — that is the whole tension of pulling a wounded mech out, and it's
 *    also what makes the limb-strip win route viable across a whole team.
 */
import type { MechBuild, ModuleSlot } from "../data/types";
import type { BattleEvent, PlayerSide, DefeatCause } from "./BattleEngine";
import {
  createUnit, cloneUnit, applyMove, validateMove, defeatCauseOf, isDefeated,
  effectiveStats, opponentOfSide,
} from "./BattleEngine";
import type { MechUnit } from "../data/types";
import { TEAM_SIZE, type TeamBuild } from "../data/team";

export interface TeamSide {
  units: MechUnit[];
  /** Index into `units` of the mech currently on the field. */
  activeIndex: number;
  name: string;
}

export type TeamStatus =
  | { kind: "active"; turn: PlayerSide }
  /** A side must substitute before play resumes; its turn is not consumed. */
  | { kind: "awaiting-switch"; side: PlayerSide }
  | { kind: "finished"; winner: PlayerSide };

/** A move, or a substitution. Both are one turn's worth of decision. */
export type TeamAction =
  | {
      kind: "move";
      side: PlayerSide;
      sourceSlot: Exclude<ModuleSlot, "matrix">;
      moveIndex: number;
      targetSlot: ModuleSlot;
    }
  | { kind: "switch"; side: PlayerSide; toIndex: number };

export type TeamEvent =
  | BattleEvent
  | { type: "switch"; side: PlayerSide; fromIndex: number; toIndex: number; mechName: string }
  | { type: "mech-down"; side: PlayerSide; index: number; mechName: string; cause: DefeatCause }
  | { type: "must-switch"; side: PlayerSide };

export interface TeamBattleState {
  p1: TeamSide;
  p2: TeamSide;
  status: TeamStatus;
  turnNumber: number;
  history: TeamAction[];
}

export interface TeamResolveResult {
  state: TeamBattleState;
  events: TeamEvent[];
}

export interface CreateTeamBattleOptions {
  p1Name?: string;
  p2Name?: string;
  /** "speed" compares the two LEAD mechs; otherwise an explicit opener. */
  firstMove?: "speed" | "p1" | "p2";
}

function buildSide(team: TeamBuild, name: string): TeamSide {
  return {
    units: team.mechs.map((b, i) => createUnit(`${name} #${i + 1}`, b)),
    activeIndex: 0,
    name,
  };
}

export function activeUnit(side: TeamSide): MechUnit {
  return side.units[side.activeIndex];
}

function sideOf(state: TeamBattleState, side: PlayerSide): TeamSide {
  return side === "p1" ? state.p1 : state.p2;
}

/** Reserve mechs that can still be sent out. */
export function switchableIndices(side: TeamSide): number[] {
  return side.units
    .map((u, i) => (i !== side.activeIndex && !isDefeated(u) ? i : -1))
    .filter((i) => i >= 0);
}

export function teamWiped(side: TeamSide): boolean {
  return side.units.every(isDefeated);
}

export function createTeamBattle(
  p1Team: TeamBuild,
  p2Team: TeamBuild,
  options: CreateTeamBattleOptions = {},
): TeamBattleState {
  if (p1Team.mechs.length !== TEAM_SIZE || p2Team.mechs.length !== TEAM_SIZE) {
    throw new Error(`A team must hold exactly ${TEAM_SIZE} mechs`);
  }
  const p1 = buildSide(p1Team, options.p1Name ?? "Player 1");
  const p2 = buildSide(p2Team, options.p2Name ?? "Player 2");

  const rule = options.firstMove ?? "speed";
  // Ties break to p1 — arbitrary, but it has to be deterministic for replay.
  const turn: PlayerSide =
    rule === "p1" || rule === "p2"
      ? rule
      : effectiveStats(activeUnit(p2)).SPD > effectiveStats(activeUnit(p1)).SPD
        ? "p2"
        : "p1";

  return { p1, p2, status: { kind: "active", turn }, turnNumber: 1, history: [] };
}

function cloneSide(side: TeamSide): TeamSide {
  return { ...side, units: side.units.map(cloneUnit) };
}

function cloneState(state: TeamBattleState): TeamBattleState {
  return {
    p1: cloneSide(state.p1),
    p2: cloneSide(state.p2),
    status: state.status,
    turnNumber: state.turnNumber,
    history: [...state.history],
  };
}

/** Stages are per-limb buffs; a mech leaving the field drops them. */
function clearStages(unit: MechUnit): void {
  for (const status of Object.values(unit.partStatuses)) status.buffs = {};
}

export function resolveTeamAction(state: TeamBattleState, action: TeamAction): TeamResolveResult {
  const reject = (reason: string): TeamResolveResult => ({
    state,
    events: [{ type: "rejected", reason }],
  });

  if (state.status.kind === "finished") return reject("Battle is already over");

  // A forced substitution is the only legal action while one is pending, and
  // only from the side that owes it.
  if (state.status.kind === "awaiting-switch") {
    if (action.kind !== "switch" || action.side !== state.status.side) {
      return reject("A substitution is required first");
    }
  } else if (state.status.turn !== action.side) {
    return reject("Not your turn");
  }

  const forced = state.status.kind === "awaiting-switch";
  const next = cloneState(state);
  const events: TeamEvent[] = [];
  const me = sideOf(next, action.side);
  const foeSide = opponentOfSide(action.side);
  const foe = sideOf(next, foeSide);

  if (action.kind === "switch") {
    if (action.toIndex === me.activeIndex) return reject("That mech is already out");
    if (action.toIndex < 0 || action.toIndex >= me.units.length) return reject("No such mech");
    if (isDefeated(me.units[action.toIndex])) return reject("That mech is out of the fight");

    const fromIndex = me.activeIndex;
    clearStages(me.units[fromIndex]);
    me.activeIndex = action.toIndex;
    events.push({
      type: "switch",
      side: action.side,
      fromIndex,
      toIndex: action.toIndex,
      mechName: activeUnit(me).matrix.matrixName,
    });
    next.history.push(action);

    // A voluntary switch spends your turn, so play passes to the opponent.
    //
    // A forced switch does not: the side that just lost a mech sends its
    // replacement in for free and then takes its normal turn. Passing the
    // turn here instead would charge them twice for one KO — the mech AND
    // the tempo — which is neither how Pokémon reads nor a rule anyone would
    // enjoy losing to.
    const nextTurn = forced ? action.side : foeSide;
    next.status = { kind: "active", turn: nextTurn };
    if (!forced) next.turnNumber += 1;
    events.push({ type: "turn-start", side: nextTurn, turnNumber: next.turnNumber });
    return { state: next, events };
  }

  // --- a move ---
  const attacker = activeUnit(me);
  const defender = activeUnit(foe);

  const illegal = validateMove(attacker, defender, action.sourceSlot, action.moveIndex, action.targetSlot);
  if (illegal) return reject(illegal);

  events.push(...applyMove(attacker, defender, action.side, action.sourceSlot, action.moveIndex, action.targetSlot));
  next.history.push(action);

  // Did anyone go down? Checked on both sides, since a self-targeted move can
  // finish off the user's own last limb.
  let pendingSwitch: PlayerSide | null = null;
  for (const side of ["p1", "p2"] as PlayerSide[]) {
    const teamSide = sideOf(next, side);
    const unit = activeUnit(teamSide);
    const cause = defeatCauseOf(unit);
    if (!cause) continue;

    events.push({
      type: "mech-down",
      side,
      index: teamSide.activeIndex,
      mechName: unit.matrix.matrixName,
      cause,
    });

    if (teamWiped(teamSide)) {
      const winner = opponentOfSide(side);
      next.status = { kind: "finished", winner };
      events.push({ type: "victory", winner });
      return { state: next, events };
    }
    // Both sides can fall on the same action; the first one owing a
    // substitution gets asked, and the other is asked on the next resolve.
    if (!pendingSwitch) pendingSwitch = side;
  }

  if (pendingSwitch) {
    next.status = { kind: "awaiting-switch", side: pendingSwitch };
    events.push({ type: "must-switch", side: pendingSwitch });
    return { state: next, events };
  }

  next.status = { kind: "active", turn: foeSide };
  next.turnNumber += 1;
  events.push({ type: "turn-start", side: foeSide, turnNumber: next.turnNumber });
  return { state: next, events };
}

/**
 * Replay a team battle from its action list — the verification path, same
 * contract as the 1v1 `replay`.
 */
export function replayTeam(
  p1Team: TeamBuild,
  p2Team: TeamBuild,
  actions: TeamAction[],
  options: CreateTeamBattleOptions = {},
): TeamBattleState {
  let state = createTeamBattle(p1Team, p2Team, options);
  for (const action of actions) state = resolveTeamAction(state, action).state;
  return state;
}

export type { MechBuild, TeamBuild };
