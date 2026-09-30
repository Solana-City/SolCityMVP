import * as Phaser from "phaser";
import { TILE_SIZE } from "../config/constants";
import { ChatBubble } from "../chat/ChatBubble";
import { SimpleSprite, NPC_DIRECTION_ROW, PLAYER_DIRECTION_ROW, type Direction } from "./SimpleSprite";
import type { NPCDefinition } from "../config/npcRegistry";
import { profileManager } from "../config/profileManager";
import { progressionBus } from "../progression/progressionBus";
import { npcCategory } from "../minimap/categories";
import { hoverCursor } from "../config/cursors";

const INTERACT_RANGE = TILE_SIZE * 1.8;
/** How long a spoken line owns the bubble before another can replace it. */
const SAY_COOLDOWN = 3600;
/** How long the reaction pose is held, just under the line's own life. */
const ACTION_HOLD_MS = 2500;

/**
 * The exclamation over an NPC's head: one animated sheet per map category,
 * drawn in that category's own legend colour (assets/ui/attention_*.png).
 *
 * Keyed by CATEGORY rather than by colour. An NPC's `color` is already its
 * category's legend colour and nothing else (see npcRegistry's categoryColor),
 * so the old nearest-RGB search over a palette of five invented reference
 * colours was measuring the distance from a colour to itself, the long way
 * round, and would quietly pick the wrong sheet the day a legend colour moved.
 *
 * These four are every category `npcCategory` can return; `landmark` and
 * `players` exist in the legend but never belong to an NPC.
 */
export const ATTENTION_CATEGORIES = ["guide", "defi", "games", "community"] as const;

/** One row of 14 frames: the mark bobbing up and back down. */
export const ATTENTION_FRAME_W = 24;
export const ATTENTION_FRAME_H = 102;
export const ATTENTION_FRAMES = 14;
/** The loop runs a touch over a second, which reads as idle rather than urgent. */
export const ATTENTION_FRAME_RATE = 12;
/**
 * Source pixels to world pixels. A sixth is the only reduction that lands both
 * dimensions on whole numbers (24x102 -> 4x17), so the mark keeps its shape
 * and its pixels stay square at every zoom on the ladder.
 */
const ATTENTION_SCALE = 1 / 6;

export class NPCSprite {
  private scene: Phaser.Scene;
  private avatar: SimpleSprite;
  private exclamation: Phaser.GameObjects.Container;
  /** Pixel-art balloon sprite (preferred) — null when the texture is missing. */
  private exclamationImg: Phaser.GameObjects.Sprite | null = null;
  /** Primitive fallback pieces — only created when the sprite isn't available. */
  private exclamationBg: Phaser.GameObjects.Arc | null = null;
  private exclamationText: Phaser.GameObjects.Text | null = null;
  private nameText: Phaser.GameObjects.Text;
  private promptText: Phaser.GameObjects.Text;
  private _isInRange = false;
  private bubble: ChatBubble | null = null;
  private quietUntil = 0;
  private originX: number;
  private originY: number;
  private unsubBus: (() => void) | null = null;
  private collisionLayers: Phaser.Tilemaps.TilemapLayer[] = [];
  readonly def: NPCDefinition;
  /** Texture the NPC is drawn from (after the fallback), for previews. */
  readonly textureKey: string;

  /** Where this NPC spawns and wanders around, in world px. */
  /**
   * Turn to look at the player when a conversation starts: stop any walk in
   * progress and face whichever way the player mostly is. Static animated
   * NPCs (a one-direction loop like Kite Pro) keep their pose.
   */
  faceToward(px: number, py: number): void {
    if (this.def.spriteAnimation) return;
    const c = this.getContainer();
    this.scene.tweens.killTweensOf(c);
    this.setSheet(this.def.spriteKey);
    const dx = px - c.x;
    const dy = py - c.y;
    const dir: Direction = Math.abs(dx) > Math.abs(dy)
      ? (dx < 0 ? "left" : "right")
      : (dy < 0 ? "up" : "down");
    this.avatar.face(dir);
  }

  getSpawn(): { x: number; y: number } {
    return { x: this.originX, y: this.originY };
  }

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
    this.textureKey = spriteKey;
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

