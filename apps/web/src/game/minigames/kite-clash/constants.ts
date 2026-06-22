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
export const CUT_NEUTRAL_CHANCE = 0.35;
export function cutSuccessChance(targetExposure: number): number {
  return clamp(0.15 + 0.35 * targetExposure, 0.15, 0.5);
}
export function resolveCutAttempt(targetExposure: number): "success" | "neutral" | "backfire" {
  const successChance = cutSuccessChance(targetExposure);
  const roll = Math.random();
  if (roll < successChance) return "success";
  if (roll < successChance + CUT_NEUTRAL_CHANCE) return "neutral";
  return "backfire";
}
/** Resolution ticks, not every frame — feels like discrete attempts. */
export const CUT_RESOLUTION_INTERVAL_MS = 500;
/** Max distance (px, at a 900px-wide canvas — engine scales this up on wider screens)
 * between player and an opponent's kite to count as "lines crossing". */
export const CUT_OVERLAP_RANGE_PX = 70;

// ── Rival AI ──────────────────────────────────────────────────────────────────
export const RIVAL_SPAWN_DELAY_MS = 4_000;
export const RIVAL_RESPAWN_COOLDOWN_MS = 5_000;
export const RIVAL_LINE_OSCILLATION_PERIOD_MS = 6_000;
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
