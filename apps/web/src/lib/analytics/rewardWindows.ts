/**
 * Mini-games whose win is owed a reward, and when a win still counts.
 *
 * `ev:<kind>:<id>:won` takes the `success` the client reports. For a game with
 * nothing riding on it that is fine: the set only lets the city give back an
 * unlock a cleared browser lost. For a game whose winners are owed an event
 * item it is not, because anybody holding a session key can report a win
 * (audit r2, R2-02). This is the least the server can hold such a win to:
 * inside the event's window, and with the score the reward asks for.
 *
 * It is still the client's own score. What actually stands between this set
 * and an event item is the list an operator vets before `event-drop.ts build`
 * (see that script): no event root is built from this set as it is.
 */
import { HALLOWEEN_ENDS_AT } from "@/game/halloween/event";
import { PASS_ACCURACY } from "@/game/minigames/pumpkin-carving/pattern";

interface RewardWindow {
  /** First instant (ms) at which a win no longer counts. */
  endsAt: number;
  /** Lowest reported score that is a win. */
  minScore: number;
}

/** Keyed `<kind>:<id>`. A game not listed here has no reward riding on it. */
export const REWARD_WINDOWS: Readonly<Record<string, RewardWindow>> = {
  "minigame:pumpkin-carving": { endsAt: HALLOWEEN_ENDS_AT, minScore: PASS_ACCURACY },
};

/** Whether a reported result may enter `ev:<kind>:<id>:won`. */
export function countsAsWin(
  kind: string, id: string, success: boolean | undefined, score: number, now = Date.now(),
): boolean {
  if (success !== true) return false;
  const window = REWARD_WINDOWS[`${kind}:${id}`];
  if (!window) return true;
  return now < window.endsAt && score >= window.minScore;
}
