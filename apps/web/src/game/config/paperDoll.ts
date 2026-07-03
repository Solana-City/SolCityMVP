export type Direction = "down" | "left" | "right" | "up";

/**
 * Paper doll layer categories in render order (back to front).
 * Matches the spriter's numbered folders:
 *   6_Base → skin
 *   3_Face → eyesFace
 *   5_Legs → pants
 *   4_Clothes → tshirt
 *   1_Accessory → accessory
 *   2_Hair → hair
 *   0_Head → hat
 */
export const LAYER_ORDER = [
  "skin",
  "eyesFace",
  "pants",
  "tshirt",
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
  skin: [
    { id: "Human",  name: "Human",  textureKey: "pd-skin-Human",  file: "skin/Human.png" },
    { id: "Feyan",  name: "Feyan",  textureKey: "pd-skin-Feyan",  file: "skin/Feyan.png" },
    { id: "Laovai", name: "Laovai", textureKey: "pd-skin-Laovai", file: "skin/Laovai.png" },
    { id: "Pinki",  name: "Pinki",  textureKey: "pd-skin-Pinki",  file: "skin/Pinki.png" },
    { id: "Radio",  name: "Radio",  textureKey: "pd-skin-Radio",  file: "skin/Radio.png" },
  ],
  eyesFace: [
    { id: "Happy",       name: "Happy",       textureKey: "pd-eyesFace-Happy",       file: "eyesFace/Happy.png" },
    { id: "Terminator",  name: "Terminator",  textureKey: "pd-eyesFace-Terminator",  file: "eyesFace/Terminator.png" },
  ],
  pants: [
    { id: "Blue_pants",      name: "Blue Pants",      textureKey: "pd-pants-Blue_pants",      file: "pants/Blue_pants.png" },
    { id: "Red_short_pants", name: "Red Short Pants", textureKey: "pd-pants-Red_short_pants", file: "pants/Red_short_pants.png" },
  ],
  tshirt: [
    { id: "Blue_tshirt",  name: "Blue T-Shirt",  textureKey: "pd-tshirt-Blue_tshirt",  file: "tshirt/Blue_tshirt.png" },
    { id: "White_tshirt", name: "White T-Shirt", textureKey: "pd-tshirt-White_tshirt", file: "tshirt/White_tshirt.png" },
  ],
  accessory: [
    { id: "Golden_ring", name: "Golden Ring", textureKey: "pd-accessory-Golden_ring", file: "accessory/Golden_ring.png" },
  ],
  hair: [
    { id: "Avatar",     name: "Avatar",     textureKey: "pd-hair-Avatar",      file: "hair/Avatar.png" },
    { id: "Black_hair", name: "Black Hair", textureKey: "pd-hair-Black_hair",  file: "hair/Black_hair.png" },
    { id: "Brown_hair", name: "Brown Hair", textureKey: "pd-hair-Brown_hair",  file: "hair/Brown_hair.png" },
  ],
  hat: [
    { id: "Cap_Sol",    name: "Cap Sol",    textureKey: "pd-hat-Cap_Sol",    file: "hat/Cap_Sol.png" },
    { id: "Cap_blue",   name: "Cap Blue",   textureKey: "pd-hat-Cap_blue",   file: "hat/Cap_blue.png" },
    { id: "Cap_kid",    name: "Cap Kid",    textureKey: "pd-hat-Cap_kid",    file: "hat/Cap_kid.png" },
    { id: "Crown",      name: "Crown",      textureKey: "pd-hat-Crown",      file: "hat/Crown.png" },
    { id: "Cylinder",   name: "Cylinder",   textureKey: "pd-hat-Cylinder",   file: "hat/Cylinder.png" },
    { id: "Viking_hat", name: "Viking Hat", textureKey: "pd-hat-Viking_hat", file: "hat/Viking_hat.png" },
  ],
};

/** Default starter loadout. Hat, accessory start empty (optional). */
export const DEFAULT_LOADOUT: Loadout = {
  skin: "Human",
  eyesFace: "Happy",
  pants: "Blue_pants",
  tshirt: "Blue_tshirt",
  hair: "Black_hair",
};

export const CATEGORY_LABELS: Record<LayerCategory, string> = {
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

/** All (category, variant) pairs — used by BootScene to preload every spritesheet. */
export function getAllLayerVariants(): { category: LayerCategory; variant: LayerVariant }[] {
  return LAYER_ORDER.flatMap((category) =>
    LAYER_VARIANTS[category].map((variant) => ({ category, variant }))
  );
}

/**
 * Only the variants worn in the given loadout — used on mobile to skip loading
 * the ~22 full sheets and only load the 5-7 the player actually wears.
 */
export function getLoadoutVariants(loadout: Loadout): { category: LayerCategory; variant: LayerVariant }[] {
  return LAYER_ORDER.flatMap((category) => {
    const variantId = loadout[category];
    if (!variantId) return [];
    const variant = getVariant(category, variantId);
    return variant ? [{ category, variant }] : [];
  });
}

const STORAGE_KEY = "solcity:loadout";

export function saveLoadout(loadout: Loadout): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(loadout)); } catch {}
}

export function loadSavedLoadout(): Loadout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Loadout;
  } catch {}
  return { ...DEFAULT_LOADOUT };
}
