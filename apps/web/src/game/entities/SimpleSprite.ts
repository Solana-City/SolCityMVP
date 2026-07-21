import * as Phaser from "phaser";
import {
  acquireSilhouetteTexture,
  releaseSilhouetteTexture,
  createContactBlob,
  SHADOW_ALPHA,
  SHADOW_SQUASH,
} from "./characterShadow";

export type Direction = "down" | "left" | "right" | "up";
export type DirectionRow = Record<Direction, number>;

// Player spritesheet row order: down=0, right=1, up=2, left=3
export const PLAYER_DIRECTION_ROW: DirectionRow = {
  down: 0,
  right: 1,
  up: 2,
  left: 3,
};

// NPC spritesheets (exported by DOM): down, up, right, left
export const NPC_DIRECTION_ROW: DirectionRow = {
  down: 0,
  up: 1,
  right: 2,
  left: 3,
};

/**
 * A simple single-sprite avatar using a complete sprite sheet.
 *
 * Sprite sheet contract:
 *   - 4 columns (walk cycle frames)
 *   - 4 rows (down, left, right, up)
 *   - Consistent frame size (e.g. 48x48)
 *
 * This replaces the layered AvatarSprite system for use with
 * pre-made character sprite sheets.
 */
export class SimpleSprite {
  private scene: Phaser.Scene;
  private sprite: Phaser.GameObjects.Sprite;
  private container: Phaser.GameObjects.Container;
  /** Mirrored silhouette under the feet — see characterShadow. */
  private shadowSprite: Phaser.GameObjects.Sprite | null = null;
  private shadowTextureKey: string | null = null;
  /** Soft oval under the feet that grounds the character. */
  private contactBlob: Phaser.GameObjects.Ellipse | null = null;
  private currentDirection: Direction = "down";
  private isWalking = false;
  private textureKey: string;
  private directionRow: DirectionRow;
  /** Set for "static animated" NPCs — see registerAnimations() below. */
  private idleLoopFrames?: number;
  /** frameHeight × applied scale — how tall the sprite renders, feet to top. */
  private visualHeight = 32;
  /** Horizontal shift (source px) of the contact blob, for sprites whose
   *  character isn't centered in its frame (e.g. Kite Pro). */
  private blobOffsetX = 0;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    textureKey: string,
    directionRow: DirectionRow = PLAYER_DIRECTION_ROW,
    /**
     * Frame count for a "static animated" sheet: a single row of N frames,
     * always facing one direction, playing in a permanent loop. Used for
     * NPCs that never wander (see NPCDefinition.spriteAnimation) — e.g. a
     * kite-flyer whose arms/kite animate in place but who never turns or
     * walks. When set, walk()/face()/idle() become no-ops and the 4-row
     * walk-cycle contract (registerAnimations' default path) is skipped.
     */
    idleLoopFrames?: number,
    /**
     * Explicit render scale override — bypasses the frameHeight>=56 → 0.5
     * auto-scale heuristic. Needed when a sheet's frame is much taller than
     * the character itself (e.g. a prop drawn above the head), where
     * auto-scaling the whole frame would render the character far bigger
     * than other NPCs.
     */
    scaleOverride?: number,
    /** Horizontal blob shift (source px) for off-center characters. */
    blobOffsetX = 0,
  ) {
    this.scene = scene;
    this.textureKey = textureKey;
    this.directionRow = directionRow;
    this.idleLoopFrames = idleLoopFrames;
    this.blobOffsetX = blobOffsetX;

    // Pixel-perfect anchoring with integer pixel mapping.
    //
    // Math: source_px × sprite_scale × camera_zoom = screen_px
    //       For pixel art, we need this product to be an integer so
    //       nearest-neighbor sampling has no ambiguity.
    //
    //       With sprite_scale=0.5 and camera_zoom=2 (set in CityScene),
    //       the product is 1.0 — every source pixel hits exactly one
    //       screen pixel. Perfectly crisp.
    //
    //       The 0.5 sprite scale effectively shrinks 64×64 characters to
    //       32×32 world units (matching the 32-px tile grid) while
    //       preserving all source data. The camera zoom then scales
    //       back up 2× — you see the character at roughly 1 tile wide
    //       in world, 64 screen px visible.
    const FOOT_Y_LOCAL = -2;

    this.sprite = scene.add.sprite(0, FOOT_Y_LOCAL, textureKey);
    this.sprite.setOrigin(0.5, 1.0);

    const frameHeight = scene.textures.get(textureKey).get(0).height || 48;
    if (scaleOverride !== undefined) {
      this.sprite.setScale(scaleOverride);
      this.visualHeight = frameHeight * scaleOverride;
      // A fractional downscale (e.g. 0.28) samples pixel art on non-integer
      // boundaries; nearest-neighbor then drops rows unevenly and the sprite
      // looks "cracked" at anything but full zoom. LINEAR filtering averages
      // instead, giving a clean (very slightly soft) shrink with no shimmer —
      // the correct filter for downscaling, vs NEAREST which only wins when
      // upscaling by whole multiples.
      this.sprite.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    } else if (frameHeight >= 56) {
      // Native 64×64 sheet → render at 0.5× world, 2× zoom cancels to 1:1.
      this.sprite.setScale(0.5);
      this.visualHeight = frameHeight * 0.5;
    } else {
      this.visualHeight = frameHeight;
    }

    this.container = scene.add.container(x, y, [this.sprite]);

    this.registerAnimations();
    if (this.idleLoopFrames) {
      this.sprite.anims.play({ key: `${textureKey}-idle-loop`, repeat: -1 });
    } else {
      this.sprite.setFrame(0);
    }
    this.buildShadow();
  }

  /**
   * Silhouette shadow: a black-ink copy of this character's sheet mirrored
   * below the feet, squashed and translucent. It runs the same animations
   * as the main sprite, so the projected outline always matches the pose.
   */
  private buildShadow(): void {
    const frame = this.scene.textures.get(this.textureKey).get(0);
    if (!frame) return;

    const silhouette = acquireSilhouetteTexture(
      this.scene, [this.textureKey], frame.width, frame.height,
    );
    if (!silhouette) return;
    this.shadowTextureKey = silhouette.key;

    const base = this.sprite.scaleX; // 0.5 for native 64px sheets, 1 otherwise
    // Where the feet INK actually sits: frame anchor minus the measured
    // below-feet margin. Blob and silhouette both anchor to this line.
    const feetY = this.sprite.y - silhouette.bottomPad * base;

    // Contact blob (lowest layer) — narrower than the body and centered
    // slightly ABOVE the feet-ink bottom (mid-foot), so the character
    // stands in the middle of the oval: half behind the shoes, half
    // peeking below.
    this.contactBlob = createContactBlob(
      this.scene, feetY - 2, frame.width * base * 0.45,
    );
    // Characters drawn off-center in their frame (Kite Pro sits right of
    // center to counterbalance the kite string) would otherwise have the
    // container-centered blob sit beside their feet. blobOffsetX (source px)
    // shifts it under the actual feet; the mirrored silhouette already lines
    // up because it's the whole frame, so it's untouched.
    this.contactBlob.x = this.blobOffsetX * base;
    this.container.addAt(this.contactBlob, 0);

    // Mirrored silhouette: its own copy of the margin (scaled by squash)
    // plus a 4px tuck under the body glue it to the feet.
    const shadowY = feetY - silhouette.bottomPad * base * SHADOW_SQUASH - 4;
    const shadow = this.scene.add.sprite(0, shadowY, silhouette.key);
    shadow.setOrigin(0.5, 1.0);
    // Negative Y scale with a bottom origin mirrors the silhouette downward
    // from the feet; X matches whatever scale the main sprite uses.
    shadow.setScale(base, -base * SHADOW_SQUASH);
    shadow.setAlpha(SHADOW_ALPHA);
    // Above the blob, below the body sprite.
    this.container.addAt(shadow, 1);
    this.shadowSprite = shadow;
    this.registerAnimations(silhouette.key);

    if (this.idleLoopFrames) {
      shadow.anims.play({ key: `${silhouette.key}-idle-loop`, repeat: -1 });
    } else {
      shadow.setFrame(this.sprite.frame.name);
    }
  }

  private destroyShadow(): void {
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

  get x(): number { return this.container.x; }
  set x(v: number) { this.container.x = v; }

  get y(): number { return this.container.y; }
  set y(v: number) { this.container.y = v; }

  getContainer(): Phaser.GameObjects.Container {
    return this.container;
  }

  /**
   * Distance from the sprite's feet (its anchor) up to the top of its
   * rendered frame. Standard NPCs are 32 (64px frame × 0.5 scale) — used as
   * the default so label-stacking math elsewhere doesn't need a special
   * case for them. Sheets with a scaleOverride (e.g. a tall sheet with a
   * prop above the head) report their own, usually larger, height so
   * name/prompt labels can sit above the whole sprite instead of the
   * standard-NPC assumption.
   */
  getVisualHeight(): number {
    return this.visualHeight;
  }

  walk(direction: Direction): void {
    if (this.idleLoopFrames) return; // static animated NPC — never walks
    this.currentDirection = direction;
    const animKey = `${this.textureKey}-walk-${direction}`;
    const anim = this.scene.anims.get(animKey);
    if (!anim || anim.frames.length === 0) return;
    // Already playing this exact animation — let it continue from the current frame.
    if (this.sprite.anims.isPlaying && this.sprite.anims.currentAnim?.key === animKey) return;
    this.isWalking = true;
    // Start at frame 1 (mid-stride) so even a single-frame tap shows visible movement.
    const startFrame = Math.min(1, anim.frames.length - 1);
    this.sprite.anims.play({ key: animKey, startFrame });
    if (this.shadowSprite && this.shadowTextureKey) {
      const shadowKey = `${this.shadowTextureKey}-walk-${direction}`;
      if (this.scene.anims.exists(shadowKey)) {
        this.shadowSprite.anims.play({ key: shadowKey, startFrame });
      }
    }
  }

  /** Stop walking and show the idle frame for the current direction. */
  idle(): void {
    if (this.idleLoopFrames) return; // static animated NPC — always mid-loop
    if (!this.isWalking) return;
    this.isWalking = false;
    this.sprite.anims.stop();
    const row = this.directionRow[this.currentDirection];
    this.sprite.setFrame(row * 4);
    this.syncShadowFrame(row * 4);
  }

  /** Change facing direction instantly, no walk animation. */
  face(direction: Direction): void {
    if (this.idleLoopFrames) return; // static animated NPC — always facing its one direction
    this.currentDirection = direction;
    this.isWalking = false;
    this.sprite.anims.stop();
    const row = this.directionRow[direction];
    this.sprite.setFrame(row * 4);
    this.syncShadowFrame(row * 4);
  }

  private syncShadowFrame(frameIndex: number): void {
    if (!this.shadowSprite) return;
    this.shadowSprite.anims.stop();
    this.shadowSprite.setFrame(frameIndex);
  }

  updateDepth(): void {
    this.container.depth = this.container.y;
  }

  setTexture(textureKey: string, directionRow?: DirectionRow): void {
    if (textureKey === this.textureKey) return;
    this.textureKey = textureKey;
    if (directionRow) this.directionRow = directionRow;
    this.sprite.setTexture(textureKey);
    this.registerAnimations();
    this.destroyShadow();
    this.buildShadow();
    this.idle();
  }

  destroy(): void {
    // Destroy the sprites BEFORE releasing the shared silhouette texture —
    // release may remove the texture and its animations, which must never
    // happen while a live sprite still plays them.
    this.container.destroy();
    releaseSilhouetteTexture(this.scene, this.shadowTextureKey);
    this.shadowTextureKey = null;
  }

  /** Registers animations for a sheet. Defaults to the character's own
   *  texture; also used for its silhouette shadow texture (same grid). */
  private registerAnimations(textureKey: string = this.textureKey): void {
    if (this.idleLoopFrames) {
      // Static animated NPC: single row of N frames, always facing one
      // direction, no walk cycle at all.
      const key = `${textureKey}-idle-loop`;
      if (!this.scene.anims.exists(key)) {
        const frames = this.scene.anims.generateFrameNumbers(textureKey, {
          start: 0,
          end: this.idleLoopFrames - 1,
        });
        if (frames.length > 0) {
          this.scene.anims.create({ key, frames, frameRate: 6, repeat: -1 });
        }
      }
      return;
    }

    const directions: Direction[] = ["down", "left", "right", "up"];
    const cols = 4;

    for (const dir of directions) {
      const row = this.directionRow[dir];
      const key = `${textureKey}-walk-${dir}`;

      if (!this.scene.anims.exists(key)) {
        const frames = this.scene.anims.generateFrameNumbers(textureKey, {
          start: row * cols,
          end: row * cols + cols - 1,
        });
        if (frames.length > 0) {
          this.scene.anims.create({ key, frames, frameRate: 8, repeat: -1 });
        }
      }
    }
  }

  /**
   * Preloads a sprite sheet in BootScene.
   * Call with the frame dimensions of the individual character frame.
   */
  static load(
    scene: Phaser.Scene,
    key: string,
    path: string,
    frameWidth: number,
    frameHeight: number
  ): void {
    scene.load.spritesheet(key, path, { frameWidth, frameHeight });
  }
}
