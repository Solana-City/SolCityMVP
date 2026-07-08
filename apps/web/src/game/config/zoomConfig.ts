/**
 * Camera zoom management, shared by CityScene, ZoomControl and pinch zoom.
 *
 * Sprites render at world scale 0.5, so one source pixel covers
 * 0.5 x cameraZoom canvas pixels. Crisp pixel art requires that to be a
 * whole number of DEVICE pixels. On desktop the canvas backing store is
 * rendered at devicePixelRatio resolution (see PhaserGame), so any EVEN
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

const MIN_VIEW_SCALE = 0.6;
const MAX_VIEW_SCALE = 4.05;

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
  // Mobile keeps a 1:1 CSS-pixel canvas: the Canvas2D renderer redraws
  // every pixel on the CPU each frame, and a DPR-sized backing store would
  // multiply that fill cost by dpr^2.
  if (window.matchMedia("(pointer: coarse)").matches) return 1;
  return Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
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
