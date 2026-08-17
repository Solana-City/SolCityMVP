/**
 * Sol Mechs — battle engine.
 *
 * Ported from LocalBattleManager.cs (Assets/Scripts/LocalPvP). The Unity class
 * mixed rules with UI: it called into LocalUIManager to render buttons and log
 * lines mid-resolution. Here the rules are a pure, deterministic reducer and
 * the UI subscribes to the emitted event log instead.
 *
 * That split is what makes on-chain play possible: given the same two builds,
 * the same seed and the same ordered list of actions, every client and the
 * settlement program compute byte-identical state. Nothing in this file reads
 * the clock, Math.random, or the DOM.
 */
import type {
  MechUnit, MechBuild, ModuleSlot, MoveDefinition, StageableStat,
  StatBlock, PartStatus,
} from "../data/types";
import { LIMB_SLOTS, addStats } from "../data/types";
import { getMatrix, getPart } from "../data/catalog";

/**
 * Stage multiplier ladder, indexed by stage + 6 so [-6..+6] maps to [0..12].
 * Verbatim from LocalBattleManager.GetStageMultiplier — Pokémon-style, but
 * note the positive half climbs linearly (1.5, 2, 2.5…) rather than by the
 * n+2/2 ratio, so high stacks hit far harder than Pokémon's cap of 4x at +6.
 */
const STAGE_MULTIPLIERS = [
  0.25, 0.2857, 0.3333, 0.4, 0.5, 0.6667, 1, 1.5, 2, 2.5, 3, 3.5, 4,
];

const MIN_STAGE = -6;
const MAX_STAGE = 6;

/**
 * Damage tuning.
 *
 * Every value a designer would want to move lives here rather than inline in
 * the formula, because changing any of them rebalances every matchup and the
 * on-chain verifier must be kept in lockstep with whatever these are set to.
 *
 * The curve is `2 * atk / (atk + def)`, which sits at exactly 1.0 when the
 * two sides are even and self-normalizes at the extremes. It replaces the
 * raw `atk / def` quotient the Unity build used: that quotient was unbounded,
 * so a stat-stage stack could swing damage 16x (4x on the attacker's side
 * against 0.25x on the defender's) and every fight collapsed inside five
 * actions. The ratio form keeps stages meaningful without letting them run
 * away — see the clamp below.
 */
/**
 * Exported so balance tooling can sweep it and so the on-chain port has one
 * named place to mirror. Every value here is consensus data — see ONCHAIN.md.
 */
export const BALANCE = {
  /**
   * Global damage scale. Move power values come straight from the Unity
   * .assets and are left untouched; this is the single dial that sets fight
   * length. At 0.65 a healthy limb takes 2-3 hits and a matrix 4-6, putting
   * a full battle in the 12-20 action range.
   */
  DAMAGE_SCALE: 0.65,
  /**
   * Bounds on the attack/defense multiplier. The natural range for real
   * builds is roughly 0.6-1.5, so these only bind once stat stages are
   * stacked — which is the point: a +6/-6 stack should be decisive, not
   * terminal.
   */
  MIN_MULTIPLIER: 0.35,
  MAX_MULTIPLIER: 1.75,
  /** A connecting hit always does something, however bad the matchup. */
  MIN_DAMAGE: 1,
  /**
   * What fraction of its stats a DESTROYED limb still contributes.
   *
   * At 0 — the original rule — offence compounds and defence does not: going
   * first lets you break a limb before it acts, and the stats that limb was
   * providing vanish, so the next hit lands harder still. Measured, that
   * snowball was the single biggest driver of the roster's spread: fast
   * offensive chassis sat near 75% and slow durable ones near 30%, even with
   * every chassis on an identical stat budget and near-identical damage per
   * hit.
   *
   * At 0.5 the wrecked frame is still bolted on and still carries load. Taking
   * a limb is still a real gain — half its stats, ALL of its moves, and it can
   * no longer act or be healed — but it no longer hands the aggressor a
   * runaway lead, which is what makes a defensive build a strategy rather than
   * a slower loss.
   */
  WRECKED_STAT_RETENTION: 0.5,
} as const;

export type PlayerSide = "p1" | "p2";

/**
 * Both sides choose every round, so there is no "whose turn is it" — only
 * whether the fight is still going.
 */
