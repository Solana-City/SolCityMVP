import { LayerCategory, getBoosterPool, isFreeInShippedGame, type LayerVariant } from "./paperDoll";
import { unlockKeyOf } from "./wardrobeUnlocks";
import {
  CURRENT_SEASON, RARITY_ORDER, type Rarity, type TileKind,
} from "@/game/collections/seasons";

// Re-exported so a screen that shows wardrobe items does not have to know
// where the shared vocabulary lives.
export { RARITY_ORDER, RARITY_LABEL, RARITY_COLOR, PROVENANCE_COLOR, TILE_COLOR, TILE_ORDER, rarityTheme, UNRANKED_THEME, CURRENT_SEASON, SEASONS, seasonLabel } from "@/game/collections/seasons";
export type { Rarity, RarityTheme, TileKind } from "@/game/collections/seasons";

/**
 * Outfit packs: three of them, four rarities, one season at a time.
 *
 * NOTHING HERE IS FINAL. The numbers are placeholders the room will tune —
 * pack names, prices, the odds per rarity, and which item is which rarity.
 * What IS meant to be settled is the SHAPE: a pack is a named bundle with a
 * weight per rarity, every wardrobe item has a rarity and a season, and a
 * draw picks a rarity first and an item second. The program has to speak the
 * same shape, and it does not yet — see BOOSTER_SPEC.md, "Before the
 * redeploy", which must land before any of this can be paid for on chain.
 *
 * Until then this is the same preview the single pack already was: the draw
 * runs on `Math.random` here and grants into localStorage, exactly as the
 * on-chain version will run it on VRF and grant into a PDA.
 */

/**
 * Which items are worth more than the others. PROVISIONAL: a first pass so
 * the packs have something real to draw from and the reveal shows a spread.
 * Anything not named here is common.
 *
 * Whoever tunes this should remember it is a client mirror of what the
 * program will hold: an item's rarity decides which bucket it is drawn from,
 * so changing one changes the odds of everything in both buckets.
 */
const RARITY_TABLE: Partial<Record<Rarity, Partial<Record<LayerCategory, string[]>>>> = {
  legendary: {
    // Both animated effect hats are in the pool now, not test items: the plain
    // Crown was dropped and the Royal Crown took its place.
    hat: ["Royal_crown", "Halo", "Fire_Skull"],
    accessory: ["Glasses_cyber"],
    back: ["Sands_of_time"],
    tshirt: ["Suit_golden"],
    pants: ["Tail_demon", "Pants_golden"],
  },
  // Rare was carrying 18 of the 95, nearly double the supply model's share,
  // which left a specific rare barely easier to pull than a legendary while
  // common and uncommon sat at the same per-item rate. Six came down.
  rare: {
    hat: ["Viking_hat", "Vizard_hat", "Pirate", "Ninja"],
    accessory: ["Blindfold_demon", "Glasses_funny"],
    back: ["Wings_angel", "Wings_demon", "Jetpack", "Swords", "Wings_butterfly"],
    tshirt: ["Tshirt_dragon", "Suit_black"],
    // The first rare trousers, 2026-11-04: until then the slot had none.
    pants: ["Tail_dino"],
  },
  uncommon: {
    hat: ["Cylinder", "Straw_hat", "Horns_demon", "Cap_kid", "Cap_blue"],
    // backpack_red came down to common with the drop: a plain colourway reads
    // as one, and the back slot needed commons more than it needed tiers.
    // The seven capes are uncommon by the owner's rule, a silhouette of its
    // own, like the Wizard Cape: colour alone would have made them common.
    back: [
      "Backpack_solana", "Backpack_heart", "Cape_wizard",
      "Cape_black", "Cape_blue", "Cape_green", "Cape_red", "Cape_acid", "Cape_neon", "Cape_lotus",
    ],
    // All three earrings are uncommon, the owner's call, the plain gold and
    // silver pair included. The colour glasses are common.
    accessory: [
      "Glasses_steampunk", "Pirate", "Visor_cyber", "Glasses_thug",
      "Ear_golden_earrings", "Ear_silver_earrings", "Ear_heart_earrings", "Nose_clown",
    ],
    // Longsleeve_indies is NOT here any more: it became an event item, so it
    // sits in the quest block and never reaches a pack. Naming it would have
    // put an uncommon badge on something no pack can draw.
    // Acid and neon are gone from both cuts, and from the legs below. They
    // are the same garment as the eighteen commons in a different colour,
    // which is what common means here. Chess is a pattern and the Solana
    // shirt is branded, so those two stay.
    tshirt: ["Longsleeve_chess", "Tshirt_chess", "Tshirt_solana_white", "Coat_doc", "Coat_red", "Coat_dude"],
    pants: ["Pants_chess_red", "Pants_chess_white", "Pants_flame_blue", "Pants_flame_red"],
  },
};

