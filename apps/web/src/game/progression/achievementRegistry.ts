import type { PlayerProfile } from "@/game/config/profileManager";

/**
 * An achievement is a milestone the player can unlock. Each is defined
 * purely by data: a readable title/description, an icon, a threshold
 * predicate that inspects the profile, and (optionally) an outfit reward.
 *
 * The engine re-evaluates every achievement whenever the profile changes
 * — no per-event dispatching, no subscribe logic here. Dumb on purpose.
 */
export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  icon: string;              // a single unicode char or short emoji
  /** Rarity drives the toast color. */
  tier: "common" | "rare" | "epic" | "legendary";
  /** Returns true if the profile currently satisfies this achievement. */
  check: (p: PlayerProfile) => boolean;
  /**
   * Optional outfit id to unlock on first award. None set today: the old
   * rewards belonged to a retired outfit system and were never wearable.
   * Real wardrobe rewards go through game/progression/outfitRewards.ts.
   */
  outfitReward?: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  // ── First-time milestones (common, fast dopamine) ──────────────────
  {
    id: "first-swap",
    title: "First Swap",
    description: "Swap once with Jupiter Cat.",
    icon: "💱",
    tier: "common",
    check: (p) => p.swapCount >= 1,
  },
  {
    id: "first-transfer",
    title: "First Transfer",
    description: "Send once with Steve Sends.",
    icon: "📨",
    tier: "common",
    check: (p) => p.transferCount >= 1,
  },
  {
    id: "streak-3",
    title: "Regular",
    description: "Come back 3 days in a row.",
    icon: "📅",
    tier: "common",
    check: (p) => (p.streakBest ?? 0) >= 3,
  },

  // ── Exploration (social/discovery) ─────────────────────────────────
  {
    id: "met-sol",
    title: "New in Town",
    description: "Talk to Sol.",
    icon: "👋",
    tier: "common",
    check: (p) => p.visitedNPCs.includes("sol-guide"),
  },
  {
    id: "met-everyone",
    title: "Social Butterfly",
    description: "Talk to every citizen.",
    icon: "🦋",
    tier: "rare",
    check: (p) =>
      ["sol-guide", "swap-npc", "send-npc", "pratik", "magic-man", "kuka", "bk-indies", "mr-bananas", "sushi-man"].every((id) =>
        p.visitedNPCs.includes(id)
      ),
  },

  // ── Progression (rare, shows commitment) ───────────────────────────
  {
    id: "trader-10",
    title: "Active Trader",
    description: "Swap 10 times.",
    icon: "📈",
    tier: "rare",
    check: (p) => p.swapCount >= 10,
  },
  {
    id: "streak-7",
    title: "Week in the City",
    description: "Come back 7 days in a row.",
    icon: "🗓️",
    tier: "rare",
    check: (p) => (p.streakBest ?? 0) >= 7,
  },

  // ── Summit (legendary) ─────────────────────────────────────────────
  {
    id: "score-1000",
    title: "Citizen of the Year",
    description: "Reach 1000 points.",
    icon: "🏆",
    tier: "legendary",
    check: (p) => p.score >= 1000,
  },
];

/** Map of tier → accent color for toasts/UI. */
export const TIER_COLORS: Record<AchievementDef["tier"], string> = {
  common: "#14F195",
  rare: "#00D1FF",
  epic: "#9945FF",
  legendary: "#FFD700",
};

/** Outfit catalog — names only, paired with ids used in achievements. */
export const OUTFIT_NAMES: Record<string, string> = {
  "default": "Default",
  "trader-novice": "Trader's Scarf",
  "trader-cloak": "Trader's Cloak",
  "builder-novice": "Builder's Cap",
  "builder-jacket": "Builder's Jacket",
  "explorer-cloak": "Explorer's Cloak",
  "mayor-robes": "Mayor's Robes",
};
