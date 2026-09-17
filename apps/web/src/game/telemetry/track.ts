/**
 * Client side of the gameplay events (/api/events).
 *
 * Fire and forget: a failed report must never interrupt play, so every call
 * swallows its errors and nothing awaits it. `keepalive` lets a report survive
 * the page being closed right after the action that caused it.
 *
 * What is sent: the wallet already visible to every player in the city, an
 * event kind from a fixed list, an id (protocol, NPC or mini-game) and a
 * number. No balances, no addresses, no transaction contents.
 */
export type TrackKind =
  | "protocol" | "protocol-open" | "minigame" | "hunt" | "duel" | "tutorial" | "quest"
  | "latency";

let currentWallet: string | null = null;

/** The city calls this when the wallet connects or disconnects. */
export function setTrackedWallet(wallet: string | null): void {
  currentWallet = wallet;
}

export function track(
  kind: TrackKind,
  id: string,
  opts: { value?: number; success?: boolean; label?: string; wallet?: string } = {},
): void {
  const wallet = opts.wallet ?? currentWallet;
  if (!wallet || typeof fetch === "undefined") return;
  try {
    void fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, id, wallet, value: opts.value, success: opts.success, label: opts.label }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* never let telemetry break the game */
  }
}
