/**
 * Sol Mechs — energy.
 *
 * Energy is what makes the ladder a competition rather than an endurance
 * test: everyone gets the same small number of ranked matches a day, and the
 * one purchasable pack is capped so spend cannot be converted into rank
 * without bound. Remove that cap and the leaderboard stops being a contest
 * and becomes an auction for a share of the prize pool.
 *
 * Days are UTC day indices rather than local dates. A reset that depends on
 * the client's timezone is a reset a client can move.
 */
import { ENERGY } from "./config";

const DAY_MS = 86_400_000;

export interface EnergyState {
  /** Current balance. */
  energy: number;
  /** UTC day index of the last refill. */
  day: number;
  /** Packs bought during `day`. */
  packsToday: number;
}

export function dayIndex(nowMs: number): number {
  return Math.floor(nowMs / DAY_MS);
}

export function newEnergy(nowMs: number): EnergyState {
  return { energy: ENERGY.DAILY_FREE, day: dayIndex(nowMs), packsToday: 0 };
}

/**
 * Roll the daily grant forward.
 *
 * Exactly ONE day's grant is credited no matter how long the player was away
 * — accruing per missed day would hand a returning account a month of matches
 * at once, which is the opposite of what the daily cap is for. The bank cap
 * would blunt that anyway; granting once makes the intent explicit rather
 * than leaving it to a `Math.min` to enforce.
 */
export function refresh(state: EnergyState, nowMs: number): EnergyState {
  const day = dayIndex(nowMs);
  if (day === state.day) return state;
  return {
    energy: Math.min(ENERGY.MAX_BANKED, state.energy + ENERGY.DAILY_FREE),
    day,
    packsToday: 0,
  };
}

export function canPlay(state: EnergyState, nowMs: number): boolean {
  return refresh(state, nowMs).energy >= ENERGY.COST_PER_MATCH;
}

/** Charge one ranked match. Returns null when the player cannot afford it. */
export function spendForMatch(state: EnergyState, nowMs: number): EnergyState | null {
  const s = refresh(state, nowMs);
  if (s.energy < ENERGY.COST_PER_MATCH) return null;
  return { ...s, energy: s.energy - ENERGY.COST_PER_MATCH };
}

export function canBuyPack(state: EnergyState, nowMs: number): boolean {
  return refresh(state, nowMs).packsToday < ENERGY.PACKS_PER_DAY;
}

/**
 * Credit a purchased pack.
 *
 * Purchased energy deliberately IGNORES `MAX_BANKED`. The bank cap exists to
 * stop free energy compounding while a player is away; applying it here would
 * mean taking someone's money and handing them nothing when they happen to be
 * near the ceiling.
 *
 * Returns null if the daily pack limit is already spent — the caller must
 * check before taking payment.
 */
export function creditPack(state: EnergyState, nowMs: number): EnergyState | null {
  const s = refresh(state, nowMs);
  if (s.packsToday >= ENERGY.PACKS_PER_DAY) return null;
  return { ...s, energy: s.energy + ENERGY.PACK_SIZE, packsToday: s.packsToday + 1 };
}

/** Ms until the next daily grant, for the UI countdown. */
export function msUntilRefill(nowMs: number): number {
  return (dayIndex(nowMs) + 1) * DAY_MS - nowMs;
}

/** Most matches a wallet can play in one day, free grant plus the pack cap. */
export const MAX_MATCHES_PER_DAY =
  ENERGY.DAILY_FREE + ENERGY.PACK_SIZE * ENERGY.PACKS_PER_DAY;
