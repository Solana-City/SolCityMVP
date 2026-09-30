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

/**
 * A tally kept on the profile — kicks, pets, wins, citizens found. A missing
 * one reads as zero, which is what a profile saved before it existed gives.
 */
const tally = (p: PlayerProfile, key: string): number => p.counters?.[key] ?? 0;

/**
 * The list is deliberately long, and deliberately full of small steps.
 *
 * Everything the city offers earns something now — kicking the ball on the
 * beach, petting the dog, a mini-game, a ranked win, a stock bought — and
 * anything repeatable comes in tiers, because one unlock per activity is a
 * single hit of dopamine where three is a reason to keep going. A tier is the
 * same tally read at another threshold, so a new step costs one entry here
 * and nothing anywhere else.
 *
 * Ids are permanent: unlocks are stored by id, so renaming one takes a
 * player's achievement away.
 */
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
    id: "social-5",
    title: "Neighbourly",
    description: "Talk to 5 citizens.",
    icon: "🗨️",
    tier: "common",
    check: (p) => p.visitedNPCs.length >= 5,
  },
  {
    id: "social-10",
    title: "Known Around",
    description: "Talk to 10 citizens.",
    icon: "🗨️",
    tier: "rare",
    check: (p) => p.visitedNPCs.length >= 10,
  },
  {
    id: "social-20",
    title: "Everybody Knows You",
    description: "Talk to 20 citizens.",
    icon: "🗨️",
    tier: "epic",
    check: (p) => p.visitedNPCs.length >= 20,
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

  // ── Trading ────────────────────────────────────────────────────────
  {
    id: "trader-10",
    title: "Active Trader",
    description: "Swap 10 times.",
    icon: "📈",
    tier: "rare",
    check: (p) => p.swapCount >= 10,
  },
  {
    id: "trader-25",
    title: "Desk Regular",
    description: "Swap 25 times.",
    icon: "📈",
    tier: "epic",
    check: (p) => p.swapCount >= 25,
  },
  {
    id: "trader-50",
    title: "Market Maker",
    description: "Swap 50 times.",
    icon: "📈",
    tier: "legendary",
    check: (p) => p.swapCount >= 50,
  },
  {
    id: "sender-10",
    title: "Postman",
    description: "Send 10 times.",
    icon: "📨",
    tier: "rare",
    check: (p) => p.transferCount >= 10,
  },

  // ── The Stocks Broker ──────────────────────────────────────────────
  {
    id: "stocks-1",
    title: "Shareholder",
    description: "Buy a tokenized stock.",
    icon: "🏦",
    tier: "common",
    check: (p) => tally(p, "stocks-buys") >= 1,
  },
  {
    id: "stocks-10",
    title: "Portfolio",
    description: "Buy stocks 10 times.",
    icon: "🏦",
    tier: "rare",
    check: (p) => tally(p, "stocks-buys") >= 10,
  },
  {
    id: "stocks-50",
    title: "Sunrise Investor",
    description: "Buy stocks 50 times.",
    icon: "🏦",
    tier: "epic",
    check: (p) => tally(p, "stocks-buys") >= 50,
  },

  // ── Find Someone ───────────────────────────────────────────────────
  {
    id: "hunt-1",
    title: "Sharp Eyes",
    description: "Find the hunted citizen.",
    icon: "🔍",
    tier: "common",
    check: (p) => tally(p, "hunt-finds") >= 1,
  },
  {
    id: "hunt-5",
    title: "Face in the Crowd",
    description: "Find 5 hunted citizens.",
    icon: "🔍",
    tier: "rare",
    check: (p) => tally(p, "hunt-finds") >= 5,
  },
  {
    id: "hunt-25",
    title: "Nothing Gets Past You",
    description: "Find 25 hunted citizens.",
    icon: "🔍",
    tier: "legendary",
    check: (p) => tally(p, "hunt-finds") >= 25,
  },

  // ── The beach football ─────────────────────────────────────────────
  {
    id: "ball-1",
    title: "First Touch",
    description: "Kick the ball on the beach.",
    icon: "⚽",
    tier: "common",
    check: (p) => tally(p, "ball-kicks") >= 1,
  },
  {
    id: "ball-25",
    title: "Kickabout",
    description: "Kick the ball 25 times.",
    icon: "⚽",
    tier: "common",
    check: (p) => tally(p, "ball-kicks") >= 25,
  },
  {
    id: "ball-100",
    title: "Beach Pelada",
    description: "Kick the ball 100 times.",
    icon: "⚽",
    tier: "rare",
    check: (p) => tally(p, "ball-kicks") >= 100,
  },

  // ── The Caramel Dog ────────────────────────────────────────────────
  {
    id: "dog-1",
    title: "Good Dog",
    description: "Pet the Caramel Dog.",
    icon: "🐕",
    tier: "common",
    check: (p) => tally(p, "dog-pets") >= 1,
  },
  {
    id: "dog-10",
    title: "Dog Person",
    description: "Pet the Caramel Dog 10 times.",
    icon: "🐕",
    tier: "common",
    check: (p) => tally(p, "dog-pets") >= 10,
  },
  {
    id: "dog-50",
    title: "Best Friend",
    description: "Pet the Caramel Dog 50 times.",
    icon: "🐕",
    tier: "rare",
    check: (p) => tally(p, "dog-pets") >= 50,
  },

  // ── Mini-games ─────────────────────────────────────────────────────
  {
    id: "games-1",
    title: "Player One",
    description: "Finish a mini-game.",
    icon: "🎮",
    tier: "common",
    check: (p) => tally(p, "minigame-plays") >= 1,
  },
  {
    id: "games-10",
    title: "Arcade Regular",
    description: "Finish 10 mini-games.",
    icon: "🎮",
    tier: "common",
    check: (p) => tally(p, "minigame-plays") >= 10,
  },
  {
    id: "games-win-10",
    title: "On a Roll",
    description: "Win 10 mini-games.",
    icon: "🎮",
    tier: "rare",
    check: (p) => tally(p, "minigame-wins") >= 10,
  },
  {
    id: "games-50",
    title: "Arcade Fixture",
    description: "Finish 50 mini-games.",
    icon: "🎮",
    tier: "epic",
    check: (p) => tally(p, "minigame-plays") >= 50,
  },

  // ── Kite Clash ─────────────────────────────────────────────────────
  // Thresholds read off the live board: the city's best is in the 8000s, so
  // 1000 is a first flight and 10000 beats everyone who has played so far.
  {
    id: "kite-1000",
    title: "Off the Ground",
    description: "Score 1000 in Kite Clash.",
    icon: "🪁",
    tier: "common",
    check: (p) => tally(p, "kite-best") >= 1000,
  },
  {
    id: "kite-5000",
    title: "Line Cutter",
    description: "Score 5000 in Kite Clash.",
    icon: "🪁",
    tier: "rare",
    check: (p) => tally(p, "kite-best") >= 5000,
  },
  {
    id: "kite-10000",
    title: "King of the Sky",
    description: "Score 10000 in Kite Clash.",
    icon: "🪁",
    tier: "legendary",
    check: (p) => tally(p, "kite-best") >= 10000,
  },

  // ── Sol Mechs ──────────────────────────────────────────────────────
  {
    id: "mechs-pve-1",
    title: "First Scrap",
    description: "Win a Sol Mechs battle.",
    icon: "🤖",
    tier: "common",
    check: (p) => tally(p, "mechs-pve-wins") >= 1,
  },
  {
    id: "mechs-pve-10",
    title: "Pilot",
    description: "Win 10 Sol Mechs battles.",
    icon: "🤖",
    tier: "rare",
    check: (p) => tally(p, "mechs-pve-wins") >= 10,
  },
  {
    id: "mechs-pve-25",
    title: "Veteran Pilot",
    description: "Win 25 Sol Mechs battles.",
    icon: "🤖",
    tier: "epic",
    check: (p) => tally(p, "mechs-pve-wins") >= 25,
  },
  {
    id: "mechs-pvp-1",
    title: "Ranked Debut",
    description: "Win a ranked Sol Mechs match.",
    icon: "🎖️",
    tier: "rare",
    check: (p) => tally(p, "mechs-pvp-wins") >= 1,
  },
  {
    id: "mechs-pvp-5",
    title: "Contender",
    description: "Win 5 ranked matches.",
    icon: "🎖️",
    tier: "epic",
    check: (p) => tally(p, "mechs-pvp-wins") >= 5,
  },
  {
    id: "mechs-pvp-25",
    title: "Arena Name",
    description: "Win 25 ranked matches.",
    icon: "🎖️",
    tier: "legendary",
    check: (p) => tally(p, "mechs-pvp-wins") >= 25,
  },

  // ── Reactions ──────────────────────────────────────────────────────
  {
    id: "express-10",
    title: "Say It With Your Face",
    description: "Use 10 reactions.",
    icon: "😊",
    tier: "common",
    check: (p) => tally(p, "expressions") >= 10,
  },

  // ── Coming back ────────────────────────────────────────────────────
  {
    id: "streak-7",
    title: "Week in the City",
    description: "Come back 7 days in a row.",
    icon: "🗓️",
    tier: "rare",
    check: (p) => (p.streakBest ?? 0) >= 7,
  },
  {
    id: "streak-14",
    title: "Fortnight",
    description: "Come back 14 days in a row.",
    icon: "🗓️",
    tier: "epic",
    check: (p) => (p.streakBest ?? 0) >= 14,
  },
  {
    id: "streak-30",
    title: "Resident",
    description: "Come back 30 days in a row.",
    icon: "🗓️",
    tier: "legendary",
    check: (p) => (p.streakBest ?? 0) >= 30,
  },

  // ── Points ─────────────────────────────────────────────────────────
  {
    id: "score-100",
    title: "Getting Somewhere",
    description: "Reach 100 points.",
    icon: "🏆",
    tier: "common",
    check: (p) => p.score >= 100,
  },
  {
    id: "score-500",
    title: "Making a Name",
    description: "Reach 500 points.",
    icon: "🏆",
    tier: "rare",
    check: (p) => p.score >= 500,
  },
  {
    id: "score-1000",
    title: "Citizen of the Year",
    description: "Reach 1000 points.",
    icon: "🏆",
    tier: "legendary",
    check: (p) => p.score >= 1000,
  },
  {
    id: "score-5000",
    title: "Mayor Material",
    description: "Reach 5000 points.",
    icon: "🏆",
    tier: "legendary",
    check: (p) => p.score >= 5000,
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
