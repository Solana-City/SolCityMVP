/**
 * Sol Mechs — battle scene renderer.
 *
 * Draws the two mechs facing each other in the sidescroller layout the Unity
 * battle scene used, and plays short animations in response to engine events.
 *
 * The renderer is a pure consumer of BattleState: it never decides anything
 * about the fight, it only shows what the engine already resolved. Animations
 * are fire-and-forget overlays on top of the current state, so a dropped or
 * skipped animation can never desync the battle — which matters once actions
 * arrive from the network instead of from a local click.
 */
import type { BattleState, BattleEvent, PlayerSide } from "../engine/BattleEngine";
import { drawMech, DOLL_WIDTH, DOLL_HEIGHT } from "./MechPaperDoll";
import type { MechBuild } from "../data/types";

export const CANVAS_W = 640;
export const CANVAS_H = 320;

const MECH_SCALE = 2;
const MECH_W = DOLL_WIDTH * MECH_SCALE;
const MECH_H = DOLL_HEIGHT * MECH_SCALE;
const GROUND_Y = 268;
const P1_X = 64;
const P2_X = CANVAS_W - 64 - MECH_W;

/** ms */
const ATTACK_DURATION = 420;
const FLASH_DURATION = 260;
const FLOATER_DURATION = 900;

interface AttackAnim {
  side: PlayerSide;
  start: number;
}

interface FlashAnim {
  side: PlayerSide;
  start: number;
}

interface Floater {
  side: PlayerSide;
  text: string;
  color: string;
  start: number;
}

export class BattleRenderer {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private state: BattleState;
  private attacks: AttackAnim[] = [];
  private flashes: FlashAnim[] = [];
  private floaters: Floater[] = [];
  private running = false;

  constructor(private canvas: HTMLCanvasElement, initial: BattleState) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    this.state = initial;
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

  setState(state: BattleState): void {
    this.state = state;
  }

  /** Feed the engine's event log so the renderer can animate the outcome. */
  playEvents(events: BattleEvent[]): void {
    const now = performance.now();
    for (const e of events) {
      switch (e.type) {
        case "attack":
          this.attacks.push({ side: e.side, start: now });
          break;
        case "damage":
          this.flashes.push({ side: e.side, start: now });
          this.floaters.push({ side: e.side, text: `-${e.amount}`, color: "#ff5468", start: now });
          break;
        case "heal":
          this.floaters.push({ side: e.side, text: `+${e.amount}`, color: "#14f195", start: now });
          break;
        case "stage":
          this.floaters.push({
            side: e.side,
            text: `${e.delta > 0 ? "+" : ""}${e.delta} ${e.stat}`,
            color: e.delta > 0 ? "#14f195" : "#ffa726",
            start: now,
          });
          break;
      }
    }
  }

  private buildFor(side: PlayerSide): MechBuild {
    return (side === "p1" ? this.state.p1 : this.state.p2).build;
  }

  private draw(now: number): void {
    const ctx = this.ctx;

    this.attacks = this.attacks.filter((a) => now - a.start < ATTACK_DURATION);
    this.flashes = this.flashes.filter((f) => now - f.start < FLASH_DURATION);
    this.floaters = this.floaters.filter((f) => now - f.start < FLOATER_DURATION);

    this.drawBackground(ctx);

    for (const side of ["p1", "p2"] as PlayerSide[]) {
      this.drawSide(ctx, side, now);
    }

    this.drawFloaters(ctx, now);
  }

  private drawBackground(ctx: CanvasRenderingContext2D): void {
    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    sky.addColorStop(0, "#120a24");
    sky.addColorStop(0.55, "#231145");
    sky.addColorStop(1, "#0d0718");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Arena floor plus a horizon line to anchor the mechs' feet.
    ctx.fillStyle = "#1b1030";
    ctx.fillRect(0, GROUND_Y, CANVAS_W, CANVAS_H - GROUND_Y);
    ctx.fillStyle = "#3d2a63";
    ctx.fillRect(0, GROUND_Y, CANVAS_W, 2);
  }

  private drawSide(ctx: CanvasRenderingContext2D, side: PlayerSide, now: number): void {
    const unit = side === "p1" ? this.state.p1 : this.state.p2;
    const baseX = side === "p1" ? P1_X : P2_X;
    const y = GROUND_Y - MECH_H;

    const attack = this.attacks.find((a) => a.side === side);
    const flash = this.flashes.find((f) => f.side === side);

    // Lunge: ease out toward the opponent and settle back. Each part has only
    // one sprite — there is no second pose to swap to — so the attack reads
    // through movement rather than through a changed frame.
    let dx = 0;
    if (attack) {
      const t = (now - attack.start) / ATTACK_DURATION;
      dx = Math.sin(t * Math.PI) * 22 * (side === "p1" ? 1 : -1);
    }

    // Recoil away from the hit.
    if (flash) {
      const t = (now - flash.start) / FLASH_DURATION;
      dx += Math.sin(t * Math.PI) * 8 * (side === "p1" ? -1 : 1);
    }

    const hitFlash = flash ? 1 - (now - flash.start) / FLASH_DURATION : 0;

    // Ground shadow — sold separately from the sprite so a lunging mech's
    // shadow stays put rather than sliding with it.
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.ellipse(baseX + MECH_W / 2, GROUND_Y + 2, MECH_W * 0.3, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const drawn = drawMech(ctx, this.buildFor(side), {
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
      // Sprites still decoding — a labelled block keeps the layout stable
      // instead of leaving a hole that pops when the art lands.
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

  private drawFloaters(ctx: CanvasRenderingContext2D, now: number): void {
    ctx.save();
    ctx.font = "bold 18px monospace";
    ctx.textAlign = "center";
    for (const f of this.floaters) {
      const t = (now - f.start) / FLOATER_DURATION;
      const x = (f.side === "p1" ? P1_X : P2_X) + MECH_W / 2;
      const y = GROUND_Y - MECH_H - 10 - t * 42;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = "#000000";
      ctx.fillText(f.text, x + 1, y + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, x, y);
    }
    ctx.restore();
  }
}
