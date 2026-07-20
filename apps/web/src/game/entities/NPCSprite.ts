import * as Phaser from "phaser";
import { TILE_SIZE } from "../config/constants";
import { SimpleSprite, NPC_DIRECTION_ROW, PLAYER_DIRECTION_ROW, type Direction } from "./SimpleSprite";
import type { NPCDefinition } from "../config/npcRegistry";
import { profileManager } from "../config/profileManager";
import { progressionBus } from "../progression/progressionBus";

const INTERACT_RANGE = TILE_SIZE * 1.8;

// Pixel-art attention balloons come in five palette variants (see
// assets/ui/attention_*.png). Each NPC uses the variant closest to its
// registry color, measured by RGB distance to these representative values.
const ATTENTION_RGB: Record<string, [number, number, number]> = {
  green:  [63, 190, 96],
  orange: [240, 138, 48],
  purple: [153, 69, 255],
  red:    [229, 72, 82],
  yellow: [245, 197, 66],
};

function attentionVariantFor(color: number): string {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  let best = "yellow";
  let bestDist = Infinity;
  for (const [name, [vr, vg, vb]] of Object.entries(ATTENTION_RGB)) {
    const d = (r - vr) ** 2 + (g - vg) ** 2 + (b - vb) ** 2;
    if (d < bestDist) { bestDist = d; best = name; }
  }
  return best;
}

export class NPCSprite {
  private scene: Phaser.Scene;
  private avatar: SimpleSprite;
  private exclamation: Phaser.GameObjects.Container;
  /** Pixel-art balloon sprite (preferred) — null when the texture is missing. */
  private exclamationImg: Phaser.GameObjects.Image | null = null;
  /** Primitive fallback pieces — only created when the sprite isn't available. */
  private exclamationBg: Phaser.GameObjects.Arc | null = null;
  private exclamationText: Phaser.GameObjects.Text | null = null;
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
    // Row order belongs to the TEXTURE, not the NPC: Dom's NPC sheets are
    // down/up/right/left, but the main_char fallback sheet is the player
    // order down/right/up/left. Using the NPC mapping on the fallback made
    // missing-sprite NPCs (e.g. Kite Pro) play the right-walk animation
    // while moving up — the classic moonwalk.
    const directionRow = spriteKey === "avatar-player" ? PLAYER_DIRECTION_ROW : NPC_DIRECTION_ROW;

