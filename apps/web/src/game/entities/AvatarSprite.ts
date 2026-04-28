import * as Phaser from "phaser";
import {
  Direction,
  DIRECTION_ROW,
  SPRITE_FRAME_WIDTH,
  SPRITE_FRAME_HEIGHT,
  SPRITE_COLS,
  OutfitLayer,
  getOutfit,
} from "../config/outfitRegistry";

/**
 * A composite avatar made of stacked sprite layers.
 *
 * Each layer is a separate Phaser.GameObjects.Sprite sharing the same
 * position and animation frame. Swapping an outfit means destroying
 * the old layer sprites and creating new ones from different textures.
 *
 * Usage:
 *   const avatar = new AvatarSprite(scene, x, y, "default");
 *   avatar.walk("left");
 *   avatar.idle();
 *   avatar.setOutfit("trader-cloak");
 */
export class AvatarSprite {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private layerSprites: Phaser.GameObjects.Sprite[] = [];
  private currentDirection: Direction = "down";
  private currentOutfitId: string;
  private isWalking = false;

  constructor(scene: Phaser.Scene, x: number, y: number, outfitId: string) {
    this.scene = scene;
    this.currentOutfitId = outfitId;
    this.container = scene.add.container(x, y);
    this.buildLayers(outfitId);
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

  /**
   * Replaces the current outfit with a new one.
   * Destroys old layer sprites and creates new ones.
   */
  setOutfit(outfitId: string): void {
    if (outfitId === this.currentOutfitId) return;
    this.destroyLayers();
    this.currentOutfitId = outfitId;
    this.buildLayers(outfitId);
  }

  /**
   * Plays the walk animation for the given direction.
   */
  walk(direction: Direction): void {
    this.currentDirection = direction;
    this.isWalking = true;
    const animKey = this.getAnimKey(direction, true);
    for (const sprite of this.layerSprites) {
      const key = `${sprite.texture.key}-${animKey}`;
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
    for (const sprite of this.layerSprites) {
      sprite.anims.stop();
      const row = DIRECTION_ROW[this.currentDirection];
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

  private buildLayers(outfitId: string): void {
    const outfit = getOutfit(outfitId);
    const sorted = [...outfit.layers].sort((a, b) => a.zIndex - b.zIndex);

    for (const layer of sorted) {
      if (!this.scene.textures.exists(layer.key)) continue;

      const sprite = this.scene.add.sprite(0, 0, layer.key);
      sprite.setOrigin(0.5, 0.75);
      this.container.add(sprite);
      this.layerSprites.push(sprite);

      this.registerAnimations(layer.key);
    }

    // Set initial idle frame
    const row = DIRECTION_ROW[this.currentDirection];
    for (const sprite of this.layerSprites) {
      sprite.setFrame(row * SPRITE_COLS);
    }
  }

  private destroyLayers(): void {
    for (const sprite of this.layerSprites) {
      this.container.remove(sprite);
      sprite.destroy();
    }
    this.layerSprites = [];
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

  private getAnimKey(direction: Direction, walking: boolean): string {
    return walking ? `walk-${direction}` : `idle-${direction}`;
  }

  /**
   * Registers a sprite sheet in Phaser's texture manager.
   * Call this from BootScene for each layer key.
   */
  static loadSpriteSheet(scene: Phaser.Scene, key: string, path: string): void {
    scene.load.spritesheet(key, path, {
      frameWidth: SPRITE_FRAME_WIDTH,
      frameHeight: SPRITE_FRAME_HEIGHT,
    });
  }
}
