/**
 * Sol Mechs — matrix and part catalog.
 *
 * Transcribed from the Unity ScriptableObjects:
 *   Resources/Matrices/M01–M05.asset
 *   Resources/Parts/{Right,Left,Lower}/{RA,LA,IN}01–05.asset
 *
 * Slot ↔ code prefix: RA = rightArm, LA = leftArm, IN = lowerBody.
 * Index 01–05 lines up with the matrix of the same number, so RA03 is
 * Arclight's right arm. Nothing enforces that pairing — mixing parts across
 * mechs is the point of the build system.
 */
import type { MechMatrix, MechPart, MechBuild, MechId } from "./types";
import { parseEffect } from "./moves";

/**
 * Roles come from Data/SolMechs_Matrices.json, which only covered the first
 * four mechs and used the pre-rename "Specter" for M02. Solus was added after
 * that file was last touched, hence the role assigned here rather than quoted.
 */
export const MATRICES: MechMatrix[] = [
  {
    matrixCode: "M01",
    matrixName: "Titan",
    id: "titan",
    role: "Tank",
    baseStats: { HP: 260, ATK: 45, DEF: 60, ENG: 30, SPD: 25, SYS: 40, PROC: 20 },
    passive1: "Fortify",
    passive2: "Thermal Stability",
  },
  {
    matrixCode: "M02",
    matrixName: "Striker",
    id: "striker",
    role: "Hacker",
    baseStats: { HP: 200, ATK: 45, DEF: 30, ENG: 40, SPD: 45, SYS: 40, PROC: 80 },
    passive1: "Hostile Instinct",
    passive2: "Backdoor",
  },
  {
    matrixCode: "M03",
    matrixName: "Arclight",
    id: "arclight",
    role: "Energy DPS",
    baseStats: { HP: 200, ATK: 30, DEF: 30, ENG: 60, SPD: 45, SYS: 35, PROC: 60 },
    passive1: "Residual Energy",
    passive2: "First Shot",
  },
  {
    matrixCode: "M04",
    matrixName: "HeartCore",
    id: "heartcore",
    role: "Support",
    baseStats: { HP: 250, ATK: 30, DEF: 45, ENG: 50, SPD: 25, SYS: 50, PROC: 60 },
    passive1: "Auto-Regen",
    passive2: "Echo Sensor",
  },
  {
    matrixCode: "M05",
    matrixName: "Solus",
    id: "solus",
    role: "All-Rounder",
    /**
     * REBALANCED. Every chassis now carries the SAME combat budget — 200
     * points across ATK/DEF/ENG/SPD/SYS — with the four base mechs shaped as
     * specialists (one stat at 60, the rest lower) and Solus flat.
     *
     * Solus is the mech with no weakness, so its flat value sits a little
     * above the others' average rather than at their peak. That last part is a
     * measured constraint, not a preference: flat 60 — matching a
     * specialist's peak in every stat — wins 100% of 144 duels and stays
     * unbeatable even with its HP cut to 150. Stats in this engine feed BOTH
     * sides of an exchange (damage is 2*atk/(atk+def)), so being at peak
     * everywhere means hitting harder AND taking less, and HP cannot buy that
     * back.
     *
     * Flat 45 puts it at 67% — clearly the best chassis, which suits a mech
     * earned by completing the collection, but one the other four can beat.
     * The cliff is sharp: 45 -> 67%, 50 -> 83%, 55 -> 100%.
     */
    baseStats: { HP: 260, ATK: 45, DEF: 45, ENG: 45, SPD: 45, SYS: 45, PROC: 0 },
    passive1: "Solana Speed",
    passive2: "Huge Community",
  },
];

/** Terser shape for transcription; expanded into MechPart below. */
interface RawPart {
  code: string;
  name: string;
  mech: MechId;
  stats: [HP: number, ATK: number, DEF: number, ENG: number, SPD: number, SYS: number];
  moves: Array<{
    name: string;
    dmg: number;
    type: "Physical" | "Energy" | "Effect";
    /** Unity's TargetType ordinal: 0 single, 1 self, 2 aoe. */
    target: 0 | 1 | 2;
    effect?: string;
  }>;
}

