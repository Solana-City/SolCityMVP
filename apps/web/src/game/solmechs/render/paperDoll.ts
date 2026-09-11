/**
 * Sol Mechs — which paper doll the build draws with.
 *
 * Both part formats ship side by side while the new art is being evaluated.
 * `?parts=v2` switches to the 128x128 set, `?parts=v1` switches back, and the
 * choice is remembered in localStorage so it survives navigating into the
 * city and back. Default is v1.
 *
 * Decided once, at module load: the doll dimensions feed module-level layout
 * constants in the renderer, so flipping formats mid-session would leave them
 * describing the wrong box. A reload applies a change.
 */
import * as V1 from "./MechPaperDoll";
import * as V2 from "./MechPaperDollV2";

const STORAGE_KEY = "solmechs:parts";

function readFlag(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const q = new URLSearchParams(window.location.search).get("parts");
    if (q === "v1" || q === "v2") window.localStorage.setItem(STORAGE_KEY, q);
    return window.localStorage.getItem(STORAGE_KEY) === "v2";
  } catch {
    return false;
  }
}

export const PARTS_V2 = readFlag();

export type MechBounds = V1.MechBounds;

export const DOLL_WIDTH: number = PARTS_V2 ? V2.DOLL_WIDTH : V1.DOLL_WIDTH;
export const DOLL_HEIGHT: number = PARTS_V2 ? V2.DOLL_HEIGHT : V1.DOLL_HEIGHT;
export const drawMech: typeof V1.drawMech = PARTS_V2 ? V2.drawMech : V1.drawMech;
export const slotAnchor: typeof V1.slotAnchor = PARTS_V2 ? V2.slotAnchor : V1.slotAnchor;
export const preloadBuild: typeof V1.preloadBuild = PARTS_V2 ? V2.preloadBuild : V1.preloadBuild;
export const preloadAll: typeof V1.preloadAll = PARTS_V2 ? V2.preloadAll : V1.preloadAll;
export const mechBounds: typeof V1.mechBounds = PARTS_V2 ? V2.mechBounds : V1.mechBounds;

/**
 * Ink height of a typical assembled mech, in doll pixels.
 *
 * The arena sizes mechs by this rather than by a fixed scale: the 128px set is
 * ~40% taller in the frame than the 64px one, so the same 2x that suited the
 * old parts made the new ones tower over the ring and run up under the HUD.
 */
export const INK_HEIGHT: number = PARTS_V2 ? 112 : 80;
