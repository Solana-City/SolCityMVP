/**
 * Sol Mechs — team composition and its legality rules.
 *
 * A team is three mechs fought one at a time with substitution. The binding
 * constraint is **part uniqueness**: no part code may appear twice across the
 * whole team, in any slot.
 *
 * That single rule is what stops a team from being "my best build, three
 * times". Every slot has five options and a team needs three, so a legal team
 * is always reachable — but each mech after the first has to give something
 * up, which is the interesting part.
 *
 * Uniqueness covers the matrix too. The matrix is a part in this model, and
 * exempting it would let all three mechs share one chassis and differ only in
 * limbs, which is most of the way back to the problem the rule exists to
 * prevent.
 */
import type { MechBuild, ModuleSlot } from "./types";
import { getMatrix, getPart } from "./catalog";

export const TEAM_SIZE = 3;

export interface TeamBuild {
  /** Exactly TEAM_SIZE builds, in the order they'll be sent out. */
  mechs: MechBuild[];
}

/** The four codes a build occupies, in slot order. */
export function codesOf(build: MechBuild): Record<ModuleSlot, string> {
  return {
    matrix: build.matrixCode,
    rightArm: build.rightArm,
    leftArm: build.leftArm,
    lowerBody: build.lowerBody,
  };
}

export interface TeamViolation {
  /** Which slot the clash is in. */
  slot: ModuleSlot;
  /** The duplicated part code. */
  code: string;
  /** Indices of the mechs sharing it. */
  mechIndices: number[];
}

export interface TeamValidation {
  ok: boolean;
  violations: TeamViolation[];
  /** Human-readable summary, empty when the team is legal. */
  messages: string[];
}

const SLOT_LABEL: Record<ModuleSlot, string> = {
  matrix: "Matrix",
  rightArm: "Right Arm",
  leftArm: "Left Arm",
  lowerBody: "Legs",
};

function nameFor(slot: ModuleSlot, code: string): string {
  if (slot === "matrix") return getMatrix(code)?.matrixName ?? code;
  return getPart(code)?.partName ?? code;
}

/**
 * Check a team against the uniqueness rule.
 *
 * Reports every clash rather than the first, so the team builder can mark all
 * the offending mechs at once instead of making the player fix them one
 * reload at a time.
 */
export function validateTeam(team: TeamBuild): TeamValidation {
  const violations: TeamViolation[] = [];
  const slots: ModuleSlot[] = ["matrix", "rightArm", "leftArm", "lowerBody"];

  for (const slot of slots) {
    const byCode = new Map<string, number[]>();
    team.mechs.forEach((build, i) => {
      const code = codesOf(build)[slot];
      const seen = byCode.get(code);
      if (seen) seen.push(i);
      else byCode.set(code, [i]);
    });
    for (const [code, mechIndices] of byCode) {
      if (mechIndices.length > 1) violations.push({ slot, code, mechIndices });
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    messages: violations.map(
      (v) => `${SLOT_LABEL[v.slot]} "${nameFor(v.slot, v.code)}" is used by mechs ${v.mechIndices.map((i) => i + 1).join(" and ")}.`,
    ),
  };
}

/**
 * Codes already spoken for by the rest of the team — what a slot picker must
 * grey out for `mechIndex`.
 */
export function takenCodes(team: TeamBuild, mechIndex: number, slot: ModuleSlot): Set<string> {
  const taken = new Set<string>();
  team.mechs.forEach((build, i) => {
    if (i !== mechIndex) taken.add(codesOf(build)[slot]);
  });
  return taken;
}

/** True when this mech may take this code without clashing with its team. */
export function isCodeAvailable(team: TeamBuild, mechIndex: number, slot: ModuleSlot, code: string): boolean {
  return !takenCodes(team, mechIndex, slot).has(code);
}
