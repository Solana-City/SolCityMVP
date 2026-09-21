import { track } from "@/game/telemetry/track";

/**
 * Automatic page reloads, with a paper trail.
 *
 * Three things reload the page on their own: a new deploy (SWUpdater), a
 * chunk that failed to load (ChunkReloadGuard) and a wallet-looking render
 * error (ErrorBoundary). To a player every one of them looks the same — the
 * city blinks and they respawn at the fountain — and none of them said which
 * it was. Each now records its reason before reloading; the next load prints
 * it to the console and reports it.
 */

const KEY = "solcity:last-auto-reload";

export function reloadWithReason(reason: string, detail?: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      reason,
      detail: detail?.slice(0, 300),
      at: Date.now(),
    }));
  } catch { /* storage blocked — reload anyway */ }
  window.location.reload();
}

/** Call once per page load: surfaces why the previous load reloaded itself. */
export function reportPreviousReload(): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
  } catch { return; }
  if (!raw) return;
  try {
    const { reason, detail, at } = JSON.parse(raw) as { reason: string; detail?: string; at: number };
    // Only a reload that just happened is this page's story.
    if (Date.now() - at > 5 * 60_000) return;
    console.warn(
      `[reload] the page reloaded itself: ${reason}` +
      (detail ? ` | ${detail}` : "") +
      ` | ${Math.round((Date.now() - at) / 1000)}s ago`,
    );
    track("session", "auto-reload", { label: detail ? `${reason}: ${detail.slice(0, 80)}` : reason });
  } catch { /* malformed — ignore */ }
}
