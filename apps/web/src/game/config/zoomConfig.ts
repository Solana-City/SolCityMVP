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

/**
 * The ladder, written as what the player sees: CSS pixels per source pixel.
 * Small numbers show more city.
 *
 * Deliberately lopsided. Playtesters kept asking for room between "the whole
 * neighbourhood at once" and "a few buildings", and never once asked to get
 * closer than 2x — so the wide half is in quarter steps and the near half is
 * in halves. The old ladder was five even steps from 0.5 to 2.5, which meant
 * one single option below 1x and three above it.
 */
const VIEW_SCALES = [0.4, 0.5, 0.625, 0.75, 1.0, 1.5, 2.0];

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

/**
 * The ladder as camera zooms, ascending.
 *
 * A step is crisp when it lands a source pixel on a whole number of device
 * pixels; the ones that do not are rendered smooth instead of torn (see
 * CityScene.applyZoomSmoothing). Which steps are which depends on the screen,
 * so the ladder is the same everywhere and the rendering adapts, rather than
 * every screen getting a different set of options.
 */
/**
 * Widest useful view, in tiles across. The city is 135 tiles wide, so a step
 * that fits 200 of them on a big monitor is showing the void past the edges
 * and drawing everything in between to do it. A step that wide is dropped on
 * the screens where it lands there, which is why a 1920px desktop gets fewer
 * steps than a laptop: its 1x already shows 80 tiles.
 */
const MAX_TILES_ACROSS = 110;
const TILE_PX = 24;

export function getValidZooms(): number[] {
  const dpr = getRenderDpr();
  const cssWidth = typeof window === "undefined" ? 0 : window.innerWidth;
  const zooms = VIEW_SCALES
    .filter((v) => !cssWidth || cssWidth / v / TILE_PX <= MAX_TILES_ACROSS)
    .map((v) => v * 2 * dpr);
  // Never leave the control with nothing to offer.
  return zooms.length > 0 ? zooms : [VIEW_SCALES[VIEW_SCALES.length - 1] * 2 * dpr];
}

export function snapZoom(zoom: number): number {
  return getValidZooms().reduce((best, v) =>
    Math.abs(v - zoom) < Math.abs(best - zoom) ? v : best
  );
}

/**
 * View scale a first-time player starts at. Player feedback asked for a wider
 * default view so the buildings and NPCs around you are visible; 0.5x is the
 * one crisp step below the old 1x. Players who picked a zoom keep theirs.
 */
const DEFAULT_VIEW_SCALE = 0.5;

/** True when this step lands on whole device pixels and renders crisp. */
export function isCrisp(zoom: number): boolean {
  const px = viewScale(zoom) * (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
  return px >= 1 && Math.abs(px - Math.round(px)) < 0.01;
}

/** The valid zoom whose view scale is closest to DEFAULT_VIEW_SCALE. */
export function getDefaultZoom(): number {
  const dpr = getRenderDpr();
  const off = (z: number) => Math.abs(z / (2 * dpr) - DEFAULT_VIEW_SCALE);
  // <= so ties resolve to the larger (more zoomed-in) candidate.
  return getValidZooms().reduce((best, z) => (off(z) <= off(best) ? z : best));
}

export function viewScale(zoom: number): number {
  return zoom / (2 * getRenderDpr());
}

/**
 * "0.75x", "1x", "1.5x". Two decimals below 1x, because that is where the
 * steps are now close together and rounding them to one decimal turned 0.625
 * and 0.75 into the same label.
 */
export function formatViewScale(zoom: number): string {
  const v = viewScale(zoom);
  const rounded = v < 1 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10;
  return `${rounded}×`;
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
