/**
 * Sol Mechs PvP — one match, as a sequence of simultaneous exchanges.
 *
 * Both clients call `exchange` once per step, in the same order, because both
 * run the same engine over the same actions: a normal round is one step, and
 * so is each forced substitution after a knockout (even for the side that has
 * nothing to pick, which sends "none"). That is what keeps step numbers aligned
 * without any extra coordination.
 */
import type { TeamBattleState } from "../engine/TeamBattle";
import {
  commitHash, decodeAction, encodeAction, randomSalt, sameBytes, stateCheck,
  type WireAction,
} from "./protocol";
import type { MatchInfo, PvpTransport } from "./types";

export interface ExchangeResult {
  theirs: WireAction;
  /** Their board checksum disagreed with ours before this step. */
  desync: boolean;
}

export class PvpSession {
  private step = 0;
  private readonly abort = new AbortController();

  constructor(
    readonly transport: PvpTransport,
    readonly match: MatchInfo,
  ) {}

  /**
   * Commit mine, wait for theirs to be committed, reveal mine, wait for their
   * reveal. Neither client can learn the other's action before its own is
   * locked in, whatever order the network delivers things in.
   */
  async exchange(mine: WireAction, state: TeamBattleState): Promise<ExchangeResult> {
    const step = this.step;
    const signal = this.abort.signal;
    const action = encodeAction(mine);
    const salt = randomSalt();
    const check = stateCheck(state);

    await this.transport.commit(step, commitHash(this.match.matchId, step, action, salt));
    const theirCommitment = await this.transport.awaitOpponentCommit(step, signal);
    await this.transport.reveal(step, action, salt, check);
    const reveal = await this.transport.awaitOpponentReveal(step, signal);

    if (reveal.salt) {
      const recomputed = commitHash(this.match.matchId, step, reveal.action, reveal.salt);
      if (!sameBytes(recomputed, theirCommitment)) {
        throw new Error("The opponent's action does not match what they committed.");
      }
    }

    this.step = step + 1;
    return { theirs: decodeAction(reveal.action), desync: reveal.check !== check };
  }

  /** Abandons any exchange in flight. Leaving the match is `transport.leave`. */
  dispose(): void {
    this.abort.abort();
  }
}
