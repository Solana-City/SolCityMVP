import { clusterKey } from "./clusterStorage";
export type Direction = "down" | "left" | "right" | "up";

/**
 * Paper doll layer categories in render order (back to front).
 * Matches the spriter's numbered folders:
 *   6_Base → skin
 *   3_Face → eyesFace
 *   5_Legs → pants
 *   4_Clothes → tshirt
 *   4_Back  → back (jetpack/backpacks — worn OVER clothes: the "up" frame
 *             shows the full pack on the back, "down" shows just the strap
 *             tops over the shoulders. Rendering it before tshirt hid the
 *             whole thing behind the shirt from every angle.)
 *   1_Accessory → accessory
 *   2_Hair → hair
 *   0_Head → hat
 */
export const LAYER_ORDER = [
  "skin",
  "eyesFace",
  "pants",
  "tshirt",
  "back",
  "accessory",
  "hair",
  "hat",
] as const;

export type LayerCategory = (typeof LAYER_ORDER)[number];

export interface LayerVariant {
  id: string;
  name: string;
  /** Phaser texture key. */
  textureKey: string;
  /** Path relative to public/assets/sprites/paperdoll/. */
  file: string;
  /**
   * Set to false to pull a variant out of the wardrobe selection and
   * random-pedestrian pool without deleting its file — BootScene also
   * skips loading its texture. Defaults to true (present) when omitted.
   */
  enabled?: boolean;
  /**
   * Only meaningful for the "hat" category — controls how hair masking
   * treats this item (see AvatarSprite.ts's getHairTextureFor):
   *   "full" (default) — a cap/helmet/crown that encloses the top of the
   *     head. Hair is erased from the top of the frame down to wherever
   *     this hat's own ink starts, per column, since a real hat like this
   *     would hide everything above its brim.
   *   "band"  — a headband/bandana that only wraps the forehead. Hair is
   *     erased ONLY exactly where this item's own pixels are opaque —
   *     the crown above it, and everything below it, must stay visible.
   *   "suppress" — a full head-covering mask/hood (e.g. Ninja) narrower
   *     than some wide hairstyles (afro, anime), where per-column masking
   *     still leaves a sliver of hair visible past its edges and looks
   *     wrong for something meant to enclose the whole head. Hides the
   *     ENTIRE hair layer whenever this hat is equipped, regardless of the
   *     hat's own silhouette width. Use sparingly — this is heavier-handed
   *     than "full" and will hide hair that would otherwise legitimately
   *     show below/beside a smaller hat (that's why Viking_hat, which only
   *     covers the crown, stays on "full" rather than this).
   */
  hatCoverage?: "full" | "band" | "suppress";
  /**
   * Reserves this item to a specific achievement so it's excluded from the
   * random booster pool — it has to be earned the intended way, not rolled.
   * Undefined + not in FREE_ITEMS ⇒ it drops from booster packs.
   *
   * Covers quest rewards and the NPC-granted Superteam Brasil set (see
   * progression/outfitRewards.ts); `unlockHint` spells out the route for each.
   */
  unlockVia?: "quest" | "event";
  /** Overrides the default locked-item hint shown in the wardrobe. */
  unlockHint?: string;
  /**
   * Which season (collection) this item belongs to. Absent means season 1,
   * which is everything that existed before seasons did.
   *
   * A pack only ever draws from the season it is opened in, so closing a
   * season retires its items: they stay in the wardrobes that own them and
   * stop being obtainable. See game/config/packs.ts.
   */
  season?: number;
  /**
   * Marks an animated EFFECT sheet (halo, flames, sparkles) instead of a walk
   * sheet: still 64x64 cells and the same four direction rows, but each row
   * holds `frames` cells that loop at `fps` on their own, walking or standing.
   * It is drawn above every other layer and left out of the shadow.
   * Never given to a pedestrian — see PedestrianSprite.
   */
  effect?: {
    frames: number;
    fps: number;
    /**
     * Rides above the hair: lifted by however far the hairstyle stands over
     * the bare head, so a tall style does not poke through the effect.
     */
    clearsHair?: boolean;
    /**
     * The sheet is groups of SPRITE_COLS cells, each group one walk cycle of
     * the body it rides on. The cell inside a group is the body's own walk
     * frame, so the effect moves with the head instead of beside it; `fps`
     * then sets how fast the groups themselves change (one every
     * SPRITE_COLS / fps seconds). Only while the body walks: standing still
     * the whole loop plays at `fps` cells a second.
     */
    followsWalk?: boolean;
    /**
     * What the effect does while the body stands still (with `followsWalk`):
     * "loop" plays the whole sheet on the clock (a halo floats, so its bob
     * needs no head), "follow" keeps the body's own frame, which is the
     * resting one, and only changes group (a crown sits ON the head, and a
     * crown that bobbed over a still head would look loose).
     */
    standing?: "loop" | "follow";
  };
}

/**
 * Sprite sheet contract for every paper doll layer:
 *   - 4 columns: walk-cycle frames 0–3
 *   - 4 rows: down, right, up, left
 *   - Frame size: 64 × 64 px
 *
 * Files live in: public/assets/sprites/paperdoll/{category}/{Variant}.png
 */
export const SPRITE_FRAME_WIDTH = 64;
export const SPRITE_FRAME_HEIGHT = 64;
export const SPRITE_COLS = 4;
export const SPRITE_ROWS = 4;

// Row order used in the spriter's paperdoll sheets (matches NPC_DIRECTION_ROW).
/**
 * Which cell of an effect sheet to show at `nowMs`.
 *
 * `walkPhase` is the body's own walk frame (0..SPRITE_COLS-1) while it walks,
 * and null standing or in a preview. A sheet with `followsWalk` is groups of
 * SPRITE_COLS cells, each one walk cycle: the clock picks the group and the
 * body picks the cell in it, so the effect moves with the head. Standing, the
 * effect either plays the whole sheet on the clock ("loop", the default) or
 * keeps the resting cell and only changes group ("follow").
 *
 * One rule for the game, the wardrobe tile and the large preview, so the three
 * cannot drift apart.
 */
