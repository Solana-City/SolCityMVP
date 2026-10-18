/**
 * Vignettes: the short first-person animations that play in a square in the
 * middle of the screen. Petting the Caramel Dog, drinking DOM's tea.
 *
 * Every one is drawn per base skin, the way the Kite Clash hands are, so the
 * hands in the square are the hands of the character the player built. The
 * wardrobe calls that trait "base"; the loadout calls it `skin`.
 */
import { loadSavedLoadout } from "../config/paperDoll";

export type VignetteId = "pet-caramel-dog" | "tea-ceremony";

export interface Vignette {
  id: VignetteId;
  /** Folder under /public holding this vignette's sheets. */
  base: string;
  /**
   * Paper-doll base skin id -> its own sheet. Anything missing falls back to
   * `defaultSheet`, so a base whose art is not drawn yet still plays rather
   * than showing nothing.
   *
   * The filenames follow the Kite Clash hands, spelling and all, so the
   * spriter exports every set the same way.
   */
  sheetBySkin: Record<string, string>;
  defaultSheet: string;
  /**
   * Frames, laid out left to right in a single row. The frame WIDTH is not
   * declared anywhere: the overlay divides the image's own width by this, so
   * a sheet can be redrawn at any size without a code change.
   */
  frames: number;
  /** How long one frame is held. */
  frameMs: number;
  /** How many times the loop plays before the square closes itself. */
  loops: number;
}

export const VIGNETTES: Record<VignetteId, Vignette> = {
  "pet-caramel-dog": {
    id: "pet-caramel-dog",
    base: "/assets/pet",
    sheetBySkin: {
      Light:      "dog_human_sheet.png",
      Feyan:      "dog_feyan_sheet.png",
      Laovai:     "dog_laovai_sheet.png",
      Pinki:      "dog_pinky_sheet.png",
      Radio:      "dog_radio_sheet.png",
      Brown:      "dog_brown_sheet.png",
      Dark_brown: "dog_dark_brown_sheet.png",
    },
    defaultSheet: "dog_human_sheet.png",
    // 452x113: four square frames of a hand working down the dog's head.
    frames: 4,
    frameMs: 180,
    loops: 4,
  },
  "tea-ceremony": {
    id: "tea-ceremony",
    base: "/assets/tea",
    sheetBySkin: {
      Light:      "tea_human_sheet.png",
      Feyan:      "tea_feyan_sheet.png",
      Laovai:     "tea_laovai_sheet.png",
      Pinki:      "tea_pinky_sheet.png",
      Radio:      "tea_radio_sheet.png",
      Brown:      "tea_brown_sheet.png",
      Dark_brown: "tea_dark_brown_sheet.png",
    },
    defaultSheet: "tea_human_sheet.png",
    // 904x113: eight square frames, the cup lifted and set back down. Two
    // passes run about as long as the dog's four shorter ones.
    frames: 8,
    frameMs: 180,
    loops: 2,
  },
};

export function vignetteSheetUrl(vignette: Vignette): string {
  const skin = loadSavedLoadout().skin ?? "Light";
  return `${vignette.base}/${vignette.sheetBySkin[skin] ?? vignette.defaultSheet}`;
}
