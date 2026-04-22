import Phaser from "phaser";
import { TILE_SIZE } from "../config/constants";
import { SimpleSprite } from "./SimpleSprite";
import type { NPCDefinition } from "../config/npcRegistry";

const INTERACT_RANGE = TILE_SIZE * 1.8;

export class NPCSprite {
  private scene: Phaser.Scene;
  private avatar: SimpleSprite;
  private exclamation: Phaser.GameObjects.Container;
  private nameText: Phaser.GameObjects.Text;
  private promptText: Phaser.GameObjects.Text;
  private _isInRange = false;
  private originX: number;
  private originY: number;
  readonly def: NPCDefinition;

  constructor(scene: Phaser.Scene, def: NPCDefinition) {
    this.scene = scene;
    this.def = def;

    const x = def.tileX * TILE_SIZE + TILE_SIZE / 2;
    const y = def.tileY * TILE_SIZE + TILE_SIZE / 2;
    this.originX = x;
    this.originY = y;

    // NPCs use the same sprite sheet as players
    this.avatar = new SimpleSprite(scene, x, y, "avatar-chef");

    const container = this.avatar.getContainer();
    const colorHex = `#${def.color.toString(16).padStart(6, "0")}`;

    // Exclamation mark (visual distinction from players)
    const excBg = scene.add.circle(0, 0, 7, def.color);
    const excText = scene.add.text(0, 0, "!", {
      fontSize: "10px", fontFamily: "monospace",
      color: "#ffffff", fontStyle: "bold",
    }).setOrigin(0.5, 0.5);

    this.exclamation = scene.add.container(0, -62, [excBg, excText]);
    container.add(this.exclamation);

    scene.tweens.add({
      targets: this.exclamation,
      y: -66,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    // Name label in NPC color (players have white/gray names)
    this.nameText = scene.add.text(0, -52, def.name, {
      fontSize: "7px", fontFamily: "monospace",
      color: colorHex,
      align: "center",
    }).setOrigin(0.5, 1);
    container.add(this.nameText);

    // [E] prompt
    this.promptText = scene.add.text(0, -74, `[E] ${def.name}`, {
      fontSize: "8px", fontFamily: "monospace",
      color: "#14F195", align: "center",
      backgroundColor: "#0a0a1eDD",
      padding: { x: 6, y: 3 },
    }).setOrigin(0.5, 1).setVisible(false);
    container.add(this.promptText);

    container.setDepth(y);

    this.startIdleBehavior();
  }

  get isInRange(): boolean {
    return this._isInRange;
  }

  checkProximity(playerX: number, playerY: number): boolean {
    const container = this.avatar.getContainer();
    const dx = container.x - playerX;
    const dy = container.y - playerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const inRange = dist < INTERACT_RANGE;

    if (inRange !== this._isInRange) {
      this._isInRange = inRange;
      this.promptText.setVisible(inRange);
    }

    return inRange;
  }

  getPosition(): { x: number; y: number } {
    const c = this.avatar.getContainer();
    return { x: c.x, y: c.y };
  }

  getContainer(): Phaser.GameObjects.Container {
    return this.avatar.getContainer();
  }

  destroy(): void {
    this.avatar.destroy();
  }

  private startIdleBehavior(): void {
    const container = this.avatar.getContainer();

    // Random direction changes (NPC looks around)
    this.scene.time.addEvent({
      delay: 3000 + Math.random() * 3000,
      loop: true,
      callback: () => {
        const dirs = ["down", "left", "right", "up"] as const;
        const dir = dirs[Math.floor(Math.random() * dirs.length)];
        this.avatar.walk(dir);
        this.scene.time.delayedCall(250, () => {
          this.avatar.idle();
        });
      },
    });

    // Small shuffle around origin (very tight, max 6px from origin)
    this.scene.time.addEvent({
      delay: 5000 + Math.random() * 4000,
      loop: true,
      callback: () => {
        if (this._isInRange) return;

        // Kill any active movement tween on this container
        this.scene.tweens.killTweensOf(container);

        // 50% chance to return to origin, 50% small offset
        const goHome = Math.random() > 0.5;
        const targetX = goHome ? this.originX : this.originX + (Math.random() - 0.5) * 12;
        const targetY = goHome ? this.originY : this.originY + (Math.random() - 0.5) * 8;

        this.scene.tweens.add({
          targets: container,
          x: targetX,
          y: targetY,
          duration: 600,
          ease: "Sine.easeInOut",
        });
      },
    });
  }
}
