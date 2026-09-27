/**
 * Camera zoom management, shared by CityScene, ZoomControl and pinch zoom.
 *
 * ONE rule decides everything here: a source pixel has to land on a whole
 * number of DEVICE pixels, or pixel art cracks — some rows of the sprite get
 * two screen pixels and their neighbours get one, which is the tearing the
 * 2026-09-27 playtest reported on several machines.
 *
 * The chain from a sprite to the glass:
 *
 *   source px --x0.5 (sprite scale) --x zoom (camera)--> backing-store px
 *   backing-store px --x (realDpr / renderDpr)--> device px
 *
 * so one source pixel covers `0.5 x zoom x realDpr / renderDpr` device
 * pixels, and THAT is what must be a whole number. The old version assumed
 * the backing store always matched the screen, so "any even zoom" was called
 * crisp — true on a dpr 1 or 2 screen, false on Windows at 125% or 150% (dpr
 * 1.25 / 1.5, where the desktop path forced a 2x store) and false on a dpr 3
 * phone (capped to 2). Those are exactly the machines that cracked.
 *
 * What the steps mean now: step N draws one source pixel as N x N device
 * pixels. How much CITY that shows depends on the window, which is why the
 * same label showed different amounts of the map on different screens — a
 * 2560px monitor sees twice what a 1280px laptop does at the same step, and
 * always will. The labels stay in CSS pixels (`viewScale`) because that is
 * what the eye reads, but only whole-device-pixel steps are offered.
 */

const VIEW_SCALE_KEY = "solcity:view-scale";
/** Pre-DPR-aware storage key — held the raw camera zoom at an implied dpr of 1. */
const LEGACY_ZOOM_KEY = "solcity:zoom";

/**
 * How big one source pixel may look, in CSS pixels. Below the floor the city
 * is unreadable; above the ceiling you are looking at four buildings.
 */
const MIN_VIEW_SCALE = 0.3;
const MAX_VIEW_SCALE = 2.2;

/** The screen's real ratio, clamped to what any device actually reports. */
function realDpr(): number {
  if (typeof window === "undefined") return 1;
  return Math.min(Math.max(window.devicePixelRatio || 1, 1), 4);
}

/**
 * DPR the canvas backing store is rendered at. PhaserGame publishes the
 * value it actually used at game creation; fall back to computing it so
 * React components can render before the game boots.
 */
export function getRenderDpr(): number {
  const active = (globalThis as { __solCityRenderDpr?: number }).__solCityRenderDpr;
  if (typeof active === "number") return active;
  return computeRenderDpr();
}

export function computeRenderDpr(): number {
  const dpr = realDpr();
  // Each backing-store pixel covers `k` device pixels. k is 1 whenever the
  // store can match the screen, and 2 on a dpr 3 phone, where a full-res
  // store would cost nine times the fill of a 1x one on the Canvas2D
  // renderer mobile uses. Keeping k a WHOLE number is what keeps the crisp
  // steps crisp: a fractional cap (the old "min(dpr, 2)", giving 1.5 on a
  // dpr 3 screen) has no zoom at all that lands on whole device pixels.
  const k = Math.ceil(dpr / 2);
  return dpr / k;
}

/**
 * Device pixels covered by one source pixel at this camera zoom.
 *
 * Read from the STEP rather than from whatever store is live, so the answer
 * is the same before and after the canvas has been resized for that step.
 */
export function devicePixelsPerSourcePixel(zoom: number): number {
  const store = zoom > 0 ? storeOf(zoom) : getRenderDpr();
  return 0.5 * zoom * (realDpr() / store);
}

/** The store a zoom is meant to render at, without recursing through steps. */
function storeOf(zoom: number): number {
  const base = realDpr() / Math.ceil(realDpr() / 2);
  const k = Math.ceil(realDpr() / 2);
  // A crisp step solves zoom = 2 x devicePx / k, a soft one 4 x devicePx / k.
  const asCrisp = (zoom * k) / 2;
  return Number.isInteger(asCrisp) ? base : base * 2;
}

/** Backing-store pixels the BASE (crisp) setup packs per device pixel. */
function baseStoreRatio(): number {
  return Math.ceil(realDpr() / 2);
}

/** The base store: what a crisp step renders at. */
function baseStore(): number {
  return realDpr() / baseStoreRatio();
}

/**
 * One step of the zoom control.
 *
 * `devicePx` is what the player is really choosing: how many device pixels
 * one source pixel covers, and therefore how much city fits on the screen.
 * Whole numbers land on the pixel grid and render crisp. HALF numbers cannot
 * — there is no way to draw half a pixel — so they are rendered by doubling
 * the backing store (`store`), drawing them crisp THERE, and letting the
 * browser downscale the canvas by exactly 2 with smoothing. The result is
 * uniformly soft instead of torn, which is the honest way to offer a step
 * between "one device pixel" and "two".
 *
 * They exist because 1x and 2x on a plain 1080p monitor is an 80-tile view
 * and a 40-tile view with nothing between them, and "more options in between"
 * was the request. They cost four times the fill, so touch screens — which
 * draw on the CPU and already get six crisp steps from their higher dpr —
 * do not get them.
 */
