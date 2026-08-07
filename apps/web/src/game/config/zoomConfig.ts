/**
 * Camera zoom management, shared by CityScene, ZoomControl and pinch zoom.
 *
 * Sprites render at world scale 0.5, so one source pixel covers
 * 0.5 x cameraZoom canvas pixels. Crisp pixel art requires that to be a
 * whole number of DEVICE pixels. The canvas backing store is rendered at
 * devicePixelRatio resolution (capped at 2 — see PhaserGame), so any EVEN
 * camera zoom is pixel-perfect — which yields several crisp steps.
 *
 * "View scale" is what the user perceives: the size of one source pixel in
 * CSS pixels, i.e. zoom / (2 * dpr). We persist the view scale rather than
 * the raw camera zoom so a stored value keeps its meaning across screens
 * with different pixel densities.
 */

const VIEW_SCALE_KEY = "solcity:view-scale";
/** Pre-DPR-aware storage key — held the raw camera zoom at an implied dpr of 1. */
const LEGACY_ZOOM_KEY = "solcity:zoom";

// Bias the range toward zooming OUT (seeing more of the city) rather than
// magnification: floor at half scale, cap at 2.5x.
const MIN_VIEW_SCALE = 0.45;
const MAX_VIEW_SCALE = 2.55;

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
  // Capped at 2 everywhere: on mobile the Canvas2D renderer redraws every
  // backing-store pixel each frame, so the cap bounds the fill cost at 4x
  // CSS resolution (phones at dpr 3 get a slight CSS upscale instead).
  // A dpr-2 backing store is what allows the crisp 0.5x zoom-out level.
  const raw = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
  // Desktop renders via WebGL, where a 2x backing store is cheap. Give it at
  // least dpr 2 so it gets the SAME crisp zoom-out range as mobile: a non-retina
  // desktop is dpr 1, whose only even (pixel-perfect) camera zooms yield view
  // scales 1.0x/2.0x — i.e. no zoom-out at all — while mobile (dpr 2) reaches
  // 0.5x. Forcing dpr 2 unlocks 0.5x..2.5x on desktop too; the default (~1.0x)
  // is unchanged. Mobile (Canvas2D) keeps its real dpr to bound fill cost.
  const isTouch = typeof window !== "undefined"
    && window.matchMedia("(pointer: coarse)").matches;
  return isTouch ? raw : Math.max(raw, 2);
}

/** Even camera zooms whose view scale falls in a sane range, ascending. */
export function getValidZooms(): number[] {
  const dpr = getRenderDpr();
  const zooms: number[] = [];
  for (let z = 2; z / (2 * dpr) <= MAX_VIEW_SCALE; z += 2) {
    if (z / (2 * dpr) >= MIN_VIEW_SCALE) zooms.push(z);
  }
  return zooms.length > 0 ? zooms : [2, 4];
}

export function snapZoom(zoom: number): number {
  return getValidZooms().reduce((best, v) =>
    Math.abs(v - zoom) < Math.abs(best - zoom) ? v : best
  );
}

/** The valid zoom whose view scale is closest to 1x (the classic look). */
export function getDefaultZoom(): number {
  const dpr = getRenderDpr();
  // <= so ties resolve to the larger (more zoomed-in) candidate.
  return getValidZooms().reduce((best, z) =>
    Math.abs(z / (2 * dpr) - 1) <= Math.abs(best / (2 * dpr) - 1) ? z : best
  );
}

export function viewScale(zoom: number): number {
  return zoom / (2 * getRenderDpr());
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