    // ── Exclamation ──────────────────────────────────────────────────────────
    const balloonKey = `attention-${npcCategory(def)}`;
    if (scene.textures.exists(balloonKey)) {
      const animKey = `${balloonKey}-bob`;
      if (!scene.anims.exists(animKey)) {
        scene.anims.create({
          key: animKey,
          frames: scene.anims.generateFrameNumbers(balloonKey, { start: 0, end: ATTENTION_FRAMES - 1 }),
          frameRate: ATTENTION_FRAME_RATE,
          repeat: -1,
        });
      }
      this.exclamationImg = scene.add.sprite(0, 0, balloonKey).setScale(ATTENTION_SCALE);
      // Every NPC in the city starts on a different frame. In step they read
      // as one blinking row of marks rather than a street of separate people.
      this.exclamationImg.anims.play(animKey);
      this.exclamationImg.anims.setProgress(((def.tileX * 7 + def.tileY * 13) % ATTENTION_FRAMES) / ATTENTION_FRAMES);
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

    // The drawn mark bobs on its own, so only the primitive fallback needs a
    // tween to move it. Both together was two bobs fighting each other.
    if (!this.exclamationImg) {
      scene.tweens.add({
        targets: this.exclamation,
        y: exclamationY - 5,
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }

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

    // ── Hit zone ─────────────────────────────────────────────────────────────
    // Transparent rectangle over the NPC sprite and its name. Clicking or
    // tapping it while in range starts the conversation, the same thing E
    // does — players tried this on desktop and nothing happened, because the
    // zone used to be built only for touch. A repelling NPC has no
    // conversation to start, so it gets no zone and no hover cursor.
    if (!def.repel) {
      // Same proportions the old fixed 48x72 @ y=-24 used for a standard
      // NPC (visualHeight 32): y = -0.75×height, height = 2.25×height.
      const hitZone = scene.add.rectangle(0, -visualHeight * 0.75, 48, visualHeight * 2.25, 0x000000, 0);
      // The city's own arrow, not the browser's hand — and only where there
      // is a pointer at all to draw it with (see game/config/cursors.ts).
      hitZone.setInteractive({ cursor: isTouch ? undefined : hoverCursor() });
      hitZone.on("pointerdown", () => {
        // Names the NPC that was clicked. The old path emitted the generic
        // touch:interact, which opens whichever NPC is NEAREST and in range:
        // click one of two NPCs standing together and the other one answered,
        // and click anyone you were not already standing next to and nothing
        // happened at all, which is what "clicking does nothing" was.
        scene.game.events.emit("npc:click", def.id);
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

  /** The definition this sprite was built from, for scene-level behaviour. */
  get definition(): NPCDefinition {
    return this.def;
  }

  /**
   * Say a line in the drawn bubble over this NPC's head, ignoring calls that
   * arrive while the last one is still up — the repel check runs every frame.
   */
  say(text: string): void {
    const now = this.scene.time.now;
    if (now < this.quietUntil) return;
    this.quietUntil = now + SAY_COOLDOWN;
    this.bubble?.destroy();
    // Clear of the name label, which sits at visualHeight + 2.
    this.bubble = new ChatBubble(this.scene, this.getContainer(), text, "#ffffff", {
      bg: 0xffffff, bgAlpha: 1, outline: false, y: -(this.avatar.getVisualHeight() + 16), overlay: true,
    });
    // The sheet that goes with the line: the builder throws an arm out.
    if (this.def.spriteActionKey) this.avatar.poseFor(this.def.spriteActionKey, ACTION_HOLD_MS);
  }

  checkProximity(playerX: number, playerY: number): boolean {
    const container = this.getContainer();
    const dx = container.x - playerX;
    const dy = container.y - playerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const inRange = dist < INTERACT_RANGE;

    if (inRange !== this._isInRange) {
      this._isInRange = inRange;
      // A repelling NPC has nothing to open: no prompt, and no "!" either.
      const talkable = !this.def.repel;
      this.promptText.setVisible(inRange && talkable);
      this.exclamation.setVisible(!inRange && talkable);
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
      //
      // Each leg is also CLAMPED to the last free point along it. The two
      // tests above only ask about the destination and the corner, and a
      // tween walks a straight line between two points without consulting
      // anything — so a leg whose ends are both clear sails straight over
      // whatever sits in the middle. That is the Caramel Dog climbing the
      // beach chairs: its corner and its destination are sand, and the chairs
      // are in between.
      //
      // Sampling is a pure function of the two endpoints, so every client
      // clamps to the same place and the crowd stays identical everywhere,
      // which the beach football depends on (NPCs are colliders it bounces
      // off: see world/BeachBall).
      const legs: Array<{ x: number; y: number; dir: Direction }> = [];
      if (Math.abs(dx) >= 1) {
        const stopX = this.clearAlong(container.x, container.y, x, container.y);
        if (Math.abs(stopX - container.x) >= 1) {
          legs.push({ x: stopX, y: container.y, dir: dx >= 0 ? "right" : "left" });
        }
      }
      const legStartX = legs.length > 0 ? legs[0].x : container.x;
      if (Math.abs(dy) >= 1) {
        const stopY = this.clearAlong(legStartX, container.y, legStartX, y);
        if (Math.abs(stopY - container.y) >= 1) {
          legs.push({ x: legStartX, y: stopY, dir: dy >= 0 ? "down" : "up" });
        }
      }
      if (legs.length === 0) {
        this.setSheet(this.def.spriteKey);
        this.avatar.face(dir);
        scheduleNext();
        return;
      }

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

  /**
   * How far along the straight line from (x0,y0) to (x1,y1) this NPC can walk
   * before something solid is in the way. Returns the moving axis' last free
   * value, which is x1/y1 when the whole line is clear.
   *
   * Sampled every third of a tile: fine enough that a one-tile obstacle can
   * never be stepped over, coarse enough to stay cheap on a timer that fires
   * for every NPC in the city.
   */
  private clearAlong(x0: number, y0: number, x1: number, y1: number): number {
    const horizontal = x0 !== x1;
    const from = horizontal ? x0 : y0;
    const to = horizontal ? x1 : y1;
    const span = to - from;
    const steps = Math.max(1, Math.ceil(Math.abs(span) / (TILE_SIZE / 3)));
    let last = from;
    for (let i = 1; i <= steps; i++) {
      const at = from + (span * i) / steps;
      if (this.isTileBlocked(horizontal ? at : x0, horizontal ? y0 : at)) break;
      last = at;
    }
    return last;
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

