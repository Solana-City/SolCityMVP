/**
 * All tunable balance numbers in one place — playtest by editing this file,
 * never the engine/provider logic. Starting values from the GDD, not final.
 */

// ── Sky bounds & kite movement ──────────────────────────────────────────────
export const KITE_MOVE_SPEED = 220; // px/sec, WASD/arrow movement within the sky bounds
export const KITE_TILT_MAX_DEG = 18; // visual tilt toward horizontal movement direction
export const KITE_TILT_LERP = 0.15; // smoothing factor per tick

// ── Line length / exposure ───────────────────────────────────────────────────
export const MIN_LINE_LENGTH = 10; // meters, fully reeled in
export const MAX_LINE_LENGTH = 100; // meters, fully let out
export const REEL_IN_RATE = 35; // meters/sec while holding Space
export const LET_OUT_RATE = 25; // meters/sec while Space is released
export const START_LINE_LENGTH = 40;

/** 0 (reeled in) .. 1 (max line out). */
export function exposureFromLineLength(lineLength: number): number {
  return clamp01((lineLength - MIN_LINE_LENGTH) / (MAX_LINE_LENGTH - MIN_LINE_LENGTH));
}

// ── Scoring ───────────────────────────────────────────────────────────────────
export const BASE_SCORE_RATE = 8; // points/sec at zero exposure
/** points/sec = BASE_SCORE_RATE * (1 + exposure) — up to 2x at max exposure. */
export function scoreRatePerSecond(exposure: number): number {
  return BASE_SCORE_RATE * (1 + exposure);
}
export const CUT_SUCCESS_SCORE_BONUS = 250;
export const MULTIPLIER_STEPS = [1, 2, 3] as const;

// ── Wind ──────────────────────────────────────────────────────────────────────
export const WIND_CHANGE_MIN_MS = 15_000;
export const WIND_CHANGE_MAX_MS = 20_000;
export const WIND_DRAG_BASE_PX_PER_SEC: Record<"LOW" | "MEDIUM" | "HIGH", number> = {
  LOW: 12,
  MEDIUM: 28,
  HIGH: 48,
};
/** Wind drag is also multiplied by (1 + exposure) — up to 2x at max exposure. */
export function windDragMultiplier(exposure: number): number {
  return 1 + exposure;
}

// ── Cut-attempt probability model (Section 5b) ───────────────────────────────
export function cutSuccessChance(targetExposure: number): number {
  return clamp(0.15 + 0.35 * targetExposure, 0.15, 0.5);
}
/**
 * Backfire depends on the ATTACKER's own exposure: cutting with a tight,
 * reeled-in line is safe, cutting with lots of line out is a gamble. It
 * used to be "whatever is left after success + a fixed neutral", which made
 * a careful player's attempt on a reeled-in rival backfire 50% of the time
 * per roll, with no way to tell why the run ended.
 */
export function cutBackfireChance(attackerExposure: number): number {
  return clamp(0.04 + 0.26 * attackerExposure, 0.04, 0.3);
}
/**
 * How long the player has to hold the cut on a crossing before the rival's
 * line gives, by how much line the TARGET has out: a loose line saws through
 * fast, a tight one resists. This used to be a dice roll every 500ms, which
 * is why the same cut sometimes took one second and sometimes ten with
 * nothing on screen explaining the difference.
 */
export const PLAYER_CUT_TIGHT_MS = 3_200;
export const PLAYER_CUT_LOOSE_MS = 1_100;
export function playerCutDurationMs(targetExposure: number): number {
  return PLAYER_CUT_TIGHT_MS + (PLAYER_CUT_LOOSE_MS - PLAYER_CUT_TIGHT_MS) * clamp01(targetExposure);
}
/** The gamble is kept, but rolled ONCE, when the ring completes. */
export function cutBackfireRoll(attackerExposure: number): boolean {
  return Math.random() < cutBackfireChance(attackerExposure);
}

export function resolveCutAttempt(
  targetExposure: number,
  attackerExposure: number,
): "success" | "neutral" | "backfire" {
  const successChance = cutSuccessChance(targetExposure);
  const backfireChance = cutBackfireChance(attackerExposure);
  const roll = Math.random();
  if (roll < successChance) return "success";
  if (roll < successChance + backfireChance) return "backfire";
  return "neutral";
}
/**
 * Two kites' lines can only meaningfully cross if they're flying at a
 * similar depth — a kite reeled in close and one let far out aren't
 * actually near each other in 3D even if their 2D projections overlap.
 * Max allowed |exposureA - exposureB| (0-1) for a line-crossing to count.
 */
export const CUT_DEPTH_TOLERANCE = 0.4;

// ── Rival AI ──────────────────────────────────────────────────────────────────
export const RIVAL_SPAWN_DELAY_MS = 4_000;
export const RIVAL_RESPAWN_COOLDOWN_MS = 5_000;
export const RIVAL_LINE_OSCILLATION_PERIOD_MS = 6_000;
/** Sustained line crossing the rival needs before its cut roll fires.
 *  Drawn as a red ring filling at the crossing point. */
export const RIVAL_ATTACK_BUILDUP_MS = 3_000;
/** Rival glide speed cap, so it never teleports across the sky. */
export const RIVAL_MAX_SPEED_PX_PER_SEC = 260;
export const RIVAL_SKIN_COLOR = "#FF6B35";
export const PLAYER_SKIN_COLOR = "#9945FF";

// ── Misc ──────────────────────────────────────────────────────────────────────
export const READY_OVERLAY_MS = 1_200;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
