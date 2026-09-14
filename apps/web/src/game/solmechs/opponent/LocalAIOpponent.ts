/**
 * Sol Mechs — local AI opponent.
 *
 * Stands in for a second player until ER matchmaking is live, and stays useful
 * afterwards as the practice/PvE opponent. It implements the same interface a
 * network opponent will (`chooseAction`), so the battle UI does not need to
 * know whether it is playing a bot or a person.
 *
 * The AI is deliberately readable rather than strong: it plays the obvious
 * line — open the core, then hit the core — which teaches the limb/matrix rule
 * to a new player through its behaviour.
 */
import type { BattleAction, BattleState, PlayerSide } from "../engine/BattleEngine";
import { availableMoves, legalTargets, canAttackMatrix, calculateDamage } from "../engine/BattleEngine";
import type { ModuleSlot } from "../data/types";

export interface OpponentProvider {
  /** Resolve to the action this opponent takes, or null to forfeit the turn. */
  chooseAction(state: BattleState, side: PlayerSide): Promise<BattleAction | null>;
}

export type AIDifficulty = "rookie" | "veteran";

export class LocalAIOpponent implements OpponentProvider {
  constructor(
    private difficulty: AIDifficulty = "veteran",
    /** Injected so battles stay reproducible in tests; defaults to Math.random. */
    private rng: () => number = Math.random,
    /** Thinking delay in ms, so the AI's turn is legible instead of instant. */
    private thinkMs = 650,
  ) {}

  async chooseAction(state: BattleState, side: PlayerSide): Promise<BattleAction | null> {
    await new Promise((r) => setTimeout(r, this.thinkMs));

    const me = side === "p1" ? state.p1 : state.p2;
    const foe = side === "p1" ? state.p2 : state.p1;

    const options = availableMoves(me);
    if (options.length === 0) return null;

    const targets = legalTargets(foe);
    if (targets.length === 0) return null;

    // Rookie picks at random among legal plays — enough to be beatable while
    // still respecting the rules.
    if (this.difficulty === "rookie") {
      const pick = options[Math.floor(this.rng() * options.length)];
      const target = pick.move.targetType === "self"
        ? "matrix" as ModuleSlot
        : targets[Math.floor(this.rng() * targets.length)];
      return { side, sourceSlot: pick.slot, moveIndex: pick.moveIndex, targetSlot: target };
    }

    // Veteran: score every legal (move, target) pair and take the best.
    let best: { action: BattleAction; score: number } | null = null;

    for (const opt of options) {
      if (opt.move.targetType === "self") {
        // Self-buffs are worth taking early, when there are turns left to
        // spend the boost, but are dead weight once the core is exposed.
        const score = canAttackMatrix(foe) ? -50 : 25 + opt.move.statModifiers.length * 10;
        const action: BattleAction = {
          side, sourceSlot: opt.slot, moveIndex: opt.moveIndex, targetSlot: opt.slot,
        };
        if (!best || score > best.score) best = { action, score };
        continue;
      }

      for (const target of targets) {
        const dmg = calculateDamage(opt.move, me, foe, opt.slot, target);
        const status = foe.partStatuses[target];
        let score = dmg;

        // The core ends the match, so damage to it counts double.
        if (target === "matrix") score *= 2;

        // Finishing a limb is worth more than the raw damage suggests: an arm
        // kill is what unlocks the core, and overkill on a nearly-dead part is
        // otherwise wasted.
        if (dmg >= status.currentHP) {
          score += target === "rightArm" || target === "leftArm" ? 60 : 20;
        } else {
          score -= Math.max(0, dmg - status.currentHP) * 0.5;
        }

        // While the core is sealed, prefer chewing on arms over legs.
        if (!canAttackMatrix(foe) && target === "lowerBody") score -= 25;

        if (!best || score > best.score) {
          best = {
            action: { side, sourceSlot: opt.slot, moveIndex: opt.moveIndex, targetSlot: target },
            score,
          };
        }
      }
    }

    return best?.action ?? null;
  }
}
