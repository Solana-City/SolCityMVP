/**
 * Pumpkin Carving: the canvas side. Owns the frame loop, the knife, the cuts,
 * the pieces and the candle; the React component owns the clock, the meter
 * and the result. Same split as KiteClashEngine.
 *
 * Input arrives in ART pixels. The knife tip chases the pointer at
 * KNIFE_SPEED, so the cut is made by the TIP, not by the pointer: rush and
 * the tip drags a straight chord across the corner you overshot.
 */
import { soundManager } from "@/game/audio/SoundManager";
import { ART, PATTERN, SHAPE_DONE, TOLERANCE, CarveScore, shapeMask, stepKnife, walkSegment } from "./pattern";
import {
  CUT_FLESH, CUT_SLIT, KNIFE_TIP,
  makeKnife, maskCanvas, paintGuide, paintHollows, paintPumpkin, paintReview, stampCut,
} from "./art";

export interface CarvingEvents {
  /** The first cut of a carve landed: start the clock. */
  onFirstCut?: () => void;
  /** A shape was cut all the way round and its piece popped out. */
  onShapeOpened?: (shape: number) => void;
}

interface Piece { img: HTMLCanvasElement; dx: number; dy: number; vx: number; vy: number }
interface Pulp { x: number; y: number; vx: number; vy: number; life: number; color: string }
type Point = { x: number; y: number };

/** Computed once: the masks never change. */
let MASKS: Uint8Array[] | null = null;
const masks = () => (MASKS ??= PATTERN.map(shapeMask));

/** Pulp flicked off the knife: one bit per this many art px of cut, capped. */
const PULP_EVERY = 3;
const PULP_MAX = 60;
const PULP_COLORS = ["#ffc272", "#ea7b2b", "#ffd88f"];
/** Gaps between the pieces Jack pops for you on a clean carve, and the candle's warm-up. */
const POP_STAGGER_MS = 170;
const LIGHT_UP_S = 0.7;
/** The candle's flicker is repainted at this pace: chunky, like the art. */
const FLICKER_MS = 90;
/** Half the side, in art px, of what the touch loupe magnifies. */
const LOUPE_RADIUS = 12;

function layer(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = ART;
  c.height = ART;
  return c;
}

function buzz(pattern: number | number[]): void {
  try { navigator.vibrate?.(pattern); } catch { /* not allowed here */ }
}

export class CarvingEngine {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly pumpkin = layer();
  private readonly guide = layer();
  private readonly flesh = layer();
  private readonly slit = layer();
  private readonly hollow = layer();
  private readonly reviewLayer = layer();
  private readonly knife = makeKnife();
  private readonly knifeOff = makeKnife(true);
  /** Cut points in a row that missed the line: two or more and the blade shows red. */
  private offLine = 0;
  private readonly maskImgs = masks().map(maskCanvas);

  private score = new CarveScore();
  private opened = PATTERN.map(() => false);
  /** True while cuts are accepted: before the first cut and during the carve. */
  private armed = true;
  private started = false;
  private pointer: Point | null = null;
  private pressing = false;
  private tip: Point | null = null;
  private pieces: Piece[] = [];
  private pulp: Pulp[] = [];
  private sincePulp = 0;
  private review = false;
  private popQueue: number[] = [];
  private nextPopAt = 0;
  private lit = false;
  private litLevel = 0;
  private lastFlicker = 0;
  private hollowDirty = true;
  /**
   * Something changed since the last paint. With nothing moving the loop
   * still ticks but paints nothing, so an idle pumpkin (the result screen, a
   * player reading the how-to) costs next to nothing on a phone.
   */
  private dirty = true;
  private raf = 0;
  private last = 0;
  private loupe: CanvasRenderingContext2D | null = null;

  constructor(canvas: HTMLCanvasElement, private readonly events: CarvingEvents = {}) {
    this.ctx = canvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false;
    paintPumpkin(this.pumpkin.getContext("2d")!);
    paintGuide(this.guide.getContext("2d")!, this.opened);
    this.flesh.getContext("2d")!.fillStyle = CUT_FLESH;
    this.slit.getContext("2d")!.fillStyle = CUT_SLIT;
    this.raf = requestAnimationFrame(this.frame);
  }

  /**
   * A finger hides the very line it is cutting, so on touch a magnified view
   * of what is under the knife tip is painted into this canvas while pressing.
   */
  setLoupe(canvas: HTMLCanvasElement | null): void {
    this.loupe = canvas?.getContext("2d") ?? null;
    if (this.loupe) this.loupe.imageSmoothingEnabled = false;
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
  }

  // ─── Input (art px) ────────────────────────────────────────────────────

