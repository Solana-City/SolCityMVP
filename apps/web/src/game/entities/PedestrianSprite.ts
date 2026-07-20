import * as Phaser from "phaser";
import { AvatarSprite } from "./AvatarSprite";
import { TILE_SIZE, PLAYABLE_ZONE } from "../config/constants";
import { getEnabledVariants, type Loadout, DIRECTION_ROW, SPRITE_COLS } from "../config/paperDoll";

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

  // 90% Light, 10% spread equally across other skins
  const skin = rng() < 0.90
    ? "Light"
    : pick(getEnabledVariants("skin").filter(v => v.id !== "Light"), rng).id;

  // 90% Happy, 10% spread across the other face variants
  const eyesFace = rng() < 0.90
    ? "Happy"
    : pick(getEnabledVariants("eyesFace").filter(v => v.id !== "Happy"), rng).id;
  // Avatar hair (blue arrow) is very rare — 2% of hair picks
  const commonHair = getEnabledVariants("hair").filter(h => h.id !== "Avatar");
  const hair = rng() < 0.02 ? "Avatar" : pick(commonHair, rng).id;
  const tshirt   = pick(getEnabledVariants("tshirt"), rng).id;
  const pants    = pick(getEnabledVariants("pants"),  rng).id;

  // 50% chance of a hat; within hats, Cap_blue (blue arrow) is very rare (3%)
  const hat = (() => {
    if (rng() >= 0.50) return undefined;
    return pick(getEnabledVariants("hat"), rng).id;
  })();

  const accessory = rng() < 0.08 ? pick(getEnabledVariants("accessory"), rng).id : undefined;

  // 25% chance of a backpack/jetpack — only some pedestrians wear one
  const back = rng() < 0.25 ? pick(getEnabledVariants("back"), rng).id : undefined;

  return { skin, eyesFace, hair, tshirt, pants, hat, accessory, back };
}

type Direction = "up" | "down" | "left" | "right";

const DIR_VECTORS: Record<Direction, [number, number]> = {
  up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
};
const TURNS: Record<Direction, [Direction, Direction]> = {
  up: ["left", "right"], down: ["left", "right"],
  left: ["up", "down"], right: ["up", "down"],
};
const OPPOSITE: Record<Direction, Direction> = {
  up: "down", down: "up", left: "right", right: "left",
};

const INTERACT_RANGE = TILE_SIZE * 2;
/** A destination is "crowded" when this many peds already stand near it. */
const CROWD_LIMIT = 4;
const CROWD_RADIUS = TILE_SIZE * 2.5;

/**
 * World-query callbacks supplied by PedestrianManager, so each pedestrian
 * can validate its stroll before walking (no bumping into walls) and steer
 * away from crowded spots.
 */
export interface PedestrianContext {
  /** True when the world tile at this world-px position is collidable. */
  isBlocked(wx: number, wy: number): boolean;
  /** Number of pedestrians within `radius` of a world-px position. */
  countNear(wx: number, wy: number, radius: number): number;
}

/**
 * Stroll-based wandering:
 *
 *   idle pause → pick a direction (heavily biased toward continuing the
 *   current heading, like a real player crossing the map) → probe the tiles
 *   along it and clamp to the walkable stretch → check the destination
 *   isn't already crowded → walk there at a steady pace → arrive → repeat.
 *
 * Because the path is validated BEFORE moving, pedestrians never march
 * against walls; because arrival is positional (not a timer), they never
 * change heading without actually walking; and because every duration and
 * choice comes from a per-pedestrian seeded RNG, the crowd has no shared
 * rhythm — each one lives on its own clock.
 */
export class PedestrianSprite {
  readonly pedId: number;
  readonly loadout: Loadout;

  private avatar: AvatarSprite;
  private scene: Phaser.Scene;
  private ctx: PedestrianContext;
  private speed: number;
  private rng: () => number;
  /** Personality: scales this ped's pauses so rhythms differ but stay sane. */
  private pauseScale: number;

