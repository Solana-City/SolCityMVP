import * as Phaser from "phaser";
import {
  acquireSilhouetteTexture,
  releaseSilhouetteTexture,
  createContactBlob,
  SHADOW_ALPHA,
  SHADOW_SQUASH,
} from "./characterShadow";
import {
  Direction,
  DIRECTION_ROW,
  SPRITE_FRAME_WIDTH,
  SPRITE_FRAME_HEIGHT,
  SPRITE_COLS,
  SPRITE_ROWS,
  LAYER_ORDER,
  LayerCategory,
  Loadout,
  DEFAULT_LOADOUT,
  getVariant,
} from "../config/paperDoll";

/** Reads a loaded texture's pixel data onto a throwaway canvas once. */
function readTexturePixels(scene: Phaser.Scene, textureKey: string): { data: Uint8ClampedArray; w: number; h: number } | null {
  try {
    const texture = scene.textures.get(textureKey);
    const source = texture.source[0];
    const img = source.image as CanvasImageSource;
    const w = source.width;
    const h = source.height;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    return { data: ctx.getImageData(0, 0, w, h).data, w, h };
  } catch {
    return null;
  }
}

// Cache: hat textureKey -> per-direction-row array of per-column topmost
// opaque row (row-relative y, 0..SPRITE_FRAME_HEIGHT). SPRITE_FRAME_HEIGHT
// in a given column means "the hat has no ink in that column for that
// direction" — i.e. don't mask hair there at all.
const hatColumnCutoffsCache = new Map<string, number[][]>();

/**
 * Per-column, per-direction hat silhouette scan — for every column x (across
 * the full sheet width, so all 4 walk frames are covered independently) and
 * every direction row, finds the topmost row containing any non-transparent
 * pixel. A flat row-wide cutoff (this function's previous version) only
 * handles hair that's taller than the hat; it can't stop hair from showing
 * past the hat's left/right edges — a bare/skinny hat column next to a wide
 * afro or mohawk left hair visible at the same height the hat sits, just to
 * the side of it. Masking per column instead follows the hat's actual
 * silhouette, which is the standard technique for this in sprite-layered
 * games (occluder's own shape, not just its bounding height).
 *
 * Only correct for "full" coverage items (caps/helmets/crowns) that enclose
 * everything above their own brim — see getHatOpaquePixels for "band" items
 * like a headband, which must NOT hide the crown above them.
 */
function getHatColumnCutoffs(scene: Phaser.Scene, hatTextureKey: string): number[][] {
  const cached = hatColumnCutoffsCache.get(hatTextureKey);
  if (cached !== undefined) return cached;

  const bands: number[][] = [[], [], [], []];
  const pixels = readTexturePixels(scene, hatTextureKey);
  if (pixels) {
    const { data, w: sheetW } = pixels;
    for (let band = 0; band < SPRITE_ROWS; band++) {
      const rowStart = band * SPRITE_FRAME_HEIGHT;
      const cutoffs = new Array<number>(sheetW).fill(SPRITE_FRAME_HEIGHT);
      for (let x = 0; x < sheetW; x++) {
        for (let y = 0; y < SPRITE_FRAME_HEIGHT; y++) {
          if (data[((rowStart + y) * sheetW + x) * 4 + 3] > 10) {
            cutoffs[x] = y;
            break;
          }
        }
      }
      bands[band] = cutoffs;
    }
  } // else: bands stay all-SPRITE_FRAME_HEIGHT ("no masking")

  hatColumnCutoffsCache.set(hatTextureKey, bands);
  return bands;
}

// Cache: hat textureKey -> its own opaque-pixel bitmap (1 = opaque), full
// sheet size. Used for "band" items — mask hair only exactly under the
// band's own ink, nothing above or below it.
const hatOpaqueMaskCache = new Map<string, { mask: Uint8Array; w: number; h: number } | null>();

