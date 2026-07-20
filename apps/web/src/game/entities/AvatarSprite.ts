import * as Phaser from "phaser";
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

// Cache: hat textureKey -> topmost opaque row (0..SPRITE_FRAME_HEIGHT) found in
// any of its 4 direction rows. SPRITE_FRAME_HEIGHT means "no ink found" (no masking).
const hatCoverageRowCache = new Map<string, number>();

/**
 * Scans a hat sheet for the highest row (smallest row-relative y) containing
 * any non-transparent pixel, checking all 4 direction rows and taking the
 * minimum (tallest-reaching) — a hat can sit higher in one direction than
 * another, so using just one row's cutoff for every direction under-masks
 * whichever direction's hat art reaches higher than the sampled one. Hair
 * above this row is only visible because the artist drew it taller than any
 * hat expects; it reads as poking out through the hat, which is the bug
 * getHairTextureFor() below corrects.
 */
function getHatCoverageRow(scene: Phaser.Scene, hatTextureKey: string): number {
  const cached = hatCoverageRowCache.get(hatTextureKey);
  if (cached !== undefined) return cached;

  let topRow = SPRITE_FRAME_HEIGHT;
  try {
    const texture = scene.textures.get(hatTextureKey);
    const source = texture.source[0];
    const img = source.image as CanvasImageSource;
    const sheetW = source.width;
    const sheetH = source.height;

    const canvas = document.createElement("canvas");
    canvas.width = sheetW;
    canvas.height = sheetH;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, sheetW, sheetH).data;

    for (let rowStart = 0; rowStart < sheetH; rowStart += SPRITE_FRAME_HEIGHT) {
      rowScan:
      for (let y = 0; y < SPRITE_FRAME_HEIGHT; y++) {
        for (let x = 0; x < sheetW; x++) {
          if (data[((rowStart + y) * sheetW + x) * 4 + 3] > 10) {
            topRow = Math.min(topRow, y);
            break rowScan;
          }
        }
      }
    }
  } catch { /* leave topRow at "no masking" default */ }

  hatCoverageRowCache.set(hatTextureKey, topRow);
  return topRow;
}

// Cache: `${hairTextureKey}--${hatTextureKey}` -> derived, capped-hair texture key.
const cappedHairTextureCache = new Map<string, string>();

/**
 * Returns a texture key for the hair sheet with anything above the
 * equipped hat's tallest point erased, so tall hairstyles (afros,
 * mohawks) don't poke out through/above the hat. Generates the derived
 * texture once per (hair, hat) pair and reuses it after; returns the
 * original hairTextureKey unchanged if the hat has no measurable coverage
 * (e.g. its texture failed to load) or no hat is equipped.
 */
function getHairTextureFor(scene: Phaser.Scene, hairTextureKey: string, hatTextureKey: string | undefined): string {
  if (!hatTextureKey || !scene.textures.exists(hatTextureKey)) return hairTextureKey;

  const cutoffRow = getHatCoverageRow(scene, hatTextureKey);
  if (cutoffRow >= SPRITE_FRAME_HEIGHT) return hairTextureKey; // no ink found — nothing to mask against

  const cacheKey = `${hairTextureKey}--capped--${hatTextureKey}`;
  if (cappedHairTextureCache.has(cacheKey)) return cappedHairTextureCache.get(cacheKey)!;
  if (scene.textures.exists(cacheKey)) {
    cappedHairTextureCache.set(cacheKey, cacheKey);
    return cacheKey;
  }

  const hairTexture = scene.textures.get(hairTextureKey);
  const source = hairTexture.source[0];
  const img = source.image as CanvasImageSource;
  const w = source.width;
  const h = source.height;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  // Erase rows [0, cutoffRow) within every direction row of the sheet —
  // same absolute cutoff for all four directions (an approximation; the
  // hat's silhouette is measured from its "down" frame only, but its peak
  // height doesn't vary enough between directions to be worth 4x the work).
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  for (let row = 0; row < SPRITE_ROWS; row++) {
    const rowYStart = row * SPRITE_FRAME_HEIGHT;
    for (let y = rowYStart; y < rowYStart + cutoffRow; y++) {
      for (let x = 0; x < w; x++) {
        data[(y * w + x) * 4 + 3] = 0;
      }
    }
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
   * Plays the walk animation for the given direction.
   */
  walk(direction: Direction): void {
    this.currentDirection = direction;
    this.isWalking = true;
    for (const sprite of this.layerSprites.values()) {
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
    for (const sprite of this.layerSprites.values()) {
      sprite.anims.stop();
      sprite.setFrame(row * SPRITE_COLS);
    }
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

      // Hair is capped to the equipped hat's tallest point so tall
      // hairstyles (afros, mohawks) don't poke out above/through it.
      const textureKey = category === "hair"
        ? getHairTextureFor(this.scene, variant.textureKey, hatVariant?.textureKey)
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

    // Set initial idle frame
    const row = DIRECTION_ROW[this.currentDirection];
    for (const sprite of this.layerSprites.values()) {
      sprite.setFrame(row * SPRITE_COLS);
    }
  }

  private destroyLayers(): void {
    for (const sprite of this.layerSprites.values()) {
      this.container.remove(sprite);
      sprite.destroy();
    }
    this.layerSprites.clear();
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