const RAW_RIGHT_ARMS: RawPart[] = [
  {
    code: "RA01", name: "Titan Claw", mech: "titan",
    stats: [100, 20, 30, 10, 10, 10],
    moves: [{ name: "Crush Grip", dmg: 50, type: "Physical", target: 0 }],
  },
  {
    code: "RA02", name: "Striker Cannon", mech: "striker",
    stats: [80, 30, 20, 10, 10, 10],
    moves: [{ name: "Piercing Shot", dmg: 65, type: "Physical", target: 0 }],
  },
  {
    code: "RA03", name: "Arclight Emitter", mech: "arclight",
    stats: [80, 10, 10, 30, 20, 10],
    moves: [{ name: "Arclight Ray", dmg: 65, type: "Energy", target: 0 }],
  },
  {
    code: "RA04", name: "HeartCore Blaster", mech: "heartcore",
    stats: [80, 10, 10, 30, 10, 20],
    moves: [{ name: "Pulse Wave", dmg: 50, type: "Energy", target: 0 }],
  },
  /**
   * Solus kit, REBALANCED alongside its chassis — see the M05 note. The Unity
   * values totalled 360 combat points against 210-220 for every other kit;
   * these are scaled to 215. HP is untouched, so the kit keeps its durability
   * and loses only the across-the-board stat lead.
   */
  {
    code: "RA05", name: "Solus Cannon", mech: "solus",
    stats: [100, 20, 20, 20, 10, 20],
    moves: [{ name: "Solus Burst", dmg: 65, type: "Energy", target: 2 }],
  },
];

const RAW_LEFT_ARMS: RawPart[] = [
  {
    code: "LA01", name: "Titan Hands", mech: "titan",
    stats: [100, 20, 30, 10, 10, 10],
    moves: [{ name: "Titan Punch", dmg: 40, type: "Physical", target: 0, effect: "-1 DEF" }],
  },
  {
    code: "LA02", name: "Striker Guns", mech: "striker",
    stats: [100, 30, 20, 10, 10, 10],
    moves: [{ name: "Striker Shot", dmg: 40, type: "Physical", target: 0, effect: "-1 ATK" }],
  },
  {
    code: "LA03", name: "Arclight Cannon", mech: "arclight",
    stats: [100, 10, 10, 20, 10, 30],
    moves: [{ name: "Overdrive Spike", dmg: 40, type: "Energy", target: 0, effect: "-1 ENG" }],
  },
  {
    code: "LA04", name: "HeartCore Disabler", mech: "heartcore",
    stats: [100, 10, 10, 20, 10, 30],
    moves: [
      { name: "Disable Motors", dmg: 40, type: "Energy", target: 0, effect: "-1 SYS" },
      { name: "Nano Repair", dmg: 0, type: "Energy", target: 1, effect: "+30HP" },
    ],
  },
  {
    code: "LA05", name: "Solus Blade", mech: "solus",
    stats: [100, 30, 20, 10, 10, 10],
    moves: [{ name: "Blade Rush", dmg: 45, type: "Physical", target: 0, effect: "-1 SPD" }],
  },
];

/**
 * Every lower body is a self-buff with no damage — legs are the utility slot.
 * IN05's .asset leaves damageType blank; "Effect" is the honest reading since
 * it deals no damage, and it keeps the field off the Physical/Energy split.
 */
const RAW_LOWER_BODIES: RawPart[] = [
  {
    code: "IN01", name: "Titan Legs", mech: "titan",
    stats: [140, 10, 10, 10, 10, 10],
    moves: [{ name: "Fortify", dmg: 0, type: "Effect", target: 1, effect: "+1 DEF" }],
  },
  {
    code: "IN02", name: "Striker Legs", mech: "striker",
    stats: [100, 20, 10, 10, 10, 10],
    moves: [{ name: "Focus Aim", dmg: 0, type: "Physical", target: 1, effect: "+1 ATK" }],
  },
  {
    code: "IN03", name: "Arclight Thrusters", mech: "arclight",
    stats: [100, 10, 10, 10, 10, 20],
    moves: [{ name: "Energy Boost", dmg: 0, type: "Energy", target: 1, effect: "+1 ENG" }],
  },
  {
    code: "IN04", name: "HeartCore Legs", mech: "heartcore",
    stats: [140, 10, 10, 10, 10, 10],
    moves: [{ name: "System Reboot", dmg: 0, type: "Energy", target: 1, effect: "+1 SYS" }],
  },
  {
    code: "IN05", name: "Solus Thrusters", mech: "solus",
    stats: [145, 10, 10, 10, 10, 10],
    moves: [{ name: "Boost Dash", dmg: 0, type: "Effect", target: 1, effect: "+1 SPD" }],
  },
];