export function effectCell(
  effect: NonNullable<LayerVariant["effect"]>,
  nowMs: number,
  walkPhase: number | null,
): number {
  const step = Math.floor((nowMs / 1000) * effect.fps);
  if (effect.followsWalk && (walkPhase !== null || effect.standing === "follow")) {
    const group = Math.floor(step / SPRITE_COLS) % (effect.frames / SPRITE_COLS);
    return group * SPRITE_COLS + (walkPhase ?? 0);
  }
  return step % effect.frames;
}

export const DIRECTION_ROW: Record<Direction, number> = {
  down: 0,
  up: 1,
  right: 2,
  left: 3,
};

/**
 * A player's full layer selection. Missing/undefined = no layer rendered for
 * that slot.
 *
 * `hairColor` is NOT a layer: it is a swatch id from game/config/hairPalette,
 * applied to whichever hairstyle is worn. Undefined means "as the sheet was
 * drawn", which is the common case and the one that renders straight off the
 * original texture with nothing derived.
 */
export type Loadout = Partial<Record<LayerCategory, string>> & { hairColor?: string };

export const LAYER_VARIANTS: Record<LayerCategory, LayerVariant[]> = {
  back: [
    { id: "Jetpack",         name: "Jetpack",        textureKey: "pd-back-Jetpack",         file: "back/Jetpack.png" },
    { id: "backpack_brown",  name: "Brown Backpack", textureKey: "pd-back-backpack_brown",  file: "back/backpack_brown.png" },
    { id: "backpack_red",    name: "Red Backpack",   textureKey: "pd-back-backpack_red",    file: "back/backpack_red.png" },
    // The Seeker Lover's second gift, for holding a real position rather than
    // a single token. Appended, never inserted: position in this list is the
    // index the program stores as a bit. unlockVia keeps it out of the booster
    // pool, so the pool order is untouched and POOL_VERSION does not move.
    { id: "Seeker_backpack", name: "Seeker Backpack", textureKey: "pd-back-Seeker_backpack",
      file: "back/Seeker_backpack.png", unlockVia: "quest",
      unlockHint: "Hold 7,000 SKR and talk to Seeker Lover" },
    // Wings, 2026-10-30. Appended; position is the index.
    { id: "Wings_angel", name: "Angel Wings", textureKey: "pd-back-Wings_angel", file: "back/Wings_angel.png" },
    { id: "Wings_demon", name: "Demon Wings", textureKey: "pd-back-Wings_demon", file: "back/Wings_demon.png" },
  ],
  skin: [
    { id: "Light",      name: "Light",      textureKey: "pd-skin-Light",      file: "skin/Light.png" },
    { id: "Feyan",      name: "Feyan",      textureKey: "pd-skin-Feyan",      file: "skin/Feyan.png" },
    { id: "Laovai",     name: "Laovai",     textureKey: "pd-skin-Laovai",     file: "skin/Laovai.png" },
    { id: "Pinki",      name: "Pinki",      textureKey: "pd-skin-Pinki",      file: "skin/Pinki.png" },
    { id: "Radio",      name: "Radio",      textureKey: "pd-skin-Radio",      file: "skin/Radio.png" },
    { id: "Brown",      name: "Brown",      textureKey: "pd-skin-Brown",      file: "skin/Brown.png" },
    { id: "Dark_brown", name: "Dark Brown", textureKey: "pd-skin-Dark_brown", file: "skin/Dark_brown.png" },
  ],
  eyesFace: [
    { id: "Happy",        name: "Happy",        textureKey: "pd-eyesFace-Happy",        file: "eyesFace/Happy.png" },
    // Replaced the Terminator face on 2026-10-30, IN PLACE. The old one
    // carried someone else's character name and was not going to ship, but
    // removing a free item renumbers every face after it, and a catalog index
    // is what a wallet owns. Taking over the slot keeps Normal Blue at 34.
    { id: "Normal_solana", name: "Normal Solana", textureKey: "pd-eyesFace-Normal_solana", file: "eyesFace/Normal_solana.png" },
    { id: "Normal_blue",  name: "Normal Blue",  textureKey: "pd-eyesFace-Normal_blue",  file: "eyesFace/Normal_blue.png" },
    { id: "Normal_green", name: "Normal Green", textureKey: "pd-eyesFace-Normal_green", file: "eyesFace/Normal_green.png" },
    { id: "Normal_grey",  name: "Normal Grey",  textureKey: "pd-eyesFace-Normal_grey",  file: "eyesFace/Normal_grey.png" },
    { id: "Normal_orange",name: "Normal Orange",textureKey: "pd-eyesFace-Normal_orange",file: "eyesFace/Normal_orange.png" },
    { id: "Normal_red",   name: "Normal Red",   textureKey: "pd-eyesFace-Normal_red",   file: "eyesFace/Normal_red.png" },
    // Nya + Sleepy were static faces; they're now triggerable expressions
    // (see EXPRESSIONS below), so they no longer appear in the wardrobe.
  ],
  pants: [
    { id: "Blue_pants",       name: "Blue Pants",       textureKey: "pd-pants-Blue_pants",       file: "pants/Blue_pants.png" },
    { id: "Red_short_pants",  name: "Red Short Pants",  textureKey: "pd-pants-Red_short_pants",  file: "pants/Red_short_pants.png" },
    { id: "Grey_pants",       name: "Grey Pants",       textureKey: "pd-pants-Grey_pants",       file: "pants/Grey_pants.png" },
    { id: "Grey_short_pants", name: "Grey Short Pants", textureKey: "pd-pants-Grey_short_pants", file: "pants/Grey_short_pants.png" },
    // The trouser drop, 2026-10-30. Appended; position is the index.
    { id: "Pants_black", name: "Black Pants", textureKey: "pd-pants-Pants_black", file: "pants/Pants_black.png" },
    { id: "Pants_black_belt", name: "Black Belted Pants", textureKey: "pd-pants-Pants_black_belt", file: "pants/Pants_black_belt.png" },
    { id: "Pants_green", name: "Green Pants", textureKey: "pd-pants-Pants_green", file: "pants/Pants_green.png" },
    { id: "Pants_chess_red", name: "Red Checkered Pants", textureKey: "pd-pants-Pants_chess_red", file: "pants/Pants_chess_red.png" },
    { id: "Pants_chess_white", name: "White Checkered Pants", textureKey: "pd-pants-Pants_chess_white", file: "pants/Pants_chess_white.png" },
    { id: "Pants_golden", name: "Golden Pants", textureKey: "pd-pants-Pants_golden", file: "pants/Pants_golden.png" },
  ],
  tshirt: [
    { id: "Blue_tshirt",  name: "Blue T-Shirt",  textureKey: "pd-tshirt-Blue_tshirt",  file: "tshirt/Blue_tshirt.png" },
    { id: "White_tshirt", name: "White T-Shirt", textureKey: "pd-tshirt-White_tshirt", file: "tshirt/White_tshirt.png" },
    // Superteam Brasil set — earned, never dropped by a booster (see unlockVia).
    { id: "STB_shirt", name: "Superteam Brasil Shirt", textureKey: "pd-tshirt-STB_shirt",
      file: "tshirt/STB_shirt.png", unlockVia: "quest", unlockHint: "Talk to Kuka" },
    { id: "Brazilian_shirt", name: "Brazil Shirt", textureKey: "pd-tshirt-Brazilian_shirt",
      file: "tshirt/Brazilian_shirt.png", unlockVia: "quest", unlockHint: "Meet Kuka, Kite Pro, the Caramel Dog and every builder at a stand" },
    // Vibhu's gift, for opening his Breakpoint 2026 link. Earned by taking the
    // link, not by buying anything: nothing checks whether a ticket was bought.
    { id: "Shirt_Solana", name: "Solana Shirt", textureKey: "pd-tshirt-Shirt_Solana",
      file: "tshirt/Shirt_Solana.png", unlockVia: "quest", unlockHint: "Open Vibhu's Breakpoint link" },
    // The clothing drop, 2026-10-30. Appended; position is the index.
    { id: "Longsleeve_black", name: "Black Longsleeve", textureKey: "pd-tshirt-Longsleeve_black", file: "tshirt/Longsleeve_black.png" },
    { id: "Longsleeve_brown", name: "Brown Longsleeve", textureKey: "pd-tshirt-Longsleeve_brown", file: "tshirt/Longsleeve_brown.png" },
    { id: "Longsleeve_dark_blue", name: "Dark Blue Longsleeve", textureKey: "pd-tshirt-Longsleeve_dark_blue", file: "tshirt/Longsleeve_dark_blue.png" },
    { id: "Longsleeve_dark_grey", name: "Dark Grey Longsleeve", textureKey: "pd-tshirt-Longsleeve_dark_grey", file: "tshirt/Longsleeve_dark_grey.png" },
    { id: "Longsleeve_green", name: "Green Longsleeve", textureKey: "pd-tshirt-Longsleeve_green", file: "tshirt/Longsleeve_green.png" },
    { id: "Longsleeve_light_blue", name: "Light Blue Longsleeve", textureKey: "pd-tshirt-Longsleeve_light_blue", file: "tshirt/Longsleeve_light_blue.png" },
    { id: "Longsleeve_light_grey", name: "Light Grey Longsleeve", textureKey: "pd-tshirt-Longsleeve_light_grey", file: "tshirt/Longsleeve_light_grey.png" },
    { id: "Longsleeve_orange", name: "Orange Longsleeve", textureKey: "pd-tshirt-Longsleeve_orange", file: "tshirt/Longsleeve_orange.png" },
    { id: "Longsleeve_red", name: "Red Longsleeve", textureKey: "pd-tshirt-Longsleeve_red", file: "tshirt/Longsleeve_red.png" },
    { id: "Longsleeve_white", name: "White Longsleeve", textureKey: "pd-tshirt-Longsleeve_white", file: "tshirt/Longsleeve_white.png" },
    { id: "Longsleeve_yellow", name: "Yellow Longsleeve", textureKey: "pd-tshirt-Longsleeve_yellow", file: "tshirt/Longsleeve_yellow.png" },
    { id: "Tshirt_black", name: "Black T-Shirt", textureKey: "pd-tshirt-Tshirt_black", file: "tshirt/Tshirt_black.png" },
    { id: "Tshirt_dark_grey", name: "Dark Grey T-Shirt", textureKey: "pd-tshirt-Tshirt_dark_grey", file: "tshirt/Tshirt_dark_grey.png" },
    { id: "Tshirt_light_grey", name: "Light Grey T-Shirt", textureKey: "pd-tshirt-Tshirt_light_grey", file: "tshirt/Tshirt_light_grey.png" },
    { id: "Tshirt_orange", name: "Orange T-Shirt", textureKey: "pd-tshirt-Tshirt_orange", file: "tshirt/Tshirt_orange.png" },
    { id: "Tshirt_yellow", name: "Yellow T-Shirt", textureKey: "pd-tshirt-Tshirt_yellow", file: "tshirt/Tshirt_yellow.png" },
    { id: "Tshirt_green", name: "Green T-Shirt", textureKey: "pd-tshirt-Tshirt_green", file: "tshirt/Tshirt_green.png" },
    { id: "Tshirt_red", name: "Red T-Shirt", textureKey: "pd-tshirt-Tshirt_red", file: "tshirt/Tshirt_red.png" },
    { id: "Longsleeve_acid", name: "Acid Longsleeve", textureKey: "pd-tshirt-Longsleeve_acid", file: "tshirt/Longsleeve_acid.png" },
    { id: "Longsleeve_neon", name: "Neon Longsleeve", textureKey: "pd-tshirt-Longsleeve_neon", file: "tshirt/Longsleeve_neon.png" },
    { id: "Longsleeve_chess", name: "Checkered Longsleeve", textureKey: "pd-tshirt-Longsleeve_chess", file: "tshirt/Longsleeve_chess.png" },
    { id: "Longsleeve_indies", name: "Indies Longsleeve", textureKey: "pd-tshirt-Longsleeve_indies", file: "tshirt/Longsleeve_indies.png" },
    { id: "Tshirt_acid", name: "Acid T-Shirt", textureKey: "pd-tshirt-Tshirt_acid", file: "tshirt/Tshirt_acid.png" },
    { id: "Tshirt_neon", name: "Neon T-Shirt", textureKey: "pd-tshirt-Tshirt_neon", file: "tshirt/Tshirt_neon.png" },
    { id: "Tshirt_chess", name: "Checkered T-Shirt", textureKey: "pd-tshirt-Tshirt_chess", file: "tshirt/Tshirt_chess.png" },
    { id: "Tshirt_solana_white", name: "White Solana T-Shirt", textureKey: "pd-tshirt-Tshirt_solana_white", file: "tshirt/Tshirt_solana_white.png" },
    { id: "Tshirt_dragon", name: "Dragon T-Shirt", textureKey: "pd-tshirt-Tshirt_dragon", file: "tshirt/Tshirt_dragon.png" },
    { id: "Coat_doc", name: "Doctor Coat", textureKey: "pd-tshirt-Coat_doc", file: "tshirt/Coat_doc.png" },
    { id: "Coat_dude", name: "Dude Coat", textureKey: "pd-tshirt-Coat_dude", file: "tshirt/Coat_dude.png" },
    { id: "Coat_red", name: "Red Coat", textureKey: "pd-tshirt-Coat_red", file: "tshirt/Coat_red.png" },
    { id: "Suit_black", name: "Black Suit", textureKey: "pd-tshirt-Suit_black", file: "tshirt/Suit_black.png" },
    { id: "Suit_golden", name: "Golden Suit", textureKey: "pd-tshirt-Suit_golden", file: "tshirt/Suit_golden.png" },
    { id: "Tshirt_solana_city", name: "Solana City T-Shirt", textureKey: "pd-tshirt-Tshirt_solana_city", file: "tshirt/Tshirt_solana_city.png",
      unlockVia: "quest", unlockHint: "Earned in the city" },
  ],
  accessory: [
    { id: "Golden_ring", name: "Golden Ring", textureKey: "pd-accessory-Golden_ring", file: "accessory/Golden_ring.png" },
    { id: "Pirate",      name: "Pirate",      textureKey: "pd-accessory-Pirate",      file: "accessory/Pirate.png" },
    { id: "Trader_shades", name: "Trader Shades", textureKey: "pd-accessory-Trader_shades",
      file: "accessory/Trader_shades.png", unlockVia: "quest", unlockHint: "Trade your first stock at Stocklana" },
    // Rings and eyewear, 2026-10-30. Appended for the same reason as the
    // caps above: position IS the index.
    { id: "Ring_bronze", name: "Bronze Ring", textureKey: "pd-accessory-Ring_bronze", file: "accessory/Ring_bronze.png" },
    { id: "Ring_silver", name: "Silver Ring", textureKey: "pd-accessory-Ring_silver", file: "accessory/Ring_silver.png" },
    { id: "Glasses_round", name: "Round Glasses", textureKey: "pd-accessory-Glasses_round", file: "accessory/Glasses_round.png" },
    { id: "Glasses_steampunk", name: "Steampunk Goggles", textureKey: "pd-accessory-Glasses_steampunk", file: "accessory/Glasses_steampunk.png" },
    { id: "Ring_brilliant", name: "Brilliant Ring", textureKey: "pd-accessory-Ring_brilliant", file: "accessory/Ring_brilliant.png" },
    { id: "Glasses_thug", name: "Thug Shades", textureKey: "pd-accessory-Glasses_thug", file: "accessory/Glasses_thug.png" },
    { id: "Blindfold_demon", name: "Demon Blindfold", textureKey: "pd-accessory-Blindfold_demon", file: "accessory/Blindfold_demon.png" },
    { id: "Visor_cyber", name: "Cyber Visor", textureKey: "pd-accessory-Visor_cyber", file: "accessory/Visor_cyber.png" },
  ],
  // STYLES ONLY — the colour is a separate axis (game/config/hairPalette.ts),
  // so a style is listed once and worn in any of the twenty swatches.
  //
  // Brown_hair, Magawk_green and Magawk_red used to live here as their own
  // entries. They were the SAME sheets as Black_hair and Magawk_blue with two
  // hexes changed, which the palette now does at runtime and hairPalette.test
  // pins pixel for pixel, so keeping them would have been three wardrobe tiles
  // showing a colour the player can already pick. loadSavedLoadout migrates
  // anyone who had one on. The names dropped their colour for the same reason:
  // "Black Hair" is wrong the moment it can be pink.
  hair: [
    // "Arrow Tattoo" and not "Avatar": it is a mark on the head, not a
    // hairstyle, and the old name said nothing about it. The ID stays, because
    // the id is what the catalog index and every saved loadout are built from.
    { id: "Avatar",      name: "Arrow Tattoo", textureKey: "pd-hair-Avatar",      file: "hair/Avatar.png" },
    { id: "Black_hair",  name: "Short Hair", textureKey: "pd-hair-Black_hair",  file: "hair/Black_hair.png" },
    // Re-enabled: AvatarSprite.ts's hair masking now clips per column against
    // the hat's own silhouette (not just a single row-wide cutoff), which
    // handles hair wider than the hat too, not only taller.
    { id: "Afro",        name: "Afro",       textureKey: "pd-hair-Afro",        file: "hair/Afro.png" },
    { id: "Anime",       name: "Anime",      textureKey: "pd-hair-Anime",       file: "hair/Anime.png" },
    { id: "Magawk_blue", name: "Mohawk",     textureKey: "pd-hair-Magawk_blue", file: "hair/Magawk_blue.png" },
    { id: "black_long",  name: "Long Hair",  textureKey: "pd-hair-black_long",  file: "hair/black_long.png" },
    // Facial hair rides the hair slot, so a beard and a hairstyle cannot be
    // worn at the same time. That is the slot's shape, not a choice made here.
    { id: "brown_beard", name: "Beard",      textureKey: "pd-hair-brown_beard", file: "hair/brown_beard.png" },
  ],
  hat: [
    // Earned, not boxed: the reward for a 7-day check-in streak. Moved out of
    // the booster pool BEFORE the pool's on-chain indices were first deployed.
    { id: "Cap_Sol",    name: "Cap Sol",    textureKey: "pd-hat-Cap_Sol",    file: "hat/Cap_Sol.png",
      unlockVia: "quest", unlockHint: "Come back 7 days in a row" },
    // "Sol Cap Blue" and not "Cap Blue": this is the Sol cap in blue, and a
    // plain blue cap joined the catalog on 2026-10-30. The ID does not move,
    // because the id is what the catalog index is built from and the index is
    // what a wallet owns. Only the label a player reads changes.
    { id: "Cap_blue",   name: "Sol Cap Blue", textureKey: "pd-hat-Cap_blue",   file: "hat/Cap_blue.png" },
    { id: "Cap_kid",    name: "Cap Kid",    textureKey: "pd-hat-Cap_kid",    file: "hat/Cap_kid.png" },
    { id: "Crown",      name: "Crown",      textureKey: "pd-hat-Crown",      file: "hat/Crown.png" },
    { id: "Cylinder",   name: "Cylinder",   textureKey: "pd-hat-Cylinder",   file: "hat/Cylinder.png" },
    { id: "Viking_hat", name: "Viking Hat", textureKey: "pd-hat-Viking_hat", file: "hat/Viking_hat.png" },
    { id: "Ninja",      name: "Ninja",      textureKey: "pd-hat-Ninja",      file: "hat/Ninja.png", hatCoverage: "suppress" },
    { id: "Pirate",     name: "Pirate",     textureKey: "pd-hat-Pirate",     file: "hat/Pirate.png" },
    { id: "Straw_hat",  name: "Straw Hat",  textureKey: "pd-hat-Straw_hat",  file: "hat/Straw_hat.png" },
    { id: "Vizard_hat", name: "Vizard Hat", textureKey: "pd-hat-Vizard_hat", file: "hat/Vizard_hat.png" },
    { id: "hat_black",  name: "Black Hat",  textureKey: "pd-hat-hat_black",  file: "hat/hat_black.png" },
    { id: "hat_red",    name: "Red Hat",    textureKey: "pd-hat-hat_red",    file: "hat/hat_red.png" },
    { id: "red_belt",   name: "Red Bandana",textureKey: "pd-hat-red_belt",   file: "hat/red_belt.png", hatCoverage: "band" },
    // Earned from NPCs, so unlockVia keeps both out of the booster pool.
    // The donation route was dropped on 2026-10-20: the Donation Manager and
    // lib/donationWallet.ts both promise the player that donations buy nothing,
    // and paying out an outfit for one makes that false. A replacement
    // condition is still to be chosen, so the hint says what is true today
    // rather than naming a route that no longer exists.
    { id: "city_cap",   name: "City Cap",   textureKey: "pd-hat-city_cap",   file: "hat/city_cap.png",
      unlockVia: "quest", unlockHint: "Earned in the city" },
    { id: "turkish_head", name: "Turkish Hat", textureKey: "pd-hat-turkish_head", file: "hat/turkish_head.png",
      unlockVia: "quest", unlockHint: "Get a new look from the Hair Specialist" },
    // Superteam Brasil set — earned, never dropped by a booster (see unlockVia).
    { id: "STB_cap", name: "Superteam Brasil Cap", textureKey: "pd-hat-STB_cap",
      file: "hat/STB_cap.png", unlockVia: "quest", unlockHint: "Win a round of Kite Clash" },
    // Seeker Lover's gift. unlockVia also keeps it out of the booster pool,
    // which is every item that is neither free nor spoken for.
    { id: "Seeker_hat", name: "Seeker Hat", textureKey: "pd-hat-Seeker_hat",
      file: "hat/Seeker_hat.png", unlockVia: "quest",
      unlockHint: "Hold SKR and talk to Seeker Lover" },
    // The Halloween collectible, handed over by Jack O' Lantern. "suppress"
    // rather than the default "full": a pumpkin encloses the whole head, and
    // per-column masking would leave a sliver of a wide hairstyle showing past
    // the pumpkin's edge. Earned, never boxed — unlockVia keeps it out of the
    // booster pool, and it is off the season table on purpose: its scarcity is
    // the event window, not a drop table that would need a redeploy.
    { id: "Pumpkin_head", name: "Pumpkin Head", textureKey: "pd-hat-Pumpkin_head",
      file: "hat/Pumpkin_head.png", hatCoverage: "suppress", unlockVia: "event",
      unlockHint: "Carve a clean pumpkin for Jack O' Lantern" },
    // The Claim Office's trophy, for ORE actually struck rather than a claim
    // staked. unlockVia keeps it out of the booster pool, like every other
    // earned piece. The grant has existed in outfitRewards since the track was
    // written and did nothing, because grant() skips a reward whose variant is
    // missing and the sprite only arrived on 2026-10-20.
    //
    // Its ink starts at y2 of each frame row while the rest of hat/ starts at
    // y5. That is the artist's choice, not a misalignment: a hat sits where it
    // sits on the head, and this one rides higher. It was "corrected" down 3px
    // once and came out wrong. Leave it.
    //
    // The spriter's export is named Helmet_Ore.png, which no longer matches
    // anything here. Worth knowing before hunting for a file called Miner_hat.
    { id: "Miner_hat", name: "Miner's Hat", textureKey: "pd-hat-Miner_hat",
      file: "hat/Miner_hat.png", unlockVia: "quest",
      unlockHint: "Win ORE out of a claim" },
    // First animated effect sheet: 24 frames per direction row. A TEST item
    // for the effect pipeline, not on sale: unlockVia keeps it out of the pool.
    // It is a hat only because hat is the LAST category in the catalog, so it
    // appends to the quest block instead of renumbering the hats after it.
    // "band" so the hair mask erases only under the halo's own ink: the
    // sheet is 24 cells wide and the mask reads the first four as a walk.
    { id: "Halo", name: "Halo", textureKey: "pd-hat-Halo", file: "hat/Halo.png",
      hatCoverage: "band", unlockVia: "quest", unlockHint: "Test item",
      // DOM's timing: 150 ms a cell, so a 3.6 s loop. Read off the clock (see
      // AvatarSprite.tickEffects), so it holds whatever the frame rate does.
      effect: { frames: 24, fps: 1000 / 150, clearsHair: true, followsWalk: true } },
    // The second effect sheet, and the first that is a crown rather than a
    // halo: 48 cells a row, twelve walk cycles drawn over the body, in the same
    // place as the static Crown above. Appended AFTER the Halo on purpose (an
    // index written to chain names an item). A hat worn ON the head, so unlike
    // the Halo it casts the hair mask like any crown (clearsHair is unset), and
    // standing it only changes group, because a crown that bobbed over a still
    // head would look loose.
    { id: "Royal_crown", name: "Royal Crown", textureKey: "pd-hat-Royal_crown", file: "hat/Royal_crown.png",
      unlockVia: "quest", unlockHint: "Test item",
      effect: { frames: 48, fps: 1000 / 150, followsWalk: true, standing: "follow" } },
    // The colourway caps, 2026-10-30. Appended, never inserted: a booster
    // item's catalog index is its position in this lane, and a wallet owns
    // the index, not the name.
    { id: "Cap_black", name: "Black Cap", textureKey: "pd-hat-Cap_black", file: "hat/Cap_black.png" },
    { id: "Cap_blue_plain", name: "Blue Cap", textureKey: "pd-hat-Cap_blue_plain", file: "hat/Cap_blue_plain.png" },
    { id: "Cap_brown", name: "Brown Cap", textureKey: "pd-hat-Cap_brown", file: "hat/Cap_brown.png" },
    { id: "Cap_dark_grey", name: "Dark Grey Cap", textureKey: "pd-hat-Cap_dark_grey", file: "hat/Cap_dark_grey.png" },
    { id: "Cap_green", name: "Green Cap", textureKey: "pd-hat-Cap_green", file: "hat/Cap_green.png" },
    { id: "Cap_light_grey", name: "Light Grey Cap", textureKey: "pd-hat-Cap_light_grey", file: "hat/Cap_light_grey.png" },
    { id: "Cap_orange", name: "Orange Cap", textureKey: "pd-hat-Cap_orange", file: "hat/Cap_orange.png" },
    { id: "Cap_red", name: "Red Cap", textureKey: "pd-hat-Cap_red", file: "hat/Cap_red.png" },
  ],
};