  /** The pointer moved, pressed or not. Pressed, the knife chases it. */
  move(x: number, y: number): void {
    this.pointer = { x, y };
    this.dirty = true;
  }

  /** The pointer left the pumpkin without pressing: hide the knife. */
  leave(): void {
    if (!this.pressing) this.pointer = null;
    this.dirty = true;
  }

  press(x: number, y: number, pointerType: string): void {
    if (!this.armed) return;
    if (!this.started) {
      this.started = true;
      // The tolerance is fixed for the carve by what made its first cut.
      this.score = new CarveScore(pointerType === "mouse" ? TOLERANCE.mouse : TOLERANCE.touch);
      this.events.onFirstCut?.();
    }
    this.pressing = true;
    this.pointer = { x, y };
    this.tip = { x, y };
    this.cutAt(x, y);
  }

  release(): void {
    this.pressing = false;
    this.dirty = true;
  }

  // ─── Phases ────────────────────────────────────────────────────────────

  /** Ends the carve: no more cuts. The score is final from here. */
  stop(): CarveScore {
    this.armed = false;
    this.pressing = false;
    this.dirty = true;
    return this.score;
  }

  /** A clean carve: Jack pops whatever pieces are left, then the candle catches. */
  light(): void {
    this.popQueue = this.opened.map((o, i) => (o ? -1 : i)).filter((i) => i >= 0);
    this.nextPopAt = performance.now() + 200;
  }

  /** A botched carve: every slip and every stretch of line nobody cut, in red. */
  showReview(): void {
    paintReview(this.reviewLayer.getContext("2d")!, this.score);
    this.review = true;
    this.dirty = true;
  }

  /** A fresh pumpkin, same pattern. */
  reset(): void {
    for (const c of [this.flesh, this.slit, this.reviewLayer]) c.getContext("2d")!.clearRect(0, 0, ART, ART);
    this.score = new CarveScore();
    this.opened = PATTERN.map(() => false);
    paintGuide(this.guide.getContext("2d")!, this.opened);
    this.armed = true;
    this.started = false;
    this.offLine = 0;
    this.pressing = false;
    this.tip = null;
    this.pieces = [];
    this.pulp = [];
    this.review = false;
    this.popQueue = [];
    this.lit = false;
    this.litLevel = 0;
    this.hollowDirty = true;
    this.dirty = true;
  }

  /** Shapes popped out so far, for the progress row. */
  openedShapes(): readonly boolean[] {
    return this.opened;
  }

  // ─── Cutting ───────────────────────────────────────────────────────────

  private cutAt(x: number, y: number): void {
    stampCut(this.flesh.getContext("2d")!, this.slit.getContext("2d")!, x, y);
    this.offLine = this.score.add(x, y) ? 0 : this.offLine + 1;
    if (++this.sincePulp >= PULP_EVERY) {
      this.sincePulp = 0;
      if (this.pulp.length < PULP_MAX) {
        this.pulp.push({
          x, y,
          vx: (Math.random() - 0.5) * 70,
          vy: -30 - Math.random() * 50,
          life: 0.35 + Math.random() * 0.3,
          color: PULP_COLORS[(Math.random() * PULP_COLORS.length) | 0],
        });
      }
    }
  }

  private cutSegment(a: Point, b: Point): void {
    let skip = true; // the joint belongs to the previous segment
    walkSegment(a.x, a.y, b.x, b.y, (x, y) => {
      if (skip) { skip = false; return; }
      this.cutAt(x, y);
    });
    soundManager.playCarve();
    for (let s = 0; s < this.opened.length; s++) {
      if (!this.opened[s] && this.score.shapeCoverage(s) >= SHAPE_DONE) this.open(s, true);
    }
  }

  /** Pops a shape's piece out: it falls away and leaves the hole behind. */
  private open(s: number, byPlayer: boolean): void {
    this.opened[s] = true;
    const mask = this.maskImgs[s];
    // The piece is the skin inside the shape, with the cuts on it.
    const img = layer();
    const p = img.getContext("2d")!;
    p.drawImage(this.pumpkin, 0, 0);
    p.drawImage(this.flesh, 0, 0);
    p.drawImage(this.slit, 0, 0);
    p.globalCompositeOperation = "destination-in";
    p.drawImage(mask, 0, 0);
    this.pieces.push({ img, dx: 0, dy: 0, vx: (Math.random() - 0.5) * 40, vy: -45 - Math.random() * 20 });
    // Cuts inside the hole went with the piece.
    for (const c of [this.flesh, this.slit]) {
      const ctx = c.getContext("2d")!;
      ctx.globalCompositeOperation = "destination-out";
      ctx.drawImage(mask, 0, 0);
      ctx.globalCompositeOperation = "source-over";
    }
    paintGuide(this.guide.getContext("2d")!, this.opened);
    this.hollowDirty = true;
    soundManager.play("pop");
    if (byPlayer) buzz(15);
    this.events.onShapeOpened?.(s);
  }

