/**
 * Kite Clash MVP engine. Owns the canvas render loop, input, physics, wind,
 * scoring, and cut-attempt resolution. Talks to opponents only through
 * `OpponentKiteProvider` (types.ts) so a real-player provider can replace
 * `LocalAIOpponentProvider` later without touching this file.
 *
 * Visuals use the pixel-art assets from public/assets/minigames/kite
 * (see assets.ts). Each render helper keeps a primitive-drawing fallback
 * for frames before its image finishes loading.
 */
import type { OpponentKiteProvider, WindDirection, WindTier } from "./types";
import { LocalAIOpponentProvider } from "./LocalAIOpponentProvider";
import { loadKiteAssets, ready, type KiteAssets } from "./assets";
import {
  RIVAL_SKIN_COLOR,
  KITE_MOVE_SPEED,
  KITE_TILT_MAX_DEG,
  KITE_TILT_LERP,
  MIN_LINE_LENGTH,
  MAX_LINE_LENGTH,
  REEL_IN_RATE,
  LET_OUT_RATE,
  START_LINE_LENGTH,
  exposureFromLineLength,
  scoreRatePerSecond,
  CUT_SUCCESS_SCORE_BONUS,
  MULTIPLIER_STEPS,
  WIND_CHANGE_MIN_MS,
  WIND_CHANGE_MAX_MS,
  WIND_DRAG_BASE_PX_PER_SEC,
  windDragMultiplier,
  CUT_RESOLUTION_INTERVAL_MS,
  CUT_DEPTH_TOLERANCE,
  PLAYER_SKIN_COLOR,
  READY_OVERLAY_MS,
} from "./constants";

export type RunPhase = "ready" | "playing" | "ended";

export interface EngineSnapshot {
  phase: RunPhase;
  score: number;
  multiplier: number;
  lineLength: number;
  exposure: number;
  windTier: WindTier;
  windDirection: WindDirection;
  runNumber: number;
  cutMessage: string | null;
  /** A rival's line is close enough to attempt a cut — show the HUD hint. */
  nearbyOpponent: boolean;
  /** nearbyOpponent && currently holding the reel-in key — cut roll is actively ticking. */
  cutReady: boolean;
}

export interface KiteClashEngineCallbacks {
  onSnapshot: (snapshot: EngineSnapshot) => void;
}

interface Cloud {
  x: number;
  y: number;
  scale: number;
  speed: number;
  /** Index into KiteAssets.clouds — which sprite this cloud uses. */
  sprite: number;
}

interface CutVfx {
  x: number;
  y: number;
  ageMs: number;
  particles: { dx: number; dy: number; color: string }[];
}

const VFX_LIFETIME_MS = 500;

/** A kite whose line was just cut — drifts away with the wind, spinning,
 * with a short piece of line fluttering under it. Pure presentation. */
interface SeveredKite {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotationDeg: number;
  spinDegPerSec: number;
  scale: number;
  isPlayer: boolean;
  ageMs: number;
}

// ── Cut juice tuning (presentation only — no gameplay impact) ──────────────
const SEVERED_KITE_LIFETIME_MS = 2600;
const SEVERED_KITE_FADE_MS = 700;
const SLOWMO_SCALE_MINOR = 0.35;
const SLOWMO_SCALE_MAJOR = 0.25;
const SLOWMO_DURATION_MINOR_MS = 350;
const SLOWMO_DURATION_MAJOR_MS = 550;
const SHAKE_DURATION_MINOR_MS = 300;
const SHAKE_DURATION_MAJOR_MS = 450;
const SHAKE_MAGNITUDE_MINOR = 5;
const SHAKE_MAGNITUDE_MAJOR = 9;

export class KiteClashEngine {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private rafId: number | null = null;
  private lastTs = 0;
  private heldKeys = new Set<string>();
  private touchReelActive = false;
  private touchMove = { dx: 0, dy: 0 };

  private phase: RunPhase = "ready";
  private readyUntilMs = 0;
  private runNumber = 1;

  private playerPos = { x: 0, y: 0 };
  private playerTiltDeg = 0;
  private lineLength = START_LINE_LENGTH;
  private score = 0;
  private multiplierIdx = 0;
  private cutMessage: string | null = null;
  private cutMessageUntilMs = 0;

  private windTier: WindTier = "LOW";
  private windDirection: WindDirection = "right";
  private windChangeAtMs = 0;
  private elapsedMs = 0;