/** Default starter loadout. Hat, accessory start empty (optional). */
export const DEFAULT_LOADOUT: Loadout = {
  skin: "Light",
  eyesFace: "Happy",
  pants: "Blue_pants",
  tshirt: "Blue_tshirt",
  hair: "Black_hair",
};

/**
 * Facial expressions — MapleStory-style. Triggering one temporarily swaps
 * the player's own eyesFace layer to the expression sheet (same 4x4 64px
 * paper-doll format as any face), then reverts to their chosen face after a
 * few seconds. The sheets live under paperdoll/expressions/ (DOM's set),
 * loaded under their own `pd-expr-*` texture keys so they're available for
 * expressions without being selectable static faces in the wardrobe.
 * Adding one is a single entry here — it auto-loads, chroma-keys, and shows
 * up as a clickable button in the expressions picker.
 */
export interface Expression {
  id: string;
  name: string;
  /** Emoji shown on the picker button. */
  uiSymbol: string;
  /** Phaser texture key (distinct from any pd-eyesFace-* key). */
  textureKey: string;
  /** Path relative to public/assets/sprites/paperdoll/. */
  file: string;
  /** Optional overhead animation, played alongside the face swap. */
  fx?: ExpressionFxDef;
}

/**
 * The overhead burst that sells an expression from across the street. A face
 * swap is 8 pixels wide on a 64px sprite: at the city's camera it reads from
 * a step away and nowhere else, which is the note testers kept giving. The
 * fx is a separate sheet drawn above the head, so distance costs it nothing.
 *
 * Sheets are a single row of `frameWidth`x`frameHeight` cells under
 * public/assets/sprites/fx/expressions/, shipped already keyed (no pink).
 */
