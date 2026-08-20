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
   * Reserves this item to a quest reward so it's excluded from the random
   * booster pool. Undefined + not in FREE_ITEMS ⇒ it drops from booster packs.
   * (NPCs no longer grant outfits — unlocks come only from quests + boosters.)
   */
  unlockVia?: "quest";
  /** Overrides the default locked-item hint shown in the wardrobe. */
  unlockHint?: string;
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
export const DIRECTION_ROW: Record<Direction, number> = {
  down: 0,
  up: 1,
  right: 2,
  left: 3,
};

/** A player's full layer selection. Missing/undefined = no layer rendered for that slot. */
export type Loadout = Partial<Record<LayerCategory, string>>;

export const LAYER_VARIANTS: Record<LayerCategory, LayerVariant[]> = {
  back: [
    { id: "Jetpack",         name: "Jetpack",        textureKey: "pd-back-Jetpack",         file: "back/Jetpack.png", unlockVia: "quest", unlockHint: "Quest reward" },
    { id: "backpack_brown",  name: "Brown Backpack", textureKey: "pd-back-backpack_brown",  file: "back/backpack_brown.png" },
    { id: "backpack_red",    name: "Red Backpack",   textureKey: "pd-back-backpack_red",    file: "back/backpack_red.png" },
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
    { id: "Terminator",   name: "Terminator",   textureKey: "pd-eyesFace-Terminator",   file: "eyesFace/Terminator.png" },
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
  ],
  tshirt: [
    { id: "Blue_tshirt",  name: "Blue T-Shirt",  textureKey: "pd-tshirt-Blue_tshirt",  file: "tshirt/Blue_tshirt.png" },
    { id: "White_tshirt", name: "White T-Shirt", textureKey: "pd-tshirt-White_tshirt", file: "tshirt/White_tshirt.png" },
  ],
  accessory: [
    { id: "Golden_ring", name: "Golden Ring", textureKey: "pd-accessory-Golden_ring", file: "accessory/Golden_ring.png" },
    { id: "Pirate",      name: "Pirate",      textureKey: "pd-accessory-Pirate",      file: "accessory/Pirate.png" },
  ],
  hair: [
    { id: "Avatar",      name: "Avatar",      textureKey: "pd-hair-Avatar",      file: "hair/Avatar.png" },
    { id: "Black_hair",  name: "Black Hair",  textureKey: "pd-hair-Black_hair",  file: "hair/Black_hair.png" },
    { id: "Brown_hair",  name: "Brown Hair",  textureKey: "pd-hair-Brown_hair",  file: "hair/Brown_hair.png" },
    // Re-enabled: AvatarSprite.ts's hair masking now clips per column against
    // the hat's own silhouette (not just a single row-wide cutoff), which
    // handles hair wider than the hat too, not only taller.
    { id: "Afro",        name: "Afro",        textureKey: "pd-hair-Afro",        file: "hair/Afro.png" },
    { id: "Anime",       name: "Anime",       textureKey: "pd-hair-Anime",       file: "hair/Anime.png" },
    { id: "Magawk_blue", name: "Magawk Blue", textureKey: "pd-hair-Magawk_blue", file: "hair/Magawk_blue.png" },
    { id: "Magawk_green",name: "Magawk Green",textureKey: "pd-hair-Magawk_green",file: "hair/Magawk_green.png" },
    { id: "Magawk_red",  name: "Magawk Red",  textureKey: "pd-hair-Magawk_red",  file: "hair/Magawk_red.png" },
  ],
  hat: [
    { id: "Cap_Sol",    name: "Cap Sol",    textureKey: "pd-hat-Cap_Sol",    file: "hat/Cap_Sol.png" },
    { id: "Cap_blue",   name: "Cap Blue",   textureKey: "pd-hat-Cap_blue",   file: "hat/Cap_blue.png" },
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
}

export const EXPRESSIONS: Expression[] = [
  { id: "nya",   name: "Nya",   uiSymbol: "😸", textureKey: "pd-expr-Nya",   file: "expressions/Nya.png" },
  { id: "sleep", name: "Sleep", uiSymbol: "😴", textureKey: "pd-expr-Sleep", file: "expressions/Sleep.png" },
  { id: "angry", name: "Angry", uiSymbol: "😠", textureKey: "pd-expr-Angry", file: "expressions/Angry.png" },
  { id: "cry",   name: "Cry",   uiSymbol: "😢", textureKey: "pd-expr-Cry",   file: "expressions/Cry.png" },
  { id: "lol",   name: "LOL",   uiSymbol: "😂", textureKey: "pd-expr-LOL",   file: "expressions/LOL.png" },
  { id: "love",  name: "Love",  uiSymbol: "😍", textureKey: "pd-expr-Love",  file: "expressions/Love.png" },
  { id: "shy",   name: "Shy",   uiSymbol: "😳", textureKey: "pd-expr-Shy",   file: "expressions/Shy.png" },
  { id: "stars", name: "Stars", uiSymbol: "🤩", textureKey: "pd-expr-Stars", file: "expressions/Stars.png" },
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
// Only a small starter set is free; everything else is locked and earned via a
// quest, an NPC, or a random booster pack. Identity layers (skin, eyesFace)
// stay fully free — they aren't cosmetics to collect.
const FREE_ITEMS: Partial<Record<LayerCategory, "*" | string[]>> = {
  skin: "*",
  eyesFace: "*",
  hair: ["Black_hair", "Brown_hair"],
  tshirt: ["Blue_tshirt", "White_tshirt"],
  pants: ["Blue_pants", "Grey_pants"],
  // hat, accessory, back: nothing free — all via quest / NPC / booster.
};

/** True if this item needs no unlock (starter set / identity layer). */
export function isFreeItem(category: LayerCategory, id: string): boolean {
  const free = FREE_ITEMS[category];
  return free === "*" || (Array.isArray(free) && free.includes(id));
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
    ({ category, variant }) => !isFreeItem(category, variant.id) && !variant.unlockVia,
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

const STORAGE_KEY = "solcity:loadout";

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
      return loadout;
    }
  } catch {}
  return { ...DEFAULT_LOADOUT };
}
