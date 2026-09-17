/**
 * Play sessions: how long someone stayed, and on what.
 *
 * The chain knows a wallet moved; it cannot say whether that was one long
 * evening or six short visits, and that difference is the whole question
 * behind "average time of play" and retention. So a session is measured here:
 * it starts when the city is entered and ends when the tab is hidden for long
 * enough or closed.
 *
 * Device is recorded as a coarse class (phone, tablet or desktop) rather than
 * a user agent string. It answers "what should we design for" without keeping
 * anything that identifies a person.
 */
import { track } from "./track";

/** Hidden for longer than this and the session is over, not paused. */
const AWAY_MS = 60_000;
/** A session shorter than this was a bounce, not a visit. */
const MIN_SESSION_MS = 5_000;

export type DeviceClass = "phone" | "tablet" | "desktop";

let startedAt = 0;
let hiddenAt = 0;
let awayTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

export function deviceClass(): DeviceClass {
  if (typeof window === "undefined") return "desktop";
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const shortest = Math.min(window.screen?.width ?? 1024, window.screen?.height ?? 768);
  if (!coarse) return "desktop";
  return shortest >= 700 ? "tablet" : "phone";
}

function endSession(): void {
  if (!started) return;
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  started = false;
  if (Date.now() - startedAt < MIN_SESSION_MS) return;
  // The value carries the length; the id carries the device, so the panel can
  // answer "how long do people play, and on what" from one row.
  track("session", deviceClass(), { value: seconds, label: `${seconds}s` });
}

function onVisibility(): void {
  if (document.visibilityState === "hidden") {
    hiddenAt = Date.now();
    awayTimer = setTimeout(endSession, AWAY_MS);
    return;
  }
  // Back within the grace window: the same session continues.
  if (awayTimer) { clearTimeout(awayTimer); awayTimer = null; }
  if (!started && hiddenAt > 0) startSession();
}

/** Called once the city is up. Safe to call again; only the first one counts. */
export function startSession(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  startedAt = Date.now();
  track("session", `start-${deviceClass()}`, { label: "entered the city" });

  if (hiddenAt === 0) {
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", endSession);
  }
  hiddenAt = Date.now();
}
