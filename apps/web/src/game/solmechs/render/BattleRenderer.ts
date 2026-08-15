/**
 * Sol Mechs — battle scene renderer.
 *
 * Draws the two mechs facing each other in the sidescroller layout the Unity
 * battle scene used, and stages the aftermath of an action as a timed
 * sequence.
 *
 * ## Why a timeline
 *
 * The engine resolves a whole action at once and hands back its events in one
 * array — attack, damage, part destroyed, stage change. Playing those
 * simultaneously reads as a single confusing frame: the mech lunges, the
 * number pops and the limb explodes on the same tick, and the player cannot
 * tell what caused what.
 *
 * So `playEvents` compiles the array into cues with start times: the attacker
 * winds up, the impact effect lands ON the struck limb at the peak of the
 * lunge, the number and shake follow the hit, and a destroyed part detonates
 * after that. `isBusy()` reports while a sequence is running so the UI can
 * hold input until it finishes.
 *
 * The renderer still decides nothing about the fight. It is fed resolved
 * state and a resolved event log, so a dropped or skipped animation can never
 * desync a battle — which matters once actions arrive over a network.
 */
import type { BattleEvent, PlayerSide } from "../engine/BattleEngine";
import { drawMech, DOLL_WIDTH, DOLL_HEIGHT, slotAnchor } from "./MechPaperDoll";
import type { MechBuild, MechUnit, ModuleSlot, MoveDefinition } from "../data/types";
import { fxForMove, fxForStage, fxFrame, clipDuration, preloadFx, statBadge, FX_DESTROY, type FxClip } from "./AttackFx";

export interface RenderUnits {
  p1: MechUnit;
  p2: MechUnit;
}

export const CANVAS_W = 640;
/**
 * Taller than the mechs strictly need, so the arena backdrop's crowd and
 * skyline read instead of being cropped down to the platform.
 */
export const CANVAS_H = 360;

/**
 * The arena art (BattleSceneSprites/arena.png) imported at 640 wide. It is
 * drawn bottom-aligned, so the canvas shows its lower portion: crowd, rails
 * and the neon platform the mechs stand on.
 */
const ARENA_SRC = "/assets/minigames/sol-mechs/ui/arena.png";
const ARENA_W = 640;
const ARENA_H = 557;

const MECH_SCALE = 2;
const MECH_W = DOLL_WIDTH * MECH_SCALE;
const MECH_H = DOLL_HEIGHT * MECH_SCALE;
/** Lands the mechs' feet on the platform in the backdrop, not on a flat line. */
const GROUND_Y = 300;
const P1_X = 58;
const P2_X = CANVAS_W - 58 - MECH_W;

// ── timing (ms) ──────────────────────────────────────────────────────────
/** Lunge start → impact. The effect and the damage land at this offset. */
const WINDUP = 240;
/** How long the attacker's lunge takes end to end. */
const LUNGE = 460;
/** Impact → a destroyed limb detonating, so the two read as cause and effect. */
const BREAK_DELAY = 260;
/** Held at the peak of the lunge, so a hit lands with weight. */
const HITSTOP = 90;
const FLASH_DURATION = 300;
/**
 * Damage numbers stay up long enough to actually be read — they were gone
 * before the eye finished moving to them. They keep drifting the whole time
 * but only fade over the last stretch, so most of their life is at full
 * opacity.
 */
const FLOATER_DURATION = 1900;
/** Fraction of a floater's life spent fading out at the end. */
const FLOATER_FADE = 0.35;
const SHAKE_DURATION = 260;
/** How long a stat-stage badge sits over the affected limb. */
const BADGE_DURATION = 1100;
/**
 * Tail after the last cue before input is handed back. Deliberately shorter
 * than a floater's life: the numbers linger over the next action rather than
 * making the player wait for them.
 */
const SEQUENCE_TAIL = 260;

interface Anim {
  start: number;
  side: PlayerSide;
}

interface LungeAnim extends Anim {
  /** Peak hold, so the mech freezes for a beat on contact. */
  hitstop: boolean;
}

interface FxAnim {
  start: number;
  clip: FxClip;
  /** Canvas-space centre, resolved when the cue was scheduled. */
  x: number;
  y: number;
  scale: number;
}

interface Floater {
  start: number;
  x: number;
  y: number;
  text: string;
  color: string;
  /** Larger for heavier hits and for a destroyed part. */
  size: number;
}

interface Shake {
  start: number;
  magnitude: number;
}

/** A single-frame stat icon (ATK_Up, DEF_Down, …) popped over a limb. */
interface Badge {
  start: number;
  img: HTMLImageElement;
  x: number;
  y: number;
}

