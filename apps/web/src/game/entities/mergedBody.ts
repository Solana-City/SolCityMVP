import * as Phaser from "phaser";

/**
 * One texture per outfit, instead of one sprite per paper-doll layer.
 *
 * A character is drawn as a stack: skin, face, pants, shirt, back, accessory,
 * hair, hat. That is up to eight sprites, each from its own texture, drawn
 * every frame — and the crowd is 40 of them on a phone and 96 on a desktop.
 * On the Canvas renderer (which mobile uses on purpose, see PhaserGame) each
 * one is a separate drawImage; on WebGL each texture change breaks the batch.
 *
 * The layers of a FIXED outfit never move relative to each other, so they can
 * be flattened once into a single sheet with the same 4x4 frame grid and
 * drawn as one sprite. The flattening is the same trick the silhouette shadow
 * already uses next door, minus the black fill, and the cache is keyed by the
 * exact stack of sheets so every pedestrian wearing the same clothes shares
 * one texture. Refcounted: the last wearer frees it.
 *
 * Only for characters whose outfit is fixed for their lifetime (pedestrians).
 * The player and remote players keep their layers, since they re-dress at
 * runtime and a merged sheet would have to be rebuilt on every change.
 */

const cache = new Map<string, number>();

function mergedKeyFor(textureKeys: string[]): string {
  return `body--${textureKeys.join("+")}`;
}

/**
 * Returns (creating and caching if needed) the flattened texture for this
 * stack of sheets, drawn bottom layer first. Every acquire must be paired
 * with a release.
 */
export function acquireMergedBodyTexture(
  scene: Phaser.Scene,
  textureKeys: string[],
  frameWidth: number,
  frameHeight: number,
): string | null {
  if (textureKeys.length < 2) return null; // nothing to merge
  const key = mergedKeyFor(textureKeys);

  const refs = cache.get(key);
  if (refs !== undefined && scene.textures.exists(key)) {
    cache.set(key, refs + 1);
    return key;
  }

  const src = scene.textures.get(textureKeys[0])?.source?.[0];
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
    // Sheets that failed to load are skipped rather than aborting the merge:
    // a missing hat is better than a character with no body.
    if (image) ctx.drawImage(image, 0, 0);
  }

  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.addCanvas(key, canvas);
  if (!tex) return null;
  (Phaser.Textures.Parsers as unknown as {
    SpriteSheet: (t: Phaser.Textures.Texture, i: number, x: number, y: number, w: number, h: number, c: object) => void;
  }).SpriteSheet(tex, 0, 0, 0, w, h, { frameWidth, frameHeight });

  cache.set(key, 1);
  return key;
}

/** Drops one reference; frees the texture once no character wears it. */
export function releaseMergedBodyTexture(scene: Phaser.Scene, key: string | null): void {
  if (!key) return;
  const refs = cache.get(key);
  if (refs === undefined) return;
  if (refs > 1) { cache.set(key, refs - 1); return; }
  cache.delete(key);
  try {
    // The walk animations registered against this texture must die with it,
    // or a later re-acquire of the same outfit would reuse animations whose
    // frames point at a destroyed texture. Same trap as the silhouette cache.
    for (const suffix of ["walk-down", "walk-left", "walk-right", "walk-up", "idle-loop"]) {
      scene.anims.remove(`${key}-${suffix}`);
    }
    scene.textures.remove(key);
  } catch {
    // Scene teardown may have destroyed the managers already.
  }
}
