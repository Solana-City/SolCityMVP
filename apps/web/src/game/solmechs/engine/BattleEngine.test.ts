import { describe, expect, it } from "vitest";
import {
  BALANCE, allLimbsDestroyed, availableMoves, calculateDamage, canAttackMatrix,
  createBattle, createUnit, isPartBroken, legalTargets, replay, resolveRound, tieBreak,
  type BattleAction, type BattleState, type PlayerSide, type RoundActions,
} from "./BattleEngine";
import { PRESET_BUILDS } from "../data/catalog";
import type { ModuleSlot } from "../data/types";

/**
 * The battle rules. `resolveRound` is a pure reducer and `replay` rebuilds a
 * match from its rounds, which is what makes a result checkable by someone who
 * was not there. These tests pin the three rules a cheating client would go
 * for, plus determinism, because the Rust port has to reproduce all of it
 * exactly.
 */

function freshBattle(seed = 1234): BattleState {
  return createBattle(PRESET_BUILDS.titan, PRESET_BUILDS.striker, { seed });
}

/** The first legal attack available to a side. */
function anyAttack(state: BattleState, side: PlayerSide): BattleAction {
  const unit = state[side];
  const move = availableMoves(unit)[0];
  const target = legalTargets(state[side === "p1" ? "p2" : "p1"])[0];
  return { side, sourceSlot: move.slot, moveIndex: move.moveIndex, targetSlot: target };
}

describe("createUnit", () => {
  it("starts every part alive and unstaged", () => {
    const unit = createUnit("Test", PRESET_BUILDS.titan);
    for (const slot of Object.keys(unit.partStatuses) as ModuleSlot[]) {
      expect(unit.partStatuses[slot].currentHP).toBe(unit.partStatuses[slot].maxHP);
      expect(isPartBroken(unit, slot)).toBe(false);
    }
  });
});

describe("calculateDamage", () => {
  const attacker = createUnit("A", PRESET_BUILDS.titan);
  const defender = createUnit("B", PRESET_BUILDS.striker);
  // The first option is the matrix self-buff now, which deals no damage.
  const attack = availableMoves(attacker).find((o) => o.move.baseDamage > 0)!;
  const move = attack.move;
  const sourceSlot = attack.slot;

  it("always does at least the floor when a move connects", () => {
    const damage = calculateDamage(move, attacker, defender, sourceSlot, "rightArm");
    expect(damage).toBeGreaterThanOrEqual(BALANCE.MIN_DAMAGE);
  });

  it("is deterministic: the same inputs give the same number", () => {
    const first = calculateDamage(move, attacker, defender, sourceSlot, "rightArm");
    const second = calculateDamage(move, attacker, defender, sourceSlot, "rightArm");
    expect(first).toBe(second);
  });

  it("stays inside the multiplier bounds however lopsided the matchup", () => {
    const damage = calculateDamage(move, attacker, defender, sourceSlot, "rightArm");
    const floor = Math.floor(move.baseDamage * BALANCE.MIN_MULTIPLIER * BALANCE.DAMAGE_SCALE);
    const ceiling = Math.ceil(move.baseDamage * BALANCE.MAX_MULTIPLIER * BALANCE.DAMAGE_SCALE);
    expect(damage).toBeGreaterThanOrEqual(Math.max(BALANCE.MIN_DAMAGE, floor));
    expect(damage).toBeLessThanOrEqual(ceiling);
  });

  it("returns a whole number, since HP is integral", () => {
    expect(Number.isInteger(calculateDamage(move, attacker, defender, sourceSlot, "rightArm"))).toBe(true);
  });
});