export class BattleRenderer {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private state: RenderUnits;
  private lunges: LungeAnim[] = [];
  private flashes: Anim[] = [];
  private fx: FxAnim[] = [];
  private floaters: Floater[] = [];
  private shakes: Shake[] = [];
  private badges: Badge[] = [];
  private running = false;
  /** performance.now() when the current sequence hands input back. */
  private busyUntil = 0;
  private arena = new Image();

  constructor(private canvas: HTMLCanvasElement, initial: RenderUnits) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    this.state = initial;
    this.arena.src = ARENA_SRC;
    preloadFx();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      this.draw(performance.now());
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  setState(state: RenderUnits): void {
    this.state = state;
  }

  /** True while a sequence is still playing — the UI gates input on this. */
  isBusy(): boolean {
    return performance.now() < this.busyUntil;
  }

  /** ms until the current sequence finishes; 0 when idle. */
  remainingMs(): number {
    return Math.max(0, this.busyUntil - performance.now());
  }

  // ── positioning ────────────────────────────────────────────────────────

  private unitFor(side: PlayerSide): MechUnit {
    return side === "p1" ? this.state.p1 : this.state.p2;
  }

  private baseX(side: PlayerSide): number {
    return side === "p1" ? P1_X : P2_X;
  }

  /**
   * Canvas-space centre of one slot on one mech.
   *
   * Player 2 is drawn mirrored, so its doll-space x has to be reflected about
   * the doll box before scaling — otherwise every effect aimed at the rival's
   * right arm lands on its left.
   */
  private anchorOf(side: PlayerSide, slot: ModuleSlot): { x: number; y: number } {
    const a = slotAnchor(slot);
    const flipped = side === "p2";
    const dx = flipped ? DOLL_WIDTH - a.x : a.x;
    return {
      x: this.baseX(side) + dx * MECH_SCALE,
      y: GROUND_Y - MECH_H + a.y * MECH_SCALE,
    };
  }

  // ── sequencing ─────────────────────────────────────────────────────────

  /**
   * Compile one action's events into a timed sequence.
   *
   * Walks the log in the order the engine emitted it and assigns each cue an
   * absolute start time, so effects land in causal order rather than all at
   * once.
   */
  playEvents(events: BattleEvent[], move?: MoveDefinition): void {
    // `last` tracks when the ACTION is done, which gates input. Floaters are
    // excluded on purpose: they outlive the sequence so the numbers stay
    // readable into the next turn instead of holding the player up.
    const now = performance.now();
    let impactAt = now + WINDUP;
    let last = now;

    for (const e of events) {
      switch (e.type) {
        case "attack": {
          this.lunges.push({ start: now, side: e.side, hitstop: true });
          // The clip is chosen from the move when the caller knows it; the
          // event only carries a name, and matching on that alone would miss
          // the four moves the Unity library never covered.
          const clip = move ? fxForMove(move) : undefined;
          if (clip) {
            // Self-buffs play on the caster; everything else waits for the
            // impact cue below, where the struck slot is known.
            if (move && move.targetType === "self") {
              const at = this.anchorOf(e.side, e.sourceSlot);
              this.fx.push({ start: impactAt, clip, x: at.x, y: at.y, scale: 1 });
              last = Math.max(last, impactAt + clipDuration(clip));
            }
          }
          last = Math.max(last, now + LUNGE);
          break;
        }

        case "damage": {
          const at = this.anchorOf(e.side, e.targetSlot);
          if (move && move.targetType !== "self") {
            const clip = fxForMove(move);
            this.fx.push({ start: impactAt, clip, x: at.x, y: at.y, scale: 1 });
            last = Math.max(last, impactAt + clipDuration(clip));
          }
          this.flashes.push({ start: impactAt, side: e.side });
          // Shake scales with how much of that part just went, so a chip and
          // a near-kill don't feel the same.
          this.shakes.push({ start: impactAt, magnitude: 2 + Math.min(9, e.percent / 9) });
          this.floaters.push({
            start: impactAt, x: at.x, y: at.y,
            text: `-${e.amount}`, color: "#ff5468",
            size: e.percent > 45 ? 26 : e.percent > 20 ? 21 : 17,
          });
          break;
        }

        case "heal": {
          const at = this.anchorOf(e.side, e.targetSlot);
          this.floaters.push({
            start: impactAt, x: at.x, y: at.y,
            text: `+${e.amount}`, color: "#21dda0", size: 20,
          });
          last = Math.max(last, impactAt + 200);
          break;
        }

        case "stage": {
          const at = this.anchorOf(e.side, e.targetSlot);
          // Offset from the damage cue so a hit that also debuffs reads as two
          // beats instead of one pile-up.
          const stageAt = impactAt + 140;
          // Unity's per-stat badge says WHICH stat moved; the animated arrow is
          // only a fallback for a stat with no icon.
          const badge = statBadge(e.stat, e.delta);
          if (badge) {
            this.badges.push({ start: stageAt, img: badge, x: at.x, y: at.y - 6 });
            last = Math.max(last, stageAt + BADGE_DURATION);
          } else {
            const clip = fxForStage(e.delta);
            this.fx.push({ start: stageAt, clip, x: at.x, y: at.y, scale: 0.85 });
            last = Math.max(last, stageAt + clipDuration(clip));
          }
          break;
        }

        case "part-broken": {
          const at = this.anchorOf(e.side, e.slot);
          const breakAt = impactAt + BREAK_DELAY;
          this.fx.push({ start: breakAt, clip: FX_DESTROY, x: at.x, y: at.y, scale: 1.15 });
          this.shakes.push({ start: breakAt, magnitude: 13 });
          this.floaters.push({
            start: breakAt + 120, x: at.x, y: at.y - 20,
            text: "DESTROYED", color: "#ffd166", size: 15,
          });
          last = Math.max(last, breakAt + clipDuration(FX_DESTROY) + 300);
          break;
        }

        case "matrix-unlocked": {
          const at = this.anchorOf(e.side, "matrix");
          const openAt = impactAt + BREAK_DELAY + 220;
          this.floaters.push({
            start: openAt, x: at.x, y: at.y - 26,
            text: "MATRIX EXPOSED", color: "#ff5468", size: 16,
          });
          last = Math.max(last, openAt + 200);
          break;
        }
      }
    }

    this.busyUntil = Math.max(this.busyUntil, last + SEQUENCE_TAIL);
  }