export interface ExpressionFxDef {
  /** Phaser texture key for the fx sheet. */
  textureKey: string;
  /** Path relative to public/assets/sprites/fx/expressions/. */
  file: string;
  frameWidth: number;
  frameHeight: number;
  /** Frames per second for one pass of the sheet. */
  frameRate: number;
}

/**
 * The whole set arrived in one shape: a single row of seven 32px frames,
 * named after the expression it belongs to. A sheet drawn to any other grid
 * writes the object out in full instead.
 */
const fxSheet = (name: string): ExpressionFxDef => ({
  textureKey: `expr-fx-${name}`,
  file: `${name}.png`,
  frameWidth: 32,
  frameHeight: 32,
  frameRate: 10,
});

export const EXPRESSIONS: Expression[] = [
  { id: "nya",   name: "Nya",   uiSymbol: "😸", textureKey: "pd-expr-Nya",   file: "expressions/Nya.png",   fx: fxSheet("Nya") },
  { id: "sleep", name: "Sleep", uiSymbol: "😴", textureKey: "pd-expr-Sleep", file: "expressions/Sleep.png", fx: fxSheet("Sleep") },
  { id: "angry", name: "Angry", uiSymbol: "😠", textureKey: "pd-expr-Angry", file: "expressions/Angry.png", fx: fxSheet("Angry") },
  { id: "cry",   name: "Cry",   uiSymbol: "😢", textureKey: "pd-expr-Cry",   file: "expressions/Cry.png",   fx: fxSheet("Cry") },
  { id: "lol",   name: "LOL",   uiSymbol: "😂", textureKey: "pd-expr-LOL",   file: "expressions/LOL.png",   fx: fxSheet("LOL") },
  { id: "love",  name: "Love",  uiSymbol: "😍", textureKey: "pd-expr-Love",  file: "expressions/Love.png",  fx: fxSheet("Love") },
  { id: "shy",   name: "Shy",   uiSymbol: "😳", textureKey: "pd-expr-Shy",   file: "expressions/Shy.png",   fx: fxSheet("Shy") },
  { id: "stars", name: "Stars", uiSymbol: "🤩", textureKey: "pd-expr-Stars", file: "expressions/Stars.png", fx: fxSheet("Stars") },
];

