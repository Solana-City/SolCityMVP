export type Direction = "down" | "up" | "left" | "right";

export interface OutfitLayer {
  key: string;        // texture key in Phaser (e.g. "hair-spiky")
  zIndex: number;     // render order within the avatar stack
}

export interface OutfitDefinition {
  id: string;
  name: string;
  layers: OutfitLayer[];
  unlock?: {
    type: "swap-count" | "nft-hold" | "bounty-complete" | "default";
    threshold?: number;
    collection?: string;
  };
}

/**
 * Sprite sheet layout contract.
 *
 * Every layer PNG follows the same grid:
 *   - 4 columns: frame 0, 1, 2, 3 (walk cycle)
 *   - 4 rows: down, left, right, up
 *   - Frame size: 32x48 pixels (width x height per frame)
 *
 * File naming: {layer}-{variant}.png
 *   e.g. body-base.png, hair-spiky.png, outfit-trader-cloak.png
 *
 * All PNGs live in public/assets/sprites/
 */
export const SPRITE_FRAME_WIDTH = 32;
export const SPRITE_FRAME_HEIGHT = 48;
export const SPRITE_COLS = 4;
export const SPRITE_ROWS = 4;

export const DIRECTION_ROW: Record<Direction, number> = {
  down: 0,
  left: 1,
  right: 2,
  up: 3,
};

/**
 * Base layers that every avatar always has.
 * These are rendered bottom-to-top by zIndex.
 */
export const BASE_LAYERS: OutfitLayer[] = [
  { key: "body-base", zIndex: 0 },
  { key: "eyes-default", zIndex: 1 },
];

/**
 * All outfits registered in the game.
 * Add new outfits here. The BootScene loads all referenced layer keys.
 */
export const OUTFIT_REGISTRY: OutfitDefinition[] = [
  {
    id: "default",
    name: "Starter Tee",
    layers: [
      ...BASE_LAYERS,
      { key: "hair-short", zIndex: 2 },
      { key: "outfit-starter", zIndex: 3 },
    ],
    unlock: { type: "default" },
  },
  {
    id: "trader-cloak",
    name: "Trader's Cloak",
    layers: [
      ...BASE_LAYERS,
      { key: "hair-short", zIndex: 2 },
      { key: "outfit-trader-cloak", zIndex: 3 },
      { key: "acc-trading-badge", zIndex: 4 },
    ],
    unlock: { type: "swap-count", threshold: 10 },
  },
  {
    id: "builder-jacket",
    name: "Builder's Jacket",
    layers: [
      ...BASE_LAYERS,
      { key: "hair-spiky", zIndex: 2 },
      { key: "outfit-builder-jacket", zIndex: 3 },
    ],
    unlock: { type: "bounty-complete", threshold: 3 },
  },
  {
    id: "collector-frame",
    name: "Collector's Frame",
    layers: [
      ...BASE_LAYERS,
      { key: "hair-long", zIndex: 2 },
      { key: "outfit-collector", zIndex: 3 },
      { key: "acc-nft-frame", zIndex: 4 },
    ],
    unlock: { type: "nft-hold", threshold: 5 },
  },
];

/**
 * Returns the full set of unique texture keys that need to be loaded.
 * Used by BootScene to preload all sprite sheets.
 */
export function getAllLayerKeys(): string[] {
  const keys = new Set<string>();
  for (const outfit of OUTFIT_REGISTRY) {
    for (const layer of outfit.layers) {
      keys.add(layer.key);
    }
  }
  return Array.from(keys);
}

/**
 * Returns the outfit definition for a given ID, or the default outfit.
 */
export function getOutfit(id: string): OutfitDefinition {
  return (
    OUTFIT_REGISTRY.find((o) => o.id === id) ??
    OUTFIT_REGISTRY.find((o) => o.id === "default")!
  );
}
