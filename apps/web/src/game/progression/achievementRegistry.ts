import type { PlayerProfile } from "@/game/config/profileManager";

export type AchievementTier = "common" | "rare" | "epic" | "legendary";

/**
 * A tally kept on the profile — kicks, pets, wins, citizens found. A missing
 * one reads as zero, which is what a profile saved before it existed gives.
 */
const tally = (p: PlayerProfile, key: string): number => p.counters?.[key] ?? 0;

/**
 * One rung on a track. `at` is the value the metric has to reach.
 *
 * `title` is optional, and that is deliberate: the named rungs are the ones
 * the city already shipped names for, and a ladder that keeps going does not
 * need a name invented for every step. An unnamed rung shows its number.
 */
export interface AchievementLevel {
  at: number;
  title?: string;
  tier: AchievementTier;
}

/**
 * ONE achievement per thing you can do, with levels, instead of a separate
 * achievement per number.
 *
 * The board used to list "Good Dog", "Dog Person" and "Best Friend" as three
 * unrelated rows, which is three rows saying the same thing and no sign of how
 * far off the next one was. One row per action, carrying a level and a bar to
 * the next rung, is both shorter to read and the only version that answers
 * "how much more".
 */
export interface AchievementTrack {
  id: string;
  /** The action, as a heading. */
  title: string;
  /** One line on what moves the bar. */
  description: string;
  icon: string;
  /** Where the player is on this track. */
  metric: (p: PlayerProfile) => number;
  /** Ascending. Level = how many of these the metric has reached. */
  levels: AchievementLevel[];
  /** Plural noun for the bar's caption: "41 / 50 pets". */
  unit: string;
  /**
   * Key into ACHIEVEMENT_ART (ui/PixelIcons) when the sprite is filed under an
   * older id than this track's. The art was always per family, so one key
   * serves every level.
   */
  art?: string;
}

/**
 * Bits reserved per track in a published profile.
 *
 * Fixed-size blocks, NOT a running count, and that is the whole reason this
 * constant exists. A published profile is a set of bit positions, so if bits
 * were handed out sequentially across tracks then adding one rung to the dog
 * track would shift every track after it and silently relabel every profile
 * already on chain. A block per track means a new rung takes a free bit inside
 * its own block and a new track takes a fresh block. Both are safe.
 *
 * 8 bits x 32 tracks = the 256 the mask holds. A track may not exceed 8 levels
 * without widening this, which would move every block: there is a test.
 */
export const BITS_PER_TRACK = 8;

/**
 * Tracks are append-only, like the levels inside them. Reordering or removing
 * one relabels published profiles.
 *
 * Ladders run past what anyone has reached on purpose. A bar with nothing above
 * it is a finished list; one that always has a next rung is a reason to kick
 * the ball again.
 */
