/** Opens the city calendar panel from anywhere (map card shortcut, profile). */
export const OPEN_CALENDAR_EVENT = "solcity:open-calendar";

/** Fired with the fresh streak after each check-in, so the profile can show it. */
export const STREAK_EVENT = "solcity:streak";

/**
 * Fired when the check-in gave up without going through.
 *
 * The profile used to say "CHECKING IN..." until the panel closed, whether it
 * was still trying or had stopped minutes ago. That label is how a broken
 * check-in went unnoticed for eight days.
 */
export const CHECKIN_STALLED_EVENT = "solcity:checkin-stalled";

export interface StreakView {
  current: number;
  best: number;
  checkedInToday: boolean;
  /** Recent check-in days (UTC, YYYY-MM-DD), oldest first. */
  recent: string[];
}
