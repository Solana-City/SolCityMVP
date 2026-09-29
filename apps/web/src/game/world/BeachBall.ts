/**
 * The football on the ST Brasil beach: one ball, every screen, kicked by hand.
 *
 * The ball is not an account. It is a SHARED SIMULATION seeded by kicks:
 * whoever kicks broadcasts the one moment that matters — where the ball was,
 * how fast it left, and when — and every other client runs the same fixed-step
 * physics from that snapshot. Rolling is free, only the kick costs a write,
 * and a ball that rolls for two seconds sends one message instead of a hundred
 * positions. The transport is the memo channel the city already uses for looks
 * and expressions (see OnChainMultiplayer.sendBallKick), so this needed no
 * program change and no new account.
 *
 * What that buys and what it costs:
 *   • Everyone sees the same roll, because the step, the friction and the
 *     stopping rule below are the only things that decide where it ends up.
 *   • A kick lands on other screens a beat late, so a receiver fast-forwards
 *     the simulation by however long the message took to arrive — the ball
 *     appears mid-roll where it should already be, not back at the kick.
 *   • Bounces off people are computed against each client's own view of where
 *     everyone is standing, which is never exactly the same. Screens drift a
 *     little between kicks; the next kick is an absolute snapshot, so every
 *     kick puts the city back in agreement.
 *
 * The wandering crowd (PedestrianManager) is deliberately NOT a collider. Each
 * browser walks its own citizens along its own random paths, so bouncing off
 * them would send the ball somewhere different on every screen and nothing
 * short of the next kick would ever reconcile it. Players and NPCs stand where
 * the chain and the registry say, so those are the bodies the ball hits.
 */
import * as Phaser from "phaser";
import { TILE_SIZE } from "../config/constants";
import type { Direction } from "../entities/SimpleSprite";

/** The one moment a kick has to carry for everyone to replay the roll. */
export interface BallKick {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Epoch ms the kick happened, by the kicker's clock. */
  t: number;
}

/**
 * Where the ball may go, in tiles: the ST Brasil sand from the grass edge in
 * the north, across the Copacabana promenade, down to the rocks in the south,
 * and out to where the sand meets the sea on both sides. Kicked at the edge
 * it stops on the line rather than sailing into the water.
 *
 * The sea and the rocks INSIDE that box are not this rectangle's problem —
 * they are solid tiles, and the ball stops on them the same way the player
 * does (see the `solid` probe the scene passes in).
 */
const ZONE_TILES = { left: 20, top: 58, right: 65, bottom: 93 };

const ZONE = {
  left:   ZONE_TILES.left * TILE_SIZE,
  top:    ZONE_TILES.top * TILE_SIZE,
  right:  (ZONE_TILES.right + 1) * TILE_SIZE,
  bottom: (ZONE_TILES.bottom + 1) * TILE_SIZE,
};

/**
 * Where the ball sits when nobody has touched it: the middle of the open sand
 * between the promenade and the south rocks (cols 37-57, rows 77-87 carry no
 * stand, no umbrella and no rock), so the first kick has room whichever way
 * it goes.
 */
const HOME = { x: 46 * TILE_SIZE + TILE_SIZE / 2, y: 81 * TILE_SIZE + TILE_SIZE / 2 };

/** Ball art: 19x19 per frame, 4 of them, drawn at world resolution. */
const TEXTURE_KEY = "beach-ball";
const TEXTURE_FILE = "assets/sprites/decor/ball_soccer.png";
const FRAME_SIZE = 19;
const FRAME_COUNT = 4;

/** Half the ball, in world pixels — what walls and people are measured against. */
const RADIUS = 8;
/** How close a person's centre has to be for the ball to touch them. */
const BODY_RADIUS = 7;

/**
 * The simulation. Every client runs these numbers and only these numbers, so
 * they are the contract — changing one desyncs anybody on the old build until
 * the next kick.
 */
const STEP_MS = 16;
const STEP_S = STEP_MS / 1000;
/** Fraction of its speed the ball keeps after one second of rolling. */
const FRICTION = 0.25;
const DECAY_PER_STEP = Math.pow(FRICTION, STEP_S);
/** Below this the ball has stopped; anything slower is a ball at rest. */
const STOP_SPEED = 8;
/** How much speed survives a bounce off a person. */
const BOUNCE = 0.7;
/** Never replay more than this much of a roll at once (a tab that was asleep). */
const MAX_CATCHUP_MS = 4_000;