export const TRACKS: AchievementTrack[] = [
  // ── Getting to know the city ───────────────────────────────────────────
  {
    id: "met-sol",
    title: "New in Town",
    description: "Talk to Sol.",
    icon: "👋",
    unit: "",
    metric: (p) => (p.visitedNPCs.includes("sol-guide") ? 1 : 0),
    levels: [{ at: 1, title: "New in Town", tier: "common" }],
  },
  {
    id: "citizens",
    title: "Meeting People",
    description: "Talk to the citizens of Sol City.",
    icon: "🗨️",
    unit: "citizens",
    art: "social-5",
    metric: (p) => p.visitedNPCs.length,
    levels: [
      { at: 1,  tier: "common" },
      { at: 5,  title: "Neighbourly", tier: "common" },
      { at: 10, title: "Known Around", tier: "rare" },
      { at: 20, title: "Everybody Knows You", tier: "epic" },
    ],
  },
  {
    id: "met-everyone",
    title: "Social Butterfly",
    description: "Talk to every citizen.",
    icon: "🦋",
    unit: "",
    metric: (p) =>
      ["sol-guide", "swap-npc", "send-npc", "pratik", "magic-man", "kuka", "bk-indies", "mr-bananas", "sushi-man"]
        .every((id) => p.visitedNPCs.includes(id)) ? 1 : 0,
    levels: [{ at: 1, title: "Social Butterfly", tier: "rare" }],
  },

  // ── Trading ────────────────────────────────────────────────────────────
  {
    id: "swaps",
    title: "Swapping",
    description: "Swap with Jupiter Cat.",
    icon: "📈",
    unit: "swaps",
    art: "trader-10",
    metric: (p) => p.swapCount,
    levels: [
      { at: 1,   title: "First Swap", tier: "common" },
      { at: 10,  title: "Active Trader", tier: "rare" },
      { at: 25,  title: "Desk Regular", tier: "epic" },
      { at: 50,  title: "Market Maker", tier: "legendary" },
      { at: 100, tier: "legendary" },
    ],
  },
  {
    id: "transfers",
    title: "Sending",
    description: "Send with Steve Sends.",
    icon: "📨",
    unit: "sends",
    art: "sender-10",
    metric: (p) => p.transferCount,
    levels: [
      { at: 1,  title: "First Transfer", tier: "common" },
      { at: 10, title: "Postman", tier: "rare" },
      { at: 50, tier: "epic" },
    ],
  },
  {
    id: "stocks",
    title: "The Stock Exchange",
    description: "Buy tokenized stocks.",
    icon: "🏦",
    unit: "buys",
    art: "stocks-1",
    metric: (p) => tally(p, "stocks-buys"),
    levels: [
      { at: 1,   title: "Shareholder", tier: "common" },
      { at: 10,  title: "Portfolio", tier: "rare" },
      { at: 50,  title: "Sunrise Investor", tier: "epic" },
      { at: 100, tier: "legendary" },
    ],
  },

  // ── Out in the city ────────────────────────────────────────────────────
  {
    id: "hunt",
    title: "Find Someone",
    description: "Find the hunted citizen.",
    icon: "🔍",
    unit: "finds",
    art: "hunt-1",
    metric: (p) => tally(p, "hunt-finds"),
    levels: [
      { at: 1,   title: "Sharp Eyes", tier: "common" },
      { at: 5,   title: "Face in the Crowd", tier: "rare" },
      { at: 25,  title: "Nothing Gets Past You", tier: "legendary" },
      { at: 100, tier: "legendary" },
    ],
  },
  {
    id: "ball",
    title: "Beach Football",
    description: "Kick the ball on the beach.",
    icon: "⚽",
    unit: "kicks",
    art: "ball-1",
    metric: (p) => tally(p, "ball-kicks"),
    levels: [
      { at: 1,    title: "First Touch", tier: "common" },
      { at: 25,   title: "Kickabout", tier: "common" },
      { at: 100,  title: "Beach Pelada", tier: "rare" },
      { at: 500,  tier: "epic" },
      { at: 1000, tier: "legendary" },
    ],
  },
  {
    id: "dog",
    title: "The Caramel Dog",
    description: "Pet the Caramel Dog.",
    icon: "🐕",
    unit: "pets",
    art: "dog-1",
    metric: (p) => tally(p, "dog-pets"),
    levels: [
      { at: 1,   title: "Good Dog", tier: "common" },
      { at: 5,   tier: "common" },
      { at: 10,  title: "Dog Person", tier: "common" },
      { at: 50,  title: "Best Friend", tier: "rare" },
      { at: 100, tier: "epic" },
      { at: 500, tier: "legendary" },
    ],
  },
  {
    id: "expressions",
    title: "Reactions",
    description: "Say it with your face.",
    icon: "😊",
    unit: "reactions",
    art: "express-10",
    metric: (p) => tally(p, "expressions"),
    levels: [
      { at: 1,   tier: "common" },
      { at: 10,  title: "Say It With Your Face", tier: "common" },
      { at: 50,  tier: "rare" },
      { at: 200, tier: "epic" },
    ],
  },

  // ── Mini-games ─────────────────────────────────────────────────────────
  {
    id: "games",
    title: "The Arcade",
    description: "Finish mini-games.",
    icon: "🎮",
    unit: "games",
    art: "games-1",
    metric: (p) => tally(p, "minigame-plays"),
    levels: [
      { at: 1,   title: "Player One", tier: "common" },
      { at: 10,  title: "Arcade Regular", tier: "common" },
      { at: 50,  title: "Arcade Fixture", tier: "epic" },
      { at: 100, tier: "legendary" },
    ],
  },
  {
    id: "game-wins",
    title: "Winning",
    description: "Win mini-games.",
    icon: "🎮",
    unit: "wins",
    art: "games-win-10",
    metric: (p) => tally(p, "minigame-wins"),
    levels: [
      { at: 1,   tier: "common" },
      { at: 10,  title: "On a Roll", tier: "rare" },
      { at: 25,  tier: "epic" },
      { at: 100, tier: "legendary" },
    ],
  },
  {
    // Thresholds read off the live board: the city's best is in the 8000s, so
    // 1000 is a first flight and 10000 beats everyone who has played so far.
    id: "kite",
    title: "Kite Clash",
    description: "Score high in Kite Clash.",
    icon: "🪁",
    unit: "points",
    art: "kite-1000",
    metric: (p) => tally(p, "kite-best"),
    levels: [
      { at: 1000,  title: "Off the Ground", tier: "common" },
      { at: 5000,  title: "Line Cutter", tier: "rare" },
      { at: 10000, title: "King of the Sky", tier: "legendary" },
      { at: 25000, tier: "legendary" },
    ],
  },

  // ── Sol Mechs ──────────────────────────────────────────────────────────
  {
    id: "mechs-pve",
    title: "Sol Mechs",
    description: "Win Sol Mechs battles.",
    icon: "🤖",
    unit: "wins",
    art: "mechs-pve-1",
    metric: (p) => tally(p, "mechs-pve-wins"),
    levels: [
      { at: 1,   title: "First Scrap", tier: "common" },
      { at: 10,  title: "Pilot", tier: "rare" },
      { at: 25,  title: "Veteran Pilot", tier: "epic" },
      { at: 100, tier: "legendary" },
    ],
  },
  {
    id: "mechs-pvp",
    title: "The Arena",
    description: "Win ranked Sol Mechs matches.",
    icon: "🎖️",
    unit: "wins",
    art: "mechs-pvp-1",
    metric: (p) => tally(p, "mechs-pvp-wins"),
    levels: [
      { at: 1,   title: "Ranked Debut", tier: "rare" },
      { at: 5,   title: "Contender", tier: "epic" },
      { at: 25,  title: "Arena Name", tier: "legendary" },
      { at: 100, tier: "legendary" },
    ],
  },

  // ── Coming back ────────────────────────────────────────────────────────
  {
    id: "streak",
    title: "Coming Back",
    description: "Check in day after day.",
    icon: "🗓️",
    unit: "days",
    art: "streak-14",
    metric: (p) => p.streakBest ?? 0,
    levels: [
      { at: 3,   title: "Regular", tier: "common" },
      { at: 7,   title: "Week in the City", tier: "rare" },
      { at: 14,  title: "Fortnight", tier: "epic" },
      { at: 30,  title: "Resident", tier: "legendary" },
      { at: 100, tier: "legendary" },
    ],
  },
  {
    id: "score",
    title: "Points",
    description: "Earn points anywhere in the city.",
    icon: "🏆",
    unit: "points",
    art: "score-1000",
    metric: (p) => p.score,
    levels: [
      { at: 100,   title: "Getting Somewhere", tier: "common" },
      { at: 500,   title: "Making a Name", tier: "rare" },
      { at: 1000,  title: "Citizen of the Year", tier: "legendary" },
      { at: 5000,  title: "Mayor Material", tier: "legendary" },
      { at: 10000, tier: "legendary" },
    ],
  },
  // Appended on purpose, never inserted: a published profile is a set of bit
  // positions handed out by track index, so putting a track anywhere but the
  // end would move every achievement after it.
  {
    id: "ore",
    title: "The Claim Office",
    description: "Stake a claim on the ORE board.",
    // TODO: placeholder icon, and no `art` key, until the spriter delivers the
    // miner sprite. The track works without it; only the picture is missing.
    icon: "⛏️",
    unit: "claims",
    metric: (p) => tally(p, "ore-claims"),
    levels: [
      { at: 1,   title: "Prospector", tier: "common" },
      { at: 10,  title: "Claim Staker", tier: "rare" },
      { at: 50,  title: "Deep Vein", tier: "epic" },
      { at: 200, tier: "legendary" },
    ],
  },
];

