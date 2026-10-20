import { describe, it, expect } from "vitest";
import {
  QUESTS,
  questById,
  questsFrom,
  questProgress,
  allQuestProgress,
  type QuestContext,
} from "./questRegistry";
import { STBR_CREW } from "@/game/progression/outfitRewards";
import { NPC_REGISTRY } from "@/game/config/npcRegistry";
import { getVariant, type LayerCategory } from "@/game/config/paperDoll";
import type { PlayerProfile } from "@/game/config/profileManager";

const emptyProfile = (over: Partial<PlayerProfile> = {}): PlayerProfile => ({
  wallet: "test-wallet",
  displayName: "Tester",
  outfitId: "default",
  score: 0,
  swapCount: 0,
  transferCount: 0,
  bountyCount: 0,
  unlockedOutfits: [],
  unlockedAchievements: [],
  visitedNPCs: [],
  discoveredZones: [],
  joinedAt: 0,
  lastActive: 0,
  ...over,
});

const ctx = (over: Partial<PlayerProfile> = {}, owned: string[] = []): QuestContext => ({
  profile: emptyProfile(over),
  owns: (c: LayerCategory, id: string) => owned.includes(`${c}:${id}`),
});

describe("the quest registry", () => {
  it("gives every quest and every step a distinct id", () => {
    const ids = QUESTS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const q of QUESTS) {
      const steps = q.steps.map((s) => s.id);
      expect(new Set(steps).size, q.id).toBe(steps.length);
      expect(steps.length, q.id).toBeGreaterThan(0);
    }
  });

  it("points every reward at a real item that is reserved to a quest", () => {
    // A reward naming an item that does not exist, or one a pack could also
    // drop, is the failure this catches.
    for (const q of QUESTS) {
      const variant = getVariant(q.reward.category, q.reward.id);
      expect(variant, `${q.id} -> ${q.reward.id}`).toBeDefined();
      expect(variant!.unlockVia, `${q.id} -> ${q.reward.id}`).toBe("quest");
    }
  });

  it("names a giver that is actually in the city", () => {
    const known = new Set(NPC_REGISTRY.map((n) => n.id));
    for (const q of QUESTS) {
      if (!q.giver) continue;
      expect(known.has(q.giver), `${q.id} -> ${q.giver}`).toBe(true);
    }
  });

  it("describes the ST Brasil chain exactly as outfitRewards grants it", () => {
    // The point of the whole file: this DESCRIBES, outfitRewards GRANTS. If
    // the two ever disagree the player is shown a checklist that does not pay
    // out, so the crew list is pinned against the authoritative one rather
    // than copied and hoped for.
    const quest = questById("stbr-crew")!;
    const described = quest.steps.map((s) => s.id.replace("talk:", ""));
    expect(described).toEqual(STBR_CREW);
  });

  it("counts a part-finished chain, which is the thing that was missing", () => {
    // Four of seven. Before this existed the player saw nothing at all until
    // the unlock toast at the end.
    const four = STBR_CREW.slice(0, 4);
    const p = questProgress(questById("stbr-crew")!, ctx({ visitedNPCs: four }));
    expect(p.done).toBe(4);
    expect(p.total).toBe(7);
    expect(p.complete).toBe(false);
    expect(p.steps.filter((s) => s.done).map((s) => s.step.id)).toEqual(
      four.map((id) => `talk:${id}`),
    );
  });

  it("completes the chain on the last of the crew", () => {
    const p = questProgress(questById("stbr-crew")!, ctx({ visitedNPCs: [...STBR_CREW] }));
    expect(p.complete).toBe(true);
    expect(p.done).toBe(p.total);
  });

  it("reads a streak as real progress rather than a yes or no", () => {
    const q = questById("streak-7")!;
    expect(questProgress(q, ctx({ streakBest: 6 })).complete).toBe(false);
    expect(questProgress(q, ctx({ streakBest: 7 })).complete).toBe(true);
    // streakBest only ever rises, so a longer run still reads as done.
    expect(questProgress(q, ctx({ streakBest: 30 })).complete).toBe(true);
  });

  it("uses the reward itself for conditions the profile cannot see", () => {
    // Nothing records "won a round of Kite Clash". What is observable is the
    // cap that followed, which is why the step asks `owns` instead of
    // inventing a counter that would be a second source of truth.
    const q = questById("kite-clash-win")!;
    expect(questProgress(q, ctx()).complete).toBe(false);
    expect(questProgress(q, ctx({}, ["hat:STB_cap"])).complete).toBe(true);
  });

  it("starts a fresh player at zero everywhere", () => {
    for (const { def, progress } of allQuestProgress(ctx())) {
      expect(progress.done, def.id).toBe(0);
      expect(progress.complete, def.id).toBe(false);
    }
  });

  it("finds Guarana's chain by its giver, and he is not a step in it", () => {
    expect(questsFrom("guarana").map((q) => q.id)).toEqual(["stbr-crew"]);
    // He is the signpost on the boardwalk, not one of the seven.
    expect(STBR_CREW).not.toContain("guarana");
  });

  it("leaves out the two rewards with no reachable condition", () => {
    // The City Cap lost its donation route and has no replacement yet; the
    // Jetpack has never had a grant at all. A quest the player cannot finish
    // is worse than no quest.
    const rewards = QUESTS.map((q) => q.reward.id);
    expect(rewards).not.toContain("city_cap");
    expect(rewards).not.toContain("Jetpack");
  });
});
