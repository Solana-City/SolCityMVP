/**
 * The petting animation's sheet, picked to match the player's own base skin.
 *
 * Same system as the Kite Clash hands (minigames/kite-clash/assets.ts): the
 * spriter draws one sheet per base, and the hand doing the petting is then the
 * hand of the character the player built. The wardrobe calls that trait
 * "base"; the loadout calls it `skin`.
 */
import { loadSavedLoadout } from "../config/paperDoll";

const BASE = "/assets/pet";

/**
 * Paper-doll base skin id -> its own sheet. Only the sheets that exist are
 * listed, so nothing ever asks the network for art that has not been drawn:
 * everything else falls back to DEFAULT_SHEET below.
 *
 * As each one lands, add a line here. No other code changes.
 *
 *   Light | Feyan | Laovai | Pinki | Radio | Brown | Dark_brown
 */
const SHEET_BY_SKIN: Record<string, string> = {};

/** The one sheet everybody gets until the per-skin art lands. */
const DEFAULT_SHEET = "pet_caramel_dog.png";

/**
 * Frames in a sheet, laid out left to right in a single row. The frame WIDTH
 * is not declared: it is the image's own width divided by this, so the artist
 * can ship whatever size the drawing needs.
 */
export const PET_FRAMES = 4;

/** How long one frame is held. Four frames at this is a calm, deliberate pat. */
export const PET_FRAME_MS = 180;

/** How many times the loop plays before the square closes itself. */
export const PET_LOOPS = 4;

export function petSheetUrl(): string {
  const skin = loadSavedLoadout().skin ?? "Light";
  return `${BASE}/${SHEET_BY_SKIN[skin] ?? DEFAULT_SHEET}`;
}
