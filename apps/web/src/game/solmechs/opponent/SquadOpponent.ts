/**
 * Sol Mechs — where player 2's decisions come from in a squad battle.
 *
 * The battle screen asks one question per step, "what does the rival do?",
 * and hands over its own choice with it. The local AI ignores that argument.
 * A networked opponent needs it, because both actions are committed together
 * (pvp/session.ts). Beyond `remote` — which changes copy and the rival clock —
 * the screen cannot tell the two apart.
 */
import {
  activeUnit, switchableIndices,
  type TeamAction, type TeamBattleState,
} from "../engine/TeamBattle";
import { availableMoves, calculateDamage, legalTargets } from "../engine/BattleEngine";
import { fromWire, toWire, type WireAction } from "../pvp/protocol";
import type { PvpSession } from "../pvp/session";
import { bestSelfTarget, selfMoveIsUseful } from "./selfTarget";

export interface SquadOpponent {
  readonly name: string;
  /** Breaks speed ties. Shared with a remote opponent. */
  readonly seed: number;
  /** See TeamBattle `invertTies`. */
  readonly invertTies: boolean;
  readonly remote: boolean;

  /** The rival's action for a round. A local AI must not read `mine`. */
  exchangeRound(state: TeamBattleState, mine: TeamAction | null): Promise<TeamAction | null>;
  /** The rival's replacement after a knockout, if it owes one. */
  exchangeForced(state: TeamBattleState, mine: number | undefined): Promise<number | undefined>;

  onGone(cb: () => void): () => void;
  onDesync(cb: () => void): () => void;
  /** Leave the match. The other side sees it and wins. */
  resign(): void;
}

/** The CPU's pick for a round, from the pre-round board only. */
export function chooseRivalRound(s: TeamBattleState): TeamAction | null {
  const me = activeUnit(s.p2);
  const foe = activeUnit(s.p1);
  const opts = availableMoves(me).filter((o) => o.move.targetType !== "self");
  if (opts.length === 0) {
    // Nothing left that deals damage: bring in the healthiest reserve.
    const sw = switchableIndices(s.p2);
    if (sw.length) {
      const health = (i: number) => s.p2.units[i].matrixHP / Math.max(1, s.p2.units[i].matrixMaxHP);
      return { kind: "switch", side: "p2", toIndex: [...sw].sort((a, b) => health(b) - health(a))[0] };
    }
    // Last mech standing: its self moves go where they help (usually the
    // exposed matrix), never back onto the full-HP legs that fired them.
    const self = availableMoves(me)
      .map((o) => ({ o, target: bestSelfTarget(me, o.move) }))
      .sort((a, b) => Number(selfMoveIsUseful(me, b.o.move, b.target)) - Number(selfMoveIsUseful(me, a.o.move, a.target)))[0];
    return self
      ? { kind: "move", side: "p2", sourceSlot: self.o.slot, moveIndex: self.o.moveIndex, targetSlot: self.target }
      : null;
  }
  const targets = legalTargets(foe);
  let best: { a: TeamAction; sc: number } | null = null;
  for (const o of opts) {
    for (const t of targets) {
      let sc = calculateDamage(o.move, me, foe, o.slot, t);
      if (t === "matrix") sc *= 2;
      if (sc >= foe.partStatuses[t].currentHP) sc += 45;
      if (!best || sc > best.sc) {
        best = { a: { kind: "move", side: "p2", sourceSlot: o.slot, moveIndex: o.moveIndex, targetSlot: t }, sc };
      }
    }
  }
  return best?.a ?? null;
}

export class LocalSquadAI implements SquadOpponent {
  readonly name = "Rival";
  readonly remote = false;
  readonly invertTies = false;
  readonly seed = Math.floor(Math.random() * 0x7fffffff);

  async exchangeRound(state: TeamBattleState): Promise<TeamAction | null> {
    return chooseRivalRound(state);
  }

  async exchangeForced(state: TeamBattleState): Promise<number | undefined> {
    if (state.status.kind !== "awaiting-switch" || !state.status.sides.includes("p2")) return undefined;
    return switchableIndices(state.p2)[0];
  }

  onGone(): () => void { return () => undefined; }
  onDesync(): () => void { return () => undefined; }
  resign(): void {}
}

export class RemoteSquadOpponent implements SquadOpponent {
  readonly remote = true;
  private readonly desyncListeners = new Set<() => void>();
  private desynced = false;

  constructor(private readonly session: PvpSession) {}

  get name(): string { return this.session.match.opponent.name; }
  get seed(): number { return this.session.match.seed; }
  get invertTies(): boolean { return this.session.match.role === "guest"; }

  async exchangeRound(state: TeamBattleState, mine: TeamAction | null): Promise<TeamAction | null> {
    const { theirs, desync } = await this.session.exchange(toWire(mine), state);
    this.noteDesync(desync);
    return fromWire(theirs, "p2");
  }

  async exchangeForced(state: TeamBattleState, mine: number | undefined): Promise<number | undefined> {
    const wire: WireAction = mine === undefined ? { kind: "none" } : { kind: "switch", toIndex: mine };
    const { theirs, desync } = await this.session.exchange(wire, state);
    this.noteDesync(desync);
    return theirs.kind === "switch" ? theirs.toIndex : undefined;
  }

  onGone(cb: () => void): () => void {
    return this.session.transport.onOpponentGone(cb);
  }

  onDesync(cb: () => void): () => void {
    this.desyncListeners.add(cb);
    return () => { this.desyncListeners.delete(cb); };
  }

  resign(): void {
    this.session.dispose();
    void this.session.transport.leave().catch(() => undefined);
  }

  private noteDesync(desync: boolean): void {
    if (!desync || this.desynced) return;
    this.desynced = true;
    for (const cb of this.desyncListeners) cb();
  }
}
