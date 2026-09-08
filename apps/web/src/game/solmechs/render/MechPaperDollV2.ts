/**
 * Sol Mechs — paper doll, NEW part format.
 *
 * NOT IN USE YET. Nothing imports this: the live renderer is still
 * `MechPaperDoll.ts`, and it stays that way until all five mechs exist in the
 * new format. Swapping is an import change — the exports below mirror the old
 * module's surface exactly.
 *
 * ## What changed
 *
 * The old format is a 64x64 canvas per part plus a per-slot socket offset read
 * out of the Unity scene, so assembling means adding two numbers per limb and
 * the art has no say in where it lands.
 *
 * The new art carries its own position. Every part is a 128x128 PNG with the
 * piece already drawn where it belongs on the finished mech, so assembly is
 * four blits at (0,0) and nothing else. Parts from different chassis line up
 * because the artist put them in the same place, not because we computed it.
 *
 * ## Layer order
 *
 * Back to front: far arm, matrix, legs, front arm.
 *
 * Legs sit ABOVE the matrix so a belt or hip plate drawn on the legs covers
 * the bottom of the torso. The FRONT arm is drawn last, over both the matrix
 * and the legs — getting that backwards makes the front arm look like the
 * torso is eating it, which is the symptom to check for first.
 *
 * Note the front arm is the LEFT slot here, the reverse of the old module.
 * That is a property of the new art, so it lives with the new renderer rather
 * than being patched into the shared slot names.
 */
import type { MechBuild, ModuleSlot } from "../data/types";
import { getMatrix, getPart } from "../data/catalog";

/** Sprites for the new format live apart from the 64x64 set. */
const BASE = "/assets/minigames/sol-mechs/parts-v2";

/** Every part ships on this square. The doll IS one frame — no offsets. */
export const PART_FRAME = 128;

export const DOLL_WIDTH = PART_FRAME;
export const DOLL_HEIGHT = PART_FRAME;

/**
 * Draw order, back to front.
 *
 * `leftArm` is the near arm in this format — see the header.
 */
const DRAW_ORDER = ["rightArm", "matrix", "lowerBody", "leftArm"] as const;
type SocketName = (typeof DRAW_ORDER)[number];

/**
 * Where a limb sits, as a fraction of the frame, for aiming hit effects.
 *
 * The old module derived these from socket offsets. Here the parts have no
 * offsets, so the anchors are measured against the assembled mech instead:
 * roughly the centre of mass of each piece within the 128 frame.
 */
const ANCHORS: Record<ModuleSlot, { x: number; y: number }> = {
  matrix: { x: 0.48, y: 0.28 },
  rightArm: { x: 0.64, y: 0.46 },
  leftArm: { x: 0.32, y: 0.43 },
  lowerBody: { x: 0.50, y: 0.69 },
};

const imageCache = new Map<string, HTMLImageElement>();

function sprite(code: string): HTMLImageElement {
  const cached = imageCache.get(code);
  if (cached) return cached;
  const el = new Image();
  el.src = `${BASE}/${code}.png`;
  imageCache.set(code, el);
  return el;
}

export function resolveCodes(build: MechBuild): Record<SocketName, string> | null {
  const matrix = getMatrix(build.matrixCode);
  const right = getPart(build.rightArm);
  const left = getPart(build.leftArm);
  const legs = getPart(build.lowerBody);
  if (!matrix || !right || !left || !legs) return null;
  return {
    matrix: matrix.matrixCode,
    rightArm: right.partCode,
    leftArm: left.partCode,
    lowerBody: legs.partCode,
  };
}

export interface DrawOptions {
  /** Top-left of the doll box, in canvas px. */
  x: number;
  y: number;
  /** Integer scale keeps the pixel art crisp. */
  scale?: number;
  /** Mirror horizontally — player 2 faces left. */
  flip?: boolean;
  /** 0..1, flashes the whole mech white on hit. */
  hitFlash?: number;
  /** Destroyed limbs render ghosted rather than vanishing. */
  brokenSlots?: Partial<Record<Exclude<SocketName, "matrix">, boolean>>;
  alpha?: number;
}

let scratch: HTMLCanvasElement | null = null;

/**
 * Scratch surface for the hit flash.
 *
 * `source-atop` keeps the DESTINATION's alpha, so tinting straight onto the
 * battle canvas — opaque everywhere — fills a white rectangle the size of the
 * box instead of following the mech's outline. Same trap as the old module.
 */
function getScratch(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  if (!scratch) scratch = document.createElement("canvas");
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  return scratch;
}

/** Draws the assembled mech. False when a sprite has not loaded yet. */
export function drawMech(ctx: CanvasRenderingContext2D, build: MechBuild, opts: DrawOptions): boolean {
  const codes = resolveCodes(build);
  if (!codes) return false;

  const images = DRAW_ORDER.map((slot) => sprite(codes[slot]));
  if (images.some((im) => !im.complete || im.naturalWidth === 0)) return false;

  const scale = opts.scale ?? 3;
  const boxW = DOLL_WIDTH * scale;
  const boxH = DOLL_HEIGHT * scale;
  const broken = opts.brokenSlots ?? {};
  const flash = Math.min(1, opts.hitFlash ?? 0);

  const off = flash > 0 ? getScratch(boxW, boxH) : null;
  const offCtx = off?.getContext("2d") ?? null;
  const target = offCtx ?? ctx;
  if (offCtx) offCtx.clearRect(0, 0, boxW, boxH);

  target.save();
  target.imageSmoothingEnabled = false;

  if (off) {
    if (opts.flip) {
      target.translate(boxW, 0);
      target.scale(-1, 1);
    }
  } else if (opts.flip) {
    target.translate(opts.x + boxW, opts.y);
    target.scale(-1, 1);
  } else {
    target.translate(opts.x, opts.y);
  }

  // Every part is the same square, already positioned — so each one is one
  // full-frame blit and there is nothing to offset.
  DRAW_ORDER.forEach((slot, i) => {
    const isBroken = slot !== "matrix" && broken[slot];
    target.save();
    if (isBroken) target.globalAlpha = (opts.alpha ?? 1) * 0.25;
    else if (opts.alpha !== undefined) target.globalAlpha = opts.alpha;
    target.drawImage(images[i], 0, 0, boxW, boxH);
    target.restore();
  });

  target.restore();

  if (off && offCtx) {
    offCtx.save();
    offCtx.globalCompositeOperation = "source-atop";
    offCtx.fillStyle = `rgba(255,255,255,${flash})`;
    offCtx.fillRect(0, 0, boxW, boxH);
    offCtx.restore();
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, opts.x, opts.y);
    ctx.restore();
  }

  return true;
}

/** Where to land a hit effect for a slot, in doll-space px. */
export function slotAnchor(slot: ModuleSlot): { x: number; y: number } {
  const a = ANCHORS[slot];
  return { x: a.x * DOLL_WIDTH, y: a.y * DOLL_HEIGHT };
}

export function preloadBuild(build: MechBuild): void {
  const codes = resolveCodes(build);
  if (!codes) return;
  for (const slot of DRAW_ORDER) sprite(codes[slot]);
}