/** A kick from standing next to it: E, SPACE, or the ACT button. */
const KICK_SPEED = 330;
/** A kick from simply walking into it. */
const NUDGE_SPEED = 190;
/** A walking player only picks the ball up again once it has slowed to this. */
const NUDGE_MAX_BALL_SPEED = 70;
/** Shortest gap between two kicks by the same player — one dribble touch. */
const KICK_COOLDOWN_MS = 350;
/** How near the player has to stand for the ACT kick to reach. */
const REACH = TILE_SIZE * 1.1;

const DIR_VECTORS: Record<Direction, { x: number; y: number }> = {
  up:    { x: 0, y: -1 },
  down:  { x: 0, y: 1 },
  left:  { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** Anything the ball can bounce off: a player's or an NPC's feet. */
export interface BallBody {
  x: number;
  y: number;
}

/** Call from BootScene.preload. */
export function preloadBeachBall(scene: Phaser.Scene): void {
  scene.load.spritesheet(TEXTURE_KEY, TEXTURE_FILE, {
    frameWidth: FRAME_SIZE,
    frameHeight: FRAME_SIZE,
  });
}

export class BeachBall {
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly trail: Phaser.GameObjects.Particles.ParticleEmitter | null;

  private x = HOME.x;
  private y = HOME.y;
  private vx = 0;
  private vy = 0;
  /** Epoch ms the state above is true for. The sim steps this up to now. */
  private simAt = Date.now();
  /** Leftover time from the last frame, so steps stay a fixed 16ms. */
  private carryMs = 0;
  private rolling = false;
  private lastKickAt = 0;
  private lastTrailAt = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    /** True when world pixel (x,y) is inside something solid. */
    private readonly solid: (wx: number, wy: number) => boolean,
    /** Called for every kick THIS client made, to broadcast to the city. */
    private readonly onKick: (kick: BallKick) => void,
  ) {
    if (!scene.anims.exists(`${TEXTURE_KEY}-roll`)) {
      scene.anims.create({
        key: `${TEXTURE_KEY}-roll`,
        frames: scene.anims.generateFrameNumbers(TEXTURE_KEY, { start: 0, end: FRAME_COUNT - 1 }),
        frameRate: 12,
        repeat: -1,
      });
    }
    this.settle();
    this.sprite = scene.add.sprite(this.x, this.y, TEXTURE_KEY, 0).setOrigin(0.5, 0.5);
    this.trail = this.createTrail();
    this.draw();
  }

  /** Where the ball is right now, for the scene's proximity prompt. */
  get position(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }

  /** The player is close enough to kick it where they stand. */
  isInReach(px: number, py: number): boolean {
    return Math.hypot(px - this.x, py - this.y) <= REACH + RADIUS;
  }

  /**
   * The deliberate kick: E, SPACE or ACT. Sends the ball the way the player is
   * facing, which is what a player who lined the shot up expects — a kick
   * aimed by the line from their feet to the ball turns a step to the side
   * into a shot backwards.
   *
   * Returns true when it connected, so the scene knows the key was used.
   */
  kick(px: number, py: number, facing: Direction): boolean {
    if (!this.isInReach(px, py)) return false;
    const dir = DIR_VECTORS[facing];
    return this.startKick(dir.x * KICK_SPEED, dir.y * KICK_SPEED);
  }

  /**
   * Advances the ball and lets the local player dribble it.
   *
   * `local` is the player this browser controls — the only body allowed to
   * START a kick, because every other client is broadcasting its own. Everyone
   * in `bodies` can still be bounced off.
   */
  update(local: { x: number; y: number; vx: number; vy: number } | null, bodies: BallBody[]): void {
    const now = Date.now();
    this.stepTo(now, bodies);
    if (local) this.tryNudge(local, now);
    this.draw();
  }

  /** A kick from another player: adopt it whole, then catch up to now. */
  applyRemoteKick(kick: BallKick): void {
    const now = Date.now();
    // A clock that runs ahead of ours would otherwise rewind the simulation.
    this.simAt = Math.min(kick.t, now);
    this.x = kick.x;
    this.y = kick.y;
    this.vx = kick.vx;
    this.vy = kick.vy;
    this.carryMs = 0;
    this.clampIntoZone();
    this.settle();
    this.stepTo(now, []);
    this.draw();
  }

  destroy(): void {
    this.sprite.destroy();
    this.trail?.destroy();
  }

  // ── Simulation ────────────────────────────────────────────────────────

  /**
   * Runs fixed 16ms steps up to `now`. Fixed, not per-frame: a 144Hz screen
   * and a 30fps phone have to integrate the same friction over the same roll
   * or the ball lands somewhere different on each.
   */
  private stepTo(now: number, bodies: BallBody[]): void {
    const elapsed = now - this.simAt;
    if (elapsed <= 0) return;
    // A backgrounded tab comes back owing minutes of simulation. Replaying it
    // all would burn a frame; the roll it missed was over long ago anyway, so
    // catch up over the last stretch and let the ball settle where it settles.
    const budget = Math.min(elapsed, MAX_CATCHUP_MS) + this.carryMs;
    this.simAt = now;
    let left = budget;
    while (left >= STEP_MS) {
      this.step(bodies);
      left -= STEP_MS;
    }
    this.carryMs = left;
  }

  private step(bodies: BallBody[]): void {
    if (this.vx === 0 && this.vy === 0) return;

    this.vx *= DECAY_PER_STEP;
    this.vy *= DECAY_PER_STEP;

    // One axis at a time, so a ball that meets a rock head on stops against it
    // and a ball that clips its corner keeps sliding along the face. A blocked
    // axis simply does not move — a step is at most six pixels, so "stopped at
    // the edge of the sand" and "stopped a step short of it" look the same,
    // and neither can push the ball inside the rock it just hit.
    const nx = this.x + this.vx * STEP_S;
    if (this.blocked(nx, this.y)) this.vx = 0; else this.x = nx;

    const ny = this.y + this.vy * STEP_S;
    if (this.blocked(this.x, ny)) this.vy = 0; else this.y = ny;

    for (const body of bodies) this.bounceOff(body);

    if (Math.hypot(this.vx, this.vy) < STOP_SPEED) {
      this.vx = 0;
      this.vy = 0;
    }
  }

  /** Outside the beach, or inside something solid. */
  private blocked(x: number, y: number): boolean {
    if (x - RADIUS < ZONE.left || x + RADIUS > ZONE.right) return true;
    if (y - RADIUS < ZONE.top || y + RADIUS > ZONE.bottom) return true;
    // Four points around the rim rather than the centre: a ball whose middle
    // is still on sand but whose side is in the wall has already hit it.
    return this.solid(x - RADIUS, y)
        || this.solid(x + RADIUS, y)
        || this.solid(x, y - RADIUS)
        || this.solid(x, y + RADIUS);
  }

  private limitX(x: number): number {
    return Phaser.Math.Clamp(x, ZONE.left + RADIUS, ZONE.right - RADIUS);
  }

  private limitY(y: number): number {
    return Phaser.Math.Clamp(y, ZONE.top + RADIUS, ZONE.bottom - RADIUS);
  }

  private clampIntoZone(): void {
    this.x = this.limitX(this.x);
    this.y = this.limitY(this.y);
  }

  /**
   * Puts the ball somewhere it can actually move from.
   *
   * A ball whose current spot is solid is a ball that never moves again: every
   * candidate step out of it reads as blocked, so it would sit inside a rock
   * for the rest of the session. That can happen if the map is re-exported
   * under its resting spot, or if a snapshot from a client with a different
   * map lands it in one. Rings outward a tile at a time and takes the first
   * free spot; if the whole neighbourhood is solid, it stays where it is and
   * waits for the next kick, which carries its own position.
   */
  private settle(): void {
    if (!this.blocked(this.x, this.y)) return;
    for (let ring = 1; ring <= 8; ring++) {
      const r = ring * TILE_SIZE;
      for (let a = 0; a < 16; a++) {
        const angle = (a / 16) * Math.PI * 2;
        const x = this.limitX(this.x + Math.cos(angle) * r);
        const y = this.limitY(this.y + Math.sin(angle) * r);
        if (!this.blocked(x, y)) { this.x = x; this.y = y; return; }
      }
    }
    console.warn("[BeachBall] no clear sand near the resting spot");
  }

  /** People are round walls: the ball comes off them rather than through. */
  private bounceOff(body: BallBody): void {
    const dx = this.x - body.x;
    const dy = this.y - body.y;
    const dist = Math.hypot(dx, dy);
    const touch = RADIUS + BODY_RADIUS;
    if (dist >= touch) return;

    // Dead centre gives no direction to come off along — send it back the way
    // it arrived, which is the only vector left that means anything.
    const speed = Math.hypot(this.vx, this.vy);
    let ux = dist > 0.01 ? dx / dist : (speed > 0.01 ? -this.vx / speed : 0);
    let uy = dist > 0.01 ? dy / dist : (speed > 0.01 ? -this.vy / speed : 1);
    if (ux === 0 && uy === 0) uy = 1;

    // Lift it clear first, so it cannot sit inside someone and bounce every step.
    const outX = body.x + ux * touch;
    const outY = body.y + uy * touch;
    if (!this.blocked(outX, outY)) {
      this.x = outX;
      this.y = outY;
    }

    const into = this.vx * ux + this.vy * uy;
    if (into >= 0) return; // already leaving — nothing to reflect
    this.vx = (this.vx - 2 * into * ux) * BOUNCE;
    this.vy = (this.vy - 2 * into * uy) * BOUNCE;
  }

  // ── Kicking ───────────────────────────────────────────────────────────

  /**
   * Walking into the ball moves it, so a player who never reads a key list
   * still finds the game. It only catches a ball that has slowed down, which
   * is also what spaces a dribble out into touches instead of a shove.
   */
  private tryNudge(local: { x: number; y: number; vx: number; vy: number }, now: number): void {
    const playerSpeed = Math.hypot(local.vx, local.vy);
    if (playerSpeed < 10) return;
    if (Math.hypot(this.vx, this.vy) > NUDGE_MAX_BALL_SPEED) return;
    if (Math.hypot(local.x - this.x, local.y - this.y) > RADIUS + BODY_RADIUS) return;
    if (now - this.lastKickAt < KICK_COOLDOWN_MS) return;
    this.startKick((local.vx / playerSpeed) * NUDGE_SPEED, (local.vy / playerSpeed) * NUDGE_SPEED);
  }

  /** Sets the ball going and tells the city, from a cooldown both share. */
  private startKick(vx: number, vy: number): boolean {
    const now = Date.now();
    if (now - this.lastKickAt < KICK_COOLDOWN_MS) return false;
    this.lastKickAt = now;
    this.simAt = now;
    this.carryMs = 0;
    this.vx = vx;
    this.vy = vy;
    // Rounded to whole pixels because that is what goes out on the wire — the
    // sender has to simulate the same numbers everyone else will read.
    this.x = Math.round(this.x);
    this.y = Math.round(this.y);
    this.vx = Math.round(this.vx);
    this.vy = Math.round(this.vy);
    this.onKick({ x: this.x, y: this.y, vx: this.vx, vy: this.vy, t: now });
    return true;
  }

  // ── Drawing ───────────────────────────────────────────────────────────

  private draw(): void {
    const speed = Math.hypot(this.vx, this.vy);
    const moving = speed > 0;

    this.sprite.setPosition(Math.round(this.x), Math.round(this.y));
    // Y-sorted off the sand it sits on, like every other standing object, so a
    // player walks in front of it from the south and behind it from the north.
    this.sprite.setDepth(this.y + RADIUS);

    if (moving && !this.rolling) {
      this.sprite.anims.play(`${TEXTURE_KEY}-roll`);
      this.rolling = true;
    } else if (!moving && this.rolling) {
      // A still ball is a still sprite: the sheet only turns while it rolls.
      this.sprite.anims.stop();
      this.sprite.setFrame(0);
      this.rolling = false;
    }
    if (moving) {
      // Spins as fast as it travels, so the slow-down reads in the art too.
      this.sprite.anims.timeScale = Phaser.Math.Clamp(speed / 160, 0.35, 2.4);
      // The sheet rolls one way; mirrored, it rolls the other. A ball kicked
      // left that spins to the right is the kind of thing nobody names and
      // everybody feels. Left alone on a straight vertical kick, where there
      // is no sideways spin to get wrong.
      if (Math.abs(this.vx) > 12) this.sprite.setFlipX(this.vx < 0);
      this.emitTrail(speed);
    }
  }

  /** A soft sand puff behind the ball — the footstep dust, for a football. */
  private createTrail(): Phaser.GameObjects.Particles.ParticleEmitter | null {
    if (!this.scene.textures.exists("ball-trail")) {
      const g = this.scene.add.graphics();
      // Warm and pale: kicked-up sand, not the grey dust of the pavement.
      g.fillStyle(0xf0e2c0, 1);
      g.fillCircle(2, 2, 2);
      g.generateTexture("ball-trail", 4, 4);
      g.destroy();
    }
    return this.scene.add.particles(0, 0, "ball-trail", {
      lifespan: 360,
      speed: { min: 2, max: 10 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.55, end: 0 },
      alpha: { start: 0.45, end: 0 },
      frequency: -1,
      emitting: false,
    });
  }

  private emitTrail(speed: number): void {
    if (!this.trail) return;
    // Behind the ball, and only while it is really travelling — the last
    // dawdling pixels of a roll should not still be throwing up sand.
    if (speed < 40) return;
    // Light, as asked: a puff every 30ms rather than one per frame, so the
    // trail reads the same on a 144Hz screen as on a phone at 30.
    const now = this.scene.time.now;
    if (now - this.lastTrailAt < 30) return;
    this.lastTrailAt = now;
    const bx = this.x - (this.vx / speed) * RADIUS;
    const by = this.y - (this.vy / speed) * RADIUS + 2;
    this.trail.setDepth(this.sprite.depth - 1);
    this.trail.emitParticleAt(bx, by, 1);
  }
}