// ── Reading a track ─────────────────────────────────────────────────────────

export interface TrackProgress {
  /** How many rungs are met. 0 = not started. */
  level: number;
  /** The metric right now. */
  value: number;
  /** The rung being worked toward, or null when the track is finished. */
  next: AchievementLevel | null;
  /** 0..1 toward `next`, measured from the rung below it. 1 when finished. */
  fraction: number;
  /** The highest rung reached, or null. */
  current: AchievementLevel | null;
  /** The tier to paint this track in: the highest rung reached. */
  tier: AchievementTier;
}

export function trackProgress(track: AchievementTrack, p: PlayerProfile): TrackProgress {
  const value = track.metric(p);
  let level = 0;
  for (const lv of track.levels) {
    if (value >= lv.at) level++;
    else break;
  }
  const current = level > 0 ? track.levels[level - 1] : null;
  const next = level < track.levels.length ? track.levels[level] : null;

  // Measured from the rung below, so a bar that just reset does not sit at 90%
  // the moment a level is gained.
  const floor = current?.at ?? 0;
  const fraction = next
    ? Math.max(0, Math.min(1, (value - floor) / Math.max(1, next.at - floor)))
    : 1;

  return { level, value, next, fraction, current, tier: current?.tier ?? "common" };
}

/** The name of a rung: its own, or its number when it was never given one. */
export function levelName(track: AchievementTrack, level: number): string {
  const lv = track.levels[level - 1];
  if (!lv) return track.title;
  return lv.title ?? `${track.title} ${level}`;
}