export interface ZoomStep {
  /** Camera zoom to set. */
  zoom: number;
  /** Backing-store scale this step needs (see PhaserGame / CityScene). */
  store: number;
  /** Device pixels per source pixel: 1, 1.5, 2, ... */
  devicePx: number;
  /** True when it lands on the pixel grid; false for the soft half steps. */
  crisp: boolean;
}

function supportsHalfSteps(): boolean {
  if (typeof window === "undefined") return false;
  // Canvas2D on phones redraws every backing pixel on the CPU each frame, so
  // quadrupling the store there is not a trade worth offering.
  if (window.matchMedia("(pointer: coarse)").matches) return false;
  // And a retina desktop would end up rendering at 4x CSS — sixteen times the
  // pixels of a 1x store — for steps it does not need: its dpr already gives
  // it four crisp ones. Only the low-density screens, where crisp leaves a
  // 2x gap between steps, are worth the supersample.
  return baseStore() < 2;
}

export function getZoomSteps(): ZoomStep[] {
  const dpr = realDpr();
  const k = baseStoreRatio();
  const store = baseStore();
  const half = supportsHalfSteps();
  const steps: ZoomStep[] = [];

  for (let n = 2; n <= 16; n++) {
    const devicePx = n / 2;                 // 1, 1.5, 2, 2.5, ...
    const crisp = Number.isInteger(devicePx);
    if (!crisp && !half) continue;
    const css = devicePx / dpr;
    if (css < MIN_VIEW_SCALE || css > MAX_VIEW_SCALE) continue;
    steps.push(crisp
      // Crisp: the base store, 0.5 x zoom x k device px per source px.
      ? { zoom: (2 * devicePx) / k, store, devicePx, crisp }
      // Soft: double store, so a source pixel covers 2 x devicePx store
      // pixels — a whole number, since devicePx is a half — and the browser
      // halves it back down.
      : { zoom: (4 * devicePx) / k, store: store * 2, devicePx, crisp });
  }

  if (steps.length === 0) {
    steps.push({ zoom: 2 / k, store, devicePx: 1, crisp: true });
  }
  return steps;
}

/** Camera zooms only, ascending — what the control and the pinch walk. */
export function getValidZooms(): number[] {
  return getZoomSteps().map((s) => s.zoom);
}

/** The step a camera zoom belongs to, nearest match. */
export function stepFor(zoom: number): ZoomStep {
  return getZoomSteps().reduce((best, s) =>
    Math.abs(s.zoom - zoom) < Math.abs(best.zoom - zoom) ? s : best
  );
}

/** The backing-store scale a zoom needs. Changing zoom may resize the canvas. */
export function storeFor(zoom: number): number {
  return stepFor(zoom).store;
}

export function snapZoom(zoom: number): number {
  return stepFor(zoom).zoom;
}

/** How many tiles fit across the viewport at this zoom — what the eye judges. */
export function tilesAcross(zoom: number, cssWidth: number, tilePx = 24): number {
  const px = devicePixelsPerSourcePixel(zoom);
  if (px <= 0) return 0;
  return Math.round((cssWidth * realDpr()) / px / tilePx);
}

/**
 * View scale a first-time player starts at, in CSS pixels per source pixel.
 * Player feedback asked for a wide default so the buildings and NPCs around
 * you are visible; the nearest crisp step to it is what they get.
 */
const DEFAULT_VIEW_SCALE = 0.5;

/**
 * The step closest to DEFAULT_VIEW_SCALE, crisp ones preferred — a player who
 * never touches the control should never be handed the soft rendering.
 */
export function getDefaultZoom(): number {
  const steps = getZoomSteps();
  const crisp = steps.filter((s) => s.crisp);
  const pool = crisp.length > 0 ? crisp : steps;
  const off = (s: ZoomStep) => Math.abs(s.devicePx / realDpr() - DEFAULT_VIEW_SCALE);
  return pool.reduce((best, s) => (off(s) <= off(best) ? s : best)).zoom;
}

/** CSS pixels per source pixel: the size the eye actually reads. */
export function viewScale(zoom: number): number {
  return devicePixelsPerSourcePixel(zoom) / realDpr();
}

/** "1x", "1.5x", "2.4x" — at most one decimal, trailing zero trimmed. */
export function formatViewScale(zoom: number): string {
  const v = Math.round(viewScale(zoom) * 10) / 10;
  return `${v}×`;
}

export function loadZoom(): number {
  try {
    const view = parseFloat(localStorage.getItem(VIEW_SCALE_KEY) ?? "");
    if (!isNaN(view)) return snapZoom(view * 2 * getRenderDpr());
    // Migrate the legacy value: it was a camera zoom on a dpr-1 canvas,
    // so its view scale is zoom / 2.
    const legacy = parseFloat(localStorage.getItem(LEGACY_ZOOM_KEY) ?? "");
    if (!isNaN(legacy)) return snapZoom(legacy * getRenderDpr());
  } catch {}
  return getDefaultZoom();
}

export function saveZoom(zoom: number): void {
  try {
    localStorage.setItem(VIEW_SCALE_KEY, String(viewScale(zoom)));
  } catch {}
}
