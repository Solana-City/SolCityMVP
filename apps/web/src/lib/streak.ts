/**
 * Daily check-in streaks.
 *
 * One check-in per wallet per UTC day. Coming back the next day grows the
 * streak; missing a day starts it over at 1. The best streak ever is kept on
 * a board (`lb:streak`), which is what the city shows as "longest streak".
 *
 * Keys:
 *   streak:<wallet>  -> JSON StreakRecord
 *   lb:streak        -> sorted set wallet -> best streak
 */
import { get, set, storeMode, zmax } from "@/lib/kv";

export { storeMode };

export const STREAK_BOARD_KEY = "lb:streak";
/** How many recent check-in days are kept, for the week strip. */
const RECENT_DAYS = 7;

export interface StreakRecord {
  /** Consecutive days up to `last`. */
  count: number;
  best: number;
  /** UTC day of the last check-in, YYYY-MM-DD. */
  last: string | null;
  /** The most recent check-in days, oldest first. */
  recent: string[];
}

/** What a player sees: `current` is 0 once a day has been missed. */
export interface StreakView {
  current: number;
  best: number;
  checkedInToday: boolean;
  recent: string[];
}

export function utcDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function previousDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return utcDay(d);
}

const EMPTY: StreakRecord = { count: 0, best: 0, last: null, recent: [] };

/** Pure: the record after checking in on `today`. Same day twice is a no-op. */
export function advanceStreak(rec: StreakRecord, today: string): { record: StreakRecord; changed: boolean } {
  if (rec.last === today) return { record: rec, changed: false };
  const count = rec.last === previousDay(today) ? rec.count + 1 : 1;
  return {
    record: {
      count,
      best: Math.max(rec.best, count),
      last: today,
      recent: [...rec.recent.filter((d) => d !== today), today].slice(-RECENT_DAYS),
    },
    changed: true,
  };
}

/** Pure: how a stored record reads on `today`. */
export function viewStreak(rec: StreakRecord, today: string): StreakView {
  const alive = rec.last === today || rec.last === previousDay(today);
  return {
    current: alive ? rec.count : 0,
    best: rec.best,
    checkedInToday: rec.last === today,
    recent: rec.recent,
  };
}

async function load(wallet: string): Promise<StreakRecord> {
  const raw = await get(`streak:${wallet}`);
  if (!raw) return EMPTY;
  try { return { ...EMPTY, ...JSON.parse(raw) }; } catch { return EMPTY; }
}

export async function readStreak(wallet: string): Promise<StreakView> {
  return viewStreak(await load(wallet), utcDay());
}

export async function checkIn(wallet: string): Promise<StreakView> {
  const today = utcDay();
  const { record, changed } = advanceStreak(await load(wallet), today);
  if (changed) {
    await set(`streak:${wallet}`, JSON.stringify(record));
    await zmax(STREAK_BOARD_KEY, wallet, record.best);
  }
  return viewStreak(record, today);
}
