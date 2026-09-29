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
 * A kick is not WAITED for, though, or the ball would sit still for as long
 * as the rollup takes to answer. The only way to kick is to walk into the
 * ball, which means a kick is CAUSED by something every client can already
 * see: a body arriving at the ball. So each client starts the roll itself,
 * the instant a player it is drawing touches the ball, whoever that player
 * is — and the kick that comes back over the chain is a correction, not the
 * starting gun. Predict, then reconcile, the way the remote avatars already
 * walk toward a predicted point rather than being tweened between samples.
 *
 * The correction is eased in rather than applied: the simulation jumps to the
 * authoritative snapshot, and the SPRITE keeps an offset that decays over
 * about a sixth of a second, so a prediction that was slightly off slides
 * into line instead of popping. A prediction that was right has no offset to
 * decay and nothing shows at all.
 *
 * What that buys and what it costs:
 *   • Everyone sees the same roll, because the step, the friction and the
 *     stopping rule below are the only things that decide where it ends up.
 *   • Bounces off people are computed against each client's own view of where
 *     everyone is standing, which is never exactly the same. Screens drift a
 *     little between kicks; the next kick is an absolute snapshot, so every
 *     kick puts the city back in agreement.
 *   • A predicted kick that never actually happened (the kicker's own client
 *     was inside its cooldown, say) leaves this screen wrong until the next
 *     real kick. Same contract: the next snapshot settles it.
 *
 * The wandering crowd (PedestrianManager) is deliberately NOT a collider. Each
 * browser walks its own citizens along its own random paths, so bouncing off
 * them would send the ball somewhere different on every screen and nothing
 * short of the next kick would ever reconcile it. Players and NPCs are in the
 * same place everywhere — the chain says where a player is, and an NPC's
 * wander is a function of the wall clock (see NPCSprite.targetForStep) — so
 * those are the bodies the ball hits. Only PLAYERS may kick it: an NPC
 * drifting into the ball would start a roll nobody else agreed to.
 */
import * as Phaser from "phaser";
import { TILE_SIZE } from "../config/constants";

/** The one moment a kick has to carry for everyone to replay the roll. */
export interface BallKick {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /**
   * Bumped on every kick by the client that sent it. It is NOT a clock and
   * means nothing across players: it exists so a receiver can tell two kicks
   * apart, because the on-chain field they arrive in is stamped in whole
   * seconds and a dribble puts three kicks inside one of them.
   */
  seq: number;
}

/**
 * The kick rides the city's chat field on the ER, tagged, exactly like a
 * Stocklana trade (see chat/tradeBroadcast) — that is the one channel that is
 * actually live cross-device today, read off the same 500ms player poll.
 *
 * Deliberately NO timestamp on the wire. Two phones do not agree on the time,
 * and a kick replayed from a clock that is a minute out lands the ball a
 * minute's worth of friction away from where the kicker sees it. The roll is
 * started from the RECEIVER's clock instead, one assumed hop late — and since
 * where the ball finally stops is decided by the snapshot rather than by the
 * timing, everybody ends up agreeing on the resting place either way.
 */
export const BALL_TAG = "§ball:";

export function encodeBallKick(kick: BallKick): string {
  return BALL_TAG + [kick.x, kick.y, kick.vx, kick.vy, kick.seq].map(Math.round).join(":");
}

/** Parses a chat line; null when it isn't a (valid) ball tag. */
export function decodeBallKick(text: string): BallKick | null {
  if (!text.startsWith(BALL_TAG)) return null;
  const parts = text.slice(BALL_TAG.length).split(":").map(Number);
  if (parts.length !== 5 || !parts.every(Number.isFinite)) return null;
  const [x, y, vx, vy, seq] = parts;
  return { x, y, vx, vy, seq };
}

/**
 * The outer box the ball can never leave, in tiles. It is a backstop, not the
 * boundary: the real edge is the painted sand itself, which the scene hands
 * over as `onBeach` (every tile of the SandSea and Copacabana promenade
 * layers). A rectangle alone let the ball roll out onto the coast road at the
 * north-west corner, where the sand stops well short of the box.
 *
 * The sea and the rocks INSIDE the sand are not this box's problem either —
 * they are solid tiles, and the ball stops on them the same way the player
 * does (see the `solid` probe the scene passes in).
 */
const ZONE_TILES = { left: 5, top: 56, right: 67, bottom: 103 };

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