  /** Opponent whose LINE is actually crossing the player's line this frame
   * (at a similar depth — see CUT_DEPTH_TOLERANCE), if any. Drives the
   * crossing-point highlight, the HUD hint, and what a held-Space cut
   * attempt targets. The focus is the line crossing, not kite proximity. */
  private nearbyOpponentId: string | null = null;
  private crossingPoint: { x: number; y: number } | null = null;

  private cutResolveTimerMs = 0;
  private spoolAngle = 0;

  private clouds: Cloud[] = [];
  private cutVfx: CutVfx[] = [];
  private severedKites: SeveredKite[] = [];
  private assets: KiteAssets = loadKiteAssets();
  /** Sailboat drift position (world px, wraps around the screen). */
  private shipX = -40;

  // Cut juice state — driven by the REAL clock (this.lastTs), not the
  // scaled elapsedMs, so the slow-mo can't stretch its own duration.
  private timeScale = 1;
  private slowMoUntilTs = 0;
  private shakeUntilTs = 0;
  private shakeDurationMs = 1;
  private shakeMagnitude = 0;

  private opponents: OpponentKiteProvider;
  private callbacks: KiteClashEngineCallbacks;

  constructor(private canvas: HTMLCanvasElement, callbacks: KiteClashEngineCallbacks) {
    this.ctx = canvas.getContext("2d")!;
    this.callbacks = callbacks;
    this.opponents = new LocalAIOpponentProvider({ width: 1, height: 1 });
    this.resize();
    this.resetPlayer();
    this.seedClouds();

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Resizing the canvas resets context state — re-disable smoothing so
    // the pixel art stays crisp.
    this.ctx.imageSmoothingEnabled = false;
    if (this.opponents instanceof LocalAIOpponentProvider) {
      this.opponents.setSkyBounds({ width: this.width, height: this.height * 0.7 });
    }
  }

  start(): void {
    this.phase = "ready";
    this.readyUntilMs = READY_OVERLAY_MS;
    this.scheduleNextWindChange();
    this.lastTs = performance.now();
    this.loop(this.lastTs);
  }

