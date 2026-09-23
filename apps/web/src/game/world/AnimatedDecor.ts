/**
 * Animated street decoration: one Phaser sprite per item, anchored to a tile.
 *
 * Tiled cannot do this for us. Its animated-tile data is not played by Phaser's
 * tilemap renderer, and painting a flag into the map would also mean re-exporting
 * city.json (the map artist's file) for every prop. A sprite costs one texture
 * and one animation, is placed from a line of config here, and moves with a
 * number instead of a map export.
 *
 * Contract per item: a single row of `frameCount` frames, all the same size,
 * with the character's/prop's feet at the BOTTOM of the frame (origin 0.5, 1),
 * so `tileY` is the row the prop stands on. Pink chroma (215,123,186) must be
 * cleared to alpha in the file, like every other sprite sheet in the repo.
 */
import * as Phaser from "phaser";
import { TILE_SIZE } from "../config/constants";

export interface AnimatedDecorDef {
  key: string;
  /** Path under /public. */
  file: string;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  /** Frames per second of the loop. */
  frameRate: number;
  /** Tile the prop stands on: its bottom edge sits on the bottom of this tile. */
  tileX: number;
  tileY: number;
  /** Source pixels to world pixels. 0.5 matches the character sheets. */
  scale: number;
}

export const ANIMATED_DECOR: AnimatedDecorDef[] = [
  {
    // Superteam Turkey flag at the TOP-RIGHT corner of the Remedi building
    // (BuildRemedi, cols 103-113 / rows 12-20): the pole stands just right of
    // its last column and the cloth flies out over the street, well above the
    // Hair Specialist at the door.
    key: "flag-st-turkey",
    file: "assets/sprites/decor/flag_st_turkey.png",
    frameWidth: 78,
    frameHeight: 183,
    frameCount: 4,
    frameRate: 6,
    tileX: 114,
    tileY: 16,
    scale: 0.5,
  },
];

/** Call from BootScene.preload. */
export function preloadAnimatedDecor(scene: Phaser.Scene): void {
  for (const d of ANIMATED_DECOR) {
    scene.load.spritesheet(d.key, d.file, { frameWidth: d.frameWidth, frameHeight: d.frameHeight });
  }
}

/**
 * Spawns every item. `depth` is the city's foreground depth: cloth flies above
 * head height, so a flag draws over the player like the other flag poles do.
 * Returns a cleanup for the scene's shutdown.
 */
export function createAnimatedDecor(scene: Phaser.Scene, depth: number): () => void {
  const sprites: Phaser.GameObjects.Sprite[] = [];
  for (const d of ANIMATED_DECOR) {
    if (!scene.textures.exists(d.key)) {
      console.warn(`[AnimatedDecor] texture "${d.key}" not loaded`);
      continue;
    }
    if (!scene.anims.exists(`${d.key}-loop`)) {
      scene.anims.create({
        key: `${d.key}-loop`,
        frames: scene.anims.generateFrameNumbers(d.key, { start: 0, end: d.frameCount - 1 }),
        frameRate: d.frameRate,
        repeat: -1,
      });
    }
    const sprite = scene.add
      .sprite(d.tileX * TILE_SIZE + TILE_SIZE / 2, (d.tileY + 1) * TILE_SIZE, d.key)
      .setOrigin(0.5, 1)
      .setScale(d.scale)
      .setDepth(depth);
    sprite.anims.play(`${d.key}-loop`);
    sprites.push(sprite);
  }
  return () => { for (const s of sprites) s.destroy(); };
}
