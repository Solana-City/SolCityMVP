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
import type { MechBuild } from "../data/types";
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

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;

  // Flip about the box's centre so `x` stays the left edge either way.
  if (opts.flip) {
    ctx.translate(opts.x + boxW, opts.y);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(opts.x, opts.y);
  }

  DRAW_ORDER.forEach((slot, i) => {
    const socket = SOCKETS[slot];
    const isBroken = slot !== "matrix" && broken[slot];
    ctx.save();
    // A destroyed limb stays on the mech but goes ghosted — removing it
    // outright makes the silhouette unreadable mid-battle.
    if (isBroken) ctx.globalAlpha = (opts.alpha ?? 1) * 0.25;
    ctx.drawImage(
      images[i],
      0, 0, PART_FRAME, PART_FRAME,
      Math.round((ORIGIN_X + socket.dx) * scale),
      Math.round((ORIGIN_Y + socket.dy) * scale),
      PART_FRAME * scale, PART_FRAME * scale,
    );
    ctx.restore();
  });

  // Hit flash: re-stamp the silhouette white through source-atop so it tints
  // only pixels already drawn, never the background.
  if (opts.hitFlash && opts.hitFlash > 0) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.globalAlpha = Math.min(1, opts.hitFlash);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, boxW, boxH);
  }

  ctx.restore();
  return true;
}

/** Kick off decoding for one build's sprites. */
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