  destroy(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  relaunch(): void {
    this.runNumber += 1;
    this.score = 0;
    this.multiplierIdx = 0;
    this.lineLength = START_LINE_LENGTH;
    this.cutMessage = null;
    this.nearbyOpponentId = null;
    this.crossingPoint = null;
    this.severedKites = [];
    this.cutVfx = [];
    this.timeScale = 1;
    this.slowMoUntilTs = 0;
    this.shakeUntilTs = 0;
    this.opponents = new LocalAIOpponentProvider({ width: this.width, height: this.height * 0.7 });
    this.resetPlayer();
    this.phase = "ready";
    this.readyUntilMs = this.elapsedMs + READY_OVERLAY_MS;
  }

  private resetPlayer(): void {
    this.playerPos = { x: this.width / 2, y: this.height * 0.35 };
    this.playerTiltDeg = 0;
  }

  private seedClouds(): void {
    this.clouds = Array.from({ length: 6 }, (_, i) => ({
      x: (i / 6) * (this.width || 800),
      y: 16 + Math.random() * 110,
      scale: 0.8 + Math.random() * 0.6,
      speed: 6 + Math.random() * 8,
      sprite: Math.floor(Math.random() * this.assets.clouds.length),
    }));
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.heldKeys.add(e.key.toLowerCase());
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.heldKeys.delete(e.key.toLowerCase());
  };

  /** Called by the touch REEL button in the React wrapper. */
  setTouchReel(active: boolean): void {
    this.touchReelActive = active;
  }

  /** Called by the touch joystick in the React wrapper (-1..1 each axis). */
  setTouchMove(dx: number, dy: number): void {
    this.touchMove = { dx, dy };
  }

  private isHoldingReelKey(): boolean {
    return this.touchReelActive || this.heldKeys.has(" ") || this.heldKeys.has("spacebar");
  }

  private scheduleNextWindChange(): void {
    const delay = WIND_CHANGE_MIN_MS + Math.random() * (WIND_CHANGE_MAX_MS - WIND_CHANGE_MIN_MS);
    this.windChangeAtMs = this.elapsedMs + delay;
  }

  private maybeChangeWind(): void {
    if (this.elapsedMs < this.windChangeAtMs) return;
    const tiers: WindTier[] = ["LOW", "MEDIUM", "HIGH"];
    this.windTier = tiers[Math.floor(Math.random() * tiers.length)];
    this.windDirection = Math.random() < 0.5 ? "left" : "right";
    this.scheduleNextWindChange();
  }

  private loop = (ts: number) => {
    const rawDt = Math.min(0.05, (ts - this.lastTs) / 1000);
    this.lastTs = ts;

    // Brief slow-motion right after a cut. Purely presentational: the whole
    // simulation slows uniformly for half a second, so relative behavior,
    // probabilities and scoring rates are unchanged.
    if (ts < this.slowMoUntilTs) {
      // timeScale was set by triggerCutJuice — hold it.
    } else if (this.timeScale < 1) {
      this.timeScale = Math.min(1, this.timeScale + rawDt * 3); // ease back to speed
    }
    const dt = rawDt * this.timeScale;
    this.elapsedMs += dt * 1000;

    this.update(dt);
    this.render();
    this.emitSnapshot();

    this.rafId = requestAnimationFrame(this.loop);
  };

  private update(dt: number): void {
    // Clouds and the sailboat drift regardless of run phase — keeps the
    // scene alive on the ready/end screens.
    for (const c of this.clouds) {
      c.x += c.speed * dt;
      if (c.x > this.width + 60) c.x = -60;
    }
    this.shipX += 5 * dt;
    if (this.shipX > this.width + 40) this.shipX = -40;
    for (const v of this.cutVfx) v.ageMs += dt * 1000;
    this.cutVfx = this.cutVfx.filter((v) => v.ageMs < VFX_LIFETIME_MS);

    // Severed kites tumble away with the wind: a small upward pop as the
    // line tension releases, then gravity and flutter take over.
    for (const k of this.severedKites) {
      k.ageMs += dt * 1000;
      k.vy += 55 * dt;
      k.x += k.vx * dt + Math.sin(k.ageMs / 180) * 30 * dt;
      k.y += k.vy * dt;
      k.rotationDeg += k.spinDegPerSec * dt;
    }
    this.severedKites = this.severedKites.filter((k) => k.ageMs < SEVERED_KITE_LIFETIME_MS);

    if (this.phase === "ready" && this.elapsedMs >= this.readyUntilMs) this.phase = "playing";
    if (this.phase !== "playing") {
      this.opponents.update(dt);
      return;
    }

    this.maybeChangeWind();

    // ── Movement (WASD/arrows OR touch joystick) ──
    let vx = this.touchMove.dx;
    let vy = this.touchMove.dy;
    if (this.heldKeys.has("a") || this.heldKeys.has("arrowleft")) vx -= 1;
    if (this.heldKeys.has("d") || this.heldKeys.has("arrowright")) vx += 1;
    if (this.heldKeys.has("w") || this.heldKeys.has("arrowup")) vy -= 1;
    if (this.heldKeys.has("s") || this.heldKeys.has("arrowdown")) vy += 1;
    vx = clamp(vx, -1, 1);
    vy = clamp(vy, -1, 1);

    const exposure = exposureFromLineLength(this.lineLength);

    // Wind drag, scaled by exposure — high exposure + high wind is hard to control.
    const windDrag = WIND_DRAG_BASE_PX_PER_SEC[this.windTier] * windDragMultiplier(exposure);
    const windSign = this.windDirection === "right" ? 1 : -1;
    vx += (windSign * windDrag) / KITE_MOVE_SPEED;

    this.playerPos.x += vx * KITE_MOVE_SPEED * dt;
    this.playerPos.y += vy * KITE_MOVE_SPEED * dt;

    const skyTop = this.height * 0.05;
    const skyBottom = this.height * 0.62;
    this.playerPos.x = clamp(this.playerPos.x, 30, this.width - 30);
    this.playerPos.y = clamp(this.playerPos.y, skyTop, skyBottom);

    const targetTilt = clamp(vx, -1, 1) * KITE_TILT_MAX_DEG;
    this.playerTiltDeg += (targetTilt - this.playerTiltDeg) * KITE_TILT_LERP;

    // ── Line length (Space held = reel in, released = let out) ──
    const reeling = this.isHoldingReelKey();
    this.lineLength += (reeling ? -REEL_IN_RATE : LET_OUT_RATE) * dt;
    this.lineLength = clamp(this.lineLength, MIN_LINE_LENGTH, MAX_LINE_LENGTH);
    this.spoolAngle += (reeling ? -1 : 1) * dt * 6;

    // ── Passive scoring ──
    this.score += scoreRatePerSecond(exposure) * this.currentMultiplier() * dt;

    // ── Opponent simulation ──
    this.opponents.update(dt);

    // ── Line-crossing check, once per frame. The focus is the LINE near
    // the kite, not the kite itself: two lines only meaningfully cross if
    // they're actually drawn crossing on screen AND the two kites are
    // flying at a similar depth (exposure) — a kite reeled in tight and
    // one let far out aren't really near each other even if their 2D
    // positions happen to overlap. ──
    const playerLine = this.playerLineSegment();
    const activeOpponents = this.opponents.getActiveOpponents();
    let nearbyId: string | null = null;
    let crossing: { x: number; y: number } | null = null;
    for (const o of activeOpponents) {
      if (Math.abs(o.exposure - exposure) > CUT_DEPTH_TOLERANCE) continue;
      const opponentLine = this.opponentLineSegment(o.position);
      const hit = segmentIntersection(playerLine[0], playerLine[1], opponentLine[0], opponentLine[1]);
      if (hit) {
        nearbyId = o.id;
        crossing = hit;
        break;
      }
    }
    this.nearbyOpponentId = nearbyId;
    this.crossingPoint = crossing;

    if (reeling && nearbyId) {
      this.cutResolveTimerMs += dt * 1000;
      if (this.cutResolveTimerMs >= CUT_RESOLUTION_INTERVAL_MS) {
        this.cutResolveTimerMs = 0;
        this.tryResolveCutAttempt(nearbyId, exposure);
      }
    } else {
      this.cutResolveTimerMs = 0;
    }

    const rivalOutcome = this.opponents.rollOpponentAttacksOnPlayer(exposure, !!nearbyId, dt);
    if (rivalOutcome === "success") {
      this.endRun("The rival cut your line!", this.crossingPoint ?? undefined);
    } else if (rivalOutcome === "backfire") {
      // The rival severed its own line — send its kite tumbling away.
      const rival = activeOpponents.find((o) => o.id === nearbyId);
      if (rival) {
        this.spawnSeveredKite(rival.position, rival.exposure, false);
        this.triggerCutJuice(this.crossingPoint ?? rival.position, false);
      }
      this.flashCutMessage("The rival cut its own line trying to cut yours!");
    }
  }

  private tryResolveCutAttempt(opponentId: string, playerExposure: number): void {
    // Capture the target's state BEFORE resolving — a successful cut kills
    // it inside the provider, and the severed-kite animation needs its
    // last position and exposure.
    const target = this.opponents.getActiveOpponents().find((o) => o.id === opponentId);
    const result = this.opponents.attemptCut(opponentId, playerExposure);
    // The cut happens to the LINE, at the crossing point — not at the kite.
    const vfxOrigin = this.crossingPoint ?? this.playerPos;
    if (result.outcome === "success") {
      this.score += result.scoreBonus;
      this.multiplierIdx = Math.min(this.multiplierIdx + 1, MULTIPLIER_STEPS.length - 1);
      if (target) this.spawnSeveredKite(target.position, target.exposure, false);
      this.triggerCutJuice(vfxOrigin, false);
      this.flashCutMessage(`Line cut! +${result.scoreBonus}`);
    } else if (result.outcome === "backfire") {
      this.endRun("Your own line was cut!", vfxOrigin);
    }
  }

  private currentMultiplier(): number {
    return MULTIPLIER_STEPS[this.multiplierIdx];
  }

  private flashCutMessage(text: string): void {
    this.cutMessage = text;
    this.cutMessageUntilMs = this.elapsedMs + 1800;
  }

  private endRun(reason: string, vfxOrigin?: { x: number; y: number }): void {
    this.phase = "ended";
    // The player's kite tumbles away with the wind — the normal player kite
    // stops being drawn during the "ended" phase, this replaces it.
    this.spawnSeveredKite(this.playerPos, exposureFromLineLength(this.lineLength), true);
    this.triggerCutJuice(vfxOrigin ?? this.playerPos, true);
    this.flashCutMessage(reason);
  }

  private spawnCutVfx(pos: { x: number; y: number }): void {
    const colors = ["#FFD700", "#FFFFFF", "#FFA94D"];
    const particles = Array.from({ length: 12 }, () => ({
      dx: (Math.random() - 0.5) * 110,
      dy: (Math.random() - 0.5) * 110,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));
    this.cutVfx.push({ x: pos.x, y: pos.y, ageMs: 0, particles });
  }

  /** One call bundles every presentation effect of a cut: snap VFX at the
   * crossing point, a short slow-motion beat and a screen shake. `major`
   * = the PLAYER's line was cut (bigger beat); minor = a rival's. */
  private triggerCutJuice(origin: { x: number; y: number }, major: boolean): void {
    this.spawnCutVfx(origin);
    this.timeScale = major ? SLOWMO_SCALE_MAJOR : SLOWMO_SCALE_MINOR;
    this.slowMoUntilTs = this.lastTs + (major ? SLOWMO_DURATION_MAJOR_MS : SLOWMO_DURATION_MINOR_MS);
    this.shakeDurationMs = major ? SHAKE_DURATION_MAJOR_MS : SHAKE_DURATION_MINOR_MS;
    this.shakeUntilTs = this.lastTs + this.shakeDurationMs;
    this.shakeMagnitude = major ? SHAKE_MAGNITUDE_MAJOR : SHAKE_MAGNITUDE_MINOR;
  }

  private spawnSeveredKite(pos: { x: number; y: number }, exposure: number, isPlayer: boolean): void {
    const windSign = this.windDirection === "right" ? 1 : -1;
    this.severedKites.push({
      x: pos.x,
      y: pos.y,
      vx: windSign * (60 + WIND_DRAG_BASE_PX_PER_SEC[this.windTier]),
      vy: -35, // small upward pop as the line tension releases
      rotationDeg: 0,
      spinDegPerSec: windSign * (150 + Math.random() * 120),
      scale: lerp(0.85, 0.34, exposure),
      isPlayer,
      ageMs: 0,
    });
  }

  private emitSnapshot(): void {
    if (this.cutMessage && this.elapsedMs > this.cutMessageUntilMs) this.cutMessage = null;
    this.callbacks.onSnapshot({
      phase: this.phase,
      score: Math.floor(this.score),
      multiplier: this.currentMultiplier(),
      lineLength: Math.round(this.lineLength),
      exposure: exposureFromLineLength(this.lineLength),
      windTier: this.windTier,
      windDirection: this.windDirection,
      runNumber: this.runNumber,
      cutMessage: this.cutMessage,
      nearbyOpponent: this.nearbyOpponentId !== null,
      cutReady: this.nearbyOpponentId !== null && this.isHoldingReelKey(),
    });
  }

  // ── Rendering — every block below is a PLACEHOLDER for Dom's pixel art ──

  private render(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // Screen shake — the whole scene jitters briefly after a cut, fading out.
    ctx.save();
    if (this.lastTs < this.shakeUntilTs) {
      const falloff = (this.shakeUntilTs - this.lastTs) / this.shakeDurationMs;
      ctx.translate(
        (Math.random() - 0.5) * 2 * this.shakeMagnitude * falloff,
        (Math.random() - 0.5) * 2 * this.shakeMagnitude * falloff,
      );
    }

    this.renderSky(ctx);
    this.renderClouds(ctx);
    this.renderSea(ctx);
    this.renderAmbientKites(ctx);

    const exposure = exposureFromLineLength(this.lineLength);
    const opponents = this.opponents.getActiveOpponents();
    for (const o of opponents) {
      // PLACEHOLDER — every rival kite also flies its own line, anchored
      // off-screen at a different point than the player's spool, so the
      // two lines visibly cross when the kites get close. This is the
      // "lines crossing" cue the cut mechanic is built around.
      this.renderOpponentLine(ctx, o.position);
    }
    this.renderLine(ctx, this.playerPos);
    for (const o of opponents) {
      this.renderKite(ctx, o.position, o.exposure, o.skinColor, 0, false);
    }
    // While the run is over, the player's kite exists only as the severed
    // one tumbling away — drawing both would duplicate it.
    if (this.phase !== "ended") {
      this.renderKite(ctx, this.playerPos, exposure, PLAYER_SKIN_COLOR, this.playerTiltDeg, true);
    }
    this.renderSeveredKites(ctx);
    // The cut targets the LINE near the kite, not the kite itself — the
    // highlight lives at the actual crossing point of the two lines.
    if (this.crossingPoint) this.renderCrossingHighlight(ctx, this.crossingPoint, this.isHoldingReelKey());

    this.renderCutVfx(ctx);
    this.renderRailing(ctx);
    this.renderHands(ctx);
    ctx.restore();
  }

  /** Cut kites drifting off with the wind, spinning, a short piece of
   * line fluttering under them — fading out near the end of their life. */
  private renderSeveredKites(ctx: CanvasRenderingContext2D): void {
    for (const k of this.severedKites) {
      const remaining = SEVERED_KITE_LIFETIME_MS - k.ageMs;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, remaining / SEVERED_KITE_FADE_MS));

      // Dangling stub of cut line, waving as the kite tumbles.
      const sway = Math.sin(k.ageMs / 150);
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(k.x, k.y);
      ctx.quadraticCurveTo(k.x - 16 * sway, k.y + 26, k.x + 12 * sway, k.y + 48);
      ctx.stroke();

      this.renderKite(
        ctx,
        { x: k.x, y: k.y },
        0,
        k.isPlayer ? PLAYER_SKIN_COLOR : RIVAL_SKIN_COLOR,
        k.rotationDeg,
        k.isPlayer,
        k.scale,
      );
      ctx.restore();
    }
  }

