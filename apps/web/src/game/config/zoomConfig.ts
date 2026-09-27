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

/** Device pixels covered by one source pixel at this camera zoom. */
export function devicePixelsPerSourcePixel(zoom: number): number {
  return 0.5 * zoom * (realDpr() / getRenderDpr());
}

/** Backing-store pixels per device pixel — 1 or 2, see computeRenderDpr. */
function storeRatio(): number {
  return Math.max(1, Math.round(realDpr() / getRenderDpr()));
}

/**
 * The camera zooms that draw a source pixel as a whole number of device
 * pixels, ascending, filtered to sizes a player can read.
 */
export function getValidZooms(): number[] {
  const dpr = realDpr();
  const k = storeRatio();
  const zooms: number[] = [];
  for (let devicePx = 1; devicePx <= 8; devicePx++) {
    const css = devicePx / dpr;
    if (css < MIN_VIEW_SCALE || css > MAX_VIEW_SCALE) continue;
    zooms.push((2 * devicePx) / k);
  }
  // A screen that fits nothing in the range still needs one working zoom.
  return zooms.length > 0 ? zooms : [2 / k];
}

export function snapZoom(zoom: number): number {
  return getValidZooms().reduce((best, v) =>
    Math.abs(v - zoom) < Math.abs(best - zoom) ? v : best
  );
}

/**
 * View scale a first-time player starts at, in CSS pixels per source pixel.
 * Player feedback asked for a wide default so the buildings and NPCs around
 * you are visible; the nearest crisp step to it is what they get.
 */
const DEFAULT_VIEW_SCALE = 0.5;

/** The valid zoom whose view scale is closest to DEFAULT_VIEW_SCALE. */
export function getDefaultZoom(): number {
  const off = (z: number) => Math.abs(viewScale(z) - DEFAULT_VIEW_SCALE);
  // <= so ties resolve to the larger (more zoomed-in) candidate.
  return getValidZooms().reduce((best, z) => (off(z) <= off(best) ? z : best));
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
