/**
 * Sol Mechs — paper doll compositor.
 *
 * Each equipped part has exactly one sprite, named after its catalog code
 * (RA02.png, LA05.png, M01.png…). Slotting is what makes builds mixable: any
 * RA sprite drops into the right-arm socket, any LA into the left, and the
 * result reads as one mech.
 *
 * ## The layout is data, not guesswork
 *
 * The part PNGs are 64x64 each but they are NOT pre-aligned to a shared
 * frame — stacking them at a common origin produces a jumbled blob, and the
 * assembled mech is ~81px tall, taller than the part canvas, so no
 * same-origin stack could ever be right.
 *
 * The real alignment lived in the Unity scenes, as four RectTransforms
 * (ImgMatrix / ImgRightArm / ImgLeftArm / ImgInferior) inside 100x100 boxes.
 * `SOCKETS` below is those anchoredPositions, taken relative to the matrix
 * and converted from Unity's y-up UI units into source pixels. All three
 * Unity scenes that draw a mech (6_LocalPvP, 3_PilotMechBattleV1,
 * 2_MechEditorScene) agree on these offsets to within a pixel, which is what
 * makes them trustworthy rather than one scene's accident.
 *
 * Verified by compositing Striker's stock parts and diffing against the
 * artist's pre-assembled `striker1.png`.
 */
import type { MechBuild, ModuleSlot } from "../data/types";
import { getMatrix, getPart } from "../data/catalog";

const BASE = "/assets/minigames/sol-mechs/parts";

/** Source sprites are 64x64. */
export const PART_FRAME = 64;

/**
 * Unity drew each 64x64 sprite into a 100x100 UI box with preserveAspect, so
 * one UI unit is 64/100 source pixels. Scene offsets are divided by this to
 * land back in source-pixel space.
 */
const UI_UNITS_PER_PX = 100 / 64;

/**
 * Socket offsets in source pixels, relative to the matrix's top-left, with
 * +y pointing down (Unity's +y points up, so the scene values are negated).
 *
 * Scene anchoredPositions (6_LocalPvP), for reference:
 *   ImgMatrix   (-344.0, 153.0)
 *   ImgRightArm (-386.3, 121.6)
 *   ImgLeftArm  (-299.3, 115.4)
 *   ImgInferior (-342.9,  92.1)
 */
const SOCKETS = {
  // Left arm is the far arm — drawn first, behind everything.
  leftArm:   { dx:  45.3 / UI_UNITS_PER_PX, dy: 37.6 / UI_UNITS_PER_PX },
  lowerBody: { dx:   1.1 / UI_UNITS_PER_PX, dy: 60.9 / UI_UNITS_PER_PX },
  matrix:    { dx:   0,                     dy:  0 },
  // Right arm is the near arm — drawn last, in front of the torso.
  rightArm:  { dx: -42.3 / UI_UNITS_PER_PX, dy: 31.4 / UI_UNITS_PER_PX },
} as const;

/**
 * The assembled mech's bounding box in source pixels, derived from the
 * sockets: the right arm reaches furthest left, the left arm furthest right,
 * and the legs furthest down. Callers draw into a box this size and the mech
 * lands centred with its feet on the bottom edge.
 */
const MIN_DX = Math.min(...Object.values(SOCKETS).map((s) => s.dx));
const MAX_DX = Math.max(...Object.values(SOCKETS).map((s) => s.dx));
const MAX_DY = Math.max(...Object.values(SOCKETS).map((s) => s.dy));

export const DOLL_WIDTH = Math.ceil(MAX_DX - MIN_DX + PART_FRAME);
export const DOLL_HEIGHT = Math.ceil(MAX_DY + PART_FRAME);

/** Where the matrix sits inside that box, so every socket lands positive. */
const ORIGIN_X = -MIN_DX;
const ORIGIN_Y = 0;

/** Draw order, back to front. */
const DRAW_ORDER = ["leftArm", "lowerBody", "matrix", "rightArm"] as const;
type SocketName = (typeof DRAW_ORDER)[number];

const imageCache = new Map<string, HTMLImageElement>();

function sprite(code: string): HTMLImageElement {
  const cached = imageCache.get(code);
  if (cached) return cached;
  const el = new Image();
  el.src = `${BASE}/${code}.png`;
  imageCache.set(code, el);
  return el;
}

