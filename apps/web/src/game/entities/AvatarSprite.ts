import * as Phaser from "phaser";
import {
  Direction,
  DIRECTION_ROW,
  SPRITE_FRAME_WIDTH,
  SPRITE_FRAME_HEIGHT,
  SPRITE_COLS,
  LAYER_ORDER,
  LayerCategory,
  Loadout,
  DEFAULT_LOADOUT,
  getVariant,
} from "../config/paperDoll";

/**
 * A paper doll avatar made of stacked sprite layers (skin, eyes/face, hair,
 * t-shirt, pants, backpack, hat, ...). Each layer is its own
 * Phaser.GameObjects.Sprite sharing position and animation frame.
 *
 * Usage:
 *   const avatar = new AvatarSprite(scene, x, y);
 *   avatar.walk("left");
 *   avatar.idle();
 *   avatar.setLayer("hat", "cap");
 */
export class AvatarSprite {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private layerSprites: Map<LayerCategory, Phaser.GameObjects.Sprite> = new Map();
  private currentDirection: Direction = "down";
  private currentLoadout: Loadout;
  private isWalking = false;

  constructor(scene: Phaser.Scene, x: number, y: number, loadout: Loadout = DEFAULT_LOADOUT) {
    this.scene = scene;
    this.currentLoadout = { ...loadout };
    this.container = scene.add.container(x, y);
    this.buildLayers();
  }

  get x(): number { return this.container.x; }
  set x(v: number) { this.container.x = v; }

  get y(): number { return this.container.y; }
  set y(v: number) { this.container.y = v; }

  get depth(): number { return this.container.depth; }
  set depth(v: number) { this.container.depth = v; }

  getContainer(): Phaser.GameObjects.Container {
    return this.container;
  }

  /** Replaces a single layer category (e.g. swap hats). Pass undefined to remove the layer. */
  setLayer(category: LayerCategory, variantId: string | undefined): void {
    if (this.currentLoadout[category] === variantId) return;
    this.currentLoadout = { ...this.currentLoadout, [category]: variantId };
    this.destroyLayers();
    this.buildLayers();
  }

  /** Replaces the entire loadout at once. */
  setLoadout(loadout: Loadout): void {
    this.currentLoadout = { ...loadout };
    this.destroyLayers();
    this.buildLayers();
  }

  getLoadout(): Loadout {
    return { ...this.currentLoadout };
  }

  /**
   * Plays the walk animation for the given direction.
   */
  walk(direction: Direction): void {
    this.currentDirection = direction;
    this.isWalking = true;
    for (const sprite of this.layerSprites.values()) {
      const key = `${sprite.texture.key}-walk-${direction}`;
      if (sprite.anims.animationManager.exists(key)) {
        sprite.anims.play(key, true);
      }
    }
  }

  /**
   * Stops walking and shows the idle frame for the current direction.
   */
  idle(): void {
    if (!this.isWalking) return;
    this.isWalking = false;
    const row = DIRECTION_ROW[this.currentDirection];
    for (const sprite of this.layerSprites.values()) {
      sprite.anims.stop();
      sprite.setFrame(row * SPRITE_COLS);
    }
  }

  /**
   * Sets the depth based on the Y position (for depth sorting).
   */
  updateDepth(): void {
    this.container.depth = this.container.y;
  }

  destroy(): void {
    this.destroyLayers();
    this.container.destroy();
  }

  // ── Internal ──────────────────────────────────────────

  private buildLayers(): void {
    const FOOT_Y_LOCAL = -2;

    for (const category of LAYER_ORDER) {
      const variant = getVariant(category, this.currentLoadout[category]);
      if (!variant || !this.scene.textures.exists(variant.textureKey)) continue;

      const sprite = this.scene.add.sprite(0, FOOT_Y_LOCAL, variant.textureKey);
      sprite.setOrigin(0.5, 1.0);

      // Native 64x64 sheets render at 0.5x world scale (2x camera zoom cancels to 1:1),
      // matching SimpleSprite's pixel-perfect convention.
      const frame = this.scene.textures.get(variant.textureKey).get(0);
      if ((frame.height || SPRITE_FRAME_HEIGHT) >= 56) {
        sprite.setScale(0.5);
      }

      this.container.add(sprite);
      this.layerSprites.set(category, sprite);
      this.registerAnimations(variant.textureKey);
    }

    // Set initial idle frame
    const row = DIRECTION_ROW[this.currentDirection];
    for (const sprite of this.layerSprites.values()) {
      sprite.setFrame(row * SPRITE_COLS);
    }
  }

  private destroyLayers(): void {
    for (const sprite of this.layerSprites.values()) {
      this.container.remove(sprite);
      sprite.destroy();
    }
    this.layerSprites.clear();
  }

  private registerAnimations(textureKey: string): void {
    const directions: Direction[] = ["down", "left", "right", "up"];

    for (const dir of directions) {
      const row = DIRECTION_ROW[dir];
      const walkKey = `${textureKey}-walk-${dir}`;

      if (!this.scene.anims.exists(walkKey)) {
        this.scene.anims.create({
          key: walkKey,
          frames: this.scene.anims.generateFrameNumbers(textureKey, {
            start: row * SPRITE_COLS,
            end: row * SPRITE_COLS + SPRITE_COLS - 1,
          }),
          frameRate: 8,
          repeat: -1,
        });
      }
    }
  }

  /**
   * Registers a paper doll layer sprite sheet in Phaser's texture manager.
   * Call this from BootScene for each layer variant.
   */
  static loadSpriteSheet(scene: Phaser.Scene, key: string, path: string): void {
    scene.load.spritesheet(key, path, {
      frameWidth: SPRITE_FRAME_WIDTH,
      frameHeight: SPRITE_FRAME_HEIGHT,
    });
  }
}
