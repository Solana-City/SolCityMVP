import { ACHIEVEMENTS } from "@/game/progression/achievementRegistry";
import { achievementMask } from "@/game/solana/program";
import type { PlayerProfile, ProfileManager } from "@/game/config/profileManager";

/**
 * Publishing our own profile, so the card another player opens on us is not
 * empty.
 *
 * Achievements are counted locally (balls kicked, dogs petted, mini-game runs),
 * which is exactly why they were invisible to everyone else: they only ever
 * existed in this browser's localStorage. This copies the summary onto our own
 * on-chain player state, where every other client already reads us.
 *
 * It writes rarely on purpose. The position poll is the hot path and this is
 * not on it: the mask changes when an achievement unlocks, which is a handful
 * of times in a session, and the write is skipped entirely when nothing moved.
 */

/**
 * Registry id -> bit index.
 *
 * THE ORDER OF `ACHIEVEMENTS` IS NOW A WIRE FORMAT. A published profile is a
 * set of bit positions, so appending to the registry is safe and free, while
 * reordering or removing an entry silently relabels every profile already
 * published: players would appear to hold badges they never earned. Add to the
 * end.
 */
const INDEX_BY_ID = new Map(ACHIEVEMENTS.map((a, i) => [a.id, i] as const));

/** Bit index for an achievement id, or undefined if it is not in the registry. */
export function achievementIndexOf(id: string): number | undefined {
  return INDEX_BY_ID.get(id);
}

/** The registry entry a published bit refers to. */
export function achievementAtIndex(index: number) {
  return ACHIEVEMENTS[index];
}

/** The mask that publishes everything this profile has unlocked. */
export function maskForProfile(profile: PlayerProfile): Uint8Array {
  const indices: number[] = [];
  for (const id of profile.unlockedAchievements ?? []) {
    const i = INDEX_BY_ID.get(id);
    if (i !== undefined) indices.push(i);
  }
  return achievementMask(indices);
}

export interface ProfileSnapshot {
  achievements: Uint8Array;
  streakCurrent: number;
  streakBest: number;
}

export function snapshotOf(profile: PlayerProfile): ProfileSnapshot {
  return {
    achievements: maskForProfile(profile),
    streakCurrent: profile.streakCurrent ?? 0,
    streakBest: profile.streakBest ?? 0,
  };
}

/** Cheap identity for "has anything worth publishing changed". */
export function snapshotKey(s: ProfileSnapshot): string {
  let hex = "";
  for (const b of s.achievements) hex += b.toString(16).padStart(2, "0");
  return `${hex}:${s.streakCurrent}:${s.streakBest}`;
}

type Publish = (s: ProfileSnapshot) => void;

/**
 * Watches the profile and publishes when the summary changes.
 *
 * Debounced, because unlocking a tier can set several achievements in the same
 * tick and each one saves the profile.
 *
 * Returns a stop function. ProfileManager.onChange keeps no unsubscribe, so
 * stopping makes the listener inert rather than detaching it: this is mounted
 * once per page load, same as the achievement engine beside it.
 */
export function startProfilePublisher(
  profileMgr: ProfileManager,
  publish: Publish,
  debounceMs = 1_500,
): () => void {
  let last: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const consider = (profile: PlayerProfile) => {
    if (stopped) return;
    const snap = snapshotOf(profile);
    const key = snapshotKey(snap);
    if (key === last) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (stopped) return;
      last = key;
      publish(snap);
    }, debounceMs);
  };

  profileMgr.onChange(consider);
  // Publish what is already there, so a returning player's card fills in
  // without waiting for them to earn something new.
  consider(profileMgr.get());

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