/** Resolve a build to its four part codes, or null if any is unknown. */
export function resolveCodes(build: MechBuild): Record<SocketName, string> | null {
  const matrix = getMatrix(build.matrixCode);
  const rightArm = getPart(build.rightArm);
  const leftArm = getPart(build.leftArm);
  const lowerBody = getPart(build.lowerBody);
  if (!matrix || !rightArm || !leftArm || !lowerBody) return null;
  return {
    matrix: matrix.matrixCode,
    rightArm: rightArm.partCode,
    leftArm: leftArm.partCode,
    lowerBody: lowerBody.partCode,
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

/**
 * Scratch surface for the hit flash.
 *
 * Tinting the mech's silhouette white needs `source-atop`, a composite that
 * keeps the DESTINATION's alpha. Applied straight to the battle canvas that
 * destination is the already-painted background — opaque everywhere — so the
 * flash filled a solid white RECTANGLE the size of the mech's box rather than
 * following its outline.
 *
 * Compositing the mech here first, where the only non-transparent pixels are
 * the mech itself, makes source-atop mean what it looks like it means. One
 * canvas is reused across every mech and resized only when the draw size
 * changes.
 */
let scratch: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;

function getScratch(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  if (!scratch) {
    scratch = document.createElement("canvas");
    scratchCtx = scratch.getContext("2d");
  }
  if (!scratchCtx || !scratch) return null;
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  } else {
    scratchCtx.clearRect(0, 0, w, h);
  }
  return scratchCtx;
}

/**
 * Composite one mech onto a 2D context.
 *
 * Returns false when any sprite is still decoding, so callers can draw a
 * placeholder instead of a half-assembled mech.
 */
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

  // The flash needs its own surface (see getScratch); everything else draws
  // straight onto the caller's context.
  const off = flash > 0 ? getScratch(boxW, boxH) : null;
  const target = off ?? ctx;

  target.save();
  target.imageSmoothingEnabled = false;
  if (opts.alpha !== undefined) target.globalAlpha = opts.alpha;

  if (off) {
    // The scratch canvas IS the box, so there is no offset to apply — only
    // the mirror, which still has to happen before the layers are laid down.
    if (opts.flip) {
      target.translate(boxW, 0);
      target.scale(-1, 1);
    }
  } else if (opts.flip) {
    // Flip about the box's centre so `x` stays the left edge either way.
    target.translate(opts.x + boxW, opts.y);
    target.scale(-1, 1);
  } else {
    target.translate(opts.x, opts.y);
  }

  DRAW_ORDER.forEach((slot, i) => {
    const socket = SOCKETS[slot];
    const isBroken = slot !== "matrix" && broken[slot];
    target.save();
    // A destroyed limb stays on the mech but goes ghosted — removing it
    // outright makes the silhouette unreadable mid-battle.
    if (isBroken) target.globalAlpha = (opts.alpha ?? 1) * 0.25;
    target.drawImage(
      images[i],
      0, 0, PART_FRAME, PART_FRAME,
      Math.round((ORIGIN_X + socket.dx) * scale),
      Math.round((ORIGIN_Y + socket.dy) * scale),
      PART_FRAME * scale, PART_FRAME * scale,
    );
    target.restore();
  });

  target.restore();

  if (off && scratch) {
    // On this surface the only non-transparent pixels ARE the mech, so
    // source-atop tints the silhouette instead of a rectangle.
    off.save();
    off.globalCompositeOperation = "source-atop";
    off.globalAlpha = flash;
    off.fillStyle = "#ffffff";
    off.fillRect(0, 0, boxW, boxH);
    off.restore();

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
    ctx.drawImage(scratch, Math.round(opts.x), Math.round(opts.y));
    ctx.restore();
  }

  return true;
}

/**
 * Where a slot sits inside the doll box, in source pixels.
 *
 * This is what lets an impact effect land ON the limb that was actually hit
 * rather than in the middle of the mech. Each socket holds a 64x64 sprite, so
 * its visual centre is the socket offset plus half a frame.
 *
 * The matrix anchor is nudged down: the torso sprite's ink sits in the lower
 * half of its frame (the upper half is head clearance), so the geometric
 * centre reads as floating above the chest.
 */
export function slotAnchor(slot: ModuleSlot): { x: number; y: number } {
  const socket = SOCKETS[slot as SocketName] ?? SOCKETS.matrix;
  return {
    x: ORIGIN_X + socket.dx + PART_FRAME / 2,
    y: ORIGIN_Y + socket.dy + PART_FRAME / 2 + (slot === "matrix" ? 6 : 0),
  };
}
export function preloadBuild(build: MechBuild): void {
  const codes = resolveCodes(build);
  if (codes) for (const slot of DRAW_ORDER) sprite(codes[slot]);
}

/** Preload the whole catalog — 20 small PNGs, cheap enough to do once. */
export function preloadAll(): void {
  for (let i = 1; i <= 5; i++) {
    const n = String(i).padStart(2, "0");
    for (const prefix of ["M", "RA", "LA", "IN"]) sprite(`${prefix}${n}`);
  }
}