export type BattleStatus =
  | { kind: "active" }
  | { kind: "finished"; winner: PlayerSide };

/** One resolved action. This is the unit that gets committed on-chain. */
export interface BattleAction {
  side: PlayerSide;
  /** Which of the attacker's limbs is firing. */
  sourceSlot: Exclude<ModuleSlot, "matrix">;
  /** Index into that part's `moves`. */
  moveIndex: number;
  /** Slot being hit — on the opponent, or on self for self-target moves. */
  targetSlot: ModuleSlot;
}

export type BattleEvent =
  | { type: "round-start"; round: number }
  | { type: "attack"; side: PlayerSide; moveName: string; sourceSlot: ModuleSlot }
  | { type: "damage"; side: PlayerSide; targetSlot: ModuleSlot; amount: number; percent: number; remaining: number }
  | { type: "heal"; side: PlayerSide; targetSlot: ModuleSlot; amount: number; remaining: number }
  | { type: "stage"; side: PlayerSide; targetSlot: ModuleSlot; stat: StageableStat; delta: number; newStage: number }
  | { type: "part-broken"; side: PlayerSide; slot: ModuleSlot; partName: string }
  | { type: "matrix-unlocked"; side: PlayerSide }
  | { type: "defeat-cause"; side: PlayerSide; cause: "matrix-destroyed" | "limbs-destroyed" }
  | { type: "forfeit"; side: PlayerSide; reason: "timeout" | "abandoned" }
  | { type: "rejected"; reason: string }
  | { type: "victory"; winner: PlayerSide };

/** One round's worth of decisions. `null` = that side had nothing legal to do. */
export interface RoundActions {
  p1: BattleAction | null;
  p2: BattleAction | null;
}

export interface BattleState {
  p1: MechUnit;
  p2: MechUnit;
  status: BattleStatus;
  /** 1-based. Also breaks speed ties — see resolveRound. */
  round: number;
  /** Every round played, in order — the replayable battle record. */
  history: RoundActions[];
}

// ==================== BUILD → UNIT ====================

/**
 * Assemble a battle-ready unit. Throws on an invalid build rather than
 * silently substituting parts: a malformed build is a bug or a tampered
 * on-chain payload, and quietly "fixing" it would desync the two clients.
 */
export function createUnit(name: string, build: MechBuild): MechUnit {
  const matrix = getMatrix(build.matrixCode);
  if (!matrix) throw new Error(`Unknown matrix: ${build.matrixCode}`);

  const rightArm = getPart(build.rightArm);
  const leftArm = getPart(build.leftArm);
  const lowerBody = getPart(build.lowerBody);
  if (!rightArm || rightArm.slot !== "rightArm") throw new Error(`Bad rightArm: ${build.rightArm}`);
  if (!leftArm || leftArm.slot !== "leftArm") throw new Error(`Bad leftArm: ${build.leftArm}`);
  if (!lowerBody || lowerBody.slot !== "lowerBody") throw new Error(`Bad lowerBody: ${build.lowerBody}`);

  // Total stats drive the damage formula; each part's own HP stays local to
  // that part as its hit points and is not pooled into a shared health bar.
  let totalStats: StatBlock = { ...matrix.baseStats };
  for (const part of [rightArm, leftArm, lowerBody]) {
    totalStats = addStats(totalStats, part.statModifiers);
  }

  const mkStatus = (partName: string, hp: number): PartStatus => ({
    partName, maxHP: hp, currentHP: hp, buffs: {},
  });

  return {
    name,
    build,
    matrix,
    parts: { rightArm, leftArm, lowerBody },
    totalStats,
    matrixHP: matrix.baseStats.HP,
    matrixMaxHP: matrix.baseStats.HP,
    partStatuses: {
      rightArm: mkStatus(rightArm.partName, rightArm.statModifiers.HP),
      leftArm: mkStatus(leftArm.partName, leftArm.statModifiers.HP),
      lowerBody: mkStatus(lowerBody.partName, lowerBody.statModifiers.HP),
      matrix: mkStatus(matrix.matrixName, matrix.baseStats.HP),
    },
  };
}

export interface CreateBattleOptions {
  p1Name?: string;
  p2Name?: string;
}

