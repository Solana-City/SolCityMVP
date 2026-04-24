import type { ProfileManager, PlayerProfile } from "@/game/config/profileManager";
import { progressionBus } from "./progressionBus";
import { ACHIEVEMENTS, OUTFIT_NAMES } from "./achievementRegistry";

/**
 * Listens to the ProfileManager and fires achievement / outfit unlock
 * events onto the progression bus when thresholds are crossed.
 *
 * Idempotent: re-evaluating an already-unlocked achievement is a no-op.
 * The first evaluation after construct fires *no* events even if the
 * profile already satisfies achievements — we only celebrate the moment
 * of crossing, not pre-existing state (otherwise a page reload would
 * toast every unlock all over again).
 */
export class AchievementEngine {
  private profileMgr: ProfileManager;
  /** Unlocked state mirror — populated from profile on init. */
  private unlocked: Set<string>;

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

      progressionBus.emit({
        type: "achievement-unlocked",
        id: ach.id,
        title: ach.title,
        description: ach.description,
        icon: ach.icon,
      });

      if (ach.outfitReward) {
        const newly = this.profileMgr.unlockOutfit(ach.outfitReward);
        if (newly) {
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