function getHatOpaqueMask(scene: Phaser.Scene, hatTextureKey: string): { mask: Uint8Array; w: number; h: number } | null {
  if (hatOpaqueMaskCache.has(hatTextureKey)) return hatOpaqueMaskCache.get(hatTextureKey)!;

  const pixels = readTexturePixels(scene, hatTextureKey);
  let result: { mask: Uint8Array; w: number; h: number } | null = null;
  if (pixels) {
    const { data, w, h } = pixels;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] > 10 ? 1 : 0;
    result = { mask, w, h };
  }
  hatOpaqueMaskCache.set(hatTextureKey, result);
  return result;
}

// Cache: `${hairTextureKey}--${hatTextureKey}--${coverage}` -> derived,
// capped-hair texture key.
const cappedHairTextureCache = new Map<string, string>();

/**
 * Returns a texture key for the hair sheet with the equipped hat's coverage
 * erased from it, so hair doesn't show where a hat/headband should hide it.
 * Generates the derived texture once per (hair, hat) pair and reuses it
 * after; returns the original hairTextureKey unchanged if the hat has no
 * measurable coverage (e.g. its texture failed to load) or no hat is
 * equipped.
 *
 * Two coverage styles (LayerVariant.hatCoverage, default "full"):
 *   "full" — a cap/helmet/crown that encloses the top of the head. Erases
 *     hair from the top of the frame down to each column's own hat cutoff
 *     (see getHatColumnCutoffs) — correct for hair poking out above or
 *     beside the hat, wrong for a band (would bald the whole crown).
 *   "band" — a headband/bandana that only wraps the forehead. Erases hair
 *     ONLY exactly where the band's own pixels are opaque, leaving the
 *     crown above it and everything below it untouched.
 */
function getHairTextureFor(
  scene: Phaser.Scene,
  hairTextureKey: string,
  hatTextureKey: string | undefined,
  // "suppress" is handled by the caller (skips the hair layer outright) —
  // never actually reaches here, but accepted in the type since callers
  // pass a hat variant's hatCoverage straight through.
  hatCoverage: "full" | "band" | "suppress" = "full",
): string {
  if (!hatTextureKey || !scene.textures.exists(hatTextureKey)) return hairTextureKey;

  const cacheKey = `${hairTextureKey}--capped--${hatTextureKey}--${hatCoverage}`;
  if (cappedHairTextureCache.has(cacheKey)) return cappedHairTextureCache.get(cacheKey)!;
  if (scene.textures.exists(cacheKey)) {
    cappedHairTextureCache.set(cacheKey, cacheKey);
    return cacheKey;
  }

  const hairPixels = readTexturePixels(scene, hairTextureKey);
  if (!hairPixels) return hairTextureKey;
  const { w, h } = hairPixels;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const hairTexture = scene.textures.get(hairTextureKey);
  ctx.drawImage(hairTexture.source[0].image as CanvasImageSource, 0, 0);
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  let masked = false;

  if (hatCoverage === "band") {
    const hatMask = getHatOpaqueMask(scene, hatTextureKey);
    if (hatMask) {
      const n = Math.min(hatMask.mask.length, w * h);
      for (let i = 0; i < n; i++) {
        if (hatMask.mask[i]) { data[i * 4 + 3] = 0; masked = true; }
      }
    }
  } else {
    const bands = getHatColumnCutoffs(scene, hatTextureKey);
    if (bands.some(cutoffs => cutoffs.some(c => c < SPRITE_FRAME_HEIGHT))) {
      for (let band = 0; band < SPRITE_ROWS && band < bands.length; band++) {
        const rowStart = band * SPRITE_FRAME_HEIGHT;
        const cutoffs = bands[band];
        for (let x = 0; x < w; x++) {
          const cutoff = cutoffs[x] ?? SPRITE_FRAME_HEIGHT;
          for (let y = rowStart; y < rowStart + cutoff; y++) {
            data[(y * w + x) * 4 + 3] = 0;
          }
        }
      }
      masked = true;
    }
  }

  if (!masked) {
    cappedHairTextureCache.set(cacheKey, hairTextureKey);
    return hairTextureKey; // nothing to mask against — skip generating a derived texture
  }

  ctx.putImageData(imageData, 0, 0);

  const newTex = scene.textures.addCanvas(cacheKey, canvas);
  (Phaser.Textures.Parsers as any).SpriteSheet(
    newTex, 0, 0, 0, w, h,
    { frameWidth: SPRITE_FRAME_WIDTH, frameHeight: SPRITE_FRAME_HEIGHT }
  );

  cappedHairTextureCache.set(cacheKey, cacheKey);
  return cacheKey;
}