  // ── drawing ────────────────────────────────────────────────────────────

  private draw(now: number): void {
    const ctx = this.ctx;

    this.lunges = this.lunges.filter((a) => now - a.start < LUNGE);
    this.flashes = this.flashes.filter((f) => now - f.start < FLASH_DURATION);
    this.fx = this.fx.filter((f) => now - f.start < clipDuration(f.clip));
    this.floaters = this.floaters.filter((f) => now - f.start < FLOATER_DURATION);
    this.shakes = this.shakes.filter((s) => now - s.start < SHAKE_DURATION);
    this.badges = this.badges.filter((b) => now - b.start < BADGE_DURATION);

    // Screen shake displaces the whole scene, so it has to wrap every draw.
    let sx = 0, sy = 0;
    for (const s of this.shakes) {
      const t = (now - s.start) / SHAKE_DURATION;
      if (t < 0) continue;
      const decay = (1 - t) ** 2;
      // Alternating sign per frame reads as a rattle rather than a drift.
      sx += Math.sin((now - s.start) * 0.9) * s.magnitude * decay;
      sy += Math.cos((now - s.start) * 1.1) * s.magnitude * decay * 0.5;
    }

    ctx.save();
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    this.drawBackground(ctx);
    ctx.translate(sx, sy);

    for (const side of ["p1", "p2"] as PlayerSide[]) this.drawSide(ctx, side, now);
    this.drawFx(ctx, now);
    this.drawBadges(ctx, now);
    this.drawFloaters(ctx, now);
    ctx.restore();
  }

  private drawBackground(ctx: CanvasRenderingContext2D): void {
    const arena = this.arena;
    if (arena.complete && arena.naturalWidth > 0) {
      // Bottom-aligned: the platform belongs at the foot of the frame, and
      // whatever skyline fits above it is a bonus.
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(arena, 0, CANVAS_H - ARENA_H, ARENA_W, ARENA_H);
      return;
    }
    // Backdrop still decoding — the old gradient keeps the scene readable
    // rather than flashing empty on the first frame.
    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    sky.addColorStop(0, "#120a24");
    sky.addColorStop(0.55, "#231145");
    sky.addColorStop(1, "#0d0718");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = "#1b1030";
    ctx.fillRect(0, GROUND_Y, CANVAS_W, CANVAS_H - GROUND_Y);
  }

  /**
   * Lunge offset for a side.
   *
   * Eases out to the impact point, holds there for HITSTOP so contact has
   * weight, then eases back. A plain sine would sail through the moment of
   * impact and rob it of the pause.
   */
  private lungeOffset(anim: LungeAnim, now: number): number {
    const t = now - anim.start;
    const dir = anim.side === "p1" ? 1 : -1;
    const reach = 26;
    if (t < WINDUP) {
      const p = t / WINDUP;
      return dir * reach * (1 - (1 - p) ** 3);
    }
    if (anim.hitstop && t < WINDUP + HITSTOP) return dir * reach;
    const p = Math.min(1, (t - WINDUP - HITSTOP) / (LUNGE - WINDUP - HITSTOP));
    return dir * reach * (1 - p);
  }

