/**
 * Client side of /api/won: has this wallet already won this thing.
 *
 * Separate from `boards.ts` because it is a different question. A board is a
 * ranking the city reads; this is one yes or no about the player in front of
 * you, and it survives a board being reset to start an event from zero.
 */

/**
 * False on anything that is not a clear yes.
 *
 * "No" and "could not ask" are not the same, and the caller must not treat
 * them as the same when deciding to GIVE something: a network blip would hand
 * out rewards. They collapse to false here so the decision is always the safe
 * one, and a caller that needs to tell them apart should read the response
 * itself rather than this helper.
 */
export async function hasWon(
  kind: string,
  id: string,
  wallet: string | null,
): Promise<boolean> {
  if (!wallet || typeof fetch === "undefined") return false;
  try {
    const params = new URLSearchParams({ kind, id, wallet });
    const res = await fetch(`/api/won?${params.toString()}`);
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean; won?: boolean };
    return body.ok === true && body.won === true;
  } catch {
    return false;
  }
}
