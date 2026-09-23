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
  /** Nudge in world pixels, for art that does not land on a tile centre. */
  offsetX?: number;
  offsetY?: number;
  /**
   * Stamp a solid cell on the prop's own tile, so nobody walks through
   * the foot of the pole. It is written into the city's merged collision
   * volume, which the player, the NPCs and the pedestrians all test
   * against.
   */
  blocks?: boolean;
  /**
   * Draw by where the prop meets the ground, like a palm or a lamp post:
   * the player passes in front of it from the south and behind it from the
   * north. Without this the prop always draws above the player, which is
   * right for something they walk under (the fountain's jet) and wrong for
   * something they walk around (a flag pole).
   */
  ySort?: boolean;
}

export const ANIMATED_DECOR: AnimatedDecorDef[] = [
  {
    // The north plaza fountain. The water was taken OUT of the fountain
    // tileset art (SCTileFountain.png) so it could move: ONE frame carries
    // BOTH falls pouring off the S, drawn at 1:1 over the now-dry sculpture.
    //
    // Placement is not a guess. Comparing the tileset before and after the
    // water was removed gives the exact rectangle the painted water used to
    // occupy (world 1823,803 to 1968,905), and a frame's own art box is the
    // same 146 pixels wide, so the sheet lands back where the water was.
    key: "fountain-water",
    file: "assets/sprites/decor/fountain_water.png",
    frameWidth: 192,
    frameHeight: 183,
    frameCount: 6,
    frameRate: 8,
    tileX: 78,
    tileY: 39,
    offsetX: 10,
    scale: 1,
  },
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
    blocks: true,
    ySort: true,
  },
];

/** Call from BootScene.preload. */
export function preloadAnimatedDecor(scene: Phaser.Scene): void {
  for (const d of ANIMATED_DECOR) {
    scene.load.spritesheet(d.key, d.file, { frameWidth: d.frameWidth, frameHeight: d.frameHeight });
  }
}

/**
 * Spawns every item. `foregroundDepth` is the city's above-the-player depth,
 * used by everything that is not `ySort`. `collision` is the city's merged
 * collision volume, where a `blocks` prop stamps its foot.
 * Returns a cleanup for the scene's shutdown.
 */
export function createAnimatedDecor(
  scene: Phaser.Scene,
  foregroundDepth: number,
  collision?: Phaser.Tilemaps.TilemapLayer,
): () => void {
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
    const baseY = (d.tileY + 1) * TILE_SIZE;
    const sprite = scene.add
      .sprite(d.tileX * TILE_SIZE + TILE_SIZE / 2 + (d.offsetX ?? 0), baseY + (d.offsetY ?? 0), d.key)
      .setOrigin(0.5, 1)
      .setScale(d.scale)
      // A y-sorted prop follows the same rule as a y-sorted layer: depth is
      // the world Y where it meets the ground.
      .setDepth(d.ySort ? baseY : foregroundDepth);
    sprite.anims.play(`${d.key}-loop`);
    sprites.push(sprite);

    // Only ever written into the invisible merged volume — stamping a cell
    // into a layer that IS drawn would paint a stray tile on the map.
    if (d.blocks && collision && !collision.visible) {
      // Any index does: the volume is never drawn, only collided against.
      const cell = collision.putTileAt(1, d.tileX, d.tileY, false);
      if (cell) {
        cell.setCollision(true, true, true, true, false);
        collision.calculateFacesAt(d.tileX, d.tileY);
      }
    }
  }
  return () => { for (const s of sprites) s.destroy(); };
}