/**
 * Items a pack can actually give: rarity means nothing on a free shirt or a
 * quest reward, so the wardrobe only marks the ones that drop.
 *
 * The free filter matters and is easy to miss. getBoosterPool() is built from
 * POOL_V1_FREE, which is frozen because the pool is index-stable on chain —
 * it still CONTAINS items that have become free since, and a season's drop
 * table leaves them out. Asking the pool alone marked every hairstyle as a rarity
 * the player could never actually open, which is the whole of what hair is:
 * free to everyone, like the bases and the faces.
 */
let packKeys: Set<string> | null = null;
export function isPackItem(category: LayerCategory, id: string): boolean {
  if (!packKeys) {
    packKeys = new Set(
      getBoosterPool()
        .filter((p) => !isFreeInShippedGame(p.category, p.variant.id))
        .map((p) => unlockKeyOf(p.category, p.variant.id)),
    );
  }
  return packKeys.has(unlockKeyOf(category, id));
}

export function rarityOf(category: LayerCategory, id: string): Rarity {
  for (const rarity of RARITY_ORDER) {
    if (RARITY_TABLE[rarity]?.[category]?.includes(id)) return rarity;
  }
  return "common";
}

// ── Seasons ─────────────────────────────────────────────────────────────────
//
// The calendar itself lives in game/collections/seasons.ts, shared with the
// other collection. Here it is only the reader: which season an item belongs
// to, and the rule that a pack draws from one season and one only.

/**
 * How to frame one wardrobe tile: its drop rarity, or, when a pack never
 * gives it, where it came from instead.
 *
 * Provenance wins over rarity, and that costs nothing today because the two
 * cannot overlap: `unlockVia` is exactly what keeps an item out of the
 * booster pool, so an item with one is never a pack item. Stated as an order
 * rather than left to chance, so a future item marked both still frames as
 * what it was earned for rather than silently as a common.
 *
 * `null` is an item that is neither, which is every free one. Those keep the
 * neutral frame the grid has always had.
 */
export function tileKindOf(category: LayerCategory, variant: LayerVariant): TileKind | null {
  if (variant.unlockVia) return variant.unlockVia;
  return isPackItem(category, variant.id) ? rarityOf(category, variant.id) : null;
}

export function seasonOf(variant: LayerVariant): number {
  return variant.season ?? 1;
}

// ── Packs ───────────────────────────────────────────────────────────────────

export interface PackDef {
  /** Stable id, used by the client and in analytics. Append only. */
  id: string;
  /**
   * The number `open_booster` is called with, matching PackConfig.packs[].id
   * on chain. Append only, and 0 is reserved for "no pack", so these start
   * at 1.
   *
   * Two ids rather than one because they answer to different owners: this
   * table is edited in a commit, the on-chain one in a transaction, and the
   * string is what the panels, the art paths and the analytics already use.
   */
  onChainId: number;
  name: string;
  /** One line under the name. No paragraphs. */
  blurb: string;
  /** Items drawn per pack. */
  size: number;
  /**
   * Placeholder price, in SOL, for the preview only.
   *
   * What is charged is PackConfig.packs[].price, in the config's currency
   * (USDC), which the panel has to read before it can show a figure it will
   * actually take. Keeping a number here would let the two drift silently,
   * so this one is explicitly the preview's.
   */
  priceSol: number;
  /** Weight per rarity for EACH item drawn. Must add up to 100. */
  odds: Record<Rarity, number>;
  /**
   * Animated art: one row of `frames` cells, `frameWidth` x `frameHeight`
   * each. The cells are NOT square — the delivered sheets are 36x51 — so
   * both numbers are carried rather than assumed, and the art is only ever
   * drawn at a whole multiple of them (see PackArt) so it stays crisp.
   */
  art: { file: string; frames: number; frameWidth: number; frameHeight: number };
  /** Panel accent. Taken from the art's own highlight colour. */
  accent: string;
}

