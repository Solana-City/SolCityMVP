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
 *  - **Switching costs your round.** This is structural now rather than a
 *    setting: a round action is EITHER a move or a substitution, so the cost
 *    falls out of simultaneous selection instead of needing a rule. The old
 *    `switchCost: "free"` option is gone with it — under simultaneous rounds
 *    "swap and also act" has no coherent meaning.
 *  - **Substitutions resolve before moves**, regardless of speed, so the mech
 *    you send in eats the attack the opponent already committed to. That is
 *    what makes switching a read instead of a safe escape.
 *  - **A switch after a KO is free.** You lost the round that lost the mech;
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
  /** Both sides commit an action for the round. */
  | { kind: "active" }
  /**
   * One or both sides lost their active mech and must send a replacement
   * before the next round. Free — the round that lost the mech is already
   * spent.
   */
  | { kind: "awaiting-switch"; sides: PlayerSide[] }
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
  | { type: "must-switch"; side: PlayerSide }
  | { type: "round-start"; round: number };

/** One round of simultaneous decisions. `null` = nothing legal to do. */
export interface TeamRoundActions {
  p1: TeamAction | null;
  p2: TeamAction | null;
}

export interface TeamBattleState {
  p1: TeamSide;
  p2: TeamSide;
  status: TeamStatus;
  /** 1-based; also breaks speed ties, as in the 1v1. */
  round: number;
  history: TeamRoundActions[];
}

export interface TeamResolveResult {
  state: TeamBattleState;
  events: TeamEvent[];
}

export interface CreateTeamBattleOptions {
  p1Name?: string;
  p2Name?: string;
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

  return {
    p1, p2,
    status: { kind: "active" },
    round: 1,
    history: [],
  };
}

function cloneSide(side: TeamSide): TeamSide {
  return { ...side, units: side.units.map(cloneUnit) };
}

function cloneState(state: TeamBattleState): TeamBattleState {
  return {
    p1: cloneSide(state.p1),
    p2: cloneSide(state.p2),
    status: state.status,
    round: state.round,
    history: [...state.history],
  };
}

/** Speed order among a set of sides, ties alternating by round parity. */
function bySpeed(state: TeamBattleState, sides: PlayerSide[]): PlayerSide[] {
  if (sides.length < 2) return sides;
  const spd = (s: PlayerSide) => effectiveStats(activeUnit(sideOf(state, s))).SPD;
  const [a, b] = sides;
  if (spd(a) !== spd(b)) return spd(a) > spd(b) ? [a, b] : [b, a];
  return state.round % 2 === 1 ? [a, b] : [b, a];
}

/** Stages are per-limb buffs; a mech leaving the field drops them. */
function clearStages(unit: MechUnit): void {
  for (const status of Object.values(unit.partStatuses)) status.buffs = {};
}

/**
 * Resolve one round of a squad battle.
 *
 * Order within the round, following Pokémon:
 *
 *  1. **Substitutions first**, regardless of speed. That is what makes
 *     switching a read rather than a safe escape: the mech you send in eats
 *     the attack the opponent had already committed to.
 *  2. **Then moves**, in speed order — measured AFTER the switches, so it is
 *     the incoming mech's SPD that counts.
 *
 * A side whose active mech is knocked out does not act, and owes a free
 * substitution before the next round (`awaiting-switch`).
 */