export const CATEGORY_LABELS: Record<LayerCategory, string> = {
  back:      "Back",
  skin:      "Base",
  eyesFace:  "Face",
  pants:     "Legs",
  tshirt:    "Clothes",
  accessory: "Accessory",
  hair:      "Hair",
  hat:       "Head",
};

export function getVariant(category: LayerCategory, variantId?: string): LayerVariant | undefined {
  if (!variantId) return undefined;
  return LAYER_VARIANTS[category].find((v) => v.id === variantId);
}

/** A category's variants with any enabled:false entries filtered out — use
 *  this instead of indexing LAYER_VARIANTS directly for anything the player
 *  can pick from or that a random pedestrian could roll. */
export function getEnabledVariants(category: LayerCategory): LayerVariant[] {
  return LAYER_VARIANTS[category].filter((v) => v.enabled !== false);
}

// ── Unlock economy (gacha) ──────────────────────────────────────────────────
//
// Every base and hairstyle is free, plus the Black Hat. Packs are for future
// additions; quests and NPCs still grant their own items.

/**
 * TESTING: every hat is unlocked. Black Hat stays free either way.
 *
 * OFF since 2026-10-26, so the pack economy can be tested against what a
 * wallet actually owns. While it was on, the client let anybody wear a Crown
 * or a Ninja - which are pack items - and the chain knew nothing about it.
 * That gap is what made the wardrobe impossible to enforce: the moment the
 * loadout goes over the wire as catalog indices, the program rejects the whole
 * outfit of a player wearing an item their on-chain snapshot does not hold,
 * and with this flag on that was most testers.
 *
 * Turning it back on is a real decision now, not a convenience: it puts the
 * client and the chain back into disagreement.
 */
