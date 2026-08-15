/**
 * Sol Mechs — sidescroller paper doll.
 *
 * Each mech ships six 64x64 sprites that stack in a shared frame, so a build
 * is drawn by compositing layers rather than by baking a sheet per
 * combination. That is what lets a mech wear another mech's arm: the parts
 * are authored against the same origin, so any RA/LA/IN mix lines up.
 *
 * Layer order, back to front:
 *   back_arm → legs → matrix (torso) → front_arm
 *
 * The two numbered arm files (front_arm1/front_arm2) are the idle/fire pose
 * pair, not a walk cycle — frame 2 is the extended/attacking pose.
 *
 * Which mech's sprite each layer uses comes from the equipped part's
 * `spriteMech`, so the visual follows the build automatically.
 */
import type { MechBuild, MechId } from "../data/types";
import { getMatrix, getPart } from "../data/catalog";

const BASE = "/assets/minigames/sol-mechs/mechs";

export const MECH_FRAME_SIZE = 64;

/** Arm pose: 1 = idle/at rest, 2 = extended/firing. */
export type ArmPose = 1 | 2;

export interface MechLayers {
  backArm: HTMLImageElement;
  legs: HTMLImageElement;
  matrix: HTMLImageElement;
  frontArm: HTMLImageElement;
}

/**
 * Images are cached by URL and shared across every mech on screen — a battle
 * draws two mechs and a roster screen draws five, all from the same handful
 * of files.
 */
const imageCache = new Map<string, HTMLImageElement>();

function img(path: string): HTMLImageElement {
  const cached = imageCache.get(path);
  if (cached) return cached;
  const el = new Image();
  el.src = path;
  imageCache.set(path, el);
  return el;
}

function partSprite(mech: MechId, file: string): HTMLImageElement {
  return img(`${BASE}/${mech}/${file}`);
}

/**
 * Resolve every layer for a build at a given arm pose.
 *
 * The arms are keyed off the equipped arm parts, but the source art only
 * ships one front/back arm pair per mech — there is no per-part arm sprite.
 * So a build wearing Titan's right arm draws Titan's front arm, which is the
 * intended read: you can see what your opponent is holding.
 */
export function resolveLayers(build: MechBuild, pose: ArmPose = 1): MechLayers | null {
  const matrix = getMatrix(build.matrixCode);
  const rightArm = getPart(build.rightArm);
  const leftArm = getPart(build.leftArm);
  const lowerBody = getPart(build.lowerBody);
  if (!matrix || !rightArm || !leftArm || !lowerBody) return null;

  return {
    // Right arm reads as the near/front arm in the sidescroller pose, left as
    // the far/back one — matching how the Unity battle scene laid the mechs out.
    backArm: partSprite(leftArm.spriteMech, `back_arm${pose}.png`),
    legs: partSprite(lowerBody.spriteMech, "legs.png"),
    matrix: partSprite(matrix.id, "matrix.png"),
    frontArm: partSprite(rightArm.spriteMech, `front_arm${pose}.png`),
  };
}

export interface DrawOptions {
  /** Destination top-left, in canvas px. */
  x: number;
  y: number;
  /** Integer scale keeps the pixel art crisp; 4 gives a 256px mech. */
  scale?: number;
  /** Mirror horizontally — player 2 faces left. */
  flip?: boolean;
  pose?: ArmPose;
  /** 0..1, used to flash a mech white on hit. */
  hitFlash?: number;
  /** Draw destroyed limbs dimmed instead of hiding them. */
  brokenSlots?: { rightArm?: boolean; leftArm?: boolean; lowerBody?: boolean };
  alpha?: number;
}

/**
 * Composite one mech onto a 2D context.
 *
 * Returns false when the sprites have not finished decoding, so a caller can
 * fall back to a placeholder rather than drawing a half-assembled mech.
 */
export function drawMech(ctx: CanvasRenderingContext2D, build: MechBuild, opts: DrawOptions): boolean {
  const layers = resolveLayers(build, opts.pose ?? 1);
  if (!layers) return false;

  const all = [layers.backArm, layers.legs, layers.matrix, layers.frontArm];
  if (all.some((im) => !im.complete || im.naturalWidth === 0)) return false;

  const scale = opts.scale ?? 4;
  const size = MECH_FRAME_SIZE * scale;
  const broken = opts.brokenSlots ?? {};

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;

  // Flip around the sprite's own centre so `x` stays the left edge either way.
  if (opts.flip) {
    ctx.translate(opts.x + size, opts.y);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(opts.x, opts.y);
  }

  const layer = (im: HTMLImageElement, isBroken?: boolean) => {
    ctx.save();
    // A destroyed limb stays on the mech but goes ghosted — removing it
    // outright makes the silhouette unreadable mid-battle.
    if (isBroken) ctx.globalAlpha = (opts.alpha ?? 1) * 0.25;
    ctx.drawImage(im, 0, 0, MECH_FRAME_SIZE, MECH_FRAME_SIZE, 0, 0, size, size);
    ctx.restore();
  };

  layer(layers.backArm, broken.leftArm);
  layer(layers.legs, broken.lowerBody);
  layer(layers.matrix);
  layer(layers.frontArm, broken.rightArm);

  // Hit flash: re-stamp the silhouette in white through source-atop so it
  // tints only the pixels already drawn, never the background.
  if (opts.hitFlash && opts.hitFlash > 0) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.globalAlpha = Math.min(1, opts.hitFlash);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
  }

  ctx.restore();
  return true;
}

/** Kick off decoding for a build's sprites before a battle opens. */
export function preloadBuild(build: MechBuild): void {
  resolveLayers(build, 1);
  resolveLayers(build, 2);
}

/** Preload every mech's art — cheap enough to call once on the roster screen. */
export function preloadAll(): void {
  const mechs: MechId[] = ["titan", "striker", "arclight", "heartcore", "solus"];
  for (const m of mechs) {
    img(`${BASE}/${m}/matrix.png`);
    img(`${BASE}/${m}/legs.png`);
    for (const pose of [1, 2]) {
      img(`${BASE}/${m}/front_arm${pose}.png`);
      img(`${BASE}/${m}/back_arm${pose}.png`);
    }
  }
}
