import type { CutAttemptResult, CutOutcome, OpponentKiteProvider, OpponentKiteState } from "./types";
import {
  CUT_SUCCESS_SCORE_BONUS,
  RIVAL_ATTACK_BUILDUP_MS,
  RIVAL_LINE_OSCILLATION_PERIOD_MS,
  RIVAL_MAX_SPEED_PX_PER_SEC,
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
  /** Where the rival's handler stands (0..1 of the width). Picked once per
   *  life: the line used to re-anchor to whichever half of the screen the
   *  kite was over, so the whole line snapped sides mid-flight. */
  private anchorX = 0.12;
  /** Phase offset of the wander path, randomized per life so respawns
   *  don't all trace the same curve. */
  private pathSeed = 0;

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

    // Wander target: lissajous path, biased toward the handler's side so
    // the line never has to sweep across the whole screen.
    const t = this.elapsedMs / 1000 + this.pathSeed;
    const { width, height } = this.skyBounds;
    const sideBias = (this.anchorX - 0.5) * 0.25; // -0.095 .. +0.095
    const target = {
      x: width * (0.5 + sideBias) + Math.sin(t * 0.4) * width * 0.3,
      y: height * 0.35 + Math.sin(t * 0.27) * height * 0.18,
    };
    // Follow the target with a speed cap: a resize, a respawn or a frame
    // hitch can never teleport the kite, it always glides.
    const dx = target.x - this.position.x;
    const dy = target.y - this.position.y;
    const dist = Math.hypot(dx, dy);
    const step = RIVAL_MAX_SPEED_PX_PER_SEC * dtSeconds;
    if (dist <= step) {
      this.position = target;
    } else {
      this.position = { x: this.position.x + (dx / dist) * step, y: this.position.y + (dy / dist) * step };
    }

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
        anchorX: this.anchorX,
        threat: Math.min(1, this.attackTimerMs / RIVAL_ATTACK_BUILDUP_MS),
      },
    ];
  }

  cutOpponent(opponentId: string): CutAttemptResult {
    if (opponentId !== RIVAL_ID || !this.alive) {
      return { outcome: "neutral", scoreBonus: 0 };
    }
    this.killRival();
    return { outcome: "success", scoreBonus: CUT_SUCCESS_SCORE_BONUS };
  }

  /**
   * The rival rolls a cut attempt against the player. The engine only
   * calls this when the two lines are actually crossing (same check gating
   * the player's own attempts), and the attack needs RIVAL_ATTACK_BUILDUP_MS
   * of sustained crossing, exposed as `threat` so the engine can draw it
   * filling up. Every outcome is telegraphed, never out of nowhere.
   *
   * From the RIVAL's point of view as attacker: "success" = the rival cuts
   * the PLAYER's line (the player's run ends); "backfire" = the rival cuts
   * ITS OWN line instead (it dies and respawns); "neutral" = nothing.
   */
  rollOpponentAttacksOnPlayer(playerExposure: number, isNearby: boolean, dtSeconds: number): CutOutcome | null {
    if (!this.alive || !isNearby) {
      // Leaving range resets the buildup: escaping the crossing is the
      // player's counterplay to the red ring.
      this.attackTimerMs = 0;
      return null;
    }
    this.attackTimerMs += dtSeconds * 1000;
    if (this.attackTimerMs < RIVAL_ATTACK_BUILDUP_MS) return null;
    this.attackTimerMs = 0;
    const outcome = resolveCutAttempt(playerExposure, exposureFromLineLength(this.lineLength));
    if (outcome === "backfire") this.killRival();
    return outcome;
  }

  private respawn() {
    this.alive = true;
    this.attackTimerMs = 0;
    this.lineLength = MAX_LINE_LENGTH * 0.5;
    this.anchorX = Math.random() < 0.5 ? 0.12 : 0.88;
    this.pathSeed = Math.random() * 100;
    // Enter from the handler's edge of the sky and glide in.
    const fromLeft = this.anchorX < 0.5;
    this.position = {
      x: fromLeft ? -40 : this.skyBounds.width + 40,
      y: this.skyBounds.height * 0.3,
    };
  }

  private killRival() {
    this.alive = false;
    this.attackTimerMs = 0;
    this.spawnAtMs = this.elapsedMs + RIVAL_RESPAWN_COOLDOWN_MS;
  }
}