export function createBattle(
  p1Build: MechBuild,
  p2Build: MechBuild,
  options: CreateBattleOptions = {},
): BattleState {
  return {
    p1: createUnit(options.p1Name ?? "Player 1", p1Build),
    p2: createUnit(options.p2Name ?? "Player 2", p2Build),
    status: { kind: "active" },
    round: 1,
    history: [],
  };
}

// ==================== QUERIES ====================

export function isPartBroken(unit: MechUnit, slot: ModuleSlot): boolean {
  return unit.partStatuses[slot].currentHP <= 0;
}

/**
 * The core is shielded until an arm is destroyed. Straight from
 * MechUnit.CanAttackMatrix — note it's arms only, so blowing off the legs
 * does not open the matrix.
 */
export function canAttackMatrix(unit: MechUnit): boolean {
  return isPartBroken(unit, "rightArm") || isPartBroken(unit, "leftArm");
}

export function getStage(unit: MechUnit, slot: ModuleSlot, stat: StageableStat): number {
  return unit.partStatuses[slot].buffs[stat] ?? 0;
}

/** True once every limb is gone — the second way to lose. */
export function allLimbsDestroyed(unit: MechUnit): boolean {
  return LIMB_SLOTS.every((slot) => isPartBroken(unit, slot));
}

/**
 * Stats as they stand right now: the chassis plus only the limbs still
 * standing.
 *
 * This is the heart of the modular combat. A part contributes its bonuses
 * *while it is active* — shoot off an arm and the mech permanently loses that
 * arm's ATK, not merely its moves.
 *
 * `unit.totalStats` remains the intact, at-full-strength figure — the
 * Workshop shows that one, since it describes the build rather than a
 * moment in a fight.
 */
export function effectiveStats(unit: MechUnit): StatBlock {
  const stats: StatBlock = { ...unit.matrix.baseStats };
  for (const slot of LIMB_SLOTS as Array<Exclude<ModuleSlot, "matrix">>) {
    // A destroyed limb is wrecked, not removed — the frame still carries part
    // of its load. See BALANCE.WRECKED_STAT_RETENTION for why that fraction
    // is not zero.
    const share: number = isPartBroken(unit, slot) ? BALANCE.WRECKED_STAT_RETENTION : 1;
    if (share <= 0) continue;
    const mods = unit.parts[slot].statModifiers;
    for (const key of Object.keys(stats) as Array<keyof StatBlock>) {
      stats[key] += Math.round(mods[key] * share);
    }
  }
  return stats;
}

