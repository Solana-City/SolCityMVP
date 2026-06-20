import * as Phaser from "phaser";
import { AvatarSprite } from "./AvatarSprite";
import { TILE_SIZE } from "../config/constants";
import { LAYER_VARIANTS, type Loadout, DIRECTION_ROW, SPRITE_COLS } from "../config/paperDoll";
import { PLAYABLE_ZONE } from "../config/constants";

// Fast seeded PRNG (mulberry32)
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return (): number => {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function makePedestrianLoadout(seed: number): Loadout {
  const rng = mulberry32(seed);

  // 90% Human, 10% spread equally across other skins
  const skin = rng() < 0.90
    ? "Human"
    : pick(LAYER_VARIANTS.skin.filter(v => v.id !== "Human"), rng).id;

  const eyesFace = rng() < 0.95 ? "Happy" : "Terminator";
  // Avatar hair (blue arrow) is very rare — 2% of hair picks
  const commonHair = LAYER_VARIANTS.hair.filter(h => h.id !== "Avatar");
  const hair = rng() < 0.02 ? "Avatar" : pick(commonHair, rng).id;
  const tshirt   = pick(LAYER_VARIANTS.tshirt, rng).id;
  const pants    = pick(LAYER_VARIANTS.pants,  rng).id;

  // 50% chance of a hat; within hats, Cap_blue (blue arrow) is very rare (3%)
  const hat = (() => {
    if (rng() >= 0.50) return undefined;
    return pick(LAYER_VARIANTS.hat, rng).id;
  })();

  const accessory = rng() < 0.08 ? pick(LAYER_VARIANTS.accessory, rng).id : undefined;

  return { skin, eyesFace, hair, tshirt, pants, hat, accessory };
}

type Direction = "up" | "down" | "left" | "right";
const DIRS: Direction[] = ["up", "down", "left", "right"];

const INTERACT_RANGE = TILE_SIZE * 2;

export class PedestrianSprite {
  readonly pedId: number;
  readonly loadout: Loadout;

  private avatar: AvatarSprite;
  private scene: Phaser.Scene;
  private speed: number;
  private moveTimer: Phaser.Time.TimerEvent | null = null;
  private isMoving = false;
  private lastDir: Direction = "down";

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    loadout: Loadout,
    speed: number,
    _collisionLayers: Phaser.Tilemaps.TilemapLayer[], // colliders set up externally via PedestrianManager
    pedId: number,
  ) {
    this.scene = scene;
    this.speed = speed;
    this.pedId = pedId;
    this.loadout = loadout;

    this.avatar = new AvatarSprite(scene, x, y, loadout);

    // Enable physics — body NOT immovable so physics resolves collisions
    const container = this.avatar.getContainer();
    scene.physics.world.enable(container);
    const body = container.body as Phaser.Physics.Arcade.Body;
    body.setSize(TILE_SIZE * 0.5, TILE_SIZE * 0.3);
    body.setOffset(-TILE_SIZE * 0.25, -TILE_SIZE * 0.2);
    body.setCollideWorldBounds(true);
    body.setImmovable(true);
    body.setMaxVelocity(80, 80);

    this.showIdleFrame();
    this.scheduleNextMove();

    // Keep walking animation in sync with actual physics velocity each frame
    scene.events.on("update", this.syncAnimation, this);
  }

  private syncAnimation() {
    if (!this.isMoving) return;
    const container = this.avatar.getContainer();
    // Container/body can already be torn down (e.g. mid-recycle in
    // PedestrianManager.rotateBatch()) by the time this frame's "update"
    // fires, since scene.events.off() in destroy() doesn't retroactively
    // skip a listener collected earlier in the same emit pass.
    if (!container?.scene || !container.body) return;
    const body = container.body as Phaser.Physics.Arcade.Body;
    const vx = body.velocity.x;
    const vy = body.velocity.y;
    if (Math.abs(vx) < 1 && Math.abs(vy) < 1) return;

    const dir: Direction = Math.abs(vx) >= Math.abs(vy)
      ? (vx > 0 ? "right" : "left")
      : (vy > 0 ? "down" : "up");

    if (dir !== this.lastDir) {
      this.lastDir = dir;
      this.avatar.walk(dir);
    }
  }

  get x() { return this.avatar.x; }
  get y() { return this.avatar.y; }
  getContainer() { return this.avatar.getContainer(); }

  isNearPlayer(px: number, py: number): boolean {
    const dx = this.avatar.x - px;
    const dy = this.avatar.y - py;
    return Math.sqrt(dx * dx + dy * dy) <= INTERACT_RANGE;
  }

  /** No visual marker — player must find target by appearance only. */
  setAsTarget(_isTarget: boolean): void {}

  /** Brief pause + scale pulse when found, then resume movement cleanly. */
  celebrateFound(): void {
    const container = this.avatar.getContainer();
    if (!container?.scene || !container.body) return;
    const body = container.body as Phaser.Physics.Arcade.Body;

    // Stop movement for the celebration duration
    this.moveTimer?.remove(false);
    this.moveTimer = null;
    body.setVelocity(0, 0);
    this.isMoving = false;
    this.showIdleFrame();

    const baseScale = container.scaleX;
    this.scene.tweens.add({
      targets: container,
      scaleX: baseScale * 1.4, scaleY: baseScale * 1.4,
      duration: 120,
      yoyo: true,
      repeat: 2,
      ease: "Sine.easeInOut",
      onComplete: () => {
        container.setScale(baseScale); // guarantee correct scale after tween
        this.scheduleNextMove();
      },
    });
  }

  private showIdleFrame() {
    const container = this.avatar.getContainer();
    const row = DIRECTION_ROW["down"];
    for (const child of container.list as Phaser.GameObjects.Sprite[]) {
      if (child.anims) {
        child.anims.stop();
        child.setFrame(row * SPRITE_COLS);
      }
    }
  }

  private scheduleNextMove() {
    // Pause 600ms–2s between moves
    const pause = 600 + Math.random() * 1400;
    this.moveTimer = this.scene.time.delayedCall(pause, () => this.startMove());
  }

  private startMove() {
    if (!this.scene?.sys?.isActive()) return;
    const container = this.avatar.getContainer();
    if (!container?.scene) return;

    const body = container.body as Phaser.Physics.Arcade.Body;
    const dir = DIRS[Math.floor(Math.random() * DIRS.length)];

    const spd = this.speed;
    const vx = dir === "left" ? -spd : dir === "right" ? spd : 0;
    const vy = dir === "up"   ? -spd : dir === "down"  ? spd : 0;

    body.setVelocity(vx, vy);
    this.lastDir = dir;
    this.avatar.walk(dir);
    this.isMoving = true;

    // Walk for 600ms–2s, then stop and rest
    const moveDuration = 600 + Math.random() * 1400;
    this.moveTimer = this.scene.time.delayedCall(moveDuration, () => this.stopMove());
  }

  private stopMove() {
    if (!this.scene?.sys?.isActive()) return;
    const container = this.avatar.getContainer();
    if (!container?.scene) return;

    const body = container.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, 0);
    this.isMoving = false;
    this.showIdleFrame();
    this.scheduleNextMove();
  }

  updateDepth() { this.avatar.updateDepth(); }

  destroy() {
    this.moveTimer?.remove(false);
    this.scene.events.off("update", this.syncAnimation, this);
    this.avatar.destroy();
  }
}
