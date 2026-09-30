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
 * Paper-doll base skin id -> its own sheet. All seven are drawn now, so the
 * hand on the dog is the hand of the character the player actually built.
 *
 * The filenames follow the Kite Clash hands, spelling and all, so the spriter
 * exports both sets the same way.
 *
 * Which sheet belongs to which base was not read off the filenames the art
 * arrived under, because it did not arrive under any. It was matched on the
 * arm: each sheet's arm carries exactly one main tone and one shadow tone,
 * and both pairs match a Kite Clash hands sheet for the same seven bases
 * exactly, with no two bases close enough to confuse.
 */
const SHEET_BY_SKIN: Record<string, string> = {
  Light:      "dog_human_sheet.png",
  Feyan:      "dog_feyan_sheet.png",
  Laovai:     "dog_laovai_sheet.png",
  Pinki:      "dog_pinky_sheet.png",
  Radio:      "dog_radio_sheet.png",
  Brown:      "dog_brown_sheet.png",
  Dark_brown: "dog_dark_brown_sheet.png",
};

/**
 * For a loadout naming a base this does not know — art mid-rename, or a save
 * from a build with a base that has since gone. Light is the paper doll's own
 * default, so it is the least surprising hand to borrow.
 */
const DEFAULT_SHEET = "dog_human_sheet.png";

/**
 * Frames in a sheet, laid out left to right in a single row. The frame WIDTH
 * is not declared: it is the image's own width divided by this, so the artist
 * can ship whatever size the drawing needs. Every sheet is 452x113, four
 * square 113px frames.
 *
 * The seven arrived as 904x113 — the same four frames, then those same four
 * frames again, byte for byte. They are stored here as the one cycle, which
 * is the format this already had and keeps the pat at the speed it was tuned
 * to. If a sheet ever ships a genuinely longer cycle, this number is the only
 * thing that changes.
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