/** Ball art: 19x19 per frame, 4 of them. */
const TEXTURE_KEY = "beach-ball";
const TEXTURE_FILE = "assets/sprites/decor/ball_soccer.png";
const FRAME_SIZE = 19;
const FRAME_COUNT = 4;
/**
 * Drawn at the same scale as every character sheet in the city (0.5), which
 * is what keeps a source pixel a whole number of screen pixels at the zooms
 * the ladder offers — see config/zoomConfig. Half the size it shipped at:
 * a football beside a person, rather than a beach ball.
 */
const SCALE = 0.5;

/** Half the ball, in world pixels — what walls and people are measured against. */
const RADIUS = 5;
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
/**
 * How far into the roll a kick from someone else is assumed to already be
 * when it reaches us: one hop to the rollup and one poll back. A constant,
 * not a measurement, because the alternative is trusting the sender's clock
 * — and getting that wrong by a minute is far worse than getting this wrong
 * by a fraction of a second, which only shifts where the roll is picked up.
 */
const REMOTE_LAG_MS = 400;

/** A kick, which is to say walking into it. */
const NUDGE_SPEED = 190;
/** A walking player only picks the ball up again once it has slowed to this. */
const NUDGE_MAX_BALL_SPEED = 70;
/** Shortest gap between two kicks — one dribble touch. */
const KICK_COOLDOWN_MS = 350;
/** Under this a body counts as standing still and cannot kick anything. */
const MIN_KICK_SPEED = 10;

/**
 * How long the sprite has to slide back into line after a correction, and the
 * per-step decay that gets it there (0.74^10 ≈ 0.05, so it is over in about a
 * sixth of a second).
 */
const OFFSET_DECAY_PER_STEP = 0.74;
/** Below this the offset is spent; above it a correction is not worth easing. */
const OFFSET_MIN_PX = 0.3;
const OFFSET_MAX_PX = 64;
/** A kick nothing here saw coming, so it is worth a sound. */
const SURPRISE_MS = 600;

/** Anything the ball can bounce off: a player's or an NPC's feet. */
export interface BallBody {
  x: number;
  y: number;
  /** How fast it is travelling, px/s. Absent or still = it cannot kick. */
  vx?: number;
  vy?: number;
  /** A PLAYER, so it may start a roll. NPCs are walls, never kickers. */
  kicks?: boolean;
  /** The player THIS browser drives, whose kicks go out to the city. */
  local?: boolean;
}

/**
 * The layers that paint the ST Brasil beach: the sand itself and the
 * Copacabana promenade that runs along it. Whatever they cover IS the pitch,
 * so the ball's boundary follows the artist's brush rather than a rectangle
 * somebody measured off a screenshot — which is what let it roll onto the
 * coast road where the sand stops early.
 */
const BEACH_LAYERS: ReadonlySet<string> = new Set(["SandSea", "SidewalkCopacabana"]);

/**
 * Bakes those layers into one bitmask of tiles, for the `onBeach` probe.
 *
 * Read from the created layers, BEFORE the scene merges the flat ground into
 * combined layers and bakes it into textures — after that pass, the sand no
 * longer exists as a layer anyone can ask about by name. Every client builds
 * this from the same map file, so every client agrees on where the ball may
 * go, which the shared simulation depends on.
 */
