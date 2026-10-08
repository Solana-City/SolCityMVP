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
const VIEW_SCALES = [0.3, 0.4, 0.5, 0.625, 0.75, 1.0, 1.5, 2.0];

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

/** Stored render-scale choice: "auto" (today's behaviour), "1" or "1.5". */
const RENDER_SCALE_KEY = "solcity:render-scale";

/**
 * An opt-in override for how many device pixels the canvas is rendered at.
 *
 * The backing store is the single biggest piece of GPU work the game does —
 * at dpr 2 it is 4x the pixels of dpr 1, every frame — so this is the largest
 * lever available for heat and battery. It is a CHOICE and not a default
 * because it is paid for in sharpness, not in anything invisible: see
 * CityScene.applyZoomSmoothing for which zoom steps survive it.
 *
 * `?render=1` in the URL for a side-by-side test without touching settings;
 * otherwise whatever was stored. Anything unparseable, or "auto", leaves the
 * original behaviour exactly as it was.
 */
function renderScaleOverride(): number | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = new URLSearchParams(window.location.search).get("render")
      ?? window.localStorage.getItem(RENDER_SCALE_KEY);
  } catch { return null; } // private mode, blocked storage
  if (!raw || raw === "auto") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 2 ? n : null;
}

/** Persists a render-scale choice. The canvas is built at boot, so the caller reloads. */
export function setRenderScale(value: number | "auto"): void {
  try { window.localStorage.setItem(RENDER_SCALE_KEY, String(value)); } catch { /* ignore */ }
}

export function computeRenderDpr(): number {
  const override = renderScaleOverride();
  if (override !== null) return override;
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
  // Rounded to a whole number on touch, where it used to be whatever the
  // device reported (1.5 and 1.75 are both common). The camera zoom is
  // viewScale * 2 * dpr, and Phaser only rounds draw positions when that zoom
  // is an INTEGER (Camera.preRender: renderRoundPixels). A fractional dpr
  // makes an integer zoom impossible at almost every step, which on the Canvas
  // renderer phones use shows as a seam between every tile — so the dpr has to
  // be whole before the ladder below can offer anything safe.
  return isTouchPointer() ? Math.min(2, Math.max(1, Math.round(raw))) : Math.max(raw, 2);
}

/** Phones and tablets — the devices PhaserGame puts on the Canvas renderer. */
function isTouchPointer(): boolean {
  return typeof window !== "undefined"
    && window.matchMedia("(pointer: coarse)").matches;
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
 * Widest useful view, in tiles across. The city is 135 wide and 115 tall, so
 * 145 is the whole thing with a margin — wide enough to take a picture of
 * the city, and short of the point where a step is mostly the void past the
 * edges with everything in between still being drawn.
 */
const MAX_TILES_ACROSS = 145;
const TILE_PX = 24;

export function getValidZooms(): number[] {
  const dpr = getRenderDpr();
  const cssWidth = typeof window === "undefined" ? 0 : window.innerWidth;
  const zooms = VIEW_SCALES
    .filter((v) => !cssWidth || cssWidth / v / TILE_PX <= MAX_TILES_ACROSS)
    .map((v) => v * 2 * dpr);

  // On the Canvas renderer only, drop every step whose camera zoom is not a
  // whole number.
  //
  // Phaser turns off render-time pixel rounding when the zoom is fractional
  // (Camera.preRender sets renderRoundPixels from Number.isInteger(zoom)), so
  // every tile is then drawn at a fractional position. WebGL covers the seam;
  // Canvas2D rounds each drawImage on its own and leaves a sliver of the
  // background between them — the black grid over every tile, at the widest
  // zooms, that phones have been showing.
  //
  // Desktop is left alone on purpose: it renders through WebGL, has never had
  // the artefact, and filtering there would cost zoom steps for nothing.
  //
  // With the dpr rounded above this leaves 0.5/0.75/1/1.5/2 at dpr 2 and
  // 0.5/1/1.5/2 at dpr 1 — the default (0.5) survives on both. If some future
  // ladder left nothing at all, the unfiltered list is better than a zoom
  // control with no options in it.
  if (isTouchPointer()) {
    const whole = zooms.filter((z) => Number.isInteger(z));
    if (whole.length > 0) return whole;
  }
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

/**
 * True when this step renders crisp — which takes BOTH scalings landing whole:
 * the game into the backing store (0.5 * zoom), and the backing store onto the
 * screen (viewScale * the real dpr). They are the same number until render
 * scale is overridden; see CityScene.applyZoomSmoothing for the long version.
 *
 * Currently unused by the UI; kept in step with applyZoomSmoothing so the two
 * can never disagree about the same zoom.
 */
export function isCrisp(zoom: number): boolean {
  const realDpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const whole = (n: number) => n >= 1 && Math.abs(n - Math.round(n)) < 0.01;
  return whole(0.5 * zoom) && whole(viewScale(zoom) * realDpr);
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
