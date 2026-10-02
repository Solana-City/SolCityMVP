/**
 * Signing with the SERVER's clock, not the player's.
 *
 * The daily check-in is a message signed with a timestamp, and the server
 * refuses one more than a minute old — that window is what stops somebody
 * replaying a captured check-in forever. It also, quietly, refused every
 * check-in from a player whose computer clock was off by more than a minute.
 *
 * That is not a rare machine. A desktop that has been asleep, a phone with
 * automatic time switched off, a VM: a minute of drift is ordinary, and it
 * only ever grows. One player's streak stopped on 2026-09-24 and the panel
 * read "CHECKING IN..." for eight days, because the client treated the
 * rejection as a hard failure and gave up quietly. Their machine was 63
 * seconds behind; the window is 60.
 *
 * So the client learns the offset from the server itself — every check-in
 * response carries the server's own time — and signs with a corrected clock.
 * The replay window stays at one minute on the server's clock, which is the
 * only clock that was ever supposed to matter.
 */

let skewMs = 0;

/**
 * Records how far this machine is from the server. `serverTs` is the server's
 * own `Date.now()`, read out of a response; `receivedAt` is ours when it
 * arrived.
 *
 * The round trip makes this imprecise by however long the response took, and
 * that is fine: it is correcting MINUTES, inside a window of one.
 */
export function learnClockSkew(serverTs: number, receivedAt: number = Date.now()): void {
  if (!Number.isFinite(serverTs) || serverTs <= 0) return;
  skewMs = serverTs - receivedAt;
}

/** This machine's best guess at the server's clock. */
export function serverNow(): number {
  return Date.now() + skewMs;
}

/** How far off this machine is, in milliseconds. For diagnostics only. */
export function clockSkewMs(): number {
  return skewMs;
}

/** Testing seam. */
export function resetClockSkew(): void {
  skewMs = 0;
}