export const TEST_UNLOCK_ALL_HATS = false;

/**
 * TESTING: the animated effect hats, free to everyone while their art is being
 * tried out in the real game. Unlike the switch above this is safe with the
 * chain as it stands: both are quest-block items, which the program skips when
 * it checks a look, so wearing one cannot get an outfit rejected. Empty this
 * list when they are meant to be earned, or sold. SHIPPED_FREE_ITEMS below does
 * not read it, so the pool and the catalog are untouched.
 */
const TEST_FREE_EFFECT_HATS = ["Halo", "Royal_crown"];

const FREE_ITEMS: Partial<Record<LayerCategory, "*" | string[]>> = {
  skin: "*",
  eyesFace: "*",
  hair: "*",
  hat: TEST_UNLOCK_ALL_HATS ? "*" : ["hat_black", ...TEST_FREE_EFFECT_HATS],
  tshirt: ["Blue_tshirt", "White_tshirt"],
  pants: ["Blue_pants", "Grey_pants"],
};

/**
 * The free set the booster pool was ORIGINALLY fixed against (POOL_VERSION 1).
 * Retired on 2026-10-20 and kept only as history.
 *
 * It was frozen in anticipation of a deploy that never happened, so when the
 * owner ruled that hair is never a pack item, the freeze could be lifted
 * exactly once, the same way POOL_VERSION 2 lifted it for the Magawk removal.
 * The chain's free set is SHIPPED_FREE_ITEMS now, which is simply what the
 * game already gives away.
 *
 * It also still named `Brown_hair`, which stopped existing when hair colour
 * became its own axis, so it described nineteen items while claiming twenty.
 */

