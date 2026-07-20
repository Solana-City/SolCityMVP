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

const cache = new Map<string, { refs: number }>();

function silhouetteKeyFor(textureKeys: string[]): string {
  return `shadow--${textureKeys.join("+")}`;
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
): string | null {
  if (textureKeys.length === 0) return null;
  const key = silhouetteKeyFor(textureKeys);

  const entry = cache.get(key);
  if (entry && scene.textures.exists(key)) {
    entry.refs++;
    return key;
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

  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.addCanvas(key, canvas);
  if (!tex) return null;
  (Phaser.Textures.Parsers as any).SpriteSheet(tex, 0, 0, 0, w, h, { frameWidth, frameHeight });

  cache.set(key, { refs: 1 });
  return key;
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
    scene.textures.remove(key);
  } catch {
    // Scene teardown may have already destroyed the texture manager.
  }
}
