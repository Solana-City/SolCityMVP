/**
 * Sol Mechs — which mechs a wallet may field.
 *
 * Read from chain rather than from saved state: the pass is transferable, so
 * "do I own these" has to be answered per session, not cached at unlock time.
 *
 * `hangar.ts` deliberately ignored its own saved `owned` list and returned the
 * full roster, with a note to restore gating "once unlocking is real". This is
 * that gate; the hangar now takes the answer from here.
 */
import { MECH_IDS, type MechId } from "./data/types";
import { holdsPass } from "./pass/read";
import { isPassConfigured } from "./pass/config";

/** Granted by holding a Season 1 Battle Pass. */
export const PASS_MECHS: readonly MechId[] = ["titan", "striker", "arclight", "heartcore"];

/**
 * Playable without a pass.
 *
 * Not a giveaway — it is the demo. Somebody who has never seen the game needs
 * to be able to reach a real battle before deciding to spend, and the modular
 * combat is the thing that sells it. Unranked only.
 */
export const TRIAL_MECHS: readonly MechId[] = ["titan"];

/**
 * Earned by playing the season, never sold. Solus sits outside the pass and
 * outside ranked play — see the 225 combat budget in `data/catalog.ts`, which
 * is deliberately above the 200 every other chassis is built to.
 */
export const REWARD_MECHS: readonly MechId[] = ["solus"];

export type OwnershipSource = "dev" | "trial" | "pass";

export interface Ownership {
  mechs: MechId[];
  hasPass: boolean;
  /** Where the answer came from, for the UI to explain what is locked and why. */
  source: OwnershipSource;
}

const DEV_OWNERSHIP: Ownership = { mechs: [...MECH_IDS], hasPass: true, source: "dev" };
const TRIAL_OWNERSHIP: Ownership = { mechs: [...TRIAL_MECHS], hasPass: false, source: "trial" };

/**
 * Resolve what this wallet may field.
 *
 * With no sale configured every mech is available: before the collection
 * exists on chain there is nothing to hold, and locking the roster would make
 * the game untestable rather than making it correct.
 */
export async function resolveOwnership(wallet: string | null): Promise<Ownership> {
  if (!isPassConfigured()) return DEV_OWNERSHIP;
  if (!wallet) return TRIAL_OWNERSHIP;
  try {
    const hasPass = await holdsPass(wallet);
    return hasPass
      ? { mechs: [...PASS_MECHS], hasPass: true, source: "pass" }
      : TRIAL_OWNERSHIP;
  } catch {
    // An RPC failure must not silently strip someone's roster. Falling back to
    // the trial set is the safe direction: it under-grants rather than
    // over-grants, and a retry restores the rest.
    return TRIAL_OWNERSHIP;
  }
}

export function isOwned(o: Ownership, mech: MechId): boolean {
  return o.mechs.includes(mech);
}

/** Why a mech is locked, for the roster card to say so. */
export function lockReason(o: Ownership, mech: MechId): "pass" | "reward" | null {
  if (isOwned(o, mech)) return null;
  return REWARD_MECHS.includes(mech) ? "reward" : "pass";
}
