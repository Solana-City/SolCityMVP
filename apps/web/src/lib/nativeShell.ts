/**
 * Detects the Sol City Android app (apps/android) around the page.
 *
 * The app is a WebView loading this same site, so one build serves desktop,
 * mobile browsers and the Seeker app. Anything app-only must be behind this
 * check, and anything native must be optional: in a browser `SolCityNative`
 * does not exist.
 *
 * The bridge object is the reliable signal. The user agent is only a fallback
 * for code that runs before the bridge is injected.
 */

export interface SolCityNative {
  version: () => string;
  haptic: (kind: "tap" | "select" | "heavy" | "success" | "warning") => void;
}

export function nativeShell(): SolCityNative | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { SolCityNative?: SolCityNative }).SolCityNative;
  return bridge ?? null;
}

export function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  if (nativeShell()) return true;
  return typeof navigator !== "undefined" && navigator.userAgent.includes("SolCityApp/");
}

/** Fires a haptic pattern; does nothing in a browser. */
export function haptic(kind: "tap" | "select" | "heavy" | "success" | "warning"): void {
  try {
    nativeShell()?.haptic(kind);
  } catch {
    // A bridge failure must never break gameplay.
  }
}
