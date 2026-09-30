import type { ProfileManager, PlayerProfile } from "@/game/config/profileManager";
import { progressionBus } from "./progressionBus";
import { ACHIEVEMENTS, OUTFIT_NAMES } from "./achievementRegistry";

/**
 * Listens to the ProfileManager and fires achievement / outfit unlock
 * events onto the progression bus when thresholds are crossed.
 *
 * Idempotent: re-evaluating an already-unlocked achievement is a no-op.
 *
 * The first evaluation of a session is a SILENT back-fill: anything the
 * profile already satisfies is written down without a toast. Only crossings
 * after that are celebrated. Two reasons, and the second is the one that
 * matters: a reload would otherwise toast every unlock again, and the day the
 * city gains thirty new achievements — kicks, pets, wins, stocks — a player
 * who already earned eight of them would be met by eight toasts at once for
 * things they did last week. They are theirs, and the profile panel says so;
 * the toast is for the moment it happens.
 */
export class AchievementEngine {
  private profileMgr: ProfileManager;
  /** Unlocked state mirror — populated from profile on init. */
  private unlocked: Set<string>;
  /** False until the first evaluation has run: that one awards silently. */
  private primed = false;
  /** `unlockAchievement` saves, and a save re-enters here. See evaluate. */
  private evaluating = false;

  constructor(profileMgr: ProfileManager) {
    this.profileMgr = profileMgr;
    const profile = profileMgr.get();
    this.unlocked = new Set(profile.unlockedAchievements ?? []);

    // On every profile change, re-check and surface any newly-crossed
    // thresholds. Debouncing isn't necessary: the check is O(achievements)
    // which is a handful of predicate calls.
    profileMgr.onChange((p) => this.evaluate(p));
  }

  /**
   * Public API for a one-shot evaluation — useful when the ProfileManager
   * is constructed but its onChange hasn't fired yet (cold start path).
   */
  bootstrap(): void {
    this.evaluate(this.profileMgr.get());
  }

  private evaluate(profile: PlayerProfile): void {
    // Writing an unlock saves the profile, and a save calls every listener —
    // including this one. The outer pass covers the whole list anyway, so the
    // re-entrant call has nothing left to do.
    if (this.evaluating) return;
    this.evaluating = true;
    const silent = !this.primed;
    try {
      this.evaluateOnce(profile, silent);
    } finally {
      this.evaluating = false;
      this.primed = true;
    }
  }

  private evaluateOnce(profile: PlayerProfile, silent: boolean): void {
    // Resync the unlocked cache from profile storage — this makes the
    // engine robust against external resets (e.g. profileManager.resetProgress()
    // from the UI). If an achievement was cleared from the profile, it can
    // be re-earned and re-emit its unlock event.
    const profileUnlocked = new Set(profile.unlockedAchievements);
    for (const id of this.unlocked) {
      if (!profileUnlocked.has(id)) this.unlocked.delete(id);
    }

    for (const ach of ACHIEVEMENTS) {
      if (this.unlocked.has(ach.id)) continue;
      if (!ach.check(profile)) continue;

      this.unlocked.add(ach.id);
      this.profileMgr.unlockAchievement(ach.id);

      if (!silent) {
        progressionBus.emit({
          type: "achievement-unlocked",
          id: ach.id,
          title: ach.title,
          description: ach.description,
          icon: ach.icon,
        });
      }

      if (ach.outfitReward) {
        const newly = this.profileMgr.unlockOutfit(ach.outfitReward);
        if (newly && !silent) {
          progressionBus.emit({
            type: "outfit-unlocked",
            outfitId: ach.outfitReward,
            outfitName: OUTFIT_NAMES[ach.outfitReward] ?? ach.outfitReward,
          });
        }
      }
    }
  }
}
