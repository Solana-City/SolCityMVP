/**
 * Kite Clash MVP engine. Owns the canvas render loop, input, physics, wind,
 * scoring, and cut-attempt resolution. Talks to opponents only through
 * `OpponentKiteProvider` (types.ts) so a real-player provider can replace
 * `LocalAIOpponentProvider` later without touching this file.
 *
 * All visuals here are placeholder primitives (Graphics-style shapes drawn
 * straight to Canvas2D) — every PLACEHOLDER block is a drop-in swap point
 * for Dom's pixel art later.
 */
import type { OpponentKiteProvider, WindDirection, WindTier } from "./types";
import { LocalAIOpponentProvider } from "./LocalAIOpponentProvider";
import {
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
  CUT_OVERLAP_RANGE_PX,
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
}

export interface KiteClashEngineCallbacks {
  onSnapshot: (snapshot: EngineSnapshot) => void;
}

interface Cloud {
  x: number;
  y: number;
  scale: number;
  speed: number;
}

interface CutVfx {
  x: number;
  y: number;
  ageMs: number;
  particles: { dx: number; dy: number }[];
}

const VFX_LIFETIME_MS = 500;

export class KiteClashEngine {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private rafId: number | null = null;
  private lastTs = 0;
  private heldKeys = new Set<string>();

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

  private cutResolveTimerMs = 0;
  private spoolAngle = 0;