    this.collisionLayers = collisionLayers ?? [];
    this.avatar = new SimpleSprite(
      scene, x, y, spriteKey, directionRow,
      def.spriteAnimation?.frameCount,
      def.spriteAnimation?.scale,
    );

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
      fontSize: "8px",
      fontFamily: '"Press Start 2P", monospace',
      color: colorHex,
      align: "center",
      resolution: 2,
      stroke: "#0a0a1e",
      strokeThickness: 3,
    }).setOrigin(0.5, 1);
    container.add(this.nameText);

    // ── Exclamation bubble ───────────────────────────────────────────────────
    const balloonKey = `attention-${attentionVariantFor(def.color)}`;
    if (scene.textures.exists(balloonKey)) {
      this.exclamationImg = scene.add.image(0, 0, balloonKey);
      // 64x64 source rendered at 20px world — same footprint as the old
      // 8px-radius circle, with room for the sprite's outline.
      this.exclamationImg.setDisplaySize(20, 20);
      this.exclamation = scene.add.container(0, -56, [this.exclamationImg]);
    } else {
      // Fallback: primitive circle + "!" (texture failed to load).
      this.exclamationBg = scene.add.circle(0, 0, 8, def.color);
      this.exclamationText = scene.add.text(0, 0, "!", {
        fontSize: "9px", fontFamily: "monospace",
        color: "#ffffff", fontStyle: "bold",
        resolution: 2,
      }).setOrigin(0.5, 0.5);
      this.exclamation = scene.add.container(0, -56, [this.exclamationBg, this.exclamationText]);
    }
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
      fontSize: "7px",
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
    // Static animated NPCs (spriteAnimation set) stay put, facing south,
    // playing their idle-loop animation — no wandering to layer on top.
    if (!def.spriteAnimation) {
      this.startDeterministicBehavior();
    }
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

  /**
   * Deterministic NPC behavior — all clients produce the same movements.
   *
   * Every STEP_MS (4 s) a seeded PRNG derived from (npc.id + stepIndex)
   * decides the NPC's next action. Because the seed depends only on the
   * NPC's identity and the global Unix-time step, every browser calculates
   * the same sequence of moves in perfect sync — like a server-authoritative
   * world, but without a server.
   *
   * On first call the NPC is snapped to the position it *should* be at for
   * the current time step (catches up if the player logged in mid-move).
   */
  private startDeterministicBehavior(): void {
    const STEP_MS    = 4_000;  // one "tick" every 4 s — all clients in sync
    const WANDER_R   = 18;     // max wander radius in world-px
    const WALK_SPEED = 18;     // px/s

    /** Fast 32-bit seeded PRNG (mulberry32). */
    const rng = (seed: number) => {
      let s = seed >>> 0;
      return (): number => {
        s += 0x6D2B79F5;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };

    /** Deterministic seed for this NPC at a given step index. */
    const stepSeed = (step: number): number => {
      let h = step ^ 0xdeadbeef;
      for (let i = 0; i < this.def.id.length; i++) {
        h = Math.imul(h ^ this.def.id.charCodeAt(i), 0x9e3779b9);
      }
      return h >>> 0;
    };

    /** Compute the target (x, y) the NPC moves to at a given step. */
    const targetForStep = (step: number): { x: number; y: number; dir: Direction } => {
      const r    = rng(stepSeed(step));
      const dirs: Direction[] = ["up", "down", "left", "right"];
      const dir  = dirs[Math.floor(r() * 4)];
      const move = r() < 0.55 ? 0 : (0.25 + r() * 0.45) * WANDER_R;
      let tx = this.originX, ty = this.originY;
      if (dir === "left")  tx -= move;
      if (dir === "right") tx += move;
      if (dir === "up")    ty -= move;
      if (dir === "down")  ty += move;
      return {
        x: Math.max(this.originX - WANDER_R, Math.min(this.originX + WANDER_R, tx)),
        y: Math.max(this.originY - WANDER_R, Math.min(this.originY + WANDER_R, ty)),
        dir,
      };
    };

    const container = this.getContainer();

    /** Snap the NPC to its correct mid-step position on first load. */
    const now     = Date.now();
    const step0   = Math.floor(now / STEP_MS);
    const elapsed = now - step0 * STEP_MS;
    const prev    = targetForStep(step0 - 1);
    const cur     = targetForStep(step0);
    const progress = elapsed / STEP_MS;
    container.setPosition(
      prev.x + (cur.x - prev.x) * progress,
      prev.y + (cur.y - prev.y) * progress,
    );
    container.setDepth(container.y);

    /** Called at every step boundary — same wall-clock time for all clients. */
    const tick = () => {
      if (this._isInRange) {
        scheduleNext();
        return;
      }

      const stepNow = Math.floor(Date.now() / STEP_MS);
      const { x, y, dir } = targetForStep(stepNow);
      const dist = Math.abs(x - container.x) + Math.abs(y - container.y);

      if (dist < 2 || this.isTileBlocked(x, y)) {
        this.avatar.face(dir);
      } else {
        this.avatar.walk(dir);
        this.scene.tweens.killTweensOf(container);
        this.scene.tweens.add({
          targets: container,
          x, y,
          duration: (dist / WALK_SPEED) * 1000,
          ease: "Linear",
          onUpdate: () => container.setDepth(container.y),
          onComplete: () => this.avatar.idle(),
        });
      }

      scheduleNext();
    };

    /** Schedule next tick at the START of the next step boundary. */
    const scheduleNext = () => {
      const msUntilNext = STEP_MS - (Date.now() % STEP_MS);
      this.scene.time.delayedCall(msUntilNext, tick);
    };

    scheduleNext();
  }

  private isTileBlocked(x: number, y: number): boolean {
    for (const layer of this.collisionLayers) {
      const tile = layer.getTileAtWorldXY(x, y);
      if (tile && tile.collides) return true;
    }
    return false;
  }

  private applyVisitedState(visited: boolean): void {
    if (this.exclamationImg) {
      // Sprite balloon: fade out once visited — color variants stay intact.
      this.exclamationImg.setAlpha(visited ? 0.35 : 1);
      return;
    }
    if (!this.exclamationBg || !this.exclamationText) return;
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
