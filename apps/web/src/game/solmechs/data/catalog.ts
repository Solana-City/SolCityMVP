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
    baseStats: { HP: 260, ATK: 40, DEF: 60, ENG: 40, SPD: 20, SYS: 20, PROC: 20 },
    passive1: "Fortify",
    passive2: "Thermal Stability",
  },
  {
    matrixCode: "M02",
    matrixName: "Striker",
    id: "striker",
    role: "Hacker",
    baseStats: { HP: 180, ATK: 40, DEF: 30, ENG: 40, SPD: 40, SYS: 60, PROC: 80 },
    passive1: "Hostile Instinct",
    passive2: "Backdoor",
  },
  {
    matrixCode: "M03",
    matrixName: "Arclight",
    id: "arclight",
    role: "Energy DPS",
    baseStats: { HP: 180, ATK: 40, DEF: 20, ENG: 80, SPD: 40, SYS: 30, PROC: 60 },
    passive1: "Residual Energy",
    passive2: "First Shot",
  },
  {
    matrixCode: "M04",
    matrixName: "HeartCore",
    id: "heartcore",
    role: "Support",
    baseStats: { HP: 240, ATK: 30, DEF: 40, ENG: 50, SPD: 20, SYS: 40, PROC: 60 },
    passive1: "Auto-Regen",
    passive2: "Echo Sensor",
  },
  {
    matrixCode: "M05",
    matrixName: "Solus",
    id: "solus",
    role: "All-Rounder",
    baseStats: { HP: 260, ATK: 60, DEF: 60, ENG: 60, SPD: 60, SYS: 60, PROC: 0 },
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
  {
    code: "RA05", name: "Solus Cannon", mech: "solus",
    stats: [100, 30, 30, 30, 15, 30],
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
    stats: [100, 40, 30, 20, 15, 20],
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
    stats: [145, 20, 20, 20, 20, 20],
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

/** The five stock builds — each mech wearing its own matching parts. */
export const PRESET_BUILDS: Record<MechId, MechBuild> = {
  titan:     { matrixCode: "M01", rightArm: "RA01", leftArm: "LA01", lowerBody: "IN01" },
  striker:   { matrixCode: "M02", rightArm: "RA02", leftArm: "LA02", lowerBody: "IN02" },
  arclight:  { matrixCode: "M03", rightArm: "RA03", leftArm: "LA03", lowerBody: "IN03" },
  heartcore: { matrixCode: "M04", rightArm: "RA04", leftArm: "LA04", lowerBody: "IN04" },
  solus:     { matrixCode: "M05", rightArm: "RA05", leftArm: "LA05", lowerBody: "IN05" },
};
