import * as Phaser from "phaser";
import { TILE_SIZE } from "../config/constants";
import { SimpleSprite, type Direction } from "./SimpleSprite";
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
  readonly def: NPCDefinition;

  constructor(scene: Phaser.Scene, def: NPCDefinition, spawnX?: number, spawnY?: number) {
    this.scene = scene;
    this.def = def;

    const x = spawnX ?? (def.tileX * TILE_SIZE + TILE_SIZE / 2);
    const y = spawnY ?? (def.tileY * TILE_SIZE + TILE_SIZE / 2);
    this.originX = x;
    this.originY = y;

    const desiredKey = def.spriteKey ?? "avatar-player";
    const spriteKey = scene.textures.exists(desiredKey) ? desiredKey : "avatar-player";

    this.avatar = new SimpleSprite(scene, x, y, spriteKey);

    const container = this.getContainer();
    const colorHex = `#${def.color.toString(16).padStart(6, "0")}`;

    // Label stack above head. Tight layout optimized for 32-world-px-tall
    // characters (64×64 native sheets rendered at 0.5× sprite scale).
    //
    // Stack from top to bottom:
    //   [! marker]  — smallest, softest, just a visual breadcrumb
    //   [ Name   ]  — primary identifier, crisp and compact
    //   [head]
    //
    // When the player enters interaction range, the "!" is replaced by
    // the "[E] Name" prompt in the same slot so they never stack.

    // Status marker — small dot with "!". Tight (radius 6 vs 9 before)
    // so it recedes visually and the name takes primary focus.
    this.exclamationBg = scene.add.circle(0, 0, 6, def.color);
    this.exclamationText = scene.add.text(0, 0, "!", {
      fontSize: "10px", fontFamily: "monospace",
      color: "#ffffff", fontStyle: "bold",
      resolution: 2,
    }).setOrigin(0.5, 0.5);

    this.exclamation = scene.add.container(0, -52, [this.exclamationBg, this.exclamationText]);
    container.add(this.exclamation);

    scene.tweens.add({
      targets: this.exclamation,
      y: -55,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    // Apply initial visited state (for profiles that already know this NPC).
    this.applyVisitedState(profileManager.get().visitedNPCs.includes(def.id));

    // Live updates: react to first visits AND to any profile mutation
    // (e.g. resetProgress wipes visitedNPCs; the marker should flip back).
    const unsubVisit = progressionBus.on("npc-visited", (e) => {
      if (e.npcId === def.id && e.firstTime) {
        this.applyVisitedState(true);
      }
    });
    const unsubProfile = progressionBus.on("profile-updated", (e) => {
      this.applyVisitedState(e.profile.visitedNPCs.includes(def.id));
    });
    this.unsubBus = () => {
      unsubVisit();
      unsubProfile();
    };

    // Name label — compact, right above the head (sprite top ≈ -34 local).
    this.nameText = scene.add.text(0, -38, def.name, {
      fontSize: "10px", fontFamily: "monospace",
      color: colorHex,
      align: "center",
      resolution: 2,
      stroke: "#0a0a1e",
      strokeThickness: 2,
    }).setOrigin(0.5, 1);
    container.add(this.nameText);

    // [E] prompt — shown ONLY when player is in range. Replaces the "!"
    // in the same screen slot (y=-52, matching the marker's hover baseline).
    this.promptText = scene.add.text(0, -52, `[E]`, {
      fontSize: "10px", fontFamily: "monospace",
      color: "#14F195", align: "center",
      backgroundColor: "#0a0a1eDD",
      padding: { x: 5, y: 2 },
      resolution: 2,
    }).setOrigin(0.5, 0.5).setVisible(false);
    container.add(this.promptText);

    container.setDepth(y);

    this.startIdleBehavior();
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
      // The prompt and the "!" marker share the same overhead slot,
      // so we flip their visibility together for a clean swap.
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

  /**
   * Cleanup — releases the avatar's resources and the
   * progression-bus subscription so repeated hot-reloads don't leak.
   */
  destroy(): void {
    if (this.unsubBus) {
      this.unsubBus();
      this.unsubBus = null;
    }
    this.avatar.destroy();
  }

  private startIdleBehavior(): void {
    // Max wander distance from spawn point (world units, ~1.5 tiles)
    const WANDER_RADIUS = 28;
    // Walk speed in world-units/second
    const WALK_SPEED = 18;
    // Pause between walks (ms)
    const PAUSE_MIN = 1200;
    const PAUSE_MAX = 3800;

    const wander = () => {
      if (this._isInRange) {
        // Player nearby — face south, stay still, retry later
        this.avatar.idle();
        this.scene.time.delayedCall(800, wander);
        return;
      }

      const container = this.getContainer();

      // Pick one of the 4 cardinal directions — sprites only have
      // up/down/left/right frames, so diagonal movement breaks animation.
      const dirs: Direction[] = ["up", "down", "left", "right"];
      const dir = dirs[Math.floor(Math.random() * dirs.length)];

      // Step distance along that single axis only, clamped to WANDER_RADIUS
      const step = (0.4 + Math.random() * 0.6) * WANDER_RADIUS;
      let targetX = container.x;
      let targetY = container.y;
      if (dir === "left")  targetX = container.x - step;
      if (dir === "right") targetX = container.x + step;
      if (dir === "up")    targetY = container.y - step;
      if (dir === "down")  targetY = container.y + step;

      // Clamp to wander radius from origin so NPCs don't drift away
      const clampedX = Math.max(this.originX - WANDER_RADIUS, Math.min(this.originX + WANDER_RADIUS, targetX));
      const clampedY = Math.max(this.originY - WANDER_RADIUS, Math.min(this.originY + WANDER_RADIUS, targetY));

      const dx = clampedX - container.x;
      const dy = clampedY - container.y;
      const distance = Math.abs(dx) + Math.abs(dy);

      if (distance < 3) {
        this.scene.time.delayedCall(PAUSE_MIN + Math.random() * (PAUSE_MAX - PAUSE_MIN), wander);
        return;
      }

      this.avatar.walk(dir);

      const duration = (distance / WALK_SPEED) * 1000;

      this.scene.tweens.killTweensOf(container);
      this.scene.tweens.add({
        targets: container,
        x: clampedX,
        y: clampedY,
        duration,
        ease: "Linear",
        onUpdate: () => container.setDepth(container.y),
        onComplete: () => {
          this.avatar.idle();
          const pause = PAUSE_MIN + Math.random() * (PAUSE_MAX - PAUSE_MIN);
          this.scene.time.delayedCall(pause, wander);
        },
      });
    };

    // Stagger startup so all NPCs don't move at the same tick
    this.scene.time.delayedCall(Math.random() * 2000, wander);
  }

  /**
   * Updates the status marker above the NPC's head.
   *   not-visited: bright "!" in NPC's accent color (the "come talk to me" cue)
   *   visited:     muted "·" in a softer gray — still present, but recedes
   */
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
