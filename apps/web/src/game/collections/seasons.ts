/**
 * Seasons and rarities, shared by every collectible the city sells.
 *
 * Two collections are being built on this: the wardrobe (outfit packs) and
 * Sol Mechs (its own packs, later). They are separate collections on chain and
 * always will be — one is worn by a character, the other is a game piece with
 * stats — but they speak the SAME two words, and that is worth one file
 * instead of two copies that drift.
 *
 * ── The word "season" is overloaded here. Read this before using it. ──
 *
 * Three different things wanted the name, and only one of them gets it:
 *
 *   1. DROP SEASON (this file). The window a collectible was released in. It
 *      is stamped on the item at mint, never changes, and is what makes a
 *      collection time-limited: a pack only draws from the open season, so
 *      what you could open in January is not what you can open in July.
 *   2. RANKED SEASON (game/solmechs/season/config.ts). A competitive window:
 *      rating, energy, rewards. It resets; a drop season never does.
 *   3. The Battle Pass' "Season 1", which is a SALE, and should be read as
 *      the name of a product, not as either of the above.
 *
 * They are numbered off the SAME calendar on purpose — drop season 3 runs
 * alongside ranked season 3 — so the city has one story to tell and a player
 * has one number to remember. Aligning them costs nothing; letting them drift
 * costs an explanation every time.
 */

// ── Rarity ──────────────────────────────────────────────────────────────────

export type Rarity = "common" | "uncommon" | "rare" | "legendary";

/** Least to most rare. Also the fallback ladder when a bucket runs dry. */
export const RARITY_ORDER: Rarity[] = ["common", "uncommon", "rare", "legendary"];

export const RARITY_LABEL: Record<Rarity, string> = {
  common: "COMMON",
  uncommon: "UNCOMMON",
  rare: "RARE",
  legendary: "LEGENDARY",
};

/**
 * One colour per rarity, for every surface in the game that shows one: the
 * wardrobe grid, a pack reveal, a Sol Mechs part card. A player should learn
 * "gold means legendary" once.
 */
export const RARITY_COLOR: Record<Rarity, string> = {
  common: "#8a8aa7",
  uncommon: "#14F195",
  rare: "#00D1FF",
  legendary: "#FFD700",
};

// ── Seasons ─────────────────────────────────────────────────────────────────

export interface SeasonDef {
  /** The number stamped on every item of this season. Never reused. */
  n: number;
  /** What players call it. Goes in the metadata beside the number. */
  name: string;
  /**
   * "open" is the one packs draw from; exactly one season is open at a time.
   * A "closed" season keeps everything it minted — those items stay owned,
   * worn, and tradable — and simply stops being obtainable.
   */
  status: "open" | "closed";
}

/**
 * The calendar. Append a season, flip the previous one to "closed", and both
 * collections follow: the items are already stamped, the packs read the open
 * season, and nothing that exists is disturbed.
 *
 * Season 1 is everything that existed before seasons did, which is why an
 * item with no season reads as 1.
 */
export const SEASONS: SeasonDef[] = [
  { n: 1, name: "Founders", status: "open" },
];

/** The season packs draw from today. */
export const CURRENT_SEASON: number = SEASONS.find((s) => s.status === "open")?.n ?? 1;

export function seasonDef(n: number): SeasonDef | undefined {
  return SEASONS.find((s) => s.n === n);
}

/** "SEASON 2 · NIGHT SHIFT", for anywhere a season is shown. */
export function seasonLabel(n: number): string {
  const def = seasonDef(n);
  return def ? `SEASON ${def.n} · ${def.name.toUpperCase()}` : `SEASON ${n}`;
}

export function isSeasonOpen(n: number): boolean {
  return seasonDef(n)?.status === "open";
}
