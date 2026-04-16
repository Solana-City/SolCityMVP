import Phaser from "phaser";

export type Direction = "down" | "left" | "right" | "up";

// Sprite sheet row order: down=0, right=1, up=2, left=3
// This matches the standard output from most sprite generators
const DIRECTION_ROW: Record<Direction, number> = {
  down: 0,
  right: 1,
  up: 2,
  left: 3,
};

/**
 * A simple single-sprite avatar using a complete sprite sheet.
 *
 * Sprite sheet contract:
 *   - 4 columns (walk cycle frames)
 *   - 4 rows (down, left, right, up)
 *   - Consistent frame size (e.g. 48x48)
 *
 * This replaces the layered AvatarSprite system for use with
 * pre-made character sprite sheets.
 */
export class SimpleSprite {
  private scene: Phaser.Scene;
  private sprite: Phaser.GameObjects.Sprite;
  private container: Phaser.GameObjects.Container;
  private currentDirection: Direction = "down";
  private isWalking = false;
  private textureKey: string;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    textureKey: string
  ) {
    this.scene = scene;
    this.textureKey = textureKey;

    this.sprite = scene.add.sprite(0, -12, textureKey);
    this.sprite.setOrigin(0.5, 1.0);

    this.container = scene.add.container(x, y, [this.sprite]);

    this.registerAnimations();
    this.sprite.setFrame(0);
  }

  get x(): number { return this.container.x; }
  set x(v: number) { this.container.x = v; }

  get y(): number { return this.container.y; }
  set y(v: number) { this.container.y = v; }

  getContainer(): Phaser.GameObjects.Container {
    return this.container;
  }

  walk(direction: Direction): void {
    this.currentDirection = direction;
    if (!this.isWalking || this.sprite.anims.getName() !== `${this.textureKey}-walk-${direction}`) {
      this.isWalking = true;
      this.sprite.anims.play(`${this.textureKey}-walk-${direction}`, true);
    }
  }

  idle(): void {
    if (!this.isWalking) return;
    this.isWalking = false;
    this.sprite.anims.stop();
    const row = DIRECTION_ROW[this.currentDirection];
    this.sprite.setFrame(row * 4);
  }

  updateDepth(): void {
    this.container.depth = this.container.y;
  }

  setTexture(textureKey: string): void {
    if (textureKey === this.textureKey) return;
    this.textureKey = textureKey;
    this.sprite.setTexture(textureKey);
    this.registerAnimations();
    this.idle();
  }

  destroy(): void {
    this.container.destroy();
  }

  private registerAnimations(): void {
    const directions: Direction[] = ["down", "left", "right", "up"];
    const cols = 4;

    for (const dir of directions) {
      const row = DIRECTION_ROW[dir];
      const key = `${this.textureKey}-walk-${dir}`;

      if (!this.scene.anims.exists(key)) {
        this.scene.anims.create({
          key,
          frames: this.scene.anims.generateFrameNumbers(this.textureKey, {
            start: row * cols,
            end: row * cols + cols - 1,
          }),
          frameRate: 8,
          repeat: -1,
        });
      }
    }
  }

  /**
   * Preloads a sprite sheet in BootScene.
   * Call with the frame dimensions of the individual character frame.
   */
  static load(
    scene: Phaser.Scene,
    key: string,
    path: string,
    frameWidth: number,
    frameHeight: number
  ): void {
    scene.load.spritesheet(key, path, { frameWidth, frameHeight });
  }
}
