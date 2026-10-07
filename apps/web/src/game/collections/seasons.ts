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

/**
 * The frame a rarity is drawn as. THE ONE PLACE to change how a rarity looks:
 * every surface asks `rarityTheme()` rather than picking its own border and
 * tint, so editing a hex in RARITY_COLOR above moves the wardrobe grid, the
 * pack reveal and anything added later together.
 *
 * Only `color` is authored. The tint and the glow are the same colour at a
 * fixed alpha, which is what keeps four rarities reading as one system.
 */
export interface RarityTheme {
  /** The line at rest: border, label text, odds bar. */
  color: string;
  /** The line stood down, for a locked tile. Still legible AS the rarity. */
  muted: string;
  /**
   * The line at full strength, for the one tile that is selected. Selection
   * is drawn in the item's OWN colour, never a separate accent — a second
   * hue in a grid of four rarities reads as a fifth rarity, not as "this one
   * is on". Weight carries selection; see the wardrobe's SELECTED_BORDER.
   */
  strong: string;
  /** Behind the item, so the frame is not a lone outline. */
  fill: string;
  /** The same tint, raised, for the selected tile. */
  fillStrong: string;
  /** For a drop-shadow on the rarities worth lighting up. */
  glow: string;
  label: string;
}

/** Hex + two-digit alpha. The palette is authored as 6-digit hex on purpose. */
const alpha = (hex: string, aa: string) => `${hex}${aa}`;

/** Tint and glow strength per rarity: common stays flat, legendary burns. */
const RARITY_WEIGHT: Record<Rarity, { fill: string; fillStrong: string; glow: string }> = {
  common: { fill: "0d", fillStrong: "26", glow: "00" },
  uncommon: { fill: "16", fillStrong: "33", glow: "55" },
  rare: { fill: "1c", fillStrong: "38", glow: "66" },
  legendary: { fill: "22", fillStrong: "40", glow: "88" },
};

/** One step down for every rarity: a locked item still says what it is. */
const MUTED = "55";

/** An item with no rarity at all (a free shirt, a quest reward). Same shape,
 *  so a grid can frame every tile without asking whether it drops. Its line
 *  is deliberately faint at rest, which is why `strong` has further to climb
 *  here than it does for a rarity that is already a full-strength hex. */
export const UNRANKED_THEME: RarityTheme = {
  color: "rgba(255,255,255,0.10)",
  muted: "rgba(255,255,255,0.04)",
  strong: "rgba(255,255,255,0.50)",
  fill: "rgba(255,255,255,0.02)",
  fillStrong: "rgba(255,255,255,0.08)",
  glow: "transparent",
  label: "",
};

const RARITY_THEME: Record<Rarity, RarityTheme> = Object.fromEntries(
  RARITY_ORDER.map((r) => [r, {
    color: RARITY_COLOR[r],
    muted: alpha(RARITY_COLOR[r], MUTED),
    strong: RARITY_COLOR[r],
    fill: alpha(RARITY_COLOR[r], RARITY_WEIGHT[r].fill),
    fillStrong: alpha(RARITY_COLOR[r], RARITY_WEIGHT[r].fillStrong),
    glow: alpha(RARITY_COLOR[r], RARITY_WEIGHT[r].glow),
    label: RARITY_LABEL[r],
  }]),
) as Record<Rarity, RarityTheme>;

export function rarityTheme(rarity: Rarity | null | undefined): RarityTheme {
  return rarity ? RARITY_THEME[rarity] : UNRANKED_THEME;
}

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