function stageMultiplier(stage: number): number {
  const idx = clamp(stage, MIN_STAGE, MAX_STAGE) + 6;
  return STAGE_MULTIPLIERS[idx];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function unitFor(state: BattleState, side: PlayerSide): MechUnit {
  return side === "p1" ? state.p1 : state.p2;
}

export function opponentOfSide(side: PlayerSide): PlayerSide {
  return side === "p1" ? "p2" : "p1";
}

/** Local alias — `opponentOfSide` is the exported name for other formats. */
const opponentOf = opponentOfSide;

/** The moves a side can legally pick right now — broken limbs can't fire. */
export function availableMoves(unit: MechUnit): Array<{ slot: Exclude<ModuleSlot, "matrix">; moveIndex: number; move: MoveDefinition }> {
  const out: Array<{ slot: Exclude<ModuleSlot, "matrix">; moveIndex: number; move: MoveDefinition }> = [];
  for (const slot of LIMB_SLOTS as Array<Exclude<ModuleSlot, "matrix">>) {
    if (isPartBroken(unit, slot)) continue;
    unit.parts[slot].moves.forEach((move, moveIndex) => out.push({ slot, moveIndex, move }));
  }
  return out;
}

/** Slots an attacker may legally aim at on the defender. */
export function legalTargets(defender: MechUnit): ModuleSlot[] {
  const targets: ModuleSlot[] = LIMB_SLOTS.filter((s) => !isPartBroken(defender, s));
  if (canAttackMatrix(defender)) targets.push("matrix");
  return targets;
}

// ==================== DAMAGE ====================

/**
 * Damage for one connecting hit.
 *
 *   atk = effectiveStats[ATK|ENG] * stageMult(firing limb's stage)
 *   def = effectiveStats[DEF|SYS] * stageMult(struck limb's stage)
 *   damage = floor(movePower * clamp(2*atk/(atk+def)) * DAMAGE_SCALE)
 *
 * Stats are the SURVIVING assembly, not the chassis base and not the intact
 * total: a destroyed limb has stopped contributing, so dismantling an opponent
 * really does weaken every remaining swing they take.
 *
 * Stages are read per *slot* — the firing limb's offensive stage against the
 * struck limb's defensive stage — so a debuff weakens one limb, not the mech.
 */
export function calculateDamage(
  move: MoveDefinition,
  attacker: MechUnit,
  defender: MechUnit,
  sourceSlot: ModuleSlot,
  targetSlot: ModuleSlot,
): number {
  if (move.baseDamage <= 0) return 0;

  const physical = move.damageType === "Physical";
  const atkStat: StageableStat = physical ? "ATK" : "ENG";
  const defStat: StageableStat = physical ? "DEF" : "SYS";

  // Math.max(1, …) guards the degenerate case where a stripped mech and a -6
  // stage together round a stat to nothing, which would divide by zero.
  const atk = Math.max(1, effectiveStats(attacker)[atkStat] * stageMultiplier(getStage(attacker, sourceSlot, atkStat)));
  const def = Math.max(1, effectiveStats(defender)[defStat] * stageMultiplier(getStage(defender, targetSlot, defStat)));

  const multiplier = clamp((2 * atk) / (atk + def), BALANCE.MIN_MULTIPLIER, BALANCE.MAX_MULTIPLIER);
  return Math.max(BALANCE.MIN_DAMAGE, Math.floor(move.baseDamage * multiplier * BALANCE.DAMAGE_SCALE));
}

// ==================== RESOLUTION ====================

/** Why a mech is out of the fight, or null while it can still stand. */
export type DefeatCause = "matrix-destroyed" | "limbs-destroyed";

export function defeatCauseOf(unit: MechUnit): DefeatCause | null {
  if (unit.matrixHP <= 0) return "matrix-destroyed";
  if (allLimbsDestroyed(unit)) return "limbs-destroyed";
  return null;
}

export function isDefeated(unit: MechUnit): boolean {
  return defeatCauseOf(unit) !== null;
}

/**
 * Why a move would be illegal, or null when it is legal.
 *
 * Shared by the 1v1 and 3v3 formats so the rules live in one place — a second
 * copy of "is the matrix still sealed?" is exactly the kind of thing that
 * drifts and then disagrees with the on-chain verifier.
 */
export function validateMove(
  attacker: MechUnit,
  defender: MechUnit,
  sourceSlot: Exclude<ModuleSlot, "matrix">,
  moveIndex: number,
  targetSlot: ModuleSlot,
): string | null {
  if (isPartBroken(attacker, sourceSlot)) return `${sourceSlot} is broken`;

  const move = attacker.parts[sourceSlot].moves[moveIndex];
  if (!move) return "No such move";

  if (move.targetType === "self") {
    if (targetSlot !== "matrix" && isPartBroken(attacker, targetSlot)) return `${targetSlot} is broken`;
    return null;
  }
  if (targetSlot === "matrix" && !canAttackMatrix(defender)) return "Matrix locked — destroy an arm first";
  if (targetSlot !== "matrix" && isPartBroken(defender, targetSlot)) return "That part is already destroyed";
  return null;
}

/**
 * Apply one already-validated move. MUTATES both units, so callers must pass
 * copies they own. Returns the events describing what happened; it performs no
 * win check, because who has lost depends on the format.
 */
export function applyMove(
  attacker: MechUnit,
  defender: MechUnit,
  attackerSide: PlayerSide,
  sourceSlot: Exclude<ModuleSlot, "matrix">,
  moveIndex: number,
  targetSlot: ModuleSlot,
): BattleEvent[] {
  const events: BattleEvent[] = [];
  const defenderSide = opponentOf(attackerSide);
  const move = attacker.parts[sourceSlot].moves[moveIndex];

  const selfTargeted = move.targetType === "self";
  const target = selfTargeted ? attacker : defender;
  const targetSide = selfTargeted ? attackerSide : defenderSide;

  events.push({ type: "attack", side: attackerSide, moveName: move.name, sourceSlot });

  if (!selfTargeted && move.baseDamage > 0) {
    const amount = calculateDamage(move, attacker, defender, sourceSlot, targetSlot);
    const status = defender.partStatuses[targetSlot];
    const wasAlive = status.currentHP > 0;

    status.currentHP = Math.max(0, status.currentHP - amount);
    if (targetSlot === "matrix") defender.matrixHP = status.currentHP;

    events.push({
      type: "damage",
      side: defenderSide,
      targetSlot,
      amount,
      percent: status.maxHP > 0 ? (amount / status.maxHP) * 100 : 0,
      remaining: status.currentHP,
    });

    if (wasAlive && status.currentHP <= 0) {
      events.push({ type: "part-broken", side: defenderSide, slot: targetSlot, partName: status.partName });
      // Losing an arm exposes the core — worth calling out, since it's the
      // moment the match becomes winnable.
      if ((targetSlot === "rightArm" || targetSlot === "leftArm") && canAttackMatrix(defender)) {
        events.push({ type: "matrix-unlocked", side: defenderSide });
      }
    }
  }

  if (move.healAmount && move.healAmount > 0) {
    const status = target.partStatuses[targetSlot];
    const healed = Math.min(status.maxHP, status.currentHP + move.healAmount);
    const delta = healed - status.currentHP;
    status.currentHP = healed;
    if (targetSlot === "matrix") target.matrixHP = healed;
    events.push({ type: "heal", side: targetSide, targetSlot, amount: delta, remaining: healed });
  }

  // Riders land on the struck slot, matching Unity's ApplyEffect. A debuff
  // therefore weakens only the limb that was hit, not the whole mech.
  for (const mod of move.statModifiers) {
    const status = target.partStatuses[targetSlot];
    const current = status.buffs[mod.stat] ?? 0;
    const newStage = clamp(current + mod.amount, MIN_STAGE, MAX_STAGE);
    if (newStage !== current) {
      status.buffs[mod.stat] = newStage;
      events.push({ type: "stage", side: targetSide, targetSlot, stat: mod.stat, delta: mod.amount, newStage });
    }
  }

  return events;
}

/**
 * Who lands first this round.
 *
 * Higher effective SPD goes first — the SURVIVING assembly's SPD, so losing
 * the legs can cost you the initiative mid-fight.
 *
 * Ties alternate by round parity instead of always favouring p1. A fixed
 * tiebreak would hand one side a permanent edge in every mirror match, which
 * on a season ladder is an advantage nobody earned. Alternating stays fully
 * deterministic, so replay is unaffected.
 */
export function orderOfPlay(state: BattleState): [PlayerSide, PlayerSide] {
  const s1 = effectiveStats(state.p1).SPD;
  const s2 = effectiveStats(state.p2).SPD;
  if (s1 !== s2) return s1 > s2 ? ["p1", "p2"] : ["p2", "p1"];
  return state.round % 2 === 1 ? ["p1", "p2"] : ["p2", "p1"];
}

export interface ResolveResult {
  state: BattleState;
  events: BattleEvent[];
}

/**
 * Resolve one round: both sides have committed an action, and they play out in
 * speed order.
 *
 * This is simultaneous selection, Pokémon-style, and it is what removes both
 * of the problems alternating turns had. Nobody holds a permanent first-move
 * advantage — every side acts every round, and SPD only decides who lands
 * first WITHIN the round. And there is no "waiting for their turn" state to
 * sit in, so stalling has nothing to stall: a round either has both
 * commitments or it times out, which is a rule the program can enforce.
 *
 * ## Legality is judged at the START of the round
 *
 * Both sides commit against the same board, so both actions are validated
 * against that board — not against the board as it stands when they resolve.
 *
 * This matters more than it sounds. Validating mid-round meant the faster mech
 * could destroy the exact limb the slower one had committed to firing, and the
 * slower mech's whole round evaporated. Traced in a Titan/Arclight duel, the
 * Titan lost its arm on round 2 and then spent rounds landing NOTHING while
 * the Arclight free-hit it — that single rule, not any stat, was what put fast
 * chassis near 75% and slow ones near 30%.
 *
 * Committing an action now means it happens: the shot was already in motion
 * when the limb came off. A mech that is fully DEFEATED still doesn't act —
 * that is death, not a damaged part.
 */
export function resolveRound(state: BattleState, actions: RoundActions): ResolveResult {
  if (state.status.kind === "finished") {
    return { state, events: [{ type: "rejected", reason: "Battle is already over" }] };
  }

  const next = cloneState(state);
  const events: BattleEvent[] = [{ type: "round-start", round: next.round }];
  const [first, second] = orderOfPlay(state);

  // Judged against the pre-round board, before anything has been applied.
  const legality: Partial<Record<PlayerSide, string | null>> = {};
  for (const side of ["p1", "p2"] as PlayerSide[]) {
    const action = side === "p1" ? actions.p1 : actions.p2;
    if (!action) continue;
    legality[side] = validateMove(
      unitFor(state, side),
      unitFor(state, opponentOf(side)),
      action.sourceSlot, action.moveIndex, action.targetSlot,
    );
  }

  for (const side of [first, second]) {
    const action = side === "p1" ? actions.p1 : actions.p2;
    if (!action) continue;

    const actor = unitFor(next, side);
    // Only death stops a committed action.
    if (isDefeated(actor)) {
      events.push({ type: "rejected", reason: `${actor.name} was down before it could act` });
      continue;
    }

    const illegal = legality[side];
    if (illegal) {
      events.push({ type: "rejected", reason: illegal });
      continue;
    }

    const foe = unitFor(next, opponentOf(side));
    events.push(...applyMove(actor, foe, side, action.sourceSlot, action.moveIndex, action.targetSlot));
  }

  next.history.push(actions);

  // A double knockout is possible now that both sides act in the same round.
  // It resolves to the mech that was still standing when it acted — the
  // faster one wins the trade, which is the only reading consistent with
  // resolving in speed order.
  const causes: Array<{ side: PlayerSide; cause: DefeatCause }> = [];
  for (const side of ["p1", "p2"] as PlayerSide[]) {
    const cause = defeatCauseOf(unitFor(next, side));
    if (cause) causes.push({ side, cause });
  }

  if (causes.length > 0) {
    for (const c of causes) events.push({ type: "defeat-cause", side: c.side, cause: c.cause });
    const loser = causes.length === 2 ? second : causes[0].side;
    const winner = opponentOf(loser);
    next.status = { kind: "finished", winner };
    events.push({ type: "victory", winner });
    return { state: next, events };
  }

  next.round += 1;
  return { state: next, events };
}

/**
 * End a battle because a side ran out of clock or abandoned it.
 *
 * A forfeit is a real result, not a UI special case: the ladder has to record
 * it, and a replay has to be able to reproduce it. Keeping it in the engine
 * means "lost on time" settles through the same path as "lost the core".
 */
export function forfeit(state: BattleState, side: PlayerSide, reason: ForfeitReason = "timeout"): ResolveResult {
  if (state.status.kind === "finished") {
    return { state, events: [{ type: "rejected", reason: "Battle is already over" }] };
  }
  const next = cloneState(state);
  const winner = opponentOf(side);
  next.status = { kind: "finished", winner };
  return {
    state: next,
    events: [
      { type: "forfeit", side, reason },
      { type: "victory", winner },
    ],
  };
}

export type ForfeitReason = "timeout" | "abandoned";

/**
 * Replay a battle from its round list. The settlement path uses this to verify
 * a submitted result: same builds + same rounds must reproduce the claimed
 * winner, so a client cannot report a match it did not win.
 *
 * A forfeit is NOT in the round list — it has no action to replay — so a
 * verifier settles it from the clock rather than from this function.
 */
export function replay(
  p1Build: MechBuild,
  p2Build: MechBuild,
  rounds: RoundActions[],
  options: CreateBattleOptions = {},
): BattleState {
  let state = createBattle(p1Build, p2Build, options);
  for (const round of rounds) state = resolveRound(state, round).state;
  return state;
}

export function cloneUnit(unit: MechUnit): MechUnit {
  const statuses = {} as Record<ModuleSlot, PartStatus>;
  for (const slot of Object.keys(unit.partStatuses) as ModuleSlot[]) {
    const s = unit.partStatuses[slot];
    statuses[slot] = { ...s, buffs: { ...s.buffs } };
  }
  // Catalog entries (matrix, parts, totalStats) are immutable and shared by
  // reference on purpose — only the mutable per-battle status is deep-copied.
  return { ...unit, partStatuses: statuses };
}

function cloneState(state: BattleState): BattleState {
  return {
    p1: cloneUnit(state.p1),
    p2: cloneUnit(state.p2),
    status: state.status,
    round: state.round,
    history: [...state.history],
  };
}