/**
 * A paper doll avatar made of stacked sprite layers (skin, eyes/face, hair,
 * t-shirt, pants, backpack, hat, ...). Each layer is its own
 * Phaser.GameObjects.Sprite sharing position and animation frame.
 *
 * Usage:
 *   const avatar = new AvatarSprite(scene, x, y);
 *   avatar.walk("left");
 *   avatar.idle();
 *   avatar.setLayer("hat", "cap");
 */
export class AvatarSprite {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private layerSprites: Map<LayerCategory, Phaser.GameObjects.Sprite> = new Map();
  /** Single silhouette sprite mirrored under the feet — see characterShadow. */
  private shadowSprite: Phaser.GameObjects.Sprite | null = null;
  private shadowTextureKey: string | null = null;
  /** Soft oval under the feet that grounds the character. */
  private contactBlob: Phaser.GameObjects.Ellipse | null = null;
  private currentDirection: Direction = "down";
  private currentLoadout: Loadout;
  private isWalking = false;

  constructor(scene: Phaser.Scene, x: number, y: number, loadout: Loadout = DEFAULT_LOADOUT) {
    this.scene = scene;
    this.currentLoadout = { ...loadout };
    this.container = scene.add.container(x, y);
    this.buildLayers();
  }

  get x(): number { return this.container.x; }
  set x(v: number) { this.container.x = v; }

  get y(): number { return this.container.y; }
  set y(v: number) { this.container.y = v; }

  get depth(): number { return this.container.depth; }
  set depth(v: number) { this.container.depth = v; }

  getContainer(): Phaser.GameObjects.Container {
    return this.container;
  }

  /** Replaces a single layer category (e.g. swap hats). Pass undefined to remove the layer. */
  setLayer(category: LayerCategory, variantId: string | undefined): void {
    if (this.currentLoadout[category] === variantId) return;
    this.currentLoadout = { ...this.currentLoadout, [category]: variantId };
    this.destroyLayers();
    this.buildLayers();
  }

  /** Replaces the entire loadout at once. */
  setLoadout(loadout: Loadout): void {
    this.currentLoadout = { ...loadout };
    this.destroyLayers();
    this.buildLayers();
  }

  getLoadout(): Loadout {
    return { ...this.currentLoadout };
  }

  /**
   * Temporarily swaps the eyesFace layer to an expression sheet (pass its
   * texture key) or reverts to the loadout's chosen face (pass null). Only
   * the face-layer sprite is touched — a face swap doesn't change the body
   * outline, so the silhouette shadow is left alone. Auto-revert timing is
   * the caller's responsibility (see CityScene).
   */
  setExpression(exprTextureKey: string | null): void {
    const sprite = this.layerSprites.get("eyesFace");
    if (!sprite) return;
    const baseKey = getVariant("eyesFace", this.currentLoadout.eyesFace)?.textureKey;
    const targetKey = exprTextureKey ?? baseKey;
    if (!targetKey || !this.scene.textures.exists(targetKey)) return;
    if (sprite.texture.key === targetKey) return;

    sprite.setTexture(targetKey);
    this.registerAnimations(targetKey);
    // Re-sync the face to the current walk/idle pose after the swap.
    if (this.isWalking) {
      const key = `${targetKey}-walk-${this.currentDirection}`;
      const anim = this.scene.anims.get(key);
      if (anim && anim.frames.length) {
        sprite.anims.play({ key, startFrame: Math.min(1, anim.frames.length - 1) });
      }
    } else {
      sprite.anims.stop();
      sprite.setFrame(DIRECTION_ROW[this.currentDirection] * SPRITE_COLS);
    }
  }