  private drawSide(ctx: CanvasRenderingContext2D, side: PlayerSide, now: number): void {
    const unit = this.unitFor(side);
    const baseX = this.baseX(side);
    const y = GROUND_Y - MECH_H;

    let dx = 0;
    const lunge = this.lunges.find((a) => a.side === side && now >= a.start);
    if (lunge) dx += this.lungeOffset(lunge, now);

    const flash = this.flashes.find((f) => f.side === side && now >= f.start);
    if (flash) {
      const t = (now - flash.start) / FLASH_DURATION;
      dx += Math.sin(t * Math.PI) * 9 * (side === "p1" ? -1 : 1);
    }
    const hitFlash = flash ? 1 - (now - flash.start) / FLASH_DURATION : 0;

    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.ellipse(baseX + MECH_W / 2, GROUND_Y + 2, MECH_W * 0.3, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const drawn = drawMech(ctx, unit.build, {
      x: baseX + dx,
      y,
      scale: MECH_SCALE,
      flip: side === "p2",
      hitFlash,
      brokenSlots: {
        rightArm: unit.partStatuses.rightArm.currentHP <= 0,
        leftArm: unit.partStatuses.leftArm.currentHP <= 0,
        lowerBody: unit.partStatuses.lowerBody.currentHP <= 0,
      },
    });

    if (!drawn) {
      ctx.save();
      ctx.fillStyle = "#2a1c4d";
      ctx.fillRect(baseX, y, MECH_W, MECH_H);
      ctx.fillStyle = "#7a68a8";
      ctx.font = "12px monospace";
      ctx.textAlign = "center";
      ctx.fillText(unit.matrix.matrixName, baseX + MECH_W / 2, y + MECH_H / 2);
      ctx.restore();
    }
  }

  private drawFx(ctx: CanvasRenderingContext2D, now: number): void {
    for (const f of this.fx) {
      const t = now - f.start;
      if (t < 0) continue;
      const frame = Math.min(f.clip.frames, Math.floor((t / 1000) * f.clip.fps) + 1);
      const img = fxFrame(f.clip, frame);
      if (!img.complete || img.naturalWidth === 0) continue;

      const h = f.clip.size * f.scale;
      const w = h * (img.naturalWidth / img.naturalHeight);

      ctx.save();
      ctx.imageSmoothingEnabled = false;
      // Additive suits the energy/plasma clips — it reads as emitted light.
      // The impact clips keep normal blending so they stay solid and readable
      // against the bright mechs.
      if (f.clip.additive) ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(img, Math.round(f.x - w / 2), Math.round(f.y - h / 2), Math.round(w), Math.round(h));
      ctx.restore();
    }
  }

  private drawBadges(ctx: CanvasRenderingContext2D, now: number): void {
    for (const b of this.badges) {
      const t = (now - b.start) / BADGE_DURATION;
      if (t < 0 || !b.img.complete || b.img.naturalWidth === 0) continue;
      // Pops in, drifts up a little, fades over the last third.
      const pop = t < 0.12 ? 0.5 + (t / 0.12) * 0.5 : 1;
      const size = 34 * pop;
      const y = b.y - t * 16;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = t > 0.66 ? Math.max(0, (1 - t) / 0.34) : 1;
      ctx.drawImage(b.img, Math.round(b.x - size / 2), Math.round(y - size / 2), Math.round(size), Math.round(size));
      ctx.restore();
    }
  }

  private drawFloaters(ctx: CanvasRenderingContext2D, now: number): void {
    ctx.save();
    ctx.textAlign = "center";
    for (const f of this.floaters) {
      const t = (now - f.start) / FLOATER_DURATION;
      if (t < 0) continue;

      // Pops slightly oversized then settles — a flat rise reads as inert.
      const pop = t < 0.07 ? 1 + (0.07 - t) * 4.8 : 1;
      // Rises fast at first and then eases almost to a stop, so the number
      // hangs where it can be read instead of sliding away at constant speed.
      const rise = 1 - (1 - t) ** 3;
      const y = f.y - 16 - rise * 52;
      // Full opacity for most of its life, fading only at the tail.
      const fadeFrom = 1 - FLOATER_FADE;
      ctx.globalAlpha = t > fadeFrom ? Math.max(0, (1 - t) / FLOATER_FADE) : 1;

      ctx.font = `bold ${Math.round(f.size * pop)}px ui-monospace, monospace`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,.85)";
      ctx.strokeText(f.text, f.x, y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, y);
    }
    ctx.restore();
  }
}
