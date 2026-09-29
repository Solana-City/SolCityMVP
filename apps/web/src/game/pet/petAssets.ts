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
 * everything else falls back to DEFAULT_SHEET below, which is why every base
 * currently pets the dog with the same hand.
 *
 * The filenames follow the Kite Clash hands, spelling and all, so the spriter
 * exports both sets the same way. As each one lands, add its line here and
 * nothing else changes:
 *
 *   Light      dog_human_sheet.png
 *   Feyan      dog_feyan_sheet.png
 *   Laovai     dog_laovai_sheet.png
 *   Pinki      dog_pinky_sheet.png
 *   Radio      dog_radio_sheet.png
 *   Brown      dog_brown_sheet.png
 *   Dark_brown dog_dark_brown_sheet.png
 */
const SHEET_BY_SKIN: Record<string, string> = {
  Pinki: "dog_pinky_sheet.png",
};

/** The one sheet everybody else gets until their own art lands. */
const DEFAULT_SHEET = "dog_pinky_sheet.png";

/**
 * Frames in a sheet, laid out left to right in a single row. The frame WIDTH
 * is not declared: it is the image's own width divided by this, so the artist
 * can ship whatever size the drawing needs. The first sheet is 452x113, four
 * square 113px frames.
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