const TARGET_BY_ORDINAL = ["single", "self", "aoe"] as const;

function expand(raw: RawPart, slot: MechPart["slot"]): MechPart {
  const [HP, ATK, DEF, ENG, SPD, SYS] = raw.stats;
  return {
    partCode: raw.code,
    partName: raw.name,
    slot,
    statModifiers: { HP, ATK, DEF, ENG, SPD, SYS, PROC: 0 },
    spriteMech: raw.mech,
    moves: raw.moves.map((m) => {
      const parsed = parseEffect(m.effect);
      return {
        name: m.name,
        baseDamage: m.dmg,
        damageType: m.type,
        targetType: TARGET_BY_ORDINAL[m.target],
        effect: m.effect,
        statModifiers: parsed.statModifiers,
        healAmount: parsed.healAmount,
      };
    }),
  };
}

export const RIGHT_ARMS: MechPart[] = RAW_RIGHT_ARMS.map((p) => expand(p, "rightArm"));
export const LEFT_ARMS: MechPart[] = RAW_LEFT_ARMS.map((p) => expand(p, "leftArm"));
export const LOWER_BODIES: MechPart[] = RAW_LOWER_BODIES.map((p) => expand(p, "lowerBody"));

export const ALL_PARTS: MechPart[] = [...RIGHT_ARMS, ...LEFT_ARMS, ...LOWER_BODIES];

const PART_BY_CODE = new Map(ALL_PARTS.map((p) => [p.partCode, p]));
const MATRIX_BY_CODE = new Map(MATRICES.map((m) => [m.matrixCode, m]));
const MATRIX_BY_ID = new Map(MATRICES.map((m) => [m.id, m]));

export function getPart(code: string): MechPart | undefined {
  return PART_BY_CODE.get(code);
}

export function getMatrix(code: string): MechMatrix | undefined {
  return MATRIX_BY_CODE.get(code);
}

export function getMatrixById(id: MechId): MechMatrix | undefined {
  return MATRIX_BY_ID.get(id);
}

export function getPartsForSlot(slot: MechPart["slot"]): MechPart[] {
  return ALL_PARTS.filter((p) => p.slot === slot);
}

/**
 * The two-digit family number shared by a matrix and its matching parts —
 * "RA03", "LA03", "IN03" and "M03" are all family "03". Ported from
 * PartCodeUtil.FamilyOf.
 */
export function familyOf(code: string): string | null {
  const m = /^(?:RA|LA|IN|M)(\d{2})$/.exec(code);
  return m ? m[1] : null;
}

/**
 * Parts selectable for a slot.
 *
 * Unity's EditorController shipped with `lockByFamily = true`, which filters
 * this to the parts matching the equipped matrix. Since every family has
 * exactly one part per slot, that leaves a single option and makes the
 * Workshop's cycling arrows inert — the flag exists precisely so it can be
 * turned off. Sol City defaults it off so the Workshop has something to do;
 * pass `lockToFamily` to restore the Unity behaviour.
 */
export function getSelectableParts(
  slot: MechPart["slot"],
  matrixCode: string,
  lockToFamily = false,
): MechPart[] {
  const parts = getPartsForSlot(slot);
  if (!lockToFamily) return parts;
  const family = familyOf(matrixCode);
  return family ? parts.filter((p) => familyOf(p.partCode) === family) : parts;
}

/**
 * The stock opponent the Workshop measures damage against.
 *
 * Striker's assembled build sits at the median of the five presets for both
 * defensive stats (DEF 80, SYS 90), so it is the least arbitrary yardstick
 * available — a "hits harder" readout against it means hits harder against a
 * typical mech, not against one cherry-picked matchup.
 */
export const REFERENCE_OPPONENT = "striker" as const;

/** The five stock builds — each mech wearing its own matching parts. */
export const PRESET_BUILDS: Record<MechId, MechBuild> = {
  titan:     { matrixCode: "M01", rightArm: "RA01", leftArm: "LA01", lowerBody: "IN01" },
  striker:   { matrixCode: "M02", rightArm: "RA02", leftArm: "LA02", lowerBody: "IN02" },
  arclight:  { matrixCode: "M03", rightArm: "RA03", leftArm: "LA03", lowerBody: "IN03" },
  heartcore: { matrixCode: "M04", rightArm: "RA04", leftArm: "LA04", lowerBody: "IN04" },
  solus:     { matrixCode: "M05", rightArm: "RA05", leftArm: "LA05", lowerBody: "IN05" },
};
