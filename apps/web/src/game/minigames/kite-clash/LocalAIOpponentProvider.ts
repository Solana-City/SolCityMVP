import type { CutAttemptResult, CutOutcome, OpponentKiteProvider, OpponentKiteState } from "./types";
import {
  CUT_SUCCESS_SCORE_BONUS,
  RIVAL_LINE_OSCILLATION_PERIOD_MS,
  RIVAL_RESPAWN_COOLDOWN_MS,
  RIVAL_SKIN_COLOR,
  RIVAL_SPAWN_DELAY_MS,
  exposureFromLineLength,
  resolveCutAttempt,
  MIN_LINE_LENGTH,
  MAX_LINE_LENGTH,
} from "./constants";

const RIVAL_ID = "kite-pro-rival";

/**
 * Single AI-controlled rival standing in for real opponents this MVP.
 * Flies a scripted path, oscillates its own line length (so it has a
 * readable exposure state the player can target), and occasionally rolls
 * a cut attempt against the player. Swappable later for a provider backed
 * by real players over Ephemeral Rollups — same interface, see types.ts.
 */
export class LocalAIOpponentProvider implements OpponentKiteProvider {
  private elapsedMs = 0;
  private spawnAtMs = RIVAL_SPAWN_DELAY_MS;
  private alive = false;
  private position = { x: 0, y: 0 };
  private lineLength = MAX_LINE_LENGTH * 0.5;
  private skyBounds: { width: number; height: number };
  private attackTimerMs = 0;
  private readonly ATTACK_INTERVAL_MS = 3_000;

  constructor(skyBounds: { width: number; height: number }) {
    this.skyBounds = skyBounds;
  }

  setSkyBounds(bounds: { width: number; height: number }) {
    this.skyBounds = bounds;
  }

  update(dtSeconds: number): void {
    this.elapsedMs += dtSeconds * 1000;

    if (!this.alive) {
      if (this.elapsedMs >= this.spawnAtMs) this.respawn();
      return;
    }

    // Simple lissajous-ish wandering path within the sky bounds.
    const t = this.elapsedMs / 1000;
    this.position = {
      x: this.skyBounds.width * 0.5 + Math.sin(t * 0.4) * this.skyBounds.width * 0.32,
      y: this.skyBounds.height * 0.35 + Math.sin(t * 0.27) * this.skyBounds.height * 0.18,
    };

    // Oscillate line length so the rival has its own visible exposure state.
    const phase = (this.elapsedMs % RIVAL_LINE_OSCILLATION_PERIOD_MS) / RIVAL_LINE_OSCILLATION_PERIOD_MS;
    const wave = (Math.sin(phase * Math.PI * 2) + 1) / 2; // 0..1
    this.lineLength = MIN_LINE_LENGTH + wave * (MAX_LINE_LENGTH - MIN_LINE_LENGTH);

  }

  getActiveOpponents(): OpponentKiteState[] {
    if (!this.alive) return [];
    return [
      {
        id: RIVAL_ID,
        position: this.position,
        lineLength: this.lineLength,
        exposure: exposureFromLineLength(this.lineLength),
        skinColor: RIVAL_SKIN_COLOR,
        alive: this.alive,
      },
    ];
  }

  attemptCut(opponentId: string, _attackerExposure: number): CutAttemptResult {
    if (opponentId !== RIVAL_ID || !this.alive) {
      return { outcome: "neutral", scoreBonus: 0 };
    }
    const targetExposure = exposureFromLineLength(this.lineLength);
    const outcome = resolveCutAttempt(targetExposure);
    if (outcome === "success") {
      this.killRival();
      return { outcome, scoreBonus: CUT_SUCCESS_SCORE_BONUS };
    }
    return { outcome, scoreBonus: 0 };
  }

  /**
   * The rival rolls a cut attempt against the player. The engine only
   * calls this when it has already determined the two kites' lines are
   * actually close enough to cross (same proximity check gating the
   * player's own attempts) — so every outcome here, including a
   * self-inflicted "backfire", reads as caused by something the player
   * can see happening, not a random event out of nowhere.
   *
   * From the RIVAL's point of view as attacker: "success" = the rival cuts
   * the PLAYER's line (the player's run ends — rival is unaffected and
   * keeps flying); "backfire" = the rival cuts ITS OWN line instead (it
   * dies and respawns after the usual cooldown); "neutral" = nothing.
   */
  rollOpponentAttacksOnPlayer(playerExposure: number, isNearby: boolean, dtSeconds: number): CutOutcome | null {
    if (!this.alive || !isNearby) {
      // Leaving range resets the buildup — requires sustained proximity,
      // not just a single passing frame, before the next attack fires.
      this.attackTimerMs = 0;
      return null;
    }
    this.attackTimerMs += dtSeconds * 1000;
    if (this.attackTimerMs < this.ATTACK_INTERVAL_MS) return null;
    this.attackTimerMs = 0;
    const outcome = resolveCutAttempt(playerExposure);
    if (outcome === "backfire") this.killRival();
    return outcome;
  }

  private respawn() {
    this.alive = true;
    this.lineLength = MAX_LINE_LENGTH * 0.5;
  }

  private killRival() {
    this.alive = false;
    this.scheduleRespawn();
  }

  private scheduleRespawn() {
    this.alive = false;
    this.spawnAtMs = this.elapsedMs + RIVAL_RESPAWN_COOLDOWN_MS;
  }
}