function inSet(set: Partial<Record<LayerCategory, "*" | string[]>>, category: LayerCategory, id: string): boolean {
  const free = set[category];
  return free === "*" || (Array.isArray(free) && free.includes(id));
}

/** True if this item needs no unlock. */
/**
 * The free set as the game will SHIP, which is what decides whether an item
 * can still drop from a pack.
 *
 * `TEST_UNLOCK_ALL_HATS` is a testing switch, not a decision. While it is on
 * every hat reads as free, and a draw that honoured that would refuse to hand
 * out a single hat — which is most of what a pack has to give, the Crown
 * included. So the draw asks this instead.
 */
const SHIPPED_FREE_ITEMS: Partial<Record<LayerCategory, "*" | string[]>> = {
  ...FREE_ITEMS,
  hat: ["hat_black"],
};

/** Free to everyone in the shipped game — see SHIPPED_FREE_ITEMS. */
export function isFreeInShippedGame(category: LayerCategory, id: string): boolean {
  return inSet(SHIPPED_FREE_ITEMS, category, id);
}

export function isFreeItem(category: LayerCategory, id: string): boolean {
  return inSet(FREE_ITEMS, category, id);
}

/** Hint shown on a locked wardrobe item — its explicit `unlockHint`, else the
 *  default booster hint. */