  /**
   * Plays the walk animation for the given direction.
   */
  walk(direction: Direction): void {
    this.currentDirection = direction;
    this.isWalking = true;
    for (const sprite of this.animatedSprites()) {
      const key = `${sprite.texture.key}-walk-${direction}`;
      const anim = this.scene.anims.get(key);
      if (!anim || anim.frames.length === 0) continue;
      // Already playing this exact animation — let it continue from the current frame.
      if (sprite.anims.isPlaying && sprite.anims.currentAnim?.key === key) continue;
      // Start at frame 1 (mid-stride) so even a single-frame tap shows visible movement.
      // Frame 0 is the neutral/idle pose — starting there looks like no animation at all.
      sprite.anims.play({ key, startFrame: Math.min(1, anim.frames.length - 1) });
    }
  }

  /**
   * Stops walking and shows the idle frame for the current direction.
   */
  idle(): void {
    if (!this.isWalking) return;
    this.isWalking = false;
    const row = DIRECTION_ROW[this.currentDirection];
    for (const sprite of this.animatedSprites()) {
      sprite.anims.stop();
      sprite.setFrame(row * SPRITE_COLS);
    }
  }

  /** All sprites that follow the walk cycle — the layers plus the shadow. */
  private animatedSprites(): Phaser.GameObjects.Sprite[] {
    const sprites: Phaser.GameObjects.Sprite[] = [...this.layerSprites.values()];
    if (this.shadowSprite) sprites.push(this.shadowSprite);
    return sprites;
  }

  /**
   * Sets the depth based on the Y position (for depth sorting).
   */
  updateDepth(): void {
    this.container.depth = this.container.y;
  }

  destroy(): void {
    this.destroyLayers();
    this.container.destroy();
  }

  // ── Internal ──────────────────────────────────────────

  private buildLayers(): void {
    const FOOT_Y_LOCAL = -2;
    const hatVariant = getVariant("hat", this.currentLoadout.hat);

    for (const category of LAYER_ORDER) {
      const variant = getVariant(category, this.currentLoadout[category]);
      if (!variant || !this.scene.textures.exists(variant.textureKey)) continue;

      // A "suppress" hat (e.g. Ninja) hides hair entirely — its own
      // silhouette is narrower than some wide hairstyles, and per-column
      // masking still leaves a sliver visible past its edges, which looks
      // wrong for something meant to enclose the whole head.
      if (category === "hair" && hatVariant?.hatCoverage === "suppress") continue;

      // Hair is otherwise capped to the equipped hat's coverage so it
      // doesn't show where the hat should hide it (see getHairTextureFor
      // for the two remaining styles — a full cap vs. a forehead-only band).
      const textureKey = category === "hair"
        ? getHairTextureFor(this.scene, variant.textureKey, hatVariant?.textureKey, hatVariant?.hatCoverage)
        : variant.textureKey;

      const sprite = this.scene.add.sprite(0, FOOT_Y_LOCAL, textureKey);
      sprite.setOrigin(0.5, 1.0);

      // Native 64x64 sheets render at 0.5x world scale (2x camera zoom cancels to 1:1),
      // matching SimpleSprite's pixel-perfect convention.
      const frame = this.scene.textures.get(textureKey).get(0);
      if ((frame.height || SPRITE_FRAME_HEIGHT) >= 56) {
        sprite.setScale(0.5);
      }

      this.container.add(sprite);
      this.layerSprites.set(category, sprite);
      this.registerAnimations(textureKey);
    }

    this.buildShadow();

    // Set initial idle frame
    const row = DIRECTION_ROW[this.currentDirection];
    for (const sprite of this.animatedSprites()) {
      sprite.setFrame(row * SPRITE_COLS);
    }
  }