  private clouds: Cloud[] = [];
  private cutVfx: CutVfx[] = [];

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
    this.clouds = Array.from({ length: 5 }, (_, i) => ({
      x: (i / 5) * (this.width || 800),
      y: 20 + Math.random() * 80,
      scale: 0.7 + Math.random() * 0.8,
      speed: 6 + Math.random() * 8,
    }));
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.heldKeys.add(e.key.toLowerCase());
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.heldKeys.delete(e.key.toLowerCase());
  };

  private isHoldingReelKey(): boolean {
    return this.heldKeys.has(" ") || this.heldKeys.has("spacebar");
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
    const dt = Math.min(0.05, (ts - this.lastTs) / 1000);
    this.lastTs = ts;
    this.elapsedMs += dt * 1000;

    this.update(dt);
    this.render();
    this.emitSnapshot();

    this.rafId = requestAnimationFrame(this.loop);
  };

  private update(dt: number): void {
    // Clouds drift regardless of run phase — keeps the sky alive on the ready/end screens.
    for (const c of this.clouds) {
      c.x += c.speed * dt;
      if (c.x > this.width + 60) c.x = -60;
    }
    for (const v of this.cutVfx) v.ageMs += dt * 1000;
    this.cutVfx = this.cutVfx.filter((v) => v.ageMs < VFX_LIFETIME_MS);

    if (this.phase === "ready" && this.elapsedMs >= this.readyUntilMs) this.phase = "playing";
    if (this.phase !== "playing") {
      this.opponents.update(dt);
      return;
    }

    this.maybeChangeWind();

    // ── Movement (WASD/arrows) ──
    let vx = 0;
    let vy = 0;
    if (this.heldKeys.has("a") || this.heldKeys.has("arrowleft")) vx -= 1;
    if (this.heldKeys.has("d") || this.heldKeys.has("arrowright")) vx += 1;
    if (this.heldKeys.has("w") || this.heldKeys.has("arrowup")) vy -= 1;
    if (this.heldKeys.has("s") || this.heldKeys.has("arrowdown")) vy += 1;

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

    // ── Opponent simulation + cut resolution ──
    this.opponents.update(dt);

    if (reeling) {
      this.cutResolveTimerMs += dt * 1000;
      if (this.cutResolveTimerMs >= CUT_RESOLUTION_INTERVAL_MS) {
        this.cutResolveTimerMs = 0;
        this.tryResolveCutAttempt(exposure);
      }
    } else {
      this.cutResolveTimerMs = 0;
    }

    const rivalOutcome = this.opponents.rollOpponentAttacksOnPlayer(exposure);
    if (rivalOutcome === "success") {
      this.endRun("The rival cut your line!");
    } else if (rivalOutcome === "backfire") {
      this.flashCutMessage("The rival cut its own line!");
    }
  }

  private tryResolveCutAttempt(playerExposure: number): void {
    const overlapping = this.opponents
      .getActiveOpponents()
      .find((o) => distance(o.position, this.playerPos) <= CUT_OVERLAP_RANGE_PX);
    if (!overlapping) return;

    const result = this.opponents.attemptCut(overlapping.id, playerExposure);
    if (result.outcome === "success") {
      this.score += result.scoreBonus;
      this.multiplierIdx = Math.min(this.multiplierIdx + 1, MULTIPLIER_STEPS.length - 1);
      this.spawnCutVfx(overlapping.position);
      this.flashCutMessage(`Line cut! +${result.scoreBonus}`);
    } else if (result.outcome === "backfire") {
      this.endRun("Your own line was cut!");
    }
  }

  private currentMultiplier(): number {
    return MULTIPLIER_STEPS[this.multiplierIdx];
  }

  private flashCutMessage(text: string): void {
    this.cutMessage = text;
    this.cutMessageUntilMs = this.elapsedMs + 1800;
  }

  private endRun(reason: string): void {
    this.phase = "ended";
    this.spawnCutVfx(this.playerPos);
    this.flashCutMessage(reason);
  }

  private spawnCutVfx(pos: { x: number; y: number }): void {
    const particles = Array.from({ length: 8 }, () => ({
      dx: (Math.random() - 0.5) * 80,
      dy: (Math.random() - 0.5) * 80,
    }));
    this.cutVfx.push({ x: pos.x, y: pos.y, ageMs: 0, particles });
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
    });
  }

  // ── Rendering — every block below is a PLACEHOLDER for Dom's pixel art ──

  private render(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    this.renderSky(ctx);
    this.renderClouds(ctx);
    this.renderLandscape(ctx);
    this.renderAmbientKites(ctx);

    const exposure = exposureFromLineLength(this.lineLength);
    for (const o of this.opponents.getActiveOpponents()) {
      this.renderKite(ctx, o.position, o.exposure, o.skinColor, 0, false);
    }
    this.renderLine(ctx, this.playerPos);
    this.renderKite(ctx, this.playerPos, exposure, PLAYER_SKIN_COLOR, this.playerTiltDeg, true);

    this.renderCutVfx(ctx);
    this.renderHands(ctx);
  }

  private renderSky(ctx: CanvasRenderingContext2D): void {
    // PLACEHOLDER: swap for a proper time-of-day gradient art asset.
    // Matches the reference concept's dusk gradient — blue overhead fading
    // to a warm peach band near the horizon.
    const grad = ctx.createLinearGradient(0, 0, 0, this.height);
    grad.addColorStop(0, "#2a5f9e");
    grad.addColorStop(0.45, "#6fa3cf");
    grad.addColorStop(0.72, "#f3cfa0");
    grad.addColorStop(1, "#f6e0b8");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private renderClouds(ctx: CanvasRenderingContext2D): void {
    // PLACEHOLDER: soft ellipse clusters standing in for pixel-art cloud sprites.
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    for (const c of this.clouds) {
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, 38 * c.scale, 16 * c.scale, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x + 24 * c.scale, c.y + 4, 26 * c.scale, 12 * c.scale, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x - 22 * c.scale, c.y + 5, 20 * c.scale, 10 * c.scale, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private renderLandscape(ctx: CanvasRenderingContext2D): void {
    // PLACEHOLDER for Dom's final backdrop art. The reference concept image
    // is a layout/positioning guide only — not the final art direction —
    // so these named shapes exist to mark WHERE each landmark sits, not
    // to lock in its exact look:
    const horizon = this.height * 0.7;

    // PLACEHOLDER — Corcovado mountain + Christ the Redeemer silhouette (left-of-center).
    ctx.fillStyle = "#4a6b55";
    ctx.beginPath();
    ctx.moveTo(this.width * 0.08, horizon);
    ctx.lineTo(this.width * 0.22, horizon - 95);
    ctx.lineTo(this.width * 0.27, horizon - 30);
    ctx.lineTo(this.width * 0.36, horizon);
    ctx.closePath();
    ctx.fill();
    // Tiny statue silhouette on the peak — PLACEHOLDER for the Christ statue.
    ctx.fillRect(this.width * 0.22 - 1.5, horizon - 112, 3, 18);
    ctx.fillRect(this.width * 0.22 - 7, horizon - 104, 14, 3);

    // PLACEHOLDER — Sugarloaf Mountain silhouette (right-of-center).
    ctx.fillStyle = "#3f5e4d";
    ctx.beginPath();
    ctx.ellipse(this.width * 0.74, horizon - 6, this.width * 0.085, 60, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(this.width * 0.74 - 4, horizon - 6, 8, 8);

    // PLACEHOLDER — city skyline silhouette, mid layer.
    ctx.fillStyle = "#33495f";
    for (let i = 0; i < 14; i++) {
      const bw = this.width / 14;
      const bh = 22 + ((i * 31) % 38);
      ctx.fillRect(this.width * 0.32 + i * bw * 0.5, horizon - bh, bw * 0.4, bh);
    }

    // PLACEHOLDER — river band, winding through the jungle.
    ctx.fillStyle = "#9fc9d6";
    ctx.beginPath();
    ctx.moveTo(this.width * 0.35, horizon);
    ctx.quadraticCurveTo(this.width * 0.5, horizon + 16, this.width * 0.65, horizon);
    ctx.lineTo(this.width, horizon + 6);
    ctx.lineTo(this.width, this.height);
    ctx.lineTo(0, this.height);
    ctx.lineTo(0, horizon + 10);
    ctx.closePath();
    ctx.fill();

    // PLACEHOLDER — jungle/palm foliage silhouettes framing the bottom corners.
    ctx.fillStyle = "#27462f";
    ctx.beginPath();
    ctx.ellipse(this.width * 0.06, this.height * 0.92, 90, 50, 0, 0, Math.PI * 2);
    ctx.ellipse(this.width * 0.97, this.height * 0.94, 100, 55, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /** PLACEHOLDER — small distant kites with no gameplay role, just atmosphere
   * matching the reference's scattered background kites. Swap for sprites
   * with the same lightweight "decorative only" treatment. */
  private renderAmbientKites(ctx: CanvasRenderingContext2D): void {
    const t = this.elapsedMs / 1000;
    const ambient = [
      { x: 0.16, y: 0.32, color: "#4ade80", scale: 0.4, speed: 0.6 },
      { x: 0.42, y: 0.42, color: "#38bdf8", scale: 0.32, speed: 0.5 },
      { x: 0.88, y: 0.38, color: "#a78bfa", scale: 0.36, speed: 0.45 },
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
      this.renderKite(ctx, { x, y }, 1, k.color, Math.sin(t * k.speed) * 8, false, k.scale);
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
    // PLACEHOLDER: diamond primitive standing in for Dom's pixel-art kite.
    // The player's kite uses a Brazilian-flag-inspired palette (green body,
    // yellow border, blue accent disc) to match the reference concept —
    // swap the whole shape for the real sprite, palette included.
    const scale = forcedScale ?? lerp(1.6, 0.6, exposure); // reeled-in = bigger/foreground, let-out = smaller/background
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

  private renderLine(ctx: CanvasRenderingContext2D, kitePos: { x: number; y: number }): void {
    const scale = Math.min(1.3, this.width / 900);
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(this.width / 2, this.height + 10 - 64 * scale);
    ctx.lineTo(kitePos.x, kitePos.y);
    ctx.stroke();
  }

  private renderCutVfx(ctx: CanvasRenderingContext2D): void {
    // PLACEHOLDER: scattering squares standing in for a real "snap" VFX.
    for (const v of this.cutVfx) {
      const t = v.ageMs / VFX_LIFETIME_MS;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = "#FFD700";
      for (const p of v.particles) {
        const x = v.x + p.dx * t;
        const y = v.y + p.dy * t;
        ctx.fillRect(x - 3, y - 3, 6, 6);
      }
    }
    ctx.globalAlpha = 1;
  }

  private renderHands(ctx: CanvasRenderingContext2D): void {
    // PLACEHOLDER: rounded rects + a rotating, thread-wound cylinder
    // standing in for first-person pixel-art hands holding a spool.
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
function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
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