export function buildBeachMask(
  layers: Phaser.Tilemaps.TilemapLayer[],
  map: Phaser.Tilemaps.Tilemap,
): (wx: number, wy: number) => boolean {
  const w = map.width;
  const h = map.height;
  const mask = new Uint8Array(w * h);
  let painted = 0;
  for (const l of layers) {
    const name = l.layer.name;
    if (!BEACH_LAYERS.has(name.slice(name.lastIndexOf("/") + 1))) continue;
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        if (mask[ty * w + tx]) continue;
        // World coordinates, not layer-local: BootScene crops every layer to
        // what it paints, so a layer's own grid starts at an offset.
        const tile = l.getTileAtWorldXY(
          tx * TILE_SIZE + TILE_SIZE / 2, ty * TILE_SIZE + TILE_SIZE / 2);
        if (tile && tile.index > 0) { mask[ty * w + tx] = 1; painted++; }
      }
    }
  }
  if (painted === 0) {
    // No sand found — a renamed layer, or a map export without it. Better a
    // ball loose on the backstop rectangle than a ball that cannot move.
    console.warn("[BeachBall] no beach layers found; falling back to the outer box");
    return () => true;
  }
  console.log(`[BeachBall] beach is ${painted.toLocaleString()} tiles`);
  return (wx, wy) => {
    const tx = Math.floor(wx / TILE_SIZE);
    const ty = Math.floor(wy / TILE_SIZE);
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return false;
    return mask[ty * w + tx] === 1;
  };
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
  /** Bumped on each kick we send, so receivers can tell two apart (see BallKick). */
  private seq = 0;
  /** A kick has been played as it happened, so the ball is no longer "as loaded". */
  private seenLiveKick = false;
  /**
   * How far the SPRITE still is from the simulation, and shrinking. Set when a
   * correction lands, so the drawn ball slides into its corrected place over a
   * few frames rather than jumping there. Cosmetic only: nothing about the
   * shared simulation reads it, so it cannot pull two screens apart.
   */
  private offX = 0;
  private offY = 0;
  /** Chain seconds of the best remembered touch adopted so far (see applyRemoteKick). */
  private bestStaleAt = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    /** True when world pixel (x,y) is inside something solid. */
    private readonly solid: (wx: number, wy: number) => boolean,
    /** True when world pixel (x,y) is on the ST Brasil sand or its promenade. */
    private readonly onBeach: (wx: number, wy: number) => boolean,
    /**
     * Called for every kick this client STARTED, predicted ones included.
     * `mine` says whether it was the local player who kicked, which is the
     * only case the city needs to hear about — a predicted kick is another
     * player's, and their own client is already broadcasting it.
     */
    private readonly onKick: (kick: BallKick, mine: boolean) => void,
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
    this.sprite = scene.add.sprite(this.x, this.y, TEXTURE_KEY, 0).setOrigin(0.5, 0.5).setScale(SCALE);
    this.trail = this.createTrail();
    this.draw();
  }

  /** Where the ball is right now, for the scene to find bodies near it. */
  get position(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }

  /**
   * Advances the ball, bounces it off everybody, and lets anybody who can
   * kick, kick.
   *
   * Every player in `bodies` may start a roll, not just the local one. A kick
   * is caused by a body arriving at the ball, and that arrival is on screen
   * here at the same time it is on the kicker's screen — so waiting for the
   * chain to say so would only add the round trip back. The local player's
   * kick goes out to the city; everyone else's is a prediction that the real
   * kick will confirm or correct a moment later.
   */
  update(bodies: BallBody[]): void {
    const now = Date.now();
    this.stepTo(now, bodies);
    // The local player first: their input is real where everyone else's is
    // inferred, so if two bodies reach the ball on the same frame the one
    // holding the keyboard is the one that gets the touch.
    for (const body of bodies) if (body.local) this.tryNudge(body, now);
    for (const body of bodies) if (body.kicks && !body.local) this.tryNudge(body, now);
    this.draw();
  }

  /**
   * Where the ball is DRAWN: the simulation plus whatever a recent correction
   * is still easing off. Physics and proximity use the simulation itself
   * (`this.x`/`this.y`), which is the part every client agrees on.
   */
  private shown(): { x: number; y: number } {
    return { x: this.x + this.offX, y: this.y + this.offY };
  }

  /**
   * A kick from another player: adopt it whole, then catch up to now.
   *
   * `stale` is a kick read off a PDA on first sight rather than as it
   * happened — the last touch the city remembers, which may be minutes old.
   * It is taken only while this client has seen no kick at all, which is what
   * puts a player who just walked in on the same ball as everybody else
   * instead of on the one that has not moved since the page loaded.
   */
  applyRemoteKick(kick: BallKick, stale = false, staleAt = 0): boolean {
    if (stale) {
      // A touch that actually happened always beats a remembered one.
      if (this.seenLiveKick) return false;
      // Several players can each be carrying their own last touch. They are
      // ordered by the chain's own seconds, which is the one clock every
      // device agrees on, so the newest remembered touch wins.
      if (staleAt <= this.bestStaleAt) return false;
      this.bestStaleAt = staleAt;
    } else {
      this.seenLiveKick = true;
    }
    const now = Date.now();
    // Nothing here saw this coming, so the scene should make a noise about it.
    // A kick this client predicted is not a surprise: it already thudded when
    // the kicker's foot arrived, and a second thud now would be an echo.
    const surprising = !stale && now - this.lastKickAt > SURPRISE_MS;
    // Where the ball is DRAWN right now, kept so the correction below can be
    // eased in from it instead of teleporting the sprite.
    const from = this.shown();
    // Started a hop into the roll, on OUR clock — see BALL_TAG on why the
    // sender's clock is not on the wire. A stale kick is replayed in full, so
    // the ball lands where that touch left it and simply is not seen moving.
    this.simAt = now - (stale ? MAX_CATCHUP_MS : REMOTE_LAG_MS);
    this.x = kick.x;
    this.y = kick.y;
    this.vx = kick.vx;
    this.vy = kick.vy;
    this.carryMs = 0;
    this.clampIntoZone();
    this.settle();
    this.stepTo(now, []);
    // Hand the sprite the gap it has to close. A correction bigger than a
    // couple of tiles is not a nudge that was slightly off, it is a different
    // ball — joining a session, or a prediction that never happened — and
    // sliding the length of the beach would look far worse than a cut.
    const dx = from.x - this.x;
    const dy = from.y - this.y;
    const eased = Math.hypot(dx, dy) <= OFFSET_MAX_PX;
    this.offX = eased ? dx : 0;
    this.offY = eased ? dy : 0;
    this.draw();
    return surprising;
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
      // Alongside the simulation, never inside it: the offset is what the
      // sprite is lagging by, and it has to shrink in real time whether the
      // ball is rolling or has already stopped.
      if (this.offX !== 0 || this.offY !== 0) {
        this.offX *= OFFSET_DECAY_PER_STEP;
        this.offY *= OFFSET_DECAY_PER_STEP;
        if (Math.hypot(this.offX, this.offY) < OFFSET_MIN_PX) { this.offX = 0; this.offY = 0; }
      }
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

  /** Off the sand, or inside something solid. */
  private blocked(x: number, y: number): boolean {
    if (x - RADIUS < ZONE.left || x + RADIUS > ZONE.right) return true;
    if (y - RADIUS < ZONE.top || y + RADIUS > ZONE.bottom) return true;
    // Tested at the rim, not just the middle: the whole ball has to be on the
    // sand, so it comes to rest a hair inside the painted edge instead of
    // hanging half of itself over the coast road.
    if (!this.onBeach(x, y)
      || !this.onBeach(x - RADIUS, y) || !this.onBeach(x + RADIUS, y)
      || !this.onBeach(x, y - RADIUS) || !this.onBeach(x, y + RADIUS)) return true;
    // Walls, the same four points: a ball whose middle is still on sand but
    // whose side is in the wall has already hit it.
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
   * A body walking into the ball moves it. Walking into it is the ONLY way to
   * kick, which is what makes the kick predictable on every screen: there is
   * no button press to guess at, just a body arriving somewhere everybody can
   * already see it arrive.
   *
   * It only catches a ball that has slowed down, which is also what spaces a
   * dribble out into touches instead of one long shove.
   */
  private tryNudge(body: BallBody, now: number): void {
    const speed = Math.hypot(body.vx ?? 0, body.vy ?? 0);
    if (speed < MIN_KICK_SPEED) return;
    if (Math.hypot(this.vx, this.vy) > NUDGE_MAX_BALL_SPEED) return;
    if (Math.hypot(body.x - this.x, body.y - this.y) > RADIUS + BODY_RADIUS) return;
    if (now - this.lastKickAt < KICK_COOLDOWN_MS) return;
    this.startKick(
      ((body.vx ?? 0) / speed) * NUDGE_SPEED,
      ((body.vy ?? 0) / speed) * NUDGE_SPEED,
      body.local === true,
    );
  }

  /**
   * Sets the ball going and tells the scene, from a cooldown every body
   * shares — one touch at a time, whoever it belongs to.
   */
  private startKick(vx: number, vy: number, mine: boolean): boolean {
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
    this.seenLiveKick = true;
    this.seq = (this.seq + 1) % 1000;
    this.onKick({ x: this.x, y: this.y, vx: this.vx, vy: this.vy, seq: this.seq }, mine);
    return true;
  }

  // ── Drawing ───────────────────────────────────────────────────────────

  private draw(): void {
    const speed = Math.hypot(this.vx, this.vy);
    const moving = speed > 0;

    // Drawn at the simulation plus whatever a recent correction is still
    // easing off, so the sprite slides into line instead of popping there.
    const at = this.shown();
    this.sprite.setPosition(Math.round(at.x), Math.round(at.y));
    // Y-sorted off the sand it sits on, like every other standing object, so a
    // player walks in front of it from the south and behind it from the north.
    this.sprite.setDepth(at.y + RADIUS);

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
      scale: { start: 0.4, end: 0 },
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
    const at = this.shown();
    const bx = at.x - (this.vx / speed) * RADIUS;
    const by = at.y - (this.vy / speed) * RADIUS + 2;
    this.trail.setDepth(this.sprite.depth - 1);
    this.trail.emitParticleAt(bx, by, 1);
  }
}
