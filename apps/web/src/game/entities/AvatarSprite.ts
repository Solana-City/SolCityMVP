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
  LayerVariant,
  Loadout,
  DEFAULT_LOADOUT,
  getVariant,
} from "../config/paperDoll";
import {
  applyHairSwaps, hairColorOf, readHairTones, swapsForTones,
} from "../config/hairPalette";

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
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    return { data: ctx.getImageData(0, 0, w, h).data, w, h };
  } catch {
    return null;
  }
}

// Cache: textureKey -> per-direction-row [topmost, lowest] ink y (row-relative),
// over every cell in that row. Used to seat an effect on top of the hair.
const inkExtentCache = new Map<string, ({ top: number; bottom: number } | null)[]>();

function getInkExtents(scene: Phaser.Scene, textureKey: string): ({ top: number; bottom: number } | null)[] {
  const cached = inkExtentCache.get(textureKey);
  if (cached) return cached;
  const rows: ({ top: number; bottom: number } | null)[] = [null, null, null, null];
  const pixels = readTexturePixels(scene, textureKey);
  if (pixels) {
    const { data, w } = pixels;
    for (let band = 0; band < SPRITE_ROWS; band++) {
      let top = SPRITE_FRAME_HEIGHT, bottom = -1;
      for (let y = 0; y < SPRITE_FRAME_HEIGHT; y++) {
        const base = ((band * SPRITE_FRAME_HEIGHT + y) * w) * 4;
        for (let x = 0; x < w; x++) {
          if (data[base + x * 4 + 3] > 10) {
            if (y < top) top = y;
            if (y > bottom) bottom = y;
            break;
          }
        }
      }
      if (bottom >= 0) rows[band] = { top, bottom };
    }
  }
  inkExtentCache.set(textureKey, rows);
  return rows;
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

// ── Derived hair textures ───────────────────────────────────────────────────
//
// A hair layer on screen may differ from its sheet in two ways: a hat erases
// part of it, and a colour swatch repaints it. Both produce a texture Phaser
// has to own, and the combinations multiply (styles x colours x hats), so two
// things keep that from turning into hundreds of megabytes of canvas:
//
//   1. NOTHING is derived unless it has to be. A style in the colour it was
//      drawn in, with no hat over it, renders straight off the original
//      texture. That is the common case and it allocates zero.
//   2. What IS derived is REFERENCE COUNTED and freed when the last character
//      wearing it is destroyed — the same contract as the shadow silhouettes
//      above, and for the same reason: this cache used to be an unbounded Map
//      that only ever grew, and a crowd of pedestrians walks a lot of it.
//
// Masking and recolouring happen in ONE pass over the pixels rather than
// chaining two derived textures, so a hat plus a colour still costs one.

interface DerivedHair { refs: number }

/** `${hair}--${colour}--${hat}--${coverage}` -> liveness of that derived texture. */
const derivedHair = new Map<string, DerivedHair>();

/** Tones per hair sheet. Depends on the sheet alone, so it survives colour changes. */
const hairToneCache = new Map<string, number[]>();

/**
 * Combinations that turned out to need no derived texture after all: a hat
 * whose silhouette never actually covers this hair, worn in the colour the
 * sheet was drawn in. Without this the pixels get read and scanned again on
 * every rebuild to reach the same conclusion.
 */
const hairNoOp = new Set<string>();

function hairTonesFor(scene: Phaser.Scene, hairTextureKey: string): number[] {
  const hit = hairToneCache.get(hairTextureKey);
  if (hit) return hit;
  const pixels = readTexturePixels(scene, hairTextureKey);
  const tones = pixels ? readHairTones(pixels.data) : [];
  hairToneCache.set(hairTextureKey, tones);
  return tones;
}

/**
 * The texture to draw a hair layer with, accounting for the hat over it and
 * the colour chosen for it.
 *
 * Returns `hairTextureKey` itself when neither applies, in which case there is
 * nothing to release. Any OTHER key returned is reference counted and must be
 * handed to releaseHairTexture when the sprite goes away.
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
function acquireHairTexture(
  scene: Phaser.Scene,
  hairTextureKey: string,
  colorId: string | undefined,
  hatTextureKey: string | undefined,
  // "suppress" is handled by the caller (skips the hair layer outright) —
  // never actually reaches here, but accepted in the type since callers
  // pass a hat variant's hatCoverage straight through.
  hatCoverage: "full" | "band" | "suppress" = "full",
): string {
  const hat = hatTextureKey && scene.textures.exists(hatTextureKey) ? hatTextureKey : undefined;

  // Resolved before any pixel is read: an empty swap list means the sheet is
  // already the requested colour, which is what makes the default free.
  const swaps = swapsForTones(hairTonesFor(scene, hairTextureKey), hairColorOf(colorId));
  if (!hat && swaps.length === 0) return hairTextureKey;

  const cacheKey = `${hairTextureKey}--${colorId ?? "as-drawn"}--${hat ?? "bare"}--${hatCoverage}`;
  if (hairNoOp.has(cacheKey)) return hairTextureKey;
  const live = derivedHair.get(cacheKey);
  if (live && scene.textures.exists(cacheKey)) { live.refs++; return cacheKey; }

  const hairPixels = readTexturePixels(scene, hairTextureKey);
  if (!hairPixels) return hairTextureKey;
  const { w, h } = hairPixels;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const hairTexture = scene.textures.get(hairTextureKey);
  ctx.drawImage(hairTexture.source[0].image as CanvasImageSource, 0, 0);
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  let masked = false;

  if (hat && hatCoverage === "band") {
    const hatMask = getHatOpaqueMask(scene, hat);
    if (hatMask) {
      const n = Math.min(hatMask.mask.length, w * h);
      for (let i = 0; i < n; i++) {
        if (hatMask.mask[i]) { data[i * 4 + 3] = 0; masked = true; }
      }
    }
  } else if (hat) {
    const bands = getHatColumnCutoffs(scene, hat);
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

  // After the mask, never before: the tones were taken from the WHOLE sheet,
  // so a hat covering most of one shade cannot flip which tone counts as the
  // main one and invert the ramp.
  applyHairSwaps(data, swaps);

  // Nothing to mask and nothing to repaint — don't hold a copy of the original,
  // and remember it so the next rebuild doesn't scan its way here again.
  if (!masked && swaps.length === 0) {
    hairNoOp.add(cacheKey);
    return hairTextureKey;
  }

  ctx.putImageData(imageData, 0, 0);

  if (scene.textures.exists(cacheKey)) scene.textures.remove(cacheKey);
  const newTex = scene.textures.addCanvas(cacheKey, canvas);
  (Phaser.Textures.Parsers as any).SpriteSheet(
    newTex, 0, 0, 0, w, h,
    { frameWidth: SPRITE_FRAME_WIDTH, frameHeight: SPRITE_FRAME_HEIGHT }
  );

  derivedHair.set(cacheKey, { refs: 1 });
  return cacheKey;
}

/** Drops one reference; frees the texture once no character wears it. */
function releaseHairTexture(scene: Phaser.Scene, key: string | null): void {
  if (!key) return;
  const entry = derivedHair.get(key);
  if (!entry) return; // an original sheet, or already freed
  entry.refs--;
  if (entry.refs > 0) return;
  derivedHair.delete(key);
  try {
    // The walk animations registered against this texture MUST die with it:
    // they live in the global AnimationManager holding its frames, and
    // registerAnimations skips any key that already exists. Re-acquiring the
    // same hair later would reuse an animation pointing at a DESTROYED
    // texture, which crashes the next walk().
    for (const dir of ["down", "left", "right", "up"]) {
      scene.anims.remove(`${key}-walk-${dir}`);
    }
    scene.textures.remove(key);
  } catch {
    // Scene teardown may have already destroyed the managers.
  }
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
/** Gap in world px between the top of the outfit and the bottom of a name tag. */
const LABEL_GAP = 1.5;
/** How long a new facing must hold before an effect layer turns to it, in ms. */
const EFFECT_TURN_MS = 120;
/** Height the name tag takes above its own seat line, badges stack on top. */
const NAME_HEIGHT = 8;

export class AvatarSprite {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private layerSprites: Map<LayerCategory, Phaser.GameObjects.Sprite> = new Map();
  /**
   * Layers drawn from an effect sheet, with the cell each one shows now.
   * They loop on their own, walking or not, and are NOT played through the
   * animation manager: it advances one cell per tick and never catches up
   * after a slow frame, so a loop on it drifts behind and looks like it
   * freezes. tickEffects picks the cell from the clock instead.
   */
  private effectSprites: Map<Phaser.GameObjects.Sprite, { effect: NonNullable<LayerVariant["effect"]>; shown: number; row: number; want: number; wantSince: number }> = new Map();
  private effectsTicking = false;
  /** Single silhouette sprite mirrored under the feet — see characterShadow. */
  private shadowSprite: Phaser.GameObjects.Sprite | null = null;
  private shadowTextureKey: string | null = null;
  /** One silhouette for the whole crowd — see the constructor. */
  private sharedShadow = false;
  /** Soft oval under the feet that grounds the character. */
  private contactBlob: Phaser.GameObjects.Ellipse | null = null;
  private currentDirection: Direction = "down";
  private currentLoadout: Loadout;
  /** False while off camera — see setAwake. */
  private awake = true;
  private isWalking = false;
  /** Every layer is already playing the walk for currentDirection. */
  private walkSynced = false;

  /**
   * `sharedShadow` draws this character's silhouette from ONE texture shared
   * by everyone who asks for it, instead of one composited from their own
   * clothes. For the crowd: their shadow is a black shape at 28% alpha,
   * mirrored and squashed to 45% of its height, and nobody has ever read a
   * hat in it — while a per-outfit silhouette costs a 64 KB texture and a
   * canvas composite for every distinct outfit in the city (6 MB across a
   * desktop crowd of 96). The player and remote players keep their own.
   */
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    loadout: Loadout = DEFAULT_LOADOUT,
    sharedShadow = false,
  ) {
    this.scene = scene;
    this.currentLoadout = { ...loadout };
    this.sharedShadow = sharedShadow;
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
    this.rebuildLayers();
  }

  /** Replaces the entire loadout at once. */
  setLoadout(loadout: Loadout): void {
    this.currentLoadout = { ...loadout };
    this.rebuildLayers();
  }

  /**
   * Rebuilds every layer for the current loadout, keeping the derived hair
   * texture alive across the swap.
   *
   * These two used to tear down and then rebuild, which freed the hair texture
   * before asking for it again. Most outfit changes do not touch the hair
   * combination at all — the key is (hair, colour, hat, coverage), so picking a
   * different t-shirt leaves it identical — and the wardrobe previews live, on
   * every click. So each click dropped the refcount to zero, destroyed the
   * texture AND its four registered walk animations, then repainted the whole
   * 256x256 sheet pixel by pixel and registered them all again, to arrive back
   * at what was already there. On the Canvas renderer phones use, that is a
   * visible hitch on the one interaction the wardrobe exists for.
   *
   * Holding the old key across the rebuild means an unchanged combination goes
   * 1 -> 2 -> 1 refs and is never torn down. A changed one still reaches zero
   * and is freed, just afterwards instead of before. Releasing last and
   * unconditionally also covers the case where the new outfit has no hair layer
   * at all, which a "suppress" hat does.
   */
  private rebuildLayers(): void {
    const prevHair = this.derivedHairKey;
    this.destroyLayers(false);
    this.buildLayers();
    releaseHairTexture(this.scene, prevHair);
  }

  getLoadout(): Loadout {
    return { ...this.currentLoadout };
  }

  /** Buff icons that ride above the name tag (see attachBadge). */
  private badges: Phaser.GameObjects.Image[] = [];
  private static inkTopCache = new Map<string, number>();

  /**
   * A small icon that sits above the name tag rather than beside it: the
   * coffee cup while the speed buff runs. Give it origin (0.5, 1), like the
   * labels, so it grows upward from the line it is seated on.
   */
  attachBadge(badge: Phaser.GameObjects.Image): void {
    this.badges.push(badge);
    this.seatOverhead();
  }

  /**
   * Local Y a name tag sits at: a small, fixed gap above the top of the
   * outfit (the tallest of hair, hat and body in the down-facing frame), so a
   * tall hat never sits under the name and a bare head does not leave it
   * floating.
   *
   * A player's tag is NOT a child of the container. It has to draw over the
   * buildings, and a container's children sort inside it, at the container's
   * own depth, so CityScene keeps it at a depth of its own and reads this
   * every frame to place it.
   */
  labelSeatY(): number {
    return this.headTopY() - LABEL_GAP;
  }

  /**
   * Top of the topmost badge currently showing, in container space, or null
   * when none is. A chat bubble uses it to clear the badge instead of sitting
   * over it: the line stays legible and the buff stays readable.
   */
  badgeTopY(): number | null {
    let top: number | null = null;
    for (const badge of this.badges ?? []) {
      if (!badge.visible || !badge.active) continue;
      const y = badge.y - badge.displayHeight;
      if (top === null || y < top) top = y;
    }
    return top;
  }

  /**
   * Top of everything riding over this character — the outfit's ink, the name
   * tag and any buff badge — in container space. An overhead effect seats its
   * bottom here so it clears the whole stack instead of drawing through the
   * name (see ExpressionFx).
   */
  overheadTopY(): number {
    // The name tag is no longer a child to measure (see labelSeatY), but it
    // is always there and always NAME_HEIGHT tall, so its top is a
    // calculation now instead of a lookup.
    let top = Math.min(this.headTopY(), this.labelSeatY() - NAME_HEIGHT);
    const badgeTop = this.badgeTopY();
    if (badgeTop !== null) top = Math.min(top, badgeTop);
    return top;
  }

  /**
   * Re-seats the badges over the outfit, leaving room for the name tag that
   * rides above it. The name is a 5px font: NAME_HEIGHT is that plus its
   * stroke and a pixel of air, which is cheaper and steadier than measuring a
   * Text every frame.
   */
  private seatOverhead(): void {
    const y = this.headTopY() - LABEL_GAP;
    for (const badge of this.badges ?? []) if (badge.active) badge.setY(y - NAME_HEIGHT);
  }

  /** Local y of the top of the outfit's ink, in container space. */
  headTopY(): number {
    const FOOT_Y_LOCAL = -2;
    let topRow = SPRITE_FRAME_HEIGHT;
    for (const sprite of this.layerSprites.values()) {
      topRow = Math.min(topRow, this.inkTopRow(sprite.texture.key));
    }
    if (topRow >= SPRITE_FRAME_HEIGHT) topRow = 4;
    // Sheets draw at 0.5 world scale, origin at the frame bottom.
    return FOOT_Y_LOCAL - (SPRITE_FRAME_HEIGHT - topRow) * 0.5;
  }

  private inkTopRow(key: string): number {
    const cached = AvatarSprite.inkTopCache.get(key);
    if (cached !== undefined) return cached;
    let top = SPRITE_FRAME_HEIGHT;
    try {
      const tex = this.scene.textures.get(key);
      const frame = tex.get(0);
      const src = tex.getSourceImage() as CanvasImageSource;
      const c = document.createElement("canvas");
      c.width = frame.cutWidth;
      c.height = frame.cutHeight;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(src, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, 0, 0, frame.cutWidth, frame.cutHeight);
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      outer: for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          if (data[(y * c.width + x) * 4 + 3] > 16) { top = Math.round(y * (SPRITE_FRAME_HEIGHT / c.height)); break outer; }
        }
      }
    } catch { top = SPRITE_FRAME_HEIGHT; }
    AvatarSprite.inkTopCache.set(key, top);
    return top;
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
    // Callers invoke this every frame for as long as a character walks (the
    // player, every pedestrian, every remote player). When nothing changed,
    // the loop below only rebuilt an array and a key string per layer and
    // looked each one up in the animation manager: ~7% of the frame across
    // ~100 characters, to conclude there was nothing to do.
    //
    // The flags alone are not enough: some callers stop the layer animations
    // directly (PedestrianSprite.showIdleFrame) without going through idle(),
    // and trusting the flags then left characters sliding with frozen legs.
    // One real check on the first layer catches that and stays cheap.
    if (this.walkSynced && this.isWalking && this.currentDirection === direction) {
      const first = this.layerSprites.values().next().value as Phaser.GameObjects.Sprite | undefined;
      if (first?.anims.isPlaying) return;
    }
    this.currentDirection = direction;
    this.isWalking = true;
    let synced = true;
    for (const sprite of this.animatedSprites()) {
      // An effect is driven by the clock, not by the walk — see tickEffects.
      if (this.effectSprites.has(sprite)) continue;
      const key = `${sprite.texture.key}-walk-${direction}`;
      const anim = this.scene.anims.get(key);
      if (!anim || anim.frames.length === 0) { synced = false; continue; }
      // Already playing this exact animation — let it continue from the current frame.
      if (sprite.anims.isPlaying && sprite.anims.currentAnim?.key === key) continue;
      // Start at frame 1 (mid-stride) so even a single-frame tap shows visible movement.
      // Frame 0 is the neutral/idle pose — starting there looks like no animation at all.
      sprite.anims.play({ key, startFrame: Math.min(1, anim.frames.length - 1) });
    }
    // Only trust the fast path once every layer is actually playing; a layer
    // whose animation was missing gets retried on the next call.
    this.walkSynced = synced;
  }

  /**
   * Stops walking and shows the idle frame.
   *
   * `direction` turns the character as it stops, for a caller that knows
   * which way the person is really facing. Remote avatars need it: the one
   * they were last MOVED in is the direction of a correction, not of the
   * player.
   */
  idle(direction?: Direction): void {
    // A direction that differs has to be applied even when already idle.
    // Without this, a remote avatar froze facing whatever way it was last
    // dragged: the early return below meant "already stopped, nothing to do",
    // and the sender turning on the spot was never drawn.
    const turning = direction !== undefined && direction !== this.currentDirection;
    if (turning) this.currentDirection = direction;
    if (!this.isWalking && !turning) return;
    this.isWalking = false;
    this.walkSynced = false;
    const row = DIRECTION_ROW[this.currentDirection];
    for (const sprite of this.animatedSprites()) {
      // An effect keeps looping while the character stands still.
      if (this.effectSprites.has(sprite)) continue;
      sprite.anims.stop();
      sprite.setFrame(row * SPRITE_COLS);
    }
  }

  /**
   * Takes this character's sprites in and out of the scene's update list.
   *
   * Phaser reads `active` per entry, and the entries are these sprites — a
   * Container has no preUpdate of its own, so deactivating the container
   * would do nothing at all.
   *
   * Nothing here can leave a character looking wrong on the way back.
   * `active` only decides whether a sprite's preUpdate runs, which is what
   * ADVANCES an animation; it does not stop, reset or rewind one. A sprite
   * asleep mid-stride wakes mid-stride and carries on from that frame. And
   * position never passes through here — the scene writes container.x/y
   * directly — so a sleeping character is still exactly where it belongs.
   */
  setAwake(on: boolean): void {
    if (this.awake === on) return;
    this.awake = on;
    for (const sprite of this.animatedSprites()) sprite.setActive(on);
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
    // Compare before writing. Phaser's depth setter has no equality check of
    // its own (gameobjects/components/Depth.js): every assignment queues a
    // full depth sort of the scene's display list, even one that stores the
    // value already there. The scene calls this once per character per frame,
    // so a city standing perfectly still was re-sorting its entire display
    // list sixty times a second for nothing.
    const depth = this.container.y;
    if (this.container.depth !== depth) this.container.depth = depth;
  }

  destroy(): void {
    this.destroyLayers();
    this.container.destroy();
  }

  // ── Internal ──────────────────────────────────────────

  private buildLayers(): void {
    // Fresh sprites are not playing anything: the next walk() must start them.
    this.walkSynced = false;
    const FOOT_Y_LOCAL = -2;
    const hatVariant = getVariant("hat", this.currentLoadout.hat);

    // Resolved first, drawn second: the merge needs the whole stack before
    // any sprite exists.
    const resolved: { category: LayerCategory; textureKey: string; effect?: LayerVariant["effect"] }[] = [];

    for (const category of LAYER_ORDER) {
      const variant = getVariant(category, this.currentLoadout[category]);
      if (!variant || !this.scene.textures.exists(variant.textureKey)) continue;

      // A "suppress" hat (e.g. Ninja) hides hair entirely — its own
      // silhouette is narrower than some wide hairstyles, and per-column
      // masking still leaves a sliver visible past its edges, which looks
      // wrong for something meant to enclose the whole head.
      if (category === "hair" && hatVariant?.hatCoverage === "suppress") continue;

      // Hair is otherwise capped to the equipped hat's coverage so it doesn't
      // show where the hat should hide it, and repainted to the chosen swatch
      // (see acquireHairTexture — one pass for both, and nothing derived at
      // all for a bare head in the colour the sheet was drawn in).
      const textureKey = category === "hair"
        ? acquireHairTexture(
            this.scene, variant.textureKey, this.currentLoadout.hairColor,
            // An effect floats over the head and hides nothing, so it casts no mask.
            hatVariant?.effect ? undefined : hatVariant?.textureKey,
            hatVariant?.effect ? undefined : hatVariant?.hatCoverage,
          )
        : variant.textureKey;
      if (category === "hair" && textureKey !== variant.textureKey) {
        this.derivedHairKey = textureKey;
      }

      resolved.push({ category, textureKey, effect: variant.effect });
    }
    // Effects are drawn last so they sit above every layer, a hat included.
    resolved.sort((a, b) => Number(!!a.effect) - Number(!!b.effect));

    for (const { category, textureKey, effect } of resolved) {
      const sprite = this.scene.add.sprite(0, FOOT_Y_LOCAL, textureKey);
      sprite.setOrigin(0.5, 1.0);

      // Native 64x64 sheets render at 0.5x world scale (2x camera zoom cancels to 1:1),
      // matching SimpleSprite's pixel-perfect convention.
      const frame = this.scene.textures.get(textureKey).get(0);
      if ((frame.height || SPRITE_FRAME_HEIGHT) >= 56) {
        sprite.setScale(0.5);
      }

      // A wardrobe change rebuilds these from scratch, and a fresh sprite is
      // active. Without this, changing outfit off camera would quietly put a
      // sleeping character back on the update list.
      if (!this.awake) sprite.setActive(false);
      this.container.add(sprite);
      this.layerSprites.set(category, sprite);
      if (effect) this.effectSprites.set(sprite, { effect, shown: -1, row: -1, want: -1, wantSince: 0 });
      else this.registerAnimations(textureKey);
    }

    this.buildShadow();

    // Outfit changed: re-seat any name tags above the new silhouette.
    this.seatOverhead();

    // Set initial idle frame
    const row = DIRECTION_ROW[this.currentDirection];
    for (const sprite of this.animatedSprites()) {
      if (!this.effectSprites.has(sprite)) sprite.setFrame(row * SPRITE_COLS);
    }
    if (this.effectSprites.size > 0 && !this.effectsTicking) {
      this.effectsTicking = true;
      this.scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.tickEffects);
    }
    this.tickEffects();
  }

  /**
   * How many sheet pixels the hairstyle stands above the bare head in this
   * direction. The halo was drawn for a bare head, so it rises by exactly
   * that much and never sits inside tall hair.
   */
  private hairLift(effect: NonNullable<LayerVariant["effect"]>, row: number): number {
    if (!effect.clearsHair) return 0;
    const hair = getVariant("hair", this.currentLoadout.hair);
    const skin = getVariant("skin", this.currentLoadout.skin);
    if (!hair || !skin) return 0;
    const h = getInkExtents(this.scene, hair.textureKey)[row];
    const s = getInkExtents(this.scene, skin.textureKey)[row];
    if (!h || !s) return 0;
    return Math.max(0, s.top - h.top);
  }

  /** Shows the cell of each effect layer that the clock says is current. */
  private tickEffects = (): void => {
    if (!this.awake) return;
    const now = this.scene.time.now;
    const facing = DIRECTION_ROW[this.currentDirection];
    for (const [sprite, fx] of this.effectSprites) {
      const { frames, fps } = fx.effect;
      // A turn only reaches the effect once the new direction has held for a
      // moment: walking diagonally flips the facing from one tick to the next,
      // and each row of the sheet is a different view, so following every flip
      // swaps the picture back and forth and reads as a stutter.
      if (facing !== fx.want) { fx.want = facing; fx.wantSince = now; }
      if (fx.row === -1 || (fx.row !== facing && now - fx.wantSince >= EFFECT_TURN_MS)) {
        fx.row = facing;
        // The sheet draws at 0.5 world scale, so a sheet pixel is half a world one.
        sprite.y = -2 - this.hairLift(fx.effect, facing) * 0.5;
      }
      let frame: number;
      if (fx.effect.followsWalk && this.isWalking) {
        // Groups of SPRITE_COLS cells: the group is the clock's, the cell in
        // it is the body's walk frame, so the ring bobs with the head. Standing
        // still there is no head to follow, so the whole loop plays on the
        // clock below and the effect stays alive.
        const body = this.layerSprites.get("skin");
        const phase = body ? Number(body.frame.name) % SPRITE_COLS : 0;
        const group = Math.floor(((now / 1000) * fps) / SPRITE_COLS) % (frames / SPRITE_COLS);
        frame = fx.row * frames + group * SPRITE_COLS + phase;
      } else {
        frame = fx.row * frames + (Math.floor((now / 1000) * fps) % frames);
      }
      if (frame !== fx.shown) {
        fx.shown = frame;
        sprite.setFrame(frame);
      }
    }
  };

  /**
   * One silhouette sprite composited from every equipped layer — the shadow
   * matches the character's actual outline, traits included. Mirrored below
   * the feet, squashed, translucent, animated with the same walk cycle.
   */
  private buildShadow(): void {
    // The shared silhouette is cast from the default BODY alone: same 4x4
    // grid, so it animates with the walk cycle exactly as a tailored one
    // does, and every pedestrian in the city reuses the one texture.
    const layerKeys = this.sharedShadow
      ? [getVariant("skin", DEFAULT_LOADOUT.skin)?.textureKey].filter((k): k is string => !!k)
      : [...this.layerSprites.values()].filter((s) => !this.effectSprites.has(s)).map((s) => s.texture.key);
    if (layerKeys.length === 0) return;
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
    // from the feet; X matches the 0.5 world scale of the 64px sheets, times
    // whatever the silhouette was shrunk by when it was stored.
    const shadowScale = scale * silhouette.scaleMul;
    shadow.setScale(shadowScale, -shadowScale * SHADOW_SQUASH);
    shadow.setAlpha(SHADOW_ALPHA);
    // Above the blob, below every body layer (blob sits at index 0).
    this.container.addAt(shadow, 1);
    this.shadowSprite = shadow;
    this.registerAnimations(silhouette.key);
  }

  /** Set only when the hair layer is drawn from a derived texture we must release. */
  private derivedHairKey: string | null = null;

  /**
   * `releaseHair` false hands the derived hair texture to the caller to free
   * AFTER it has rebuilt — see rebuildLayers. Teardown passes nothing and
   * frees it here as usual.
   */
  private destroyLayers(releaseHair = true): void {
    for (const sprite of this.layerSprites.values()) {
      this.container.remove(sprite);
      sprite.destroy();
    }
    this.layerSprites.clear();
    this.effectSprites.clear();
    if (this.effectsTicking) {
      this.effectsTicking = false;
      this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.tickEffects);
    }

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
    if (releaseHair) releaseHairTexture(this.scene, this.derivedHairKey);
    this.derivedHairKey = null;
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