  /**
   * Layout of the cover-scaled background image: uniformly scaled to fill
   * the canvas, horizontally centered, bottom-anchored (the sea band matters
   * more than the sky top, which can crop on ultrawide screens).
   */
  private bgLayout(): { scale: number; dx: number; dy: number } {
    const iw = 704, ih = 384;
    const scale = Math.max(this.width / iw, this.height / ih);
    return {
      scale,
      dx: (this.width - iw * scale) / 2,
      dy: this.height - ih * scale,
    };
  }

  /** World y of the sky/sea line (y=236 in the 384px-tall background art). */
  private horizonY(): number {
    if (!ready(this.assets.background)) return this.height * 0.7;
    const { scale, dy } = this.bgLayout();
    return dy + 236 * scale;
  }

  private renderSky(ctx: CanvasRenderingContext2D): void {
    if (ready(this.assets.background)) {
      const { scale, dx, dy } = this.bgLayout();
      ctx.drawImage(this.assets.background, dx, dy, 704 * scale, 384 * scale);
      return;
    }
    // Fallback while the image loads: flat bands approximating the art.
    ctx.fillStyle = "#7ce0e8";
    ctx.fillRect(0, 0, this.width, this.height * 0.62);
    ctx.fillStyle = "#4b8de8";
    ctx.fillRect(0, this.height * 0.62, this.width, this.height * 0.38);
  }

