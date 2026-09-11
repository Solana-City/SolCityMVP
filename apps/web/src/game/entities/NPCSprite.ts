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
      def.spriteAnimation?.blobOffsetX,
    );

    const container = this.getContainer();
    const colorHex = `#${def.color.toString(16).padStart(6, "0")}`;

    // Detect touch device for prompt wording
    const isTouch = scene.sys.game.device.input.touch;

    // ── Label stack (bottom → top) ──────────────────────────────────────────
    //
    //   nameY - 21  →  [! bubble] or [interact prompt]
    //   nameY       →  [ Name ]
    //   y = 0       →  [feet]
    //
    // Anchored to the sprite's own rendered height (32 for a standard NPC,
    // margins roughly matching the old hardcoded -38/-56) rather than fixed
    // pixels, so a taller sheet — e.g. Kite Pro's kite banner above the
    // head — doesn't have its name/prompt drawn over the top of the sprite.
    // The "!" and the prompt share the same slot (toggle visibility).
    const visualHeight = this.avatar.getVisualHeight();
    const nameY = -(visualHeight + 2);
    // Tucked just above the name so the "!" sits close to both the name and
    // the character (still clears the name text at rest, not only at the top
    // of its bounce).
    const exclamationY = -(visualHeight + 19);

    // ── Name label ───────────────────────────────────────────────────────────
    this.nameText = scene.add.text(0, nameY, def.name, {
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
      // 64x64 source rendered at 12px world — a smaller badge that sits close
      // above the name without looming over the character.
      this.exclamationImg.setDisplaySize(12, 12);
      this.exclamation = scene.add.container(0, exclamationY, [this.exclamationImg]);
    } else {
      // Fallback: primitive circle + "!" (texture failed to load), scaled to
      // match the smaller badge.
      this.exclamationBg = scene.add.circle(0, 0, 4.8, def.color);
      this.exclamationText = scene.add.text(0, 0, "!", {
        fontSize: "6px", fontFamily: "monospace",
        color: "#ffffff", fontStyle: "bold",
        resolution: 2,
      }).setOrigin(0.5, 0.5);
      this.exclamation = scene.add.container(0, exclamationY, [this.exclamationBg, this.exclamationText]);
    }
    container.add(this.exclamation);

    scene.tweens.add({
      targets: this.exclamation,
      y: exclamationY - 5,
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
    this.promptText = scene.add.text(0, exclamationY, promptLabel, {
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
      // Same proportions the old fixed 48x72 @ y=-24 used for a standard
      // NPC (visualHeight 32): y = -0.75×height, height = 2.25×height.
      const hitZone = scene.add.rectangle(0, -visualHeight * 0.75, 48, visualHeight * 2.25, 0x000000, 0);
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
    const WANDER_R   = this.def.wanderRadius ?? 18; // max wander radius, world-px
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
      const dx = x - container.x;
      const dy = y - container.y;
      const dist = Math.abs(dx) + Math.abs(dy);

      // The corner of the L-path below, checked alongside the destination so a
      // two-leg walk can't cut through a collider on the turn.
      if (dist < 2 || this.isTileBlocked(x, y) || this.isTileBlocked(x, container.y)) {
        this.setSheet(this.def.spriteKey);
        this.avatar.face(dir);
        scheduleNext();
        return;
      }

      // Walk the X leg, then the Y leg — one axis at a time, each facing the
      // way it is actually travelling.
      //
      // `dir` from targetForStep is NOT that direction. It says where the
      // target sits relative to the NPC's ORIGIN, but the NPC sets off from
      // wherever the last step left it. Those disagree constantly: a step that
      // rolls move=0 (55% of them) targets the origin itself, so an NPC parked
      // to its right walks LEFT while playing the right-walk animation. That
      // was the moonwalk, and it hit the Caramel Dog hardest simply because a
      // 168px leash makes every mismatch a long, obvious slide.
      //
      // Splitting into legs also stops the diagonal drift that happened
      // whenever consecutive steps picked different axes.
      const legs: Array<{ x: number; y: number; dir: Direction }> = [];
      if (Math.abs(dx) >= 1) legs.push({ x, y: container.y, dir: dx >= 0 ? "right" : "left" });
      if (Math.abs(dy) >= 1) legs.push({ x, y, dir: dy >= 0 ? "down" : "up" });

      // Long walks travel faster rather than overrunning the step. At the base
      // speed a full-leash move takes far longer than one 4s step, so the next
      // tick killed the tween mid-stride every time and the NPC juddered
      // without ever arriving — the other half of "moves strangely".
      const duration = Math.min((dist / WALK_SPEED) * 1000, STEP_MS * 0.85);

      this.scene.tweens.killTweensOf(container);

      let leg = 0;
      const runLeg = (): void => {
        // The legs chain through onComplete, so the scene can go away between
        // them — one more window than the single tween this replaced.
        if (!container.scene) return;
        if (leg >= legs.length) {
          this.setSheet(this.def.spriteKey);
          this.avatar.idle();
          return;
        }
        const next = legs[leg++];
        const legDist = Math.abs(next.x - container.x) + Math.abs(next.y - container.y);
        // Swap to the walk sheet BEFORE walk(), so the animation it starts is
        // the one registered against the sheet actually on screen.
        this.setSheet(this.def.spriteWalkKey ?? this.def.spriteKey);
        this.avatar.walk(next.dir);
        this.scene.tweens.add({
          targets: container,
          x: next.x, y: next.y,
          duration: duration * (dist > 0 ? legDist / dist : 1),
          ease: "Linear",
          onUpdate: () => container.setDepth(container.y),
          onComplete: runLeg,
        });
      };
      runLeg();

      scheduleNext();
    };

    /** Schedule next tick at the START of the next step boundary. */
    const scheduleNext = () => {
      const msUntilNext = STEP_MS - (Date.now() % STEP_MS);
      this.scene.time.delayedCall(msUntilNext, tick);
    };

    scheduleNext();
  }

  /**
   * Switch to one of this NPC's sheets (idle vs walk). No-op for the NPCs that
   * ship a single sheet, and SimpleSprite.setTexture already ignores a swap to
   * the texture it is on, so this is cheap to call on every step.
   */
  private setSheet(key: string | undefined): void {
    if (!key || !this.def.spriteWalkKey) return;
    if (!this.scene.textures.exists(key)) return;
    this.avatar.setTexture(key);
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
