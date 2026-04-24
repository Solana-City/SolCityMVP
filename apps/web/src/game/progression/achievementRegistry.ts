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
  /** Optional outfit id to unlock on first award. */
  outfitReward?: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  // ── First-time milestones (common, fast dopamine) ──────────────────
  {
    id: "first-swap",
    title: "First Swap",
    description: "You made your first token swap with Jupiter Joe.",
    icon: "💱",
    tier: "common",
    check: (p) => p.swapCount >= 1,
    outfitReward: "trader-novice",
  },
  {
    id: "first-transfer",
    title: "First Transfer",
    description: "You sent tokens through the Post Office.",
    icon: "📨",
    tier: "common",
    check: (p) => p.transferCount >= 1,
  },
  {
    id: "first-bounty",
    title: "First Bounty",
    description: "You completed your first Superteam bounty.",
    icon: "🎯",
    tier: "common",
    check: (p) => p.bountyCount >= 1,
    outfitReward: "builder-novice",
  },

  // ── Exploration (social/discovery) ─────────────────────────────────
  {
    id: "met-sol",
    title: "New in Town",
    description: "You met Sol, the city guide.",
    icon: "👋",
    tier: "common",
    check: (p) => p.visitedNPCs.includes("sol-guide"),
  },
  {
    id: "met-everyone",
    title: "Social Butterfly",
    description: "You talked to every NPC in the city.",
    icon: "🦋",
    tier: "rare",
    check: (p) =>
      ["sol-guide", "swap-npc", "send-npc", "st-maya"].every((id) =>
        p.visitedNPCs.includes(id)
      ),
    outfitReward: "explorer-cloak",
  },

  // ── Progression (rare, shows commitment) ───────────────────────────
  {
    id: "trader-10",
    title: "Active Trader",
    description: "Complete 10 token swaps.",
    icon: "📈",
    tier: "rare",
    check: (p) => p.swapCount >= 10,
    outfitReward: "trader-cloak",
  },
  {
    id: "builder-3",
    title: "Sol City Builder",
    description: "Complete 3 Superteam bounties.",
    icon: "🛠️",
    tier: "rare",
    check: (p) => p.bountyCount >= 3,
    outfitReward: "builder-jacket",
  },

  // ── Summit (legendary) ─────────────────────────────────────────────
  {
    id: "score-1000",
    title: "Citizen of the Year",
    description: "Reach a score of 1000.",
    icon: "🏆",
    tier: "legendary",
    check: (p) => p.score >= 1000,
    outfitReward: "mayor-robes",
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