  /**
   * One silhouette sprite composited from every equipped layer — the shadow
   * matches the character's actual outline, traits included. Mirrored below
   * the feet, squashed, translucent, animated with the same walk cycle.
   */
  private buildShadow(): void {
    const layerKeys = [...this.layerSprites.values()].map((s) => s.texture.key);
    const silhouette = acquireSilhouetteTexture(
      this.scene, layerKeys, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT,
    );
    if (!silhouette) return;
    this.shadowTextureKey = silhouette.key;

    const FOOT_Y_LOCAL = -2;
    const scale = 0.5;
    // Where the feet INK actually sits: the frame anchor minus the sheet's
    // measured below-feet margin. Both the blob and the silhouette anchor
    // to this line, not to the frame edge — otherwise the whole shadow
    // cluster floats by exactly that margin.
    const feetY = FOOT_Y_LOCAL - silhouette.bottomPad * scale;

    // Contact blob (lowest layer): narrower than the body and centered
    // slightly ABOVE the feet-ink bottom (mid-foot), so the character
    // stands in the middle of the oval — half of it behind the shoes,
    // half peeking below.
    this.contactBlob = createContactBlob(this.scene, feetY - 2, 14);
    this.container.addAt(this.contactBlob, 0);

    // Mirrored silhouette: its own copy of the margin (scaled by the
    // squash) plus a 4px tuck under the body glue it to the feet.
    const shadowY = feetY - silhouette.bottomPad * scale * SHADOW_SQUASH - 4;
    const shadow = this.scene.add.sprite(0, shadowY, silhouette.key);
    shadow.setOrigin(0.5, 1.0);
    // Negative Y scale with a bottom origin mirrors the silhouette downward
    // from the feet; X matches the 0.5 world scale of the 64px sheets.
    shadow.setScale(scale, -scale * SHADOW_SQUASH);
    shadow.setAlpha(SHADOW_ALPHA);
    // Above the blob, below every body layer (blob sits at index 0).
    this.container.addAt(shadow, 1);
    this.shadowSprite = shadow;
    this.registerAnimations(silhouette.key);
  }

  private destroyLayers(): void {
    for (const sprite of this.layerSprites.values()) {
      this.container.remove(sprite);
      sprite.destroy();
    }
    this.layerSprites.clear();

    if (this.shadowSprite) {
      this.container.remove(this.shadowSprite);
      this.shadowSprite.destroy();
      this.shadowSprite = null;
    }
    if (this.contactBlob) {
      this.container.remove(this.contactBlob);
      this.contactBlob.destroy();
      this.contactBlob = null;
    }
    releaseSilhouetteTexture(this.scene, this.shadowTextureKey);
    this.shadowTextureKey = null;
  }

  private registerAnimations(textureKey: string): void {
    const directions: Direction[] = ["down", "left", "right", "up"];

    for (const dir of directions) {
      const row = DIRECTION_ROW[dir];
      const walkKey = `${textureKey}-walk-${dir}`;

      if (!this.scene.anims.exists(walkKey)) {
        this.scene.anims.create({
          key: walkKey,
          frames: this.scene.anims.generateFrameNumbers(textureKey, {
            start: row * SPRITE_COLS,
            end: row * SPRITE_COLS + SPRITE_COLS - 1,
          }),
          frameRate: 8,
          repeat: -1,
        });
      }
    }
  }

  /**
   * Registers a paper doll layer sprite sheet in Phaser's texture manager.
   * Call this from BootScene for each layer variant.
   */
  static loadSpriteSheet(scene: Phaser.Scene, key: string, path: string): void {
    scene.load.spritesheet(key, path, {
      frameWidth: SPRITE_FRAME_WIDTH,
      frameHeight: SPRITE_FRAME_HEIGHT,
    });
  }
}
