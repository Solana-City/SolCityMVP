import * as Phaser from "phaser";
import { TILE_SIZE } from "../config/constants";
import { SimpleSprite, NPC_DIRECTION_ROW, type Direction } from "./SimpleSprite";
import type { NPCDefinition } from "../config/npcRegistry";
import { profileManager } from "../config/profileManager";
import { progressionBus } from "../progression/progressionBus";

const INTERACT_RANGE = TILE_SIZE * 1.8;

export class NPCSprite {
  private scene: Phaser.Scene;
  private avatar: SimpleSprite;
  private exclamation: Phaser.GameObjects.Container;
  private exclamationBg: Phaser.GameObjects.Arc;
  private exclamationText: Phaser.GameObjects.Text;
  private nameText: Phaser.GameObjects.Text;
  private promptText: Phaser.GameObjects.Text;
  private _isInRange = false;
  private originX: number;
  private originY: number;
  private unsubBus: (() => void) | null = null;
  private collisionLayers: Phaser.Tilemaps.TilemapLayer[] = [];
  readonly def: NPCDefinition;

  constructor(
    scene: Phaser.Scene,
    def: NPCDefinition,
    spawnX?: number,
    spawnY?: number,
    collisionLayers?: Phaser.Tilemaps.TilemapLayer[],
  ) {
    this.scene = scene;
    this.def = def;

    const x = spawnX ?? (def.tileX * TILE_SIZE + TILE_SIZE / 2);
    const y = spawnY ?? (def.tileY * TILE_SIZE + TILE_SIZE / 2);
    this.originX = x;
    this.originY = y;

    const desiredKey = def.spriteKey ?? "avatar-player";
    const spriteKey = scene.textures.exists(desiredKey) ? desiredKey : "avatar-player";

    this.collisionLayers = collisionLayers ?? [];
    this.avatar = new SimpleSprite(scene, x, y, spriteKey, NPC_DIRECTION_ROW);

    const container = this.getContainer();
    const colorHex = `#${def.color.toString(16).padStart(6, "0")}`;

    // Detect touch device for prompt wording
    const isTouch = scene.sys.game.device.input.touch;

    // ── Label stack (bottom → top) ──────────────────────────────────────────
    //
    //   y = -70 … -64  →  [! bubble] or [interact prompt]
    //   y = -46         →  [ Name ]
    //   y =   0         →  [head]
    //
    // The "!" and the prompt share the same slot (toggle visibility).

    // ── Name label ───────────────────────────────────────────────────────────
    this.nameText = scene.add.text(0, -38, def.name, {
      fontSize: "11px",
      fontFamily: '"Press Start 2P", monospace',
      color: colorHex,
      align: "center",
      resolution: 2,
      stroke: "#0a0a1e",
      strokeThickness: 3,
    }).setOrigin(0.5, 1);
    container.add(this.nameText);

    // ── Exclamation bubble ───────────────────────────────────────────────────
    this.exclamationBg = scene.add.circle(0, 0, 8, def.color);
    this.exclamationText = scene.add.text(0, 0, "!", {
      fontSize: "12px", fontFamily: "monospace",
      color: "#ffffff", fontStyle: "bold",
      resolution: 2,
    }).setOrigin(0.5, 0.5);

    this.exclamation = scene.add.container(0, -56, [this.exclamationBg, this.exclamationText]);
    container.add(this.exclamation);

    scene.tweens.add({
      targets: this.exclamation,
      y: -61,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    // Apply initial visited state
    this.applyVisitedState(profileManager.get().visitedNPCs.includes(def.id));

    const unsubVisit = progressionBus.on("npc-visited", (e) => {
      if (e.npcId === def.id && e.firstTime) this.applyVisitedState(true);
    });
    const unsubProfile = progressionBus.on("profile-updated", (e) => {
      this.applyVisitedState(e.profile.visitedNPCs.includes(def.id));
    });
    this.unsubBus = () => { unsubVisit(); unsubProfile(); };

    // ── Interaction prompt ───────────────────────────────────────────────────
    // Shown instead of the "!" when the player is in range.
    // Desktop: "[E] Talk"   Mobile/touch: "Tap to talk"
    const promptLabel = isTouch ? "Tap to talk" : "[E] Talk";
    this.promptText = scene.add.text(0, -56, promptLabel, {
      fontSize: "9px",
      fontFamily: '"Press Start 2P", monospace',
      color: "#14F195",
      align: "center",
      resolution: 2,
      stroke: "#000000",
      strokeThickness: 4,
    }).setOrigin(0.5, 0.5).setVisible(false);
    container.add(this.promptText);

    // ── Touch hit zone ───────────────────────────────────────────────────────
    // Transparent rectangle covering the NPC sprite + name area.
    // On touch devices, tapping the NPC while in range triggers interaction.
    if (isTouch) {
      const hitZone = scene.add.rectangle(0, -24, 48, 72, 0x000000, 0);
      hitZone.setInteractive({ useHandCursor: false });
      hitZone.on("pointerdown", () => {
        if (this._isInRange) {
          // Emit touch:interact so CityScene applies its interactionBlocked guard
          scene.game.events.emit("touch:interact");
        }
      });
      container.add(hitZone);
    }

    container.setDepth(y);
    // NPCs are stationary — no wandering so all players see the same world.
    // They still animate (face towards player on proximity).
    this.avatar.idle();
  }

  get isInRange(): boolean {
    return this._isInRange;
  }

  checkProximity(playerX: number, playerY: number): boolean {
    const container = this.getContainer();
    const dx = container.x - playerX;
    const dy = container.y - playerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const inRange = dist < INTERACT_RANGE;

    if (inRange !== this._isInRange) {
      this._isInRange = inRange;
      this.promptText.setVisible(inRange);
      this.exclamation.setVisible(!inRange);
    }

    return inRange;
  }

  getPosition(): { x: number; y: number } {
    const c = this.getContainer();
    return { x: c.x, y: c.y };
  }

  getContainer(): Phaser.GameObjects.Container {
    return this.avatar.getContainer();
  }

  destroy(): void {
    if (this.unsubBus) { this.unsubBus(); this.unsubBus = null; }
    this.avatar.destroy();
  }

  private startIdleBehavior(): void {
    const WANDER_RADIUS = 20;
    const WALK_SPEED = 18;
    const dirs: Direction[] = ["up", "down", "left", "right"];

    const tick = () => {
      if (this._isInRange) {
        this.scene.time.delayedCall(600, tick);
        return;
      }

      const dir = dirs[Math.floor(Math.random() * dirs.length)];

      if (Math.random() < 0.65) {
        this.avatar.face(dir);
        this.scene.time.delayedCall(1800 + Math.random() * 2400, tick);
        return;
      }

      const container = this.getContainer();
      const step = (0.3 + Math.random() * 0.4) * WANDER_RADIUS;
      let targetX = container.x;
      let targetY = container.y;
      if (dir === "left")  targetX -= step;
      if (dir === "right") targetX += step;
      if (dir === "up")    targetY -= step;
      if (dir === "down")  targetY += step;

      const clampedX = Math.max(this.originX - WANDER_RADIUS, Math.min(this.originX + WANDER_RADIUS, targetX));
      const clampedY = Math.max(this.originY - WANDER_RADIUS, Math.min(this.originY + WANDER_RADIUS, targetY));
      const distance  = Math.abs(clampedX - container.x) + Math.abs(clampedY - container.y);

      if (distance < 3 || this.isTileBlocked(clampedX, clampedY)) {
        this.avatar.face(dir);
        this.scene.time.delayedCall(1200 + Math.random() * 1600, tick);
        return;
      }

      this.avatar.walk(dir);
      this.scene.tweens.killTweensOf(container);
      this.scene.tweens.add({
        targets: container,
        x: clampedX, y: clampedY,
        duration: (distance / WALK_SPEED) * 1000,
        ease: "Linear",
        onUpdate: () => container.setDepth(container.y),
        onComplete: () => {
          this.avatar.idle();
          this.scene.time.delayedCall(1800 + Math.random() * 2400, tick);
        },
      });
    };

    this.scene.time.delayedCall(Math.random() * 2000, tick);
  }

  private isTileBlocked(x: number, y: number): boolean {
    for (const layer of this.collisionLayers) {
      const tile = layer.getTileAtWorldXY(x, y);
      if (tile && tile.collides) return true;
    }
    return false;
  }

  private applyVisitedState(visited: boolean): void {
    if (visited) {
      this.exclamationBg.setFillStyle(0x555577);
      this.exclamationText.setText("·");
      this.exclamationText.setColor("#aaaacc");
    } else {
      this.exclamationBg.setFillStyle(this.def.color);
      this.exclamationText.setText("!");
      this.exclamationText.setColor("#ffffff");
    }
  }
}
