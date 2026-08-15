/**
 * Sol Mechs — effect-string parsing.
 *
 * The Unity .asset files encode a move's rider as a short authored string on
 * MoveDefinition.effect rather than as structured data:
 *
 *   "-1 DEF"   one stage of DEF off the target
 *   "+1 ATK"   one stage of ATK onto the target (self-buff legs)
 *   "+30HP"    flat heal, no spaces (Nano Repair)
 *
 * BattleManager.cs read these with ad-hoc string checks at damage time. Doing
 * it once at load keeps the engine working on structured StatModifiers, so the
 * combat math never touches strings.
 */
import type { StatModifier, StageableStat } from "./types";

const STAGEABLE: StageableStat[] = ["ATK", "DEF", "ENG", "SPD", "SYS"];

/** "+1 DEF" / "-2 spd" — sign, magnitude, stat. */
const STAGE_RE = /([+-]?\d+)\s*(ATK|DEF|ENG|SPD|SYS)/i;
/** "+30HP" / "+30 HP" — heals are flat points, not stages. */
const HEAL_RE = /([+-]?\d+)\s*HP/i;

export interface ParsedEffect {
  statModifiers: StatModifier[];
  healAmount?: number;
}

export function parseEffect(effect?: string): ParsedEffect {
  if (!effect || !effect.trim()) return { statModifiers: [] };

  // HP is checked first: it's the only numeric rider that isn't a stage, and
  // testing STAGE_RE first would never match it anyway — but ordering it here
  // makes the "heals are not stages" rule explicit rather than incidental.
  const heal = HEAL_RE.exec(effect);
  if (heal) {
    return { statModifiers: [], healAmount: parseInt(heal[1], 10) };
  }

  const stage = STAGE_RE.exec(effect);
  if (stage) {
    const amount = parseInt(stage[1], 10);
    const stat = stage[2].toUpperCase() as StageableStat;
    if (STAGEABLE.includes(stat) && amount !== 0) {
      // Unity's StatModifier.chance defaulted to 1.0 and no .asset ever set it
      // to anything else, so every parsed rider always lands.
      return { statModifiers: [{ stat, amount, chance: 1 }] };
    }
  }

  return { statModifiers: [] };
}