/** Where a track's rung sits in a published profile's bitmask. */
export function levelBitIndex(trackIndex: number, level: number): number {
  return trackIndex * BITS_PER_TRACK + (level - 1);
}

// ── The flat view ───────────────────────────────────────────────────────────

/**
 * Every rung as its own entry.
 *
 * The engine and the toasts work one unlock at a time, which a rung still is:
 * reaching level 3 of the dog track is exactly the event that used to be
 * "Best Friend". Deriving this rather than hand-maintaining it is what keeps
 * the two views from drifting.
 *
 * Ids are `<track>:<level>`. They changed shape in this pass, so the ids saved
 * on existing profiles no longer match. That costs nothing: levels are
 * recomputed from the counters, and the engine's first evaluation is a silent
 * back-fill, so a returning player keeps every level and is not toasted for
 * any of them again.
 */
export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  icon: string;
  tier: AchievementTier;
  check: (p: PlayerProfile) => boolean;
  /** Position in a published profile's bitmask. */
  bit: number;
  /** The track this rung belongs to. */
  trackId: string;
  level: number;
  /** ACHIEVEMENT_ART key. */
  art: string;
  outfitReward?: string;
}

export const ACHIEVEMENTS: AchievementDef[] = TRACKS.flatMap((track, trackIndex) =>
  track.levels.map((lv, i) => {
    const level = i + 1;
    return {
      id: `${track.id}:${level}`,
      title: lv.title ?? `${track.title} ${level}`,
      description: lv.title
        ? track.description
        : `${track.description} (${lv.at}${track.unit ? ` ${track.unit}` : ""})`,
      icon: track.icon,
      tier: lv.tier,
      check: (p: PlayerProfile) => track.metric(p) >= lv.at,
      bit: levelBitIndex(trackIndex, level),
      trackId: track.id,
      level,
      art: track.art ?? track.id,
    };
  }),
);

/** Map of tier → accent color for toasts/UI. */
export const TIER_COLORS: Record<AchievementTier, string> = {
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
