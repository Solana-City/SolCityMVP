/**
 * How a player leaves the rollup: keep the delegation, or end it.
 *
 * MagicBlock bills a delegation once, when it ENDS. Undelegating takes a
 * 3,000,000-lamport session fee, plus 1,000,000 for every commit after the
 * first, out of the deposit the player paid to delegate (~3,160,000), and
 * refunds the rest. Measured on devnet 2026-11-04: 3,164,840 out at login,
 * 159,840 back at logout. See docs.magicblock.gg, "fees and commit economics".
 *
 * Undelegating on every logout therefore cost the player 0.003 SOL per visit,
 * plus a delegate signature on the way back in. So leaving keeps the account
 * delegated and only COMMITS, which copies the live state onto the base layer.
 * The next login finds it still delegated and enters with no signature and no
 * fee. Commits after the first are charged against the same deposit, which is
 * already capped, so they cost the player nothing extra.
 *
 * The limit is ten commits per delegation; the eleventh fails with
 * 0xA0000000, while a final commit-and-undelegate is still allowed. So after
 * COMMITS_BEFORE_UNDELEGATE commits, the next leave ends the delegation, and
 * the base copy never falls behind for good. That is one fee every few
 * sessions instead of one per session.
 *
 * The count is per wallet and per browser. Another device committing on the
 * same delegation is invisible here, which is why the threshold leaves room:
 * a miscount at worst ends a delegation early (one fee) or lets one commit
 * fail quietly (the state stays on the rollup, nothing breaks).
 */

import { clusterKey } from "@/game/config/clusterStorage";

export const COMMITS_BEFORE_UNDELEGATE = 8;

export type LeaveAction = "commit" | "undelegate";

const KEY_PREFIX = "solcity-delegation-commits";

/** Per cluster: a devnet delegation says nothing about a mainnet one. */
const keyFor = (wallet: string) => clusterKey(`${KEY_PREFIX}-${wallet}`);

/** What a leave should send, given how many commits this delegation has had. */
export function leaveAction(commitsSoFar: number, endDelegation: boolean): LeaveAction {
  if (endDelegation) return "undelegate";
  return commitsSoFar >= COMMITS_BEFORE_UNDELEGATE ? "undelegate" : "commit";
}

/** Commits this browser has sent on the wallet's current delegation. */
export function readCommits(wallet: string): number {
  try {
    const n = Number(localStorage.getItem(keyFor(wallet)));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export function recordCommit(wallet: string): void {
  try {
    localStorage.setItem(keyFor(wallet), String(readCommits(wallet) + 1));
  } catch { /* storage blocked: the count restarts, which only delays an undelegate */ }
}

/** A new delegation starts a new allowance. */
export function resetCommits(wallet: string): void {
  try {
    localStorage.removeItem(keyFor(wallet));
  } catch { /* nothing stored */ }
}
