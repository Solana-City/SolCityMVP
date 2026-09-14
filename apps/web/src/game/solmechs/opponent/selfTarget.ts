/**
 * Sol Mechs — where a bot points a self-targeting move.
 *
 * Both AIs used to aim a buff at the limb that fired it. Every self move lives
 * on the legs, so the bot spent turns fortifying full-HP legs while its open
 * matrix was being shot. Stages are per slot (see calculateDamage), so the
 * slot is the whole decision:
 *
 *   - defensive stages (DEF/SYS) go where the damage is landing: the matrix
 *     once it is exposed, otherwise the most worn limb still standing;
 *   - offensive stages (ATK/ENG) go on the arm that actually swings with that
 *     stat, since only the firing limb's stage counts;
 *   - anything else (SPD, heals) protects the core.
 */
import type { MechUnit, ModuleSlot, MoveDefinition } from "../data/types";
import { availableMoves, canAttackMatrix, legalSelfTargets } from "../engine/BattleEngine";

export function bestSelfTarget(me: MechUnit, move: MoveDefinition): ModuleSlot {
  const legal = legalSelfTargets(me);
  const stats = move.statModifiers.map((m) => m.stat);
  const hpRatio = (s: ModuleSlot) => {
    const st = me.partStatuses[s];
    return st.maxHP > 0 ? st.currentHP / st.maxHP : 1;
  };

  if (stats.some((s) => s === "ATK" || s === "ENG")) {
    const wanted = stats.includes("ATK") ? "Physical" : "Energy";
    const striker = availableMoves(me)
      .filter((o) => o.move.baseDamage > 0 && o.move.damageType === wanted)
      .sort((a, b) => b.move.baseDamage - a.move.baseDamage)[0];
    if (striker && legal.includes(striker.slot)) return striker.slot;
  }

  if (stats.some((s) => s === "DEF" || s === "SYS") || move.healAmount) {
    if (canAttackMatrix(me)) return "matrix";
    const limbs = legal.filter((s) => s !== "matrix");
    const worn = [...limbs].sort((a, b) => hpRatio(a) - hpRatio(b))[0];
    if (worn && hpRatio(worn) < 1) return worn;
  }

  return "matrix";
}

/** True when a self move is worth a turn at all: it changes something. */
export function selfMoveIsUseful(me: MechUnit, move: MoveDefinition, target: ModuleSlot): boolean {
  if (move.healAmount) return me.partStatuses[target].currentHP < me.partStatuses[target].maxHP;
  return move.statModifiers.some((m) => {
    const cur = me.partStatuses[target].buffs[m.stat] ?? 0;
    return m.amount > 0 ? cur < 6 : cur > -6;
  });
}
