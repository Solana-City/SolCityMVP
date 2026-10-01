import {
  ACHIEVEMENTS, TRACKS, levelBitIndex, trackProgress,
} from "@/game/progression/achievementRegistry";
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
 * Rung id -> its bit position in a published profile.
 *
 * The position comes from the track's own fixed block (see BITS_PER_TRACK), not
 * from where the rung happens to sit in a flattened list. That is what lets a
 * track gain a level without moving anybody else's bits: a published profile is
 * a set of bit positions, and a shifted position means a player appears to hold
 * a badge they never earned.
 */
const BIT_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a.bit] as const));

/** Bit position for a rung id, or undefined if it is not in the registry. */
export function achievementIndexOf(id: string): number | undefined {
  return BIT_BY_ID.get(id);
}

/** The rung a published bit refers to. */
export function achievementAtIndex(bit: number) {
  return BY_BIT.get(bit);
}

const BY_BIT = new Map(ACHIEVEMENTS.map((a) => [a.bit, a] as const));

/**
 * The level another player sees on each of our tracks, read out of a published
 * mask: the highest rung whose bit is set.
 */
export function levelsFromMask(bits: Set<number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of ACHIEVEMENTS) {
    if (bits.has(a.bit)) {
      out.set(a.trackId, Math.max(out.get(a.trackId) ?? 0, a.level));
    }
  }
  return out;
}

/**
 * The mask that publishes this profile.
 *
 * Built from the LEVELS the counters currently justify, not from the list of
 * ids the profile happens to have saved. Those ids changed shape when
 * achievements became tracks, and a returning player's levels are recomputed
 * anyway, so reading the metrics is both simpler and the version that cannot
 * publish a stale set.
 */
export function maskForProfile(profile: PlayerProfile): Uint8Array {
  const indices: number[] = [];
  TRACKS.forEach((track, trackIndex) => {
    const { level } = trackProgress(track, profile);
    for (let lv = 1; lv <= level; lv++) {
      indices.push(levelBitIndex(trackIndex, lv));
    }
  });
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