export function unlockHintFor(variant: LayerVariant): string {
  return variant.unlockHint ?? "🎁 Booster";
}

/** Items that can drop from a booster pack: not free, and not reserved to a
 *  quest/NPC. Shared by the client preview and (later) the on-chain VRF draw. */
export function getBoosterPool(): { category: LayerCategory; variant: LayerVariant }[] {
  return getAllLayerVariants().filter(
    ({ category, variant }) => !inSet(SHIPPED_FREE_ITEMS, category, variant.id) && !variant.unlockVia,
  );
}

/**
 * The free items as the CHAIN counts them: the SHIPPED_FREE_ITEMS set, in
 * LAYER_ORDER, including anything currently disabled.
 *
 * Two things make this different from `isFreeItem`, and both matter because
 * this feeds a global index that becomes a bit on chain.
 *
 * It uses SHIPPED_FREE_ITEMS, not FREE_ITEMS, because the latter also honours
 * TEST_UNLOCK_ALL_HATS, which is a testing switch rather than a decision. The
 * shipped set is what the game actually gives away: every skin, face and
 * hairstyle, the starter shirt and trousers, and one hat.
 *
 * It reads LAYER_VARIANTS directly rather than going through
 * getEnabledVariants, because disabling a variant must NOT renumber the items
 * after it. An index that has been written to chain names a cosmetic in
 * somebody's wallet; `enabled: false` hides an item, it does not free its slot.
 */
export function getChainFreeItems(): { category: LayerCategory; variant: LayerVariant }[] {
  return LAYER_ORDER.flatMap((category) =>
    LAYER_VARIANTS[category]
      .filter((variant) => inSet(SHIPPED_FREE_ITEMS, category, variant.id))
      .map((variant) => ({ category, variant })),
  );
}

/**
 * Every item reserved to a quest or an NPC, in LAYER_ORDER, disabled ones
 * included. Same reasoning as above: the order is an on-chain index.
 */
export function getQuestItems(): { category: LayerCategory; variant: LayerVariant }[] {
  return LAYER_ORDER.flatMap((category) =>
    LAYER_VARIANTS[category]
      .filter((variant) => !!variant.unlockVia)
      .map((variant) => ({ category, variant })),
  );
}

/** All (category, variant) pairs — used by BootScene to preload every
 *  spritesheet. Excludes disabled variants so their textures aren't even
 *  fetched. */
export function getAllLayerVariants(): { category: LayerCategory; variant: LayerVariant }[] {
  return LAYER_ORDER.flatMap((category) =>
    getEnabledVariants(category).map((variant) => ({ category, variant }))
  );
}

/**
 * Hair styles that were their own entry until colour became its own axis.
 * Each maps to the style that absorbed it plus the swatch that reproduces it,
 * which hairPalette.test checks is pixel-identical to the sheet that was
 * deleted — so a returning player sees the same hair, not a different one.
 *
 * Applied to loadouts arriving from the NETWORK too: another device may still
 * be on an older build and broadcast the old id.
 */
const RETIRED_HAIR: Record<string, { hair: string; hairColor: string }> = {
  Brown_hair:   { hair: "Black_hair",  hairColor: "brown" },
  Magawk_green: { hair: "Magawk_blue", hairColor: "green" },
  Magawk_red:   { hair: "Magawk_blue", hairColor: "red" },
};

/** Rewrites a retired hairstyle in place. Safe to call on any loadout. */
export function migrateHairColor(loadout: Loadout): Loadout {
  const moved = loadout.hair ? RETIRED_HAIR[loadout.hair] : undefined;
  if (moved) {
    loadout.hair = moved.hair;
    // An explicit colour already on the loadout wins: the player chose it on a
    // newer build, and the retired id is only telling us what it used to be.
    loadout.hairColor = loadout.hairColor ?? moved.hairColor;
  }
  return loadout;
}

const STORAGE_KEY = clusterKey("solcity:loadout");

export function saveLoadout(loadout: Loadout): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(loadout)); } catch {}
}

export function loadSavedLoadout(): Loadout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const loadout = JSON.parse(raw) as Loadout;
      // "Human" was renamed to "Light" (color-based skin names, no racial
      // labeling) — remap existing saves so returning players don't lose
      // their skin layer entirely.
      if ((loadout.skin as string) === "Human") loadout.skin = "Light";
      // Nya/Sleepy became expressions, not selectable faces — anyone who had
      // one saved as their static face falls back to Happy so they keep a face.
      if (loadout.eyesFace === "Nya" || loadout.eyesFace === "Sleepy") loadout.eyesFace = "Happy";
      migrateHairColor(loadout);
      return loadout;
    }
  } catch {}
  return { ...DEFAULT_LOADOUT };
}
