/**
 * Sol Mechs — which paper doll the build draws with.
 *
 * Both part formats still ship. The 128x128 set is the default; `?parts=v1`
 * switches to the old 64x64 set and `?parts=v2` back, and the choice is
 * remembered in localStorage so it survives navigating into the city.
 *
 * Decided once, at module load: the doll dimensions feed module-level layout
 * constants in the renderer, so flipping formats mid-session would leave them
 * describing the wrong box. A reload applies a change.
 */
import * as V1 from "./MechPaperDoll";
import * as V2 from "./MechPaperDollV2";
import { MATRICES, getPartsForSlot } from "../data/catalog";
import type { MechBuild } from "../data/types";

const STORAGE_KEY = "solmechs:parts";

function readFlag(): boolean {
  try {
    if (typeof window === "undefined") return true;
    const q = new URLSearchParams(window.location.search).get("parts");
    if (q === "v1" || q === "v2") window.localStorage.setItem(STORAGE_KEY, q);
    return window.localStorage.getItem(STORAGE_KEY) !== "v1";
  } catch {
    return true;
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

let stableCache: MechBounds | null = null;

/**
 * One crop box that fits EVERY assembly: the union of the bounds of each
 * chassis wearing each part in each slot.
 *
 * Previews used to crop to the build on screen, and the preview is scaled to
 * fit its box, so swapping a long arm for a short one rescaled the whole mech.
 * Cropping every build to the same box keeps the mech the same size and
 * standing in the same place whatever it is wearing.
 *
 * Arm reach doesn't depend on the other arm, so varying one slot at a time
 * off each chassis covers every combination. Null until all art has decoded.
 */
export function stableBounds(): MechBounds | null {
  if (stableCache) return stableCache;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const m of MATRICES) {
    const base: MechBuild = { matrixCode: m.matrixCode, rightArm: "RA01", leftArm: "LA01", lowerBody: "IN01" };
    for (const slot of ["rightArm", "leftArm", "lowerBody"] as const) {
      for (const part of getPartsForSlot(slot)) {
        const b = mechBounds({ ...base, [slot]: part.partCode });
        if (!b) return null;
        x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
        x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
      }
    }
  }
  stableCache = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  return stableCache;
}

/**
 * Ink height of a typical assembled mech, in doll pixels.
 *
 * The arena sizes mechs by this rather than by a fixed scale: the 128px set is
 * ~40% taller in the frame than the 64px one, so the same 2x that suited the
 * old parts made the new ones tower over the ring and run up under the HUD.
 */
export const INK_HEIGHT: number = PARTS_V2 ? 112 : 80;

/**
 * Tallest mech ANY combination of parts can assemble into, in doll pixels —
 * highest top of any part to lowest bottom of any part, measured off the
 * shipped PNGs. The arena uses it to guarantee a head never reaches the HUD,
 * whatever the player has built.
 */
export const INK_MAX_HEIGHT: number = PARTS_V2 ? 113 : 84;
