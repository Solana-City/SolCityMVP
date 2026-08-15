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

/** Floor on the attack/defense ratio, so a hopeless matchup still chips. */
const MIN_DAMAGE_MULTIPLIER = 0.1;

export type PlayerSide = "p1" | "p2";

export type BattleStatus =
  | { kind: "active"; turn: PlayerSide }
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
  | { type: "turn-start"; side: PlayerSide; turnNumber: number }
  | { type: "attack"; side: PlayerSide; moveName: string; sourceSlot: ModuleSlot }
  | { type: "damage"; side: PlayerSide; targetSlot: ModuleSlot; amount: number; percent: number; remaining: number }
  | { type: "heal"; side: PlayerSide; targetSlot: ModuleSlot; amount: number; remaining: number }
  | { type: "stage"; side: PlayerSide; targetSlot: ModuleSlot; stat: StageableStat; delta: number; newStage: number }
  | { type: "part-broken"; side: PlayerSide; slot: ModuleSlot; partName: string }
  | { type: "matrix-unlocked"; side: PlayerSide }
  | { type: "rejected"; reason: string }
  | { type: "victory"; winner: PlayerSide };

export interface BattleState {
  p1: MechUnit;
  p2: MechUnit;
  status: BattleStatus;
  turnNumber: number;
  /** Every action accepted so far, in order — the replayable battle record. */
  history: BattleAction[];
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

export function createBattle(p1Build: MechBuild, p2Build: MechBuild, p1Name = "Player 1", p2Name = "Player 2"): BattleState {
  return {
    p1: createUnit(p1Name, p1Build),
    p2: createUnit(p2Name, p2Build),
    // Unity's LocalBattleManager always opened on Player 1 rather than
    // comparing SPD. Kept as-is: for a wagered on-chain match, first move is
    // a real advantage and who gets it must be decided by the matchmaker
    // (seed/commit), not silently by whoever built the faster mech.
    status: { kind: "active", turn: "p1" },
    turnNumber: 1,
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

function opponentOf(side: PlayerSide): PlayerSide {
  return side === "p1" ? "p2" : "p1";
}

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
 * Verbatim port of LocalBattleManager.CalculateDamage.
 *
 *   damage = floor(moveDamage * max(0.1, effectiveATK / max(1, effectiveDEF)))
 *
 * Two quirks are deliberate, not oversights — changing either would rebalance
 * every matchup away from the Unity build:
 *  - the offensive/defensive stats come from the *chassis base* stats, so
 *    equipped parts contribute their ATK/DEF to nothing in this formula and
 *    matter only as hit points and as move providers;
 *  - stages are read per *slot* (the firing limb's ATK, the struck limb's
 *    DEF), so buffs are local to a limb rather than global to the mech.
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

  const baseAtk = physical ? attacker.matrix.baseStats.ATK : attacker.matrix.baseStats.ENG;
  const baseDef = physical ? defender.matrix.baseStats.DEF : defender.matrix.baseStats.SYS;

  const effectiveAtk = baseAtk * stageMultiplier(getStage(attacker, sourceSlot, atkStat));
  const effectiveDef = Math.max(1, baseDef * stageMultiplier(getStage(defender, targetSlot, defStat)));

  const multiplier = Math.max(MIN_DAMAGE_MULTIPLIER, effectiveAtk / effectiveDef);
  return Math.floor(move.baseDamage * multiplier);
}

// ==================== RESOLUTION ====================

export interface ResolveResult {
  state: BattleState;
  events: BattleEvent[];
}

/**
 * Apply one action and hand back the next state plus the events describing
 * what happened. The input state is never mutated — units are cloned first —
 * so callers can keep prior states around for replay and rollback.
 */
export function resolveAction(state: BattleState, action: BattleAction): ResolveResult {
  const events: BattleEvent[] = [];

  const reject = (reason: string): ResolveResult => ({
    state,
    events: [{ type: "rejected", reason }],
  });

  if (state.status.kind === "finished") return reject("Battle is already over");
  if (state.status.turn !== action.side) return reject("Not your turn");

  const next = cloneState(state);
  const attacker = unitFor(next, action.side);
  const defenderSide = opponentOf(action.side);
  const defender = unitFor(next, defenderSide);

  if (isPartBroken(attacker, action.sourceSlot)) return reject(`${action.sourceSlot} is broken`);

  const part = attacker.parts[action.sourceSlot];
  const move = part.moves[action.moveIndex];
  if (!move) return reject("No such move");

  const selfTargeted = move.targetType === "self";
  const target = selfTargeted ? attacker : defender;
  const targetSide = selfTargeted ? action.side : defenderSide;

  if (selfTargeted) {
    if (action.targetSlot !== "matrix" && isPartBroken(attacker, action.targetSlot)) {
      return reject(`${action.targetSlot} is broken`);
    }
  } else {
    if (action.targetSlot === "matrix" && !canAttackMatrix(defender)) {
      return reject("Matrix locked — destroy an arm first");
    }
    if (action.targetSlot !== "matrix" && isPartBroken(defender, action.targetSlot)) {
      return reject("That part is already destroyed");
    }
  }

  events.push({ type: "attack", side: action.side, moveName: move.name, sourceSlot: action.sourceSlot });

  // --- damage ---
  if (!selfTargeted && move.baseDamage > 0) {
    const amount = calculateDamage(move, attacker, defender, action.sourceSlot, action.targetSlot);
    const status = defender.partStatuses[action.targetSlot];
    const wasAlive = status.currentHP > 0;

    status.currentHP = Math.max(0, status.currentHP - amount);
    if (action.targetSlot === "matrix") defender.matrixHP = status.currentHP;

    events.push({
      type: "damage",
      side: defenderSide,
      targetSlot: action.targetSlot,
      amount,
      percent: status.maxHP > 0 ? (amount / status.maxHP) * 100 : 0,
      remaining: status.currentHP,
    });

    if (wasAlive && status.currentHP <= 0) {
      events.push({ type: "part-broken", side: defenderSide, slot: action.targetSlot, partName: status.partName });
      // Losing an arm exposes the core — worth calling out, since it's the
      // moment the match becomes winnable.
      if ((action.targetSlot === "rightArm" || action.targetSlot === "leftArm") && canAttackMatrix(defender)) {
        events.push({ type: "matrix-unlocked", side: defenderSide });
      }
    }
  }

  // --- heal ---
  if (move.healAmount && move.healAmount > 0) {
    const status = target.partStatuses[action.targetSlot];
    const healed = Math.min(status.maxHP, status.currentHP + move.healAmount);
    const delta = healed - status.currentHP;
    status.currentHP = healed;
    if (action.targetSlot === "matrix") target.matrixHP = healed;
    events.push({ type: "heal", side: targetSide, targetSlot: action.targetSlot, amount: delta, remaining: healed });
  }

  // --- stat stages ---
  // Riders land on the struck slot, matching Unity's ApplyEffect. A debuff
  // therefore weakens only the limb that was hit, not the whole mech.
  for (const mod of move.statModifiers) {
    const status = target.partStatuses[action.targetSlot];
    const current = status.buffs[mod.stat] ?? 0;
    const newStage = clamp(current + mod.amount, MIN_STAGE, MAX_STAGE);
    if (newStage !== current) {
      status.buffs[mod.stat] = newStage;
      events.push({
        type: "stage", side: targetSide, targetSlot: action.targetSlot,
        stat: mod.stat, delta: mod.amount, newStage,
      });
    }
  }

  next.history.push(action);

  // --- win check ---
  if (defender.matrixHP <= 0) {
    next.status = { kind: "finished", winner: action.side };
    events.push({ type: "victory", winner: action.side });
    return { state: next, events };
  }

  next.status = { kind: "active", turn: defenderSide };
  next.turnNumber += 1;
  events.push({ type: "turn-start", side: defenderSide, turnNumber: next.turnNumber });

  return { state: next, events };
}

/**
 * Replay a battle from its action list. The settlement path uses this to
 * verify a submitted result: same builds + same actions must reproduce the
 * claimed winner, so a client cannot report a match it did not win.
 */
export function replay(p1Build: MechBuild, p2Build: MechBuild, actions: BattleAction[]): BattleState {
  let state = createBattle(p1Build, p2Build);
  for (const action of actions) {
    state = resolveAction(state, action).state;
  }
  return state;
}

function cloneUnit(unit: MechUnit): MechUnit {
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
    turnNumber: state.turnNumber,
    history: [...state.history],
  };
}