  private moveTimer: Phaser.Time.TimerEvent | null = null;
  private isMoving = false;
  private lastDir: Direction = "down";
  private walkVx = 0;
  private walkVy = 0;
  private target: { x: number; y: number } | null = null;
  /** Real-time deadline: if a walk somehow takes too long, arrive anyway. */
  private walkDeadline = 0;
  private nudgeCooldown = 0;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    loadout: Loadout,
    speed: number,
    ctx: PedestrianContext,
    pedId: number,
  ) {
    this.scene = scene;
    this.ctx = ctx;
    this.speed = speed;
    this.pedId = pedId;
    this.loadout = loadout;
    this.rng = mulberry32(pedId * 7919 + 131);
    this.pauseScale = 0.8 + this.rng() * 0.5;
    this.lastDir = (["up", "down", "left", "right"] as Direction[])[Math.floor(this.rng() * 4)];

    this.avatar = new AvatarSprite(scene, x, y, loadout);

    // Enable physics — body NOT immovable so physics resolves collisions
    const container = this.avatar.getContainer();
    // Back-reference for PedestrianManager's ped-vs-ped contact resolver.
    (container as any).__pedestrian = this;
    scene.physics.world.enable(container);
    const body = container.body as Phaser.Physics.Arcade.Body;
    body.setSize(TILE_SIZE * 0.5, TILE_SIZE * 0.3);
    body.setOffset(-TILE_SIZE * 0.25, -TILE_SIZE * 0.2);
    body.setCollideWorldBounds(true);
    body.setImmovable(false);
    body.setDrag(600, 600);
    body.setMaxVelocity(80, 80);

    this.showIdleFrame();
    this.scheduleNextMove();

    // Per-frame steering + arrival detection + walk animation sync.
    scene.events.on("update", this.tick, this);
  }

  private tick() {
    const container = this.avatar.getContainer();
    // Container/body can already be torn down (e.g. mid-recycle in
    // PedestrianManager.rotateBatch()) by the time this frame's "update"
    // fires, since scene.events.off() in destroy() doesn't retroactively
    // skip a listener collected earlier in the same emit pass.
    if (!container?.scene || !container.body) return;
    if (!this.isMoving || !this.target) return;
    const body = container.body as Phaser.Physics.Arcade.Body;

    const remX = this.target.x - container.x;
    const remY = this.target.y - container.y;
    const remaining = Math.hypot(remX, remY);

    // Arrived, physically blocked mid-way (unexpected obstacle), or the
    // walk overran its deadline — stop cleanly, facing the walk direction.
    const [dirX, dirY] = DIR_VECTORS[this.lastDir];
    const blockedAhead =
      (dirX < 0 && body.blocked.left) || (dirX > 0 && body.blocked.right) ||
      (dirY < 0 && body.blocked.up)   || (dirY > 0 && body.blocked.down);
    if (remaining <= 2 || blockedAhead || this.scene.time.now > this.walkDeadline) {
      this.arrive();
      return;
    }

    // Steer straight at the target every frame — corrects cross-axis drift
    // from shoves without ever fighting a wall (the path was pre-validated).
    this.walkVx = (remX / remaining) * this.speed;
    this.walkVy = (remY / remaining) * this.speed;
    body.setVelocity(this.walkVx, this.walkVy);

    const dir: Direction = Math.abs(this.walkVx) >= Math.abs(this.walkVy)
      ? (this.walkVx > 0 ? "right" : "left")
      : (this.walkVy > 0 ? "down" : "up");
    this.lastDir = dir;
    this.avatar.walk(dir); // anims.play ignoreIfPlaying=true — no-op if already animating
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
    this.walkVx = 0;
    this.walkVy = 0;
    this.target = null;
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

  /** Idle facing the direction the pedestrian was last walking — never
   *  snaps to a different heading while standing still. */
  private showIdleFrame() {
    const container = this.avatar.getContainer();
    const row = DIRECTION_ROW[this.lastDir];
    for (const child of container.list as Phaser.GameObjects.Sprite[]) {
      if (child.anims) {
        child.anims.stop();
        child.setFrame(row * SPRITE_COLS);
      }
    }
  }

  private scheduleNextMove() {
    // Usually a short breather; occasionally a longer look-around. The
    // per-ped pauseScale keeps individual rhythms distinct without letting
    // anyone stand frozen for ages or walk non-stop.
    const roll = this.rng();
    const pause =
      roll < 0.30 ? 250 + this.rng() * 350 :               // keep flowing
      roll < 0.92 ? (900 + this.rng() * 1400) * this.pauseScale :
                    (2600 + this.rng() * 1800) * this.pauseScale; // long idle
    this.moveTimer = this.scene.time.delayedCall(pause, () => this.startMove());
  }

  /** Directions to try, most preferred first: strong momentum bias toward
   *  the current heading, turns next, reversal last. */
  private directionOrder(): Direction[] {
    const keep = this.lastDir;
    const [t1, t2] = TURNS[keep];
    const pool: { d: Direction; w: number }[] = [
      { d: keep, w: 5 },
      { d: t1, w: 2 },
      { d: t2, w: 2 },
      { d: OPPOSITE[keep], w: 1 },
    ];
    const order: Direction[] = [];
    while (pool.length > 0) {
      const total = pool.reduce((s, p) => s + p.w, 0);
      let r = this.rng() * total;
      let idx = pool.length - 1;
      for (let i = 0; i < pool.length; i++) {
        r -= pool[i].w;
        if (r <= 0) { idx = i; break; }
      }
      order.push(pool[idx].d);
      pool.splice(idx, 1);
    }
    return order;
  }

  /** Longest clear stretch (px) along `dir`, probed every half tile against
   *  the collision map and the playable-zone bounds. */
  private walkableDistance(dir: Direction, maxPx: number): number {
    const container = this.avatar.getContainer();
    const [dx, dy] = DIR_VECTORS[dir];
    const minX = (PLAYABLE_ZONE.col1 + 1) * TILE_SIZE;
    const maxX = (PLAYABLE_ZONE.col2 - 1) * TILE_SIZE;
    const minY = (PLAYABLE_ZONE.row1 + 1) * TILE_SIZE;
    const maxY = (PLAYABLE_ZONE.row2 - 1) * TILE_SIZE;

    const step = TILE_SIZE / 2;
    let free = 0;
    for (let d = step; d <= maxPx; d += step) {
      const px = container.x + dx * d;
      const py = container.y + dy * d;
      if (px < minX || px > maxX || py < minY || py > maxY) break;
      if (this.ctx.isBlocked(px, py)) break;
      free = d;
    }
    return free;
  }

  private startMove() {
    if (!this.scene?.sys?.isActive()) return;
    const container = this.avatar.getContainer();
    if (!container?.scene || !container.body) return;

    const strollPx = (2 + Math.floor(this.rng() * 3)) * TILE_SIZE; // 2-4 tiles

    // First candidate whose path is clear AND whose destination isn't
    // already packed; if everywhere is busy, take the least crowded option.
    let chosen: { dir: Direction; dist: number } | null = null;
    let leastCrowded: { dir: Direction; dist: number; density: number } | null = null;
    for (const dir of this.directionOrder()) {
      const dist = this.walkableDistance(dir, strollPx);
      if (dist < TILE_SIZE) continue; // needs at least one clear tile
      const [dx, dy] = DIR_VECTORS[dir];
      const density = this.ctx.countNear(
        container.x + dx * dist, container.y + dy * dist, CROWD_RADIUS,
      );
      if (density < CROWD_LIMIT) { chosen = { dir, dist }; break; }
      if (!leastCrowded || density < leastCrowded.density) {
        leastCrowded = { dir, dist, density };
      }
    }
    if (!chosen && leastCrowded) chosen = leastCrowded;
    if (!chosen) {
      // Boxed in on all four sides — wait a beat and try again.
      this.scheduleNextMove();
      return;
    }

    const [dx, dy] = DIR_VECTORS[chosen.dir];
    this.target = { x: container.x + dx * chosen.dist, y: container.y + dy * chosen.dist };
    this.walkVx = dx * this.speed;
    this.walkVy = dy * this.speed;
    (container.body as Phaser.Physics.Arcade.Body).setVelocity(this.walkVx, this.walkVy);
    this.lastDir = chosen.dir;
    this.avatar.walk(chosen.dir);
    this.isMoving = true;
    this.walkDeadline = this.scene.time.now + (chosen.dist / this.speed) * 1000 * 1.6 + 400;
  }

  /** Clean stop at (or near) the stroll target: idle facing the walk
   *  direction, then wait out the pause before the next stroll. */
  private arrive() {
    const container = this.avatar.getContainer();
    this.walkVx = 0;
    this.walkVy = 0;
    this.target = null;
    this.isMoving = false;
    if (container?.body) (container.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    this.showIdleFrame();
    this.scheduleNextMove();
  }

  /**
   * Halts this pedestrian because it touched another one. No push, no
   * momentum transfer — the walker simply stops where it is, waits out the
   * usual pause and picks a new direction. Stationary pedestrians only get
   * residual velocity (e.g. a shove that slid them into a neighbor) zeroed.
   */
  haltFromContact(): void {
    const container = this.avatar.getContainer();
    if (!container?.scene || !container.body) return;
    const body = container.body as Phaser.Physics.Arcade.Body;

    if (!this.isMoving) {
      body.setVelocity(0, 0);
      return;
    }
    this.arrive();
  }

  /** Resets the body velocity to the NPC's intended walk velocity (or 0 if idle),
   *  cancelling any impulse arcade physics applied during collision resolution. */
  cancelImpulse(): void {
    const container = this.avatar.getContainer();
    if (!container?.scene || !container.body) return;
    const body = container.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(this.walkVx, this.walkVy);
  }

  nudge(dx: number, dy: number): void {
    const now = this.scene.time.now;
    if (now - this.nudgeCooldown < 400) return;
    this.nudgeCooldown = now;

    const container = this.avatar.getContainer();
    if (!container?.scene || !container.body) return;
    const body = container.body as Phaser.Physics.Arcade.Body;
    body.reset(container.x + dx, container.y + dy);
  }

  updateDepth() { this.avatar.updateDepth(); }

  destroy() {
    this.moveTimer?.remove(false);
    this.scene.events.off("update", this.tick, this);
    this.avatar.destroy();
  }
}
