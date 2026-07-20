/**
 * Pixel-art assets for Kite Clash (public/assets/minigames/kite).
 *
 * Loading is fire-and-forget: every render helper in the engine falls back
 * to its primitive-placeholder drawing for any image that hasn't finished
 * loading, so the game stays playable even on a cold cache.
 */
import { loadSavedLoadout } from "../../config/paperDoll";

const BASE = "/assets/minigames/kite";

// Paper-doll skin id → first-person hands sprite. The spriter ships one
// hands sheet per base skin so the minigame matches the player's avatar.
const HANDS_BY_SKIN: Record<string, string> = {
  Light:  "hands_human.png",
  Feyan:  "hands_feyan.png",
  Laovai: "hands_laovai.png",
  Pinki:  "hands_pinky.png",
  Radio:  "hands_radio.png",
};

// Animated spool spritesheets (2400x200 = 4 frames of 600x200, drawn at the
// same on-screen size as the 300x100 static). Radio has no sheet yet — it
// falls back to the static hands.
const HANDS_SHEET_BY_SKIN: Record<string, string | null> = {
  Light:  "hands_human_sheet.png",
  Feyan:  "hands_feyan_sheet.png",
  Laovai: "hands_laovai_sheet.png",
  Pinki:  "hands_pinky_sheet.png",
  Radio:  null,
};

export const HANDS_SHEET_FRAMES = 4;
export const HANDS_SHEET_FRAME_W = 600;
export const HANDS_SHEET_FRAME_H = 200;

export interface KiteAssets {
  /** 704x384 sky + sea backdrop. */
  background: HTMLImageElement;
  /** 704x28 railing strip along the bottom edge. */
  border: HTMLImageElement;
  /** 72x76 seagull perched on the railing. */
  bird: HTMLImageElement;
  /** 26x36 sailboat drifting on the sea band. */
  ship: HTMLImageElement;
  /** 300x100 first-person hands; spool center at (50%, 34%). */
  hands: HTMLImageElement;
  /** Animated spool sheet for the same skin — null when not shipped yet. */
  handsSheet: HTMLImageElement | null;
  /** Kites (dimensions vary per sprite — read naturalWidth/Height). */
  kitePlayer: HTMLImageElement;
  kiteRival: HTMLImageElement;
  kiteStb: HTMLImageElement;
  clouds: HTMLImageElement[];
}

function img(path: string): HTMLImageElement {
  const el = new Image();
  el.src = `${BASE}/${path}`;
  return el;
}

export function loadKiteAssets(): KiteAssets {
  const skin = loadSavedLoadout().skin ?? "Light";
  const sheetFile = HANDS_SHEET_BY_SKIN[skin] ?? "hands_human_sheet.png";
  return {
    background: img("background.png"),
    border: img("details/border.png"),
    bird: img("details/bird1.png"),
    ship: img("details/ship_small1.png"),
    hands: img(`hands/${HANDS_BY_SKIN[skin] ?? "hands_human.png"}`),
    handsSheet: sheetFile ? img(`hands/${sheetFile}`) : null,
    kitePlayer: img("kites/kite_brazil.png"),
    kiteRival: img("kites/kite_solana.png"),
    kiteStb: img("kites/kite_stb.png"),
    clouds: [
      "cloud_small1.png", "cloud_small2.png", "cloud_small3.png",
      "cloud_small4.png", "cloud_small5.png", "cloud_small6.png",
      "cloud_big1.png", "cloud_big2.png", "cloud_big3.png",
      "cloud_huge.png",
    ].map(f => img(`details/${f}`)),
  };
}

export function ready(i: HTMLImageElement | null | undefined): i is HTMLImageElement {
  return !!i && i.complete && i.naturalWidth > 0;
}
