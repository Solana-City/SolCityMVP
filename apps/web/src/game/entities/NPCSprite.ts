import Phaser from "phaser";
import { TILE_SIZE } from "../config/constants";
import type { NPCDefinition } from "../config/npcRegistry";

const INTERACT_RANGE = TILE_SIZE * 1.8;

export class NPCSprite {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private body: Phaser.GameObjects.Rectangle;
  private head: Phaser.GameObjects.Rectangle;
  private exclamation: Phaser.GameObjects.Container;
  private nameText: Phaser.GameObjects.Text;
  private promptText: Phaser.GameObjects.Text;
  private _isInRange = false;
  readonly def: NPCDefinition;

  constructor(scene: Phaser.Scene, def: NPCDefinition) {
    this.scene = scene;
    this.def = def;

    const x = def.tileX * TILE_SIZE + TILE_SIZE / 2;
    const y = def.tileY * TILE_SIZE + TILE_SIZE / 2;

    // NPC body (placeholder, same as avatar style)
    this.body = scene.add.rectangle(0, 2, TILE_SIZE * 0.5, TILE_SIZE * 0.55, def.color);
    this.head = scene.add.rectangle(0, -10, TILE_SIZE * 0.35, TILE_SIZE * 0.35, def.color);
    this.head.setStrokeStyle(1, 0xffffff, 0.15);

    // Glow circle
    const glow = scene.add.circle(0, 0, TILE_SIZE * 0.7, def.color, 0.08);

    // Exclamation mark
    const excBg = scene.add.circle(0, 0, 7, def.color);
    const excText = scene.add.text(0, 0, "!", {
      fontSize: "10px", fontFamily: "monospace",
      color: "#ffffff", fontStyle: "bold",
    }).setOrigin(0.5, 0.5);

    this.exclamation = scene.add.container(0, -24, [excBg, excText]);

    // Bounce animation on exclamation
    scene.tweens.add({
      targets: this.exclamation,
      y: -28,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    // Name label
    this.nameText = scene.add.text(0, 16, def.name, {
      fontSize: "7px", fontFamily: "monospace",
      color: `#${def.color.toString(16).padStart(6, "0")}`,
      align: "center",
    }).setOrigin(0.5, 0);

    // "[E] Talk" prompt (hidden by default)
    this.promptText = scene.add.text(0, -38, `[E] ${def.name}`, {
      fontSize: "8px", fontFamily: "monospace",
      color: "#14F195", align: "center",
      backgroundColor: "#0a0a1eDD",
      padding: { x: 6, y: 3 },
    }).setOrigin(0.5, 1).setVisible(false);

    this.container = scene.add.container(x, y, [
      glow, this.body, this.head, this.exclamation,
      this.nameText, this.promptText,
    ]);

    this.container.setDepth(y);
  }

  get isInRange(): boolean {
    return this._isInRange;
  }

  /**
   * Call every frame. Checks distance to player and shows/hides prompt.
   * Returns true if player is within interaction range.
   */
  checkProximity(playerX: number, playerY: number): boolean {
    const dx = this.container.x - playerX;
    const dy = this.container.y - playerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const inRange = dist < INTERACT_RANGE;

    if (inRange !== this._isInRange) {
      this._isInRange = inRange;
      this.promptText.setVisible(inRange);
    }

    return inRange;
  }

  getPosition(): { x: number; y: number } {
    return { x: this.container.x, y: this.container.y };
  }

  destroy(): void {
    this.container.destroy();
  }
}
