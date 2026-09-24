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
    // 12, not 10: the falls sat a couple of pixels left of the S.
    offsetX: 12,
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
  // ── The city's three painted flags, now waving ───────────────────
  //
  // These replace tile layers rather than adding to the map, so each one is
  // measured rather than placed by eye: the art box of the painted flag in
  // city.json and the art box of frame 0 line up pixel for pixel, which also
  // settles the scale (1 for all three: the sheets are drawn at world
  // resolution, unlike the Turkey sheet, which is a 2x draw of the same pole).
  // CityScene drops the layers listed in REPLACED_MAP_LAYERS below.
  {
    // Solana flag on the south beach path (DecorSolanaFlag, cols 33-34 /
    // rows 93-96). Painted art sat at world 797,2232 to 836,2327 and the
    // sheet's own art box is the same 40x96, so tile 33 plus half a tile puts
    // it back where it was.
    key: "flag-solana",
    file: "assets/sprites/decor/flag_solana.png",
    frameWidth: 48,
    frameHeight: 96,
    frameCount: 6,
    frameRate: 6,
    tileX: 33,
    tileY: 96,
    offsetX: 12,
    scale: 1,
    // The pole foot was the one solid cell on the old layer (33,96).
    blocks: true,
    ySort: true,
  },
  {
    // Superteam Brasil flag by the lighthouse walk (DecorSTBrFlag, cols 54-55
    // / rows 86-89). Painted art at world 1299,2064 to 1338,2159.
    key: "flag-st-brasil",
    file: "assets/sprites/decor/flag_st_brasil.png",
    frameWidth: 48,
    frameHeight: 96,
    frameCount: 8,
    frameRate: 6,
    tileX: 54,
    tileY: 89,
    offsetX: 12,
    scale: 1,
    // Matches the old layer's one solid cell (54,89).
    blocks: true,
    ySort: true,
  },
  {
    // MonkeDAO flag on the plaza between the two MonkeDAO buildings
    // (DecorMonkeDaoFlag, cols 51-54 / rows 24-30). The redrawn pole is
    // taller than the painted one (183 against 141) but its foot is the same
    // 25px wide, so the two are aligned by the FOOT: painted foot at world
    // 1248-1272, bottom row 719.
    key: "flag-monkedao",
    file: "assets/sprites/decor/flag_monkedao.png",
    frameWidth: 78,
    frameHeight: 183,
    frameCount: 4,
    frameRate: 6,
    tileX: 53,
    tileY: 29,
    offsetX: 3,
    scale: 1,
    // No `blocks`: nothing on the old layer collided, and a pole that starts
    // blocking the plaza today would be a change nobody asked for.
    //
    // No `ySort` either, unlike the other three flags. This pole stands
    // against the MonkeDAO building, whose own y-sort depth comes from its
    // base at row 32 (792) and would beat the pole's foot at row 29 (720):
    // the facade would paint over the cloth. Above-head is also exactly how
    // the painted layer behaved, so nothing about the plaza changes except
    // that the flag now moves.
  },
];

/**
 * Tile layers whose art is now drawn by a sprite above. CityScene drops them
 * when it builds the map, so the static cloth never shows under the animated
 * one, and their collision does not reach the merged volume either: each
 * sprite stamps its own foot with `blocks` instead.
 */
export const REPLACED_MAP_LAYERS: ReadonlySet<string> = new Set([
  "DecorSolanaFlag", "DecorSTBrFlag", "DecorMonkeDaoFlag",
]);

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
