/**
 * Sol Mechs — overworld companion.
 *
 * The drone escort that trails the player around the city once they own a
 * mech. It is cosmetic: it has no body, collides with nothing, and never
 * feeds the battle engine — so it can never block a doorway or wedge the
 * player against geometry.
 *
 * Following is spring-damped toward a slot behind the player rather than
 * pinned at a fixed offset, which is what gives the drone its lag and drift
 * when the player changes direction, instead of looking welded on.
 *
 * Art contract: 48x34 frames, three per mech, loaded as individual images
 * (not a sheet) under `mech-drone-{mechId}-{n}`. The three frames are a hover
 * cycle, so they loop continuously whether or not the player is moving.
 */
import * as Phaser from "phaser";
import type { MechId } from "../data/types";

const BASE = "/assets/minigames/sol-mechs/drones";

export const DRONE_FRAME_COUNT = 3;
export const DRONE_FRAME_W = 48;
export const DRONE_FRAME_H = 34;

/** ms per hover frame. */
const HOVER_FRAME_MS = 180;
/** World px behind the player the drone aims for. */
const FOLLOW_DISTANCE = 26;
/** How high above the ground line the drone floats. */
const HOVER_HEIGHT = 22;
/** Spring constant — higher snaps to the player faster. */
const SPRING = 0.085;
const DAMPING = 0.82;
/** Amplitude of the idle bob, in world px. */
const BOB_AMPLITUDE = 3;
const BOB_SPEED = 0.003;

export function droneTextureKey(mech: MechId, frame: number): string {
  return `mech-drone-${mech}-${frame}`;
}

/**
 * Queue every companion frame for loading. Call from a scene's preload().
 * Missing art is non-fatal — the caller's loaderror handler skips it and
 * `MechCompanion.create` bails out rather than drawing a broken sprite.
 */
export function preloadCompanions(scene: Phaser.Scene, mechs: MechId[]): void {
  for (const mech of mechs) {
    for (let i = 1; i <= DRONE_FRAME_COUNT; i++) {
      const key = droneTextureKey(mech, i);
      if (!scene.textures.exists(key)) {
        scene.load.image(key, `${BASE}/${mech}/idle${i}.png`);
      }
    }
  }
}

export class MechCompanion {
  private sprite?: Phaser.GameObjects.Image;
  private shadow?: Phaser.GameObjects.Ellipse;
  private frame = 0;
  private frameTimer = 0;
  private vx = 0;
  private vy = 0;
  /** Smoothed heading, used to park the drone behind the player. */
  private facing = { x: 0, y: 1 };
  private elapsed = 0;

  constructor(
    private scene: Phaser.Scene,
    private mech: MechId,
    startX: number,
    startY: number,
  ) {
    if (!scene.textures.exists(droneTextureKey(mech, 1))) {
      console.info(`[MechCompanion] art for "${mech}" not loaded — companion disabled`);
      return;
    }

    this.shadow = scene.add.ellipse(startX, startY, 18, 6, 0x000000, 0.22);
    this.sprite = scene.add.image(startX, startY - HOVER_HEIGHT, droneTextureKey(mech, 1));
    this.sprite.setOrigin(0.5, 0.5);
    // Source art is drawn at 2x the city's character scale, matching how the
    // paper-doll sheets are halved on screen.
    this.sprite.setScale(0.5);
  }

  get active(): boolean {
    return this.sprite !== undefined;
  }

  /** Swap the escort to a different mech without respawning it. */
  setMech(mech: MechId): void {
    if (!this.sprite || mech === this.mech) return;
    if (!this.scene.textures.exists(droneTextureKey(mech, 1))) return;
    this.mech = mech;
    this.sprite.setTexture(droneTextureKey(mech, this.frame + 1));
  }

  setVisible(visible: boolean): void {
    this.sprite?.setVisible(visible);
    this.shadow?.setVisible(visible);
  }

  /**
   * @param targetX  player world x
   * @param targetY  player world y (feet)
   * @param moving   whether the player is walking this frame
   * @param delta    ms since last frame
   */
  update(targetX: number, targetY: number, moving: boolean, delta: number): void {
    const sprite = this.sprite;
    const shadow = this.shadow;
    if (!sprite || !shadow) return;

    this.elapsed += delta;

    // Track heading only while moving — otherwise the drone would swing
    // around the player every time they stop and the delta collapses to zero.
    if (moving) {
      const dx = targetX - (sprite.x);
      const dy = targetY - (sprite.y + HOVER_HEIGHT);
      const len = Math.hypot(dx, dy);
      if (len > 0.5) {
        this.facing.x += (dx / len - this.facing.x) * 0.12;
        this.facing.y += (dy / len - this.facing.y) * 0.12;
      }
    }

    // Park behind the player, opposite their heading.
    const slotX = targetX - this.facing.x * FOLLOW_DISTANCE;
    const slotY = targetY - this.facing.y * FOLLOW_DISTANCE - HOVER_HEIGHT;

    // Critically-ish damped spring toward the slot.
    this.vx = (this.vx + (slotX - sprite.x) * SPRING) * DAMPING;
    this.vy = (this.vy + (slotY - sprite.y) * SPRING) * DAMPING;
    sprite.x += this.vx;
    sprite.y += this.vy;

    // Idle bob, on top of the spring so it reads even while parked.
    const bob = Math.sin(this.elapsed * BOB_SPEED) * BOB_AMPLITUDE;
    sprite.y += bob * 0.15;

    // Face travel direction; art is drawn facing right.
    if (Math.abs(this.vx) > 0.15) sprite.setFlipX(this.vx < 0);

    // Hover animation.
    this.frameTimer += delta;
    if (this.frameTimer >= HOVER_FRAME_MS) {
      this.frameTimer -= HOVER_FRAME_MS;
      this.frame = (this.frame + 1) % DRONE_FRAME_COUNT;
      sprite.setTexture(droneTextureKey(this.mech, this.frame + 1));
    }

    // Shadow tracks the drone's ground position, shrinking with altitude so
    // the bob reads as height rather than as the whole sprite sliding.
    const groundY = sprite.y + HOVER_HEIGHT;
    shadow.x = sprite.x;
    shadow.y = groundY;
    const lift = 1 - Math.min(0.35, Math.abs(bob) / (BOB_AMPLITUDE * 3));
    shadow.setScale(lift, lift);

    // Y-sort with the city's characters, using the ground point rather than
    // the sprite's own y so the drone occludes correctly against buildings.
    sprite.setDepth(groundY);
    shadow.setDepth(groundY - 1);
  }

  destroy(): void {
    this.sprite?.destroy();
    this.shadow?.destroy();
    this.sprite = undefined;
    this.shadow = undefined;
  }
}
