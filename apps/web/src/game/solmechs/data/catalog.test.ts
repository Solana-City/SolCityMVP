import { describe, expect, it } from "vitest";
import { MATRICES, PRESET_BUILDS, getPart, familyOf } from "./catalog";
import { availableMoves, createUnit, applyMove, getStage } from "../engine/BattleEngine";
import type { MechId } from "./types";

/** The kit a mech is born with: matrix, both arms, legs. */
const KITS = Object.entries(PRESET_BUILDS) as Array<[MechId, typeof PRESET_BUILDS[MechId]]>;

describe("the chassis carries the buff", () => {
  it("gives every matrix exactly one self-buff that deals no damage", () => {
    for (const matrix of MATRICES) {
      expect(matrix.moves).toHaveLength(1);
      const [move] = matrix.moves;
      expect(move.targetType).toBe("self");
      expect(move.baseDamage).toBe(0);
      expect(Object.keys(move.statModifiers ?? {}).length).toBeGreaterThan(0);
    }
  });

  it("offers the matrix buff alongside the limbs, and it raises a stage", () => {
    const unit = createUnit("A", PRESET_BUILDS.titan);
    const foe = createUnit("B", PRESET_BUILDS.striker);
    const fromMatrix = availableMoves(unit).find((o) => o.slot === "matrix");
    expect(fromMatrix?.move.name).toBe("Fortify");

    expect(getStage(unit, "matrix", "DEF")).toBe(0);
    applyMove(unit, foe, "p1", "matrix", fromMatrix!.moveIndex, "matrix");
    expect(getStage(unit, "matrix", "DEF")).toBe(1);
  });
});

describe("legs attack", () => {
  it("hits for the weaker arm's damage, with no debuff", () => {
    for (const [, build] of KITS) {
      const legs = getPart(build.lowerBody)!;
      const arms = [getPart(build.rightArm)!, getPart(build.leftArm)!];
      const weakest = Math.min(...arms.map((a) => a.moves[0].baseDamage));
      const [move] = legs.moves;
      expect(move.baseDamage).toBe(weakest);
      expect(move.targetType).toBe("single");
      expect(move.effect).toBeUndefined();
    }
  });

  it("uses the chassis' primary type: the right arm's, except Solus, which kicks", () => {
    for (const [id, build] of KITS) {
      const legs = getPart(build.lowerBody)!;
      const rightArm = getPart(build.rightArm)!;
      const expected = id === "solus" ? "Physical" : rightArm.moves[0].damageType;
      expect(legs.moves[0].damageType).toBe(expected);
    }
  });

  it("keeps one move per part, in the family it belongs to", () => {
    for (const [, build] of KITS) {
      for (const code of [build.rightArm, build.leftArm, build.lowerBody]) {
        expect(getPart(code)!.moves).toHaveLength(1);
        expect(familyOf(code)).toBe(familyOf(build.matrixCode));
      }
    }
  });
});