  private renderClouds(ctx: CanvasRenderingContext2D): void {
    for (const c of this.clouds) {
      const sprite = this.assets.clouds[c.sprite];
      if (ready(sprite)) {
        const w = sprite.naturalWidth * c.scale;
        const h = sprite.naturalHeight * c.scale;
        ctx.drawImage(sprite, c.x - w / 2, c.y - h / 2, w, h);
      } else {
        // Fallback: soft ellipse cluster while the sprite loads.
        ctx.fillStyle = "rgba(255,255,255,0.65)";
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, 38 * c.scale, 16 * c.scale, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** Sea-band dressing: the little sailboat drifting across the horizon. */
  private renderSea(ctx: CanvasRenderingContext2D): void {
    const ship = this.assets.ship;
    if (!ready(ship)) return;
    const horizon = this.horizonY();
    ctx.drawImage(ship, this.shipX - 13, horizon + 8, 26, 36);
  }

  /** Railing strip along the bottom edge, with the seagull perched on it. */
  private renderRailing(ctx: CanvasRenderingContext2D): void {
    const border = this.assets.border;
    if (!ready(border)) return;
    const sc = Math.max(1, this.width / 704);
    const borderH = 28 * sc;
    ctx.drawImage(border, 0, this.height - borderH, 704 * sc, borderH);

    const bird = this.assets.bird;
    if (ready(bird)) {
      const bw = 72 * sc * 0.9;
      const bh = 76 * sc * 0.9;
      // Feet resting on top of the railing, off to the right like the concept.
      ctx.drawImage(bird, this.width * 0.86 - bw / 2, this.height - borderH - bh + 6 * sc, bw, bh);
    }
  }

  /** Small distant kites with no gameplay role, just atmosphere. */
  private renderAmbientKites(ctx: CanvasRenderingContext2D): void {
    const t = this.elapsedMs / 1000;
    const ambient = [
      { x: 0.16, y: 0.32, color: "#4ade80", scale: 0.28, speed: 0.6, player: true },
      { x: 0.42, y: 0.42, color: "#38bdf8", scale: 0.22, speed: 0.5, player: false },
      { x: 0.88, y: 0.38, color: "#a78bfa", scale: 0.25, speed: 0.45, player: false },
    ];
    for (const k of ambient) {
      const x = k.x * this.width + Math.sin(t * k.speed) * 14;
      const y = k.y * this.height + Math.cos(t * k.speed * 0.8) * 8;
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 18, y + this.height * 0.18);
      ctx.stroke();
      this.renderKite(ctx, { x, y }, 1, k.color, Math.sin(t * k.speed) * 8, k.player, k.scale);
    }
  }

  private renderKite(
    ctx: CanvasRenderingContext2D,
    pos: { x: number; y: number },
    exposure: number,
    color: string,
    tiltDeg: number,
    isPlayer: boolean,
    forcedScale?: number
  ): void {
    // Pixel-art kites: Brazil flag for the player, Solana for rivals.
    const sprite = isPlayer ? this.assets.kitePlayer : this.assets.kiteRival;
    if (ready(sprite)) {
      // reeled-in = bigger/foreground, let-out = smaller/background
      const s = forcedScale ?? lerp(0.85, 0.34, exposure);
      const w = 70 * s;
      const h = 112 * s;
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate((tiltDeg * Math.PI) / 180);
      ctx.drawImage(sprite, -w / 2, -h * 0.35, w, h);
      ctx.restore();
      return;
    }

    // Fallback while the sprite loads: diamond primitive.
    const scale = forcedScale ?? lerp(1.6, 0.6, exposure);
    const w = 26 * scale;
    const h = 34 * scale;

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate((tiltDeg * Math.PI) / 180);

    // Tail streamers — PLACEHOLDER for ribboned kite tails.
    ctx.strokeStyle = isPlayer ? "#FFD700" : "rgba(255,255,255,0.5)";
    ctx.lineWidth = Math.max(1, 1.5 * scale);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo((side * w) / 4, h / 2);
      ctx.quadraticCurveTo((side * w) / 2, h, (side * w) / 4, h * 1.4);
      ctx.stroke();
    }

    ctx.fillStyle = isPlayer ? "#2e9e4f" : color;
    ctx.strokeStyle = isPlayer ? "#FFD700" : "rgba(0,0,0,0.4)";
    ctx.lineWidth = isPlayer ? Math.max(2, 2.4 * scale) : 2;
    ctx.beginPath();
    ctx.moveTo(0, -h / 2);
    ctx.lineTo(w / 2, 0);
    ctx.lineTo(0, h / 2);
    ctx.lineTo(-w / 2, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (isPlayer) {
      // PLACEHOLDER — blue accent disc, standing in for the flag's globe emblem.
      ctx.fillStyle = "#2b5fae";
      ctx.beginPath();
      ctx.arc(0, 0, h * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /** Uniform scale for the first-person hands sprite (300x100 source). */
  private handsScale(): number {
    return Math.min(1.4, Math.max(0.9, this.width / 700));
  }

  /** The player's spool anchor point — shared by the line geometry used for
   * both rendering and the line-crossing cut check. Matches the spriter's
   * rope zone: X=50%, Y=34% of the hands sprite. */
  private playerLineAnchor(): { x: number; y: number } {
    if (ready(this.assets.hands)) {
      const hs = this.handsScale();
      const imgH = 100 * hs;
      return { x: this.width / 2, y: this.height - imgH + 0.34 * imgH };
    }
    const scale = Math.min(1.3, this.width / 900);
    return { x: this.width / 2, y: this.height + 10 - 64 * scale };
  }

  private playerLineSegment(): [{ x: number; y: number }, { x: number; y: number }] {
    return [this.playerLineAnchor(), this.playerPos];
  }

  /** A rival's off-screen anchor — different point than the player's own
   * spool so the two lines read as two separate kites/handlers, the same
   * geometry used to test whether the lines actually cross. */
  private opponentLineAnchor(kitePos: { x: number; y: number }): { x: number; y: number } {
    const anchorX = kitePos.x < this.width / 2 ? this.width * 0.12 : this.width * 0.88;
    return { x: anchorX, y: this.height + 20 };
  }

  private opponentLineSegment(kitePos: { x: number; y: number }): [{ x: number; y: number }, { x: number; y: number }] {
    return [this.opponentLineAnchor(kitePos), kitePos];
  }

  private renderLine(ctx: CanvasRenderingContext2D, kitePos: { x: number; y: number }): void {
    const anchor = this.playerLineAnchor();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(anchor.x, anchor.y);
    ctx.lineTo(kitePos.x, kitePos.y);
    ctx.stroke();
  }

  /** PLACEHOLDER — a rival's line, anchored off-screen below at the edge
   * rather than the player's own spool, so the two lines read as two
   * separate kites whose strings can visibly cross. */
  private renderOpponentLine(ctx: CanvasRenderingContext2D, kitePos: { x: number; y: number }): void {
    const anchor = this.opponentLineAnchor(kitePos);
    ctx.strokeStyle = "rgba(255,107,53,0.55)";
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(anchor.x, anchor.y);
    ctx.lineTo(kitePos.x, kitePos.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * Pulsing highlight drawn AT the point where the player's and a rival's
   * lines actually cross — the cut targets the line, not the kite, so the
   * feedback lives there instead of on either kite shape.
   */
  private renderCrossingHighlight(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }, active: boolean): void {
    const pulse = 0.7 + Math.sin(this.elapsedMs / 120) * 0.3;
    ctx.save();
    ctx.strokeStyle = active ? `rgba(255,215,0,${pulse})` : "rgba(255,255,255,0.7)";
    ctx.fillStyle = active ? `rgba(255,215,0,${pulse * 0.5})` : "rgba(255,255,255,0.25)";
    ctx.lineWidth = active ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, active ? 10 : 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private renderCutVfx(ctx: CanvasRenderingContext2D): void {
    for (const v of this.cutVfx) {
      const t = v.ageMs / VFX_LIFETIME_MS;
      ctx.globalAlpha = 1 - t;

      // Expanding snap ring at the exact point the line broke.
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 2.5 * (1 - t) + 0.5;
      ctx.beginPath();
      ctx.arc(v.x, v.y, 6 + t * 36, 0, Math.PI * 2);
      ctx.stroke();

      // Scattering sparks with a touch of gravity.
      for (const p of v.particles) {
        const x = v.x + p.dx * t;
        const y = v.y + p.dy * t + 50 * t * t;
        ctx.fillStyle = p.color;
        ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
      }
    }
    ctx.globalAlpha = 1;
  }

  private renderHands(ctx: CanvasRenderingContext2D): void {
    const hands = this.assets.hands;
    if (ready(hands)) {
      const hs = this.handsScale();
      const w = 300 * hs;
      const h = 100 * hs;
      ctx.drawImage(hands, this.width / 2 - w / 2, this.height - h, w, h);
      return;
    }

    // Fallback while the sprite loads: rounded rects + thread-wound spool.
    const cx = this.width / 2;
    const cy = this.height + 10;
    const scale = Math.min(1.3, this.width / 900);

    ctx.fillStyle = "#caa06f";
    roundRect(ctx, cx - 150 * scale, cy - 90 * scale, 96 * scale, 110 * scale, 22 * scale);
    roundRect(ctx, cx + 54 * scale, cy - 90 * scale, 96 * scale, 110 * scale, 22 * scale);
    ctx.fill();
    // Thumbs — small rounded caps overlapping the spool.
    ctx.beginPath();
    ctx.ellipse(cx - 60 * scale, cy - 60 * scale, 16 * scale, 22 * scale, 0.4, 0, Math.PI * 2);
    ctx.ellipse(cx + 60 * scale, cy - 60 * scale, 16 * scale, 22 * scale, -0.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(cx, cy - 64 * scale);
    ctx.fillStyle = "#9c6a36";
    roundRect(ctx, -48 * scale, -34 * scale, 96 * scale, 68 * scale, 14 * scale);
    ctx.fill();
    // Wound-thread bands — PLACEHOLDER for the spool's string texture; the
    // horizontal offset (driven by spoolAngle) sells the reel-in/out motion.
    ctx.strokeStyle = "#e8d9b8";
    ctx.lineWidth = 2.5 * scale;
    const bandOffset = (this.spoolAngle * 6) % (6 * scale);
    for (let x = -44 * scale + bandOffset; x < 44 * scale; x += 6 * scale) {
      ctx.beginPath();
      ctx.moveTo(x, -32 * scale);
      ctx.lineTo(x, 32 * scale);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ── helpers ──
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
/**
 * Standard segment-segment intersection (parametric form). Returns the
 * intersection point only if it falls within both segments — this is what
 * "the lines are crossing" means geometrically, not just "the kites are
 * close together."
 */
function segmentIntersection(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number }
): { x: number; y: number } | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-6) return null; // parallel
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