describe("the matrix rule", () => {
  it("is sealed while both arms are intact", () => {
    const unit = createUnit("B", PRESET_BUILDS.striker);
    expect(canAttackMatrix(unit)).toBe(false);
    expect(legalTargets(unit)).not.toContain("matrix");
  });

  it("opens once an arm is destroyed, and legs alone do not open it", () => {
    const legsGone = createUnit("B", PRESET_BUILDS.striker);
    legsGone.partStatuses.lowerBody.currentHP = 0;
    expect(canAttackMatrix(legsGone)).toBe(false);

    const armGone = createUnit("B", PRESET_BUILDS.striker);
    armGone.partStatuses.rightArm.currentHP = 0;
    expect(canAttackMatrix(armGone)).toBe(true);
    expect(legalTargets(armGone)).toContain("matrix");
  });
});

describe("broken parts", () => {
  it("cannot act", () => {
    const unit = createUnit("A", PRESET_BUILDS.titan);
    const before = availableMoves(unit).length;
    unit.partStatuses.rightArm.currentHP = 0;
    const after = availableMoves(unit);
    expect(after.length).toBeLessThan(before);
    expect(after.every((m) => m.slot !== "rightArm")).toBe(true);
  });

  it("cannot be targeted", () => {
    const unit = createUnit("B", PRESET_BUILDS.striker);
    unit.partStatuses.leftArm.currentHP = 0;
    expect(legalTargets(unit)).not.toContain("leftArm");
  });

  it("all three limbs down is a loss condition", () => {
    const unit = createUnit("B", PRESET_BUILDS.striker);
    expect(allLimbsDestroyed(unit)).toBe(false);
    unit.partStatuses.rightArm.currentHP = 0;
    unit.partStatuses.leftArm.currentHP = 0;
    unit.partStatuses.lowerBody.currentHP = 0;
    expect(allLimbsDestroyed(unit)).toBe(true);
  });
});

describe("resolveRound", () => {
  it("does not mutate the state it was given", () => {
    const state = freshBattle();
    const before = JSON.stringify(state);
    resolveRound(state, { p1: anyAttack(state, "p1"), p2: anyAttack(state, "p2") });
    expect(JSON.stringify(state)).toBe(before);
  });

  it("advances the round and records what happened", () => {
    const state = freshBattle();
    const { state: next } = resolveRound(state, { p1: anyAttack(state, "p1"), p2: anyAttack(state, "p2") });
    expect(next.round).toBe(state.round + 1);
    expect(next.history).toHaveLength(1);
  });

  it("is deterministic: the same round from the same state twice is identical", () => {
    const state = freshBattle();
    const actions = { p1: anyAttack(state, "p1"), p2: anyAttack(state, "p2") };
    const first = resolveRound(state, actions).state;
    const second = resolveRound(state, actions).state;
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("replay", () => {
  it("rebuilds the same battle from its round list", () => {
    let state = freshBattle(99);
    const rounds: RoundActions[] = [];
    for (let i = 0; i < 6 && state.status.kind === "active"; i++) {
      const actions = { p1: anyAttack(state, "p1"), p2: anyAttack(state, "p2") };
      rounds.push(actions);
      state = resolveRound(state, actions).state;
    }

    const replayed = replay(PRESET_BUILDS.titan, PRESET_BUILDS.striker, rounds, { seed: 99 });
    expect(replayed.status).toEqual(state.status);
    expect(replayed.p1.partStatuses).toEqual(state.p1.partStatuses);
    expect(replayed.p2.partStatuses).toEqual(state.p2.partStatuses);
  });

  it("reaches a different board with a different seed, since the seed breaks ties", () => {
    expect(tieBreak(1, 1)).toBeTypeOf("boolean");
    const seeds = new Set([tieBreak(1, 1), tieBreak(2, 1), tieBreak(3, 1), tieBreak(4, 1)]);
    // Across a handful of seeds both outcomes should appear; a constant would
    // mean the tie-break is not actually seeded.
    expect(seeds.size).toBe(2);
  });
});

describe("tieBreak", () => {
  it("is stable for the same seed and round", () => {
    expect(tieBreak(777, 3)).toBe(tieBreak(777, 3));
  });

  it("varies by round, so one side does not open every round", () => {
    const rounds = new Set(Array.from({ length: 12 }, (_, i) => tieBreak(777, i + 1)));
    expect(rounds.size).toBe(2);
  });
});
