import * as Phaser from "phaser";
import type { Expression, ExpressionFxDef } from "../config/paperDoll";
import type { AvatarSprite } from "./AvatarSprite";

/**
 * Overhead animations for facial expressions.
 *
 * The face swap alone is a handful of pixels on a 64px sheet — readable when
 * you stand next to someone and invisible from across the street, which is
 * what testers reported. An expression that carries an `fx` sheet (see
 * EXPRESSIONS in config/paperDoll) also plays it above the character's head,
 * where it is big, animated, and the same for everyone: the trigger already
 * travels over the network as a texture key, so remote players run this on
 * their own copy of the avatar and see exactly what the sender sees.
 *
 * The sheet is a single row of square frames rising bottom to top, looped for
 * as long as the expression lasts.
 */

/** How long an expression (face swap + fx) stays up. */
export const EXPRESSION_DURATION_MS = 3500;

/**
 * FX pixels are drawn 1:1 with the world, while the character sheets draw at
 * 0.5 — so the burst is twice the avatar's pixel density and about as wide as
 * the character. That chunkiness is the point: it is what makes the reaction
 * land from a screen away.
 */
const FX_SCALE = 1;

/** Air between the top of the name tag / buff badge and the burst. */
const FX_GAP = 2;

/** Container data key holding the fx currently playing over that avatar. */
const ACTIVE_KEY = "expressionFx";

/**
 * Registers the loop for an fx sheet once per scene. The frame count comes
 * off the sheet's own width rather than the config, so redrawing a sheet with
 * more frames needs no code change.
 */
function ensureAnimation(scene: Phaser.Scene, fx: ExpressionFxDef): string | null {
  const animKey = `${fx.textureKey}-loop`;
  if (scene.anims.exists(animKey)) return animKey;
  if (!scene.textures.exists(fx.textureKey)) return null;
  const source = scene.textures.get(fx.textureKey).getSourceImage();
  const count = Math.floor(source.width / fx.frameWidth);
  if (count < 1) return null;
  scene.anims.create({
    key: animKey,
    frames: scene.anims.generateFrameNumbers(fx.textureKey, { start: 0, end: count - 1 }),
    frameRate: fx.frameRate,
    repeat: -1,
  });
  return animKey;
}

/**
 * Plays an expression's overhead burst on `avatar`, replacing whatever it was
 * already playing. A no-op for expressions without an fx sheet, or when the
 * sheet failed to load — the face swap still happens either way.
 */
export function playExpressionFx(
  scene: Phaser.Scene,
  avatar: AvatarSprite,
  expr: Pick<Expression, "fx">
): void {
  const fx = expr.fx;
  if (!fx) return;
  const animKey = ensureAnimation(scene, fx);
  if (!animKey) return;

  stopExpressionFx(avatar);
  const container = avatar.getContainer();

  // Origin at the frame's bottom centre: the hearts rise inside the frame, so
  // seating that bottom on the overhead line starts them at the head.
  const sprite = scene.add.sprite(0, avatar.overheadTopY() - FX_GAP, fx.textureKey);
  sprite.setOrigin(0.5, 1);
  sprite.setScale(FX_SCALE);
  container.add(sprite);
  sprite.play(animKey);

  container.setData(ACTIVE_KEY, sprite);
  scene.time.delayedCall(EXPRESSION_DURATION_MS, () => {
    // Leave it alone when a second expression already replaced this sprite:
    // that one owns the slot and has its own timer.
    if (container.active && container.getData(ACTIVE_KEY) !== sprite) return;
    if (container.active) container.setData(ACTIVE_KEY, null);
    sprite.destroy();
  });
}

/** Removes the burst currently over `avatar`, if any. */
export function stopExpressionFx(avatar: AvatarSprite): void {
  const container = avatar.getContainer();
  if (!container.active) return;
  const active = container.getData(ACTIVE_KEY) as Phaser.GameObjects.Sprite | null | undefined;
  if (active) active.destroy();
  container.setData(ACTIVE_KEY, null);
}
