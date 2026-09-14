/**
 * Sol Mechs — core data model.
 *
 * Ported from the Unity project (SolMechsEvolution/MechBattle/Assets):
 *   StatBlock.cs, Matrix.cs, MechPart.cs, ModuleData.cs, ModuleSlot.cs,
 *   AttackData.cs, PartStatus.cs, TargetType.cs
 *
 * The Unity build kept two parallel sources of truth: a set of JSON files
 * (Data/SolMechs_*.json) and the ScriptableObject .asset files under
 * Resources/. They disagree — the JSON has 4 matrices with HP 40-80, the
 * .assets have 5 with HP 180-260 and a PROC stat the JSON never had.
 * The .asset files are the later, playable balance pass (they're what the
 * scenes actually load via MechUnitLoader), so they are canonical here.
 */

/** The four body slots a mech is assembled from. Mirrors ModuleSlot.cs. */
export type ModuleSlot = "rightArm" | "leftArm" | "lowerBody" | "matrix";

export const MODULE_SLOTS: ModuleSlot[] = ["rightArm", "leftArm", "lowerBody", "matrix"];

/** Slots that can be targeted/destroyed independently of the core. */
export const LIMB_SLOTS: ModuleSlot[] = ["rightArm", "leftArm", "lowerBody"];

/**
 * Physical attacks weigh ATK against DEF; Energy weighs ENG against SYS.
 * "Effect" moves deal no damage and only apply stat stages.
 */
export type DamageType = "Physical" | "Energy" | "Effect";

/** Mirrors TargetType.cs — the enum's ordinal is what the .asset files store. */
export type TargetType = "single" | "self" | "aoe";

export const TARGET_TYPE_BY_ORDINAL: TargetType[] = ["single", "self", "aoe"];

/** Mirrors StatBlock.cs. */
export interface StatBlock {
  HP: number;
  ATK: number;
  DEF: number;
  ENG: number;
  SPD: number;
  SYS: number;
  PROC: number;
}

/** The five stats a buff/debuff stage can move. HP and PROC are not staged. */
export type StageableStat = "ATK" | "DEF" | "ENG" | "SPD" | "SYS";

export const ZERO_STATS: StatBlock = {
  HP: 0, ATK: 0, DEF: 0, ENG: 0, SPD: 0, SYS: 0, PROC: 0,
};

export function addStats(a: StatBlock, b: StatBlock): StatBlock {
  return {
    HP: a.HP + b.HP,
    ATK: a.ATK + b.ATK,
    DEF: a.DEF + b.DEF,
    ENG: a.ENG + b.ENG,
    SPD: a.SPD + b.SPD,
    SYS: a.SYS + b.SYS,
    PROC: a.PROC + b.PROC,
  };
}

/**
 * A stat stage change carried by a move.
 *
 * In Unity these lived on MoveDefinition.statModifiers and were authored in
 * the Inspector, while the .asset files instead encode the same thing as a
 * terse `effect` string ("-1 DEF", "+30HP"). parseEffect() in moves.ts
 * normalizes those strings into this shape so both authoring styles land in
 * one representation.
 */
export interface StatModifier {
  stat: StageableStat;
  /** Stages, not points: +1 raises one stage on the multiplier ladder. */
  amount: number;
  /** 0..1. Unity defaulted this to 1 (always applies). */
  chance: number;
}

/** Mirrors MoveDefinition (MechPart.cs) after effect-string parsing. */
export interface MoveDefinition {
  name: string;
  baseDamage: number;
  damageType: DamageType;
  targetType: TargetType;
  /** Raw authored effect string, kept for tooltips//debugging. */
  effect?: string;
  /** Stat stages applied on hit, parsed from `effect` or authored directly. */
  statModifiers: StatModifier[];
  /** Flat HP restored to the target, from effects like "+30HP". */
  healAmount?: number;
}

/** Mirrors MechPart.cs — one equippable limb. */
export interface MechPart {
  partCode: string;
  partName: string;
  slot: ModuleSlot;
  /** Added to the chassis' base stats. `HP` here is the part's own hit points. */
  statModifiers: StatBlock;
  moves: MoveDefinition[];
  /** Which mech's sprite set this part is drawn from. */
  spriteMech: MechId;
}

/** Mirrors Matrix.cs — the chassis/core. */
export interface MechMatrix {
  matrixCode: string;
  matrixName: string;
  id: MechId;
  role: string;
  baseStats: StatBlock;
  passive1: string;
  passive2: string;
}

export type MechId = "titan" | "striker" | "arclight" | "heartcore" | "solus";

export const MECH_IDS: MechId[] = ["titan", "striker", "arclight", "heartcore", "solus"];

/**
 * A player's assembled mech: one matrix plus a part per limb slot.
 * Parts are stored by code so a build is a small, serializable value —
 * which matters because this is what gets written on-chain.
 */
export interface MechBuild {
  matrixCode: string;
  rightArm: string;
  leftArm: string;
  lowerBody: string;
}

/** Mirrors PartStatus.cs — per-slot runtime state during a battle. */
export interface PartStatus {
  partName: string;
  maxHP: number;
  currentHP: number;
  /** Stage values in [-6, 6] per stat. */
  buffs: Partial<Record<StageableStat, number>>;
}

/** Mirrors MechUnit.cs — a battle-ready instance of a build. */
export interface MechUnit {
  name: string;
  build: MechBuild;
  matrix: MechMatrix;
  parts: Record<Exclude<ModuleSlot, "matrix">, MechPart>;
  /** Chassis base + every equipped part's stat modifiers. */
  totalStats: StatBlock;
  matrixHP: number;
  matrixMaxHP: number;
  partStatuses: Record<ModuleSlot, PartStatus>;
}
