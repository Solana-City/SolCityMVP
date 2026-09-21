/** Opens the city calendar panel from anywhere (map card shortcut, profile). */
export const OPEN_CALENDAR_EVENT = "solcity:open-calendar";

/** Fired with the fresh streak after each check-in, so the profile can show it. */
export const STREAK_EVENT = "solcity:streak";

export interface StreakView {
  current: number;
  best: number;
  checkedInToday: boolean;
  /** Recent check-in days (UTC, YYYY-MM-DD), oldest first. */
  recent: string[];
}