export function resolveTeamRound(state: TeamBattleState, actions: TeamRoundActions): TeamResolveResult {
  if (state.status.kind === "finished") {
    return { state, events: [{ type: "rejected", reason: "Battle is already over" }] };
  }
  if (state.status.kind === "awaiting-switch") {
    return { state, events: [{ type: "rejected", reason: "A substitution is required first" }] };
  }

  const next = cloneState(state);
  const events: TeamEvent[] = [{ type: "round-start", round: next.round }];
  const get = (side: PlayerSide) => (side === "p1" ? actions.p1 : actions.p2);

  // ── 1. substitutions ────────────────────────────────────────────────────
  const switching = (["p1", "p2"] as PlayerSide[]).filter((s) => get(s)?.kind === "switch");
  for (const side of bySpeed(next, switching)) {
    const action = get(side) as Extract<TeamAction, { kind: "switch" }>;
    const me = sideOf(next, side);
    if (action.toIndex === me.activeIndex || action.toIndex < 0 || action.toIndex >= me.units.length) {
      events.push({ type: "rejected", reason: "No such mech to send out" });
      continue;
    }
    if (isDefeated(me.units[action.toIndex])) {
      events.push({ type: "rejected", reason: "That mech is out of the fight" });
      continue;
    }
    const fromIndex = me.activeIndex;
    clearStages(me.units[fromIndex]);
    me.activeIndex = action.toIndex;
    events.push({
      type: "switch", side, fromIndex, toIndex: action.toIndex,
      mechName: activeUnit(me).matrix.matrixName,
    });
  }

  // ── 2. moves, in the speed order that now applies ───────────────────────
  const moving = (["p1", "p2"] as PlayerSide[]).filter((s) => get(s)?.kind === "move");
  for (const side of bySpeed(next, moving)) {
    const action = get(side) as Extract<TeamAction, { kind: "move" }>;
    const me = sideOf(next, side);
    const foe = sideOf(next, opponentOfSide(side));
    const actor = activeUnit(me);
    const target = activeUnit(foe);

    // The slower mech may have been knocked out before it could act.
    if (isDefeated(actor)) {
      events.push({ type: "rejected", reason: `${actor.name} was down before it could act` });
      continue;
    }
    const illegal = validateMove(actor, target, action.sourceSlot, action.moveIndex, action.targetSlot);
    if (illegal) {
      events.push({ type: "rejected", reason: illegal });
      continue;
    }
    events.push(...applyMove(actor, target, side, action.sourceSlot, action.moveIndex, action.targetSlot));
  }

  next.history.push(actions);

  // ── 3. casualties ───────────────────────────────────────────────────────
  const owing: PlayerSide[] = [];
  for (const side of ["p1", "p2"] as PlayerSide[]) {
    const teamSide = sideOf(next, side);
    const unit = activeUnit(teamSide);
    const cause = defeatCauseOf(unit);
    if (!cause) continue;
    events.push({
      type: "mech-down", side, index: teamSide.activeIndex,
      mechName: unit.matrix.matrixName, cause,
    });
    if (!teamWiped(teamSide)) owing.push(side);
  }

  // A whole side being wiped ends it. Both wiped in the same round resolves to
  // whoever still had a mech standing when the round's moves ran — the faster
  // side, consistent with resolving in speed order.
  const wiped = (["p1", "p2"] as PlayerSide[]).filter((s) => teamWiped(sideOf(next, s)));
  if (wiped.length > 0) {
    const loser = wiped.length === 2 ? bySpeed(state, ["p1", "p2"])[1] : wiped[0];
    const winner = opponentOfSide(loser);
    next.status = { kind: "finished", winner };
    events.push({ type: "victory", winner });
    return { state: next, events };
  }

  if (owing.length > 0) {
    next.status = { kind: "awaiting-switch", sides: owing };
    for (const side of owing) events.push({ type: "must-switch", side });
    return { state: next, events };
  }

  next.round += 1;
  return { state: next, events };
}

/**
 * Send in replacements for every side that lost its mech last round. Free —
 * the round that lost the mech was already spent.
 */
export function resolveForcedSwitches(
  state: TeamBattleState,
  picks: Partial<Record<PlayerSide, number>>,
): TeamResolveResult {
  if (state.status.kind !== "awaiting-switch") {
    return { state, events: [{ type: "rejected", reason: "No substitution is pending" }] };
  }
  const next = cloneState(state);
  const events: TeamEvent[] = [];

  for (const side of state.status.sides) {
    const me = sideOf(next, side);
    const options = switchableIndices(me);
    const wanted = picks[side];
    // Falling back to the first legal reserve keeps a missing or illegal pick
    // from stalling the match, which matters on a ladder where refusing to
    // choose would otherwise be a way to deny an opponent their win.
    const idx = wanted !== undefined && options.includes(wanted) ? wanted : options[0];
    if (idx === undefined) continue;
    const fromIndex = me.activeIndex;
    me.activeIndex = idx;
    events.push({
      type: "switch", side, fromIndex, toIndex: idx,
      mechName: activeUnit(me).matrix.matrixName,
    });
  }

  next.status = { kind: "active" };
  next.round += 1;
  events.push({ type: "round-start", round: next.round });
  return { state: next, events };
}

/**
 * End a squad battle on clock or abandonment. Same contract as the 1v1's
 * `forfeit`: a real result the ladder records, not a UI special case.
 */
export function forfeitTeam(
  state: TeamBattleState,
  side: PlayerSide,
  reason: "timeout" | "abandoned" = "timeout",
): TeamResolveResult {
  if (state.status.kind === "finished") {
    return { state, events: [{ type: "rejected", reason: "Battle is already over" }] };
  }
  const next = cloneState(state);
  const winner = opponentOfSide(side);
  next.status = { kind: "finished", winner };
  return {
    state: next,
    events: [
      { type: "forfeit", side, reason },
      { type: "victory", winner },
    ],
  };
}

/**
 * Replay a team battle from its round list — the verification path, same
 * contract as the 1v1 `replay`.
 */
export function replayTeam(
  p1Team: TeamBuild,
  p2Team: TeamBuild,
  rounds: TeamRoundActions[],
  options: CreateTeamBattleOptions = {},
): TeamBattleState {
  let state = createTeamBattle(p1Team, p2Team, options);
  for (const round of rounds) {
    if (state.status.kind === "awaiting-switch") {
      // A forced substitution is recorded as the round's switch actions.
      const picks: Partial<Record<PlayerSide, number>> = {};
      for (const side of ["p1", "p2"] as PlayerSide[]) {
        const a = side === "p1" ? round.p1 : round.p2;
        if (a?.kind === "switch") picks[side] = a.toIndex;
      }
      state = resolveForcedSwitches(state, picks).state;
      continue;
    }
    state = resolveTeamRound(state, round).state;
  }
  return state;
}

export type { MechBuild, TeamBuild };
