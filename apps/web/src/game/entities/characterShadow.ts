import * as Phaser from "phaser";

/**
 * Silhouette shadow textures for characters.
 *
 * A shadow texture is a black-ink copy of a character sheet — or a composite
 * of several paper-doll layer sheets — with the original alpha preserved and
 * the same 4x4 frame grid. Displayed as ONE squashed, vertically mirrored,
 * translucent sprite under the character, it projects the character's actual
 * current outline (hat, hair, backpack — every equipped trait) and animates
 * in sync with the walk cycle, at the cost of a single extra sprite per
 * character.
 *
 * Compositing into one texture (instead of stacking tinted copies of each
 * layer) is what keeps the shadow's opacity uniform: translucent black
 * layers drawn on top of each other would double-darken wherever clothes
 * overlap skin.
 *
 * Textures are cached by the exact set of source sheets and refcounted, so
 * every pedestrian with the same outfit shares one texture and abandoned
 * combinations are freed when their last wearer is destroyed.
 */

export const SHADOW_ALPHA = 0.28;
/** Vertical squash of the mirrored silhouette (fraction of body height). */
export const SHADOW_SQUASH = 0.45;

/** Contact blob under the feet — the soft oval that grounds the character.
 *  Layered UNDER the silhouette; where they overlap the shadow darkens
 *  naturally, reading as contact occlusion. */
export const BLOB_ALPHA = 0.12;
/** Blob height as a fraction of its width. */
export const BLOB_FLATNESS = 0.26;

/**
 * Creates the elliptical contact blob. `footY` is the container-local feet
 * line; the ellipse centers there so its top half tucks behind the body.
 */
export function createContactBlob(
  scene: Phaser.Scene,
  footY: number,
  widthPx: number,
): Phaser.GameObjects.Ellipse {
  return scene.add.ellipse(0, footY, widthPx, widthPx * BLOB_FLATNESS, 0x000000, BLOB_ALPHA);
}

const cache = new Map<string, { refs: number; bottomPad: number }>();

function silhouetteKeyFor(textureKeys: string[]): string {
  return `shadow--${textureKeys.join("+")}`;
}

export interface SilhouetteTexture {
  key: string;
  /**
   * Empty source rows between the character's lowest inked pixel and the
   * frame bottom. Mirroring doubles this margin into a visible gap between
   * feet and shadow — callers shift the shadow up by 2x this (scaled) so
   * the silhouette's feet meet the character's feet exactly.
   */
  bottomPad: number;
}

/**
 * Returns (creating and caching if needed) the silhouette texture for the
 * given stack of sheets. Every acquire must be paired with a release.
 */
export function acquireSilhouetteTexture(
  scene: Phaser.Scene,
  textureKeys: string[],
  frameWidth: number,
  frameHeight: number,
): SilhouetteTexture | null {
  if (textureKeys.length === 0) return null;
  const key = silhouetteKeyFor(textureKeys);

  const entry = cache.get(key);
  if (entry && scene.textures.exists(key)) {
    entry.refs++;
    return { key, bottomPad: entry.bottomPad };
  }

  const first = scene.textures.get(textureKeys[0]);
  const src = first?.source?.[0];
  if (!src || !src.width) return null;
  const w = src.width;
  const h = src.height;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  for (const tk of textureKeys) {
    const image = scene.textures.get(tk)?.source?.[0]?.image as CanvasImageSource | undefined;
    if (image) ctx.drawImage(image, 0, 0);
  }
  // Flatten every opaque pixel to black while keeping the combined alpha —
  // one fill instead of a per-pixel loop.
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);

  // Measure the empty margin below the feet: for each frame band, find the
  // lowest inked row; the band whose art reaches furthest down defines the
  // padding (min across bands), so the anchor never overshoots.
  let bottomPad = 0;
  try {
    const data = ctx.getImageData(0, 0, w, h).data;
    const bands = Math.max(1, Math.floor(h / frameHeight));
    let minPad = frameHeight;
    for (let band = 0; band < bands; band++) {
      const rowStart = band * frameHeight;
      let lastInked = -1;
      for (let y = frameHeight - 1; y >= 0; y--) {
        const rowOffset = (rowStart + y) * w * 4;
        for (let x = 0; x < w; x++) {
          if (data[rowOffset + x * 4 + 3] > 10) { lastInked = y; break; }
        }
        if (lastInked >= 0) break;
      }
      if (lastInked >= 0) minPad = Math.min(minPad, frameHeight - 1 - lastInked);
    }
    if (minPad < frameHeight) bottomPad = minPad;
  } catch {
    // Reading pixels can fail on exotic sources — a zero pad only costs a
    // slightly lower shadow, never a crash.
  }

  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.addCanvas(key, canvas);
  if (!tex) return null;
  (Phaser.Textures.Parsers as any).SpriteSheet(tex, 0, 0, 0, w, h, { frameWidth, frameHeight });

  cache.set(key, { refs: 1, bottomPad });
  return { key, bottomPad };
}

/** Drops one reference; frees the texture once no character uses it. */
export function releaseSilhouetteTexture(scene: Phaser.Scene, key: string | null): void {
  if (!key) return;
  const entry = cache.get(key);
  if (!entry) return;
  entry.refs--;
  if (entry.refs > 0) return;
  cache.delete(key);
  try {
    // The animations registered for this texture MUST die with it. They
    // live in the global AnimationManager holding references to the
    // texture's frames; if the same silhouette key is ever re-acquired
    // (e.g. toggling outfits back and forth in the wardrobe), the consumer's
    // "anims.exists(key) → skip create" check would happily reuse the stale
    // animation whose frames point at the DESTROYED texture — crashing the
    // next walk() with "Cannot read properties of null (reading
    // 'sourceSize')".
    for (const suffix of ["walk-down", "walk-left", "walk-right", "walk-up", "idle-loop"]) {
      scene.anims.remove(`${key}-${suffix}`);
    }
    scene.textures.remove(key);
  } catch {
    // Scene teardown may have already destroyed the managers.
  }
}
