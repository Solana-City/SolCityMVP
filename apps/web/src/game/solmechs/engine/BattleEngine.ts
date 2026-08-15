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
const BALANCE = {
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
} as const;

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

/**
 * How the opening turn is decided.
 *
 *  - `"speed"` — higher total SPD moves first, ties to p1. This is what makes
 *    SPD (and therefore the legs slot, whose whole job is SPD) a stat worth
 *    building for; Unity left it decorative.
 *  - `"p1"` / `"p2"` — an explicit winner. Wagered on-chain matches must use
 *    this with a value derived from a commit-reveal seed: if first move came
 *    from SPD there, the advantage would simply be buyable at build time.
 */
export type FirstMoveRule = "speed" | "p1" | "p2";

export interface CreateBattleOptions {
  p1Name?: string;
  p2Name?: string;
  /** Defaults to "speed". */
  firstMove?: FirstMoveRule;
}

/** Ties break to p1 — arbitrary, but it must be deterministic for replay. */
function openingSide(p1: MechUnit, p2: MechUnit, rule: FirstMoveRule): PlayerSide {
  if (rule === "p1" || rule === "p2") return rule;
  return p2.totalStats.SPD > p1.totalStats.SPD ? "p2" : "p1";
}

export function createBattle(
  p1Build: MechBuild,
  p2Build: MechBuild,
  options: CreateBattleOptions = {},
): BattleState {
  const p1 = createUnit(options.p1Name ?? "Player 1", p1Build);
  const p2 = createUnit(options.p2Name ?? "Player 2", p2Build);
  return {
    p1,
    p2,
    status: { kind: "active", turn: openingSide(p1, p2, options.firstMove ?? "speed") },
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
 * Damage for one connecting hit.
 *
 *   atk = totalStats[ATK|ENG] * stageMult(firing limb's stage)
 *   def = totalStats[DEF|SYS] * stageMult(struck limb's stage)
 *   damage = floor(movePower * clamp(2*atk/(atk+def)) * DAMAGE_SCALE)
 *
 * Two things differ from the Unity original, both intentional:
 *
 *  - **Stats are the assembled totals, not the chassis base.** Unity read
 *    `chassis.baseStats` here, which meant every part's ATK/DEF/ENG/SYS was
 *    inert — a part contributed hit points and a move and nothing else, so
 *    the whole build editor was choosing between cosmetics. Reading
 *    `totalStats` is what makes a loadout a real decision.
 *  - **The curve is bounded** (see BALANCE), replacing the unbounded
 *    `atk / def` quotient.
 *
 * Unchanged and deliberate: stages are read per *slot* — the firing limb's
 * offensive stage against the struck limb's defensive stage — so a debuff
 * weakens one limb rather than the whole mech.
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

  // Math.max(1, …) guards the degenerate case where a build and a -6 stage
  // together round a stat to nothing, which would divide by zero below.
  const atk = Math.max(1, attacker.totalStats[atkStat] * stageMultiplier(getStage(attacker, sourceSlot, atkStat)));
  const def = Math.max(1, defender.totalStats[defStat] * stageMultiplier(getStage(defender, targetSlot, defStat)));

  const multiplier = clamp(
    (2 * atk) / (atk + def),
    BALANCE.MIN_MULTIPLIER,
    BALANCE.MAX_MULTIPLIER,
  );

  return Math.max(
    BALANCE.MIN_DAMAGE,
    Math.floor(move.baseDamage * multiplier * BALANCE.DAMAGE_SCALE),
  );
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
export function replay(
  p1Build: MechBuild,
  p2Build: MechBuild,
  actions: BattleAction[],
  /**
   * Must match what the original battle opened with — a replay under a
   * different rule desynchronizes on the very first action and would reject
   * an honest result.
   */
  options: CreateBattleOptions = {},
): BattleState {
  let state = createBattle(p1Build, p2Build, options);
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
