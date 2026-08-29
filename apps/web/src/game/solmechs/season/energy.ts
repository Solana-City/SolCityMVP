/**
 * Sol Mechs — energy. Caps ranked matches per day: a free daily grant plus a
 * bounded number of purchasable packs.
 *
 * Days are UTC day indices, not local dates — a reset keyed to the client's
 * timezone is one the client can move.
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
 * Roll the daily grant forward. Exactly one day's grant is credited however
 * long the player was away — accruing per missed day would defeat the daily
 * cap, and leaving MAX_BANKED to absorb it makes the intent implicit.
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
 * Credit a purchased pack. Ignores `MAX_BANKED`: that cap exists to stop free
 * energy compounding, and applying it here would silently void a purchase made
 * near the ceiling.
 *
 * Returns null if the daily limit is spent; check before taking payment.
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