/**
 * The three packs.
 *
 * ── Common is always the largest, and every tier below it is smaller ─────
 *
 * In every pack, without exception. A premium pack is premium because the
 * whole curve SHIFTS UP, never because the order changes. Every gacha worth
 * copying does it this way: a CS:GO case is 79.92 / 15.98 / 3.20 / 0.64 /
 * 0.26, a Hearthstone pack about 70 / 22 / 4.5 / 1.4, Genshin 94 / 5.1 / 0.6.
 *
 * Prime used to be 20 / 40 / 30 / 10, which inverted it: a player paying the
 * most saw the FEWEST commons, and commons are most of what gets drawn and
 * most of what gets drawn. Fixed 2026-10-27.
 *
 * Prime now carries seven times Street's legendary rate for 3.3x the price,
 * and almost one Prime in three holds at least one.
 *
 * These weights are mirrored on chain in PackConfig as basis points, which
 * the program requires to add up to 10000. Changing one is an upsert_pack
 * transaction rather than a deploy, so this table and the chain can drift:
 * scripts/packs-setup.ts is what puts them back in step.
 */
export const PACKS: PackDef[] = [
  {
    id: "street",
    onChainId: 1,
    name: "STREET PACK",
    blurb: "Everyday city wear.",
    size: 5,
    priceSol: 0.03,
    odds: { common: 72, uncommon: 22, rare: 5, legendary: 1 },
    art: { file: "/assets/ui/packs/pack_street.png", frames: 12, frameWidth: 36, frameHeight: 51 },
    accent: "#F5464C",
  },
  {
    id: "city",
    onChainId: 2,
    name: "CITY PACK",
    blurb: "Better odds, same five pieces.",
    size: 5,
    priceSol: 0.07,
    odds: { common: 58, uncommon: 29, rare: 10, legendary: 3 },
    art: { file: "/assets/ui/packs/pack_city.png", frames: 12, frameWidth: 36, frameHeight: 51 },
    accent: "#4995F3",
  },
  {
    id: "prime",
    onChainId: 3,
    name: "PRIME PACK",
    blurb: "The one with the crowns in it.",
    size: 5,
    priceSol: 0.1,
    odds: { common: 44, uncommon: 32, rare: 17, legendary: 7 },
    art: { file: "/assets/ui/packs/pack_prime.png", frames: 12, frameWidth: 36, frameHeight: 51 },
    accent: "#9A46FE",
  },
];

export function packById(id: string): PackDef | undefined {
  return PACKS.find((p) => p.id === id);
}

/** The reverse lookup, for reading a BoosterOpened event or a pending draw. */
export function packByOnChainId(id: number): PackDef | undefined {
  return PACKS.find((p) => p.onChainId === id);
}

// ── The draw ────────────────────────────────────────────────────────────────
//
// Drawn on chain only (callback_open_booster): every item an independent roll
// against the pack's odds, nothing the wallet holds consulted, repeats normal.
// The client-side rollPack that used to live here was removed on 2026-11-10;
// it followed older rules (no repeats in a pack, unowned items first).

export interface PackDrop {
  category: LayerCategory;
  id: string;
  name: string;
  file: string;
  rarity: Rarity;
  /** A repeat: the wallet could already wear it before this pack, or an
   *  earlier item of this pack is the same one. Still a new copy, minted like
   *  every other. */
  owned: boolean;
}

/** How many items of each rarity this season actually holds — the sanity
 *  check behind the odds, and what the dev panel would show. */
export function seasonRarityCounts(season: number = CURRENT_SEASON): Record<Rarity, number> {
  const counts: Record<Rarity, number> = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
  for (const { category, variant } of getBoosterPool()) {
    if (isFreeInShippedGame(category, variant.id)) continue;
    if (seasonOf(variant) !== season) continue;
    counts[rarityOf(category, variant.id)]++;
  }
  return counts;
}