  // ─── Frame ─────────────────────────────────────────────────────────────

  private frame = (now: number): void => {
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
    this.last = now;

    if (this.armed && this.pressing && this.tip && this.pointer) {
      const next = stepKnife(this.tip, this.pointer, dt);
      if (next.x !== this.tip.x || next.y !== this.tip.y) {
        this.cutSegment(this.tip, next);
        this.tip = next;
      }
    } else if (this.armed && this.pointer) {
      this.tip = this.pointer;
    }

    if (this.popQueue.length && now >= this.nextPopAt) {
      this.open(this.popQueue.shift()!, false);
      this.nextPopAt = now + POP_STAGGER_MS;
      if (!this.popQueue.length) {
        this.lit = true;
        soundManager.play("ignite");
      }
    }
    if (this.lit && this.litLevel < 1) {
      this.litLevel = Math.min(1, this.litLevel + dt / LIGHT_UP_S);
      this.hollowDirty = true;
    }

    for (const piece of this.pieces) {
      piece.vy += 300 * dt;
      piece.dx += piece.vx * dt;
      piece.dy += piece.vy * dt;
    }
    const animating = this.pressing || this.pieces.length > 0 || this.pulp.length > 0
      || this.popQueue.length > 0 || (this.litLevel > 0 && (this.litLevel < 1 || now - this.lastFlicker > FLICKER_MS));
    this.pieces = this.pieces.filter((piece) => piece.dy < ART);
    this.pulp = this.pulp.filter((p) => {
      p.vy += 160 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      return p.life > 0 && p.y < ART;
    });

    if (this.dirty || animating || this.hollowDirty) {
      this.dirty = false;
      this.paint(now);
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private paint(now: number): void {
    const ctx = this.ctx;
    if (this.litLevel > 0 && now - this.lastFlicker > FLICKER_MS) {
      this.lastFlicker = now;
      this.hollowDirty = true;
    }
    if (this.hollowDirty) {
      this.hollowDirty = false;
      const flicker = Math.sin(now * 0.011) * 0.5 + Math.sin(now * 0.029 + 1.3) * 0.35 + (Math.random() - 0.5) * 0.3;
      paintHollows(this.hollow.getContext("2d")!, masks(), this.opened, this.litLevel, flicker);
    }

    ctx.clearRect(0, 0, ART, ART);
    ctx.drawImage(this.pumpkin, 0, 0);
    ctx.drawImage(this.guide, 0, 0);
    ctx.drawImage(this.flesh, 0, 0);
    ctx.drawImage(this.slit, 0, 0);
    // Lights out: everything but the candle goes dark.
    if (this.litLevel > 0) {
      ctx.fillStyle = `rgba(6, 4, 14, ${0.55 * this.litLevel})`;
      ctx.fillRect(0, 0, ART, ART);
    }
    ctx.drawImage(this.hollow, 0, 0);
    if (this.review) ctx.drawImage(this.reviewLayer, 0, 0);
    for (const piece of this.pieces) ctx.drawImage(piece.img, Math.round(piece.dx), Math.round(piece.dy));
    for (const p of this.pulp) {
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.floor(p.x), Math.floor(p.y), 1, 1);
    }

    if (this.armed && this.tip) {
      // Where the pointer is when the heavy knife lags behind it.
      if (this.pressing && this.pointer && Math.hypot(this.pointer.x - this.tip.x, this.pointer.y - this.tip.y) > 2.5) {
        const px = Math.floor(this.pointer.x), py = Math.floor(this.pointer.y);
        ctx.fillStyle = "rgba(255, 241, 193, 0.8)";
        ctx.fillRect(px - 2, py, 1, 1); ctx.fillRect(px + 2, py, 1, 1);
        ctx.fillRect(px, py - 2, 1, 1); ctx.fillRect(px, py + 2, 1, 1);
      }
      const sprite = this.pressing && this.offLine >= 2 ? this.knifeOff : this.knife;
      ctx.drawImage(sprite, Math.round(this.tip.x) - KNIFE_TIP.x, Math.round(this.tip.y) - KNIFE_TIP.y);
    }

    if (this.loupe && this.pressing && this.tip) {
      const L = this.loupe.canvas.width;
      const r = LOUPE_RADIUS;
      this.loupe.fillStyle = "#0b1020";
      this.loupe.fillRect(0, 0, L, L);
      this.loupe.drawImage(ctx.canvas, Math.round(this.tip.x) - r, Math.round(this.tip.y) - r, r * 2, r * 2, 0, 0, L, L);
    }
  }
}
