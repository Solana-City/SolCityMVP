import * as Phaser from "phaser";
import type { AvatarSprite } from "./AvatarSprite";

/**
 * The star that marks a found citizen.
 *
 * Finding someone used to be announced by scaling the citizen up and down
 * three times, which is the one thing a crowd of pedestrians does not do: a
 * body that changes size reads as a rendering fault rather than a reward, and
 * it said nothing about WHAT happened. A drawn star above the head says it in
 * the same visual language as every other overhead signal in the city (see
 * ExpressionFx, which this follows: same seat on the overhead line, same
 * origin, same one-animation-per-scene registration).
 *
 * It plays ONCE and goes. An expression loops because it lasts as long as the
 * mood does; a find is an instant, and the star shining and fading is the
 * whole of it.
 */

/** Texture key and frame size, shared with BootScene so the two cannot drift. */
export const STAR_TEXTURE_KEY = "fx-hunt-star";
export const STAR_FRAME_SIZE = 23;
export const STAR_SHEET = "assets/sprites/fx/hunt/star-found.png";

const STAR_ANIM_KEY = `${STAR_TEXTURE_KEY}-once`;
/** 21 frames at this rate is a beat under a second, close to the old pulse. */
const STAR_FPS = 24;
/** Air between the top of the name tag and the star. */
const STAR_GAP = 2;

/**
 * Registers the one-shot once per scene. The frame count comes off the sheet's
 * own width, so a redrawn star with more frames needs no code change.
 */
function ensureAnimation(scene: Phaser.Scene): string | null {
  if (scene.anims.exists(STAR_ANIM_KEY)) return STAR_ANIM_KEY;
  if (!scene.textures.exists(STAR_TEXTURE_KEY)) return null;
  const source = scene.textures.get(STAR_TEXTURE_KEY).getSourceImage();
  const count = Math.floor(source.width / STAR_FRAME_SIZE);
  if (count < 1) return null;
  scene.anims.create({
    key: STAR_ANIM_KEY,
    frames: scene.anims.generateFrameNumbers(STAR_TEXTURE_KEY, { start: 0, end: count - 1 }),
    frameRate: STAR_FPS,
    repeat: 0,
  });
  return STAR_ANIM_KEY;
}

/**
 * Plays the star over `avatar` and calls `onDone` when it has finished.
 *
 * `onDone` is what puts the citizen back on its walk, so it has to run even
 * when the star cannot: a missing sheet, a scene that is tearing down, or a
 * pedestrian recycled mid-celebration would otherwise leave that citizen
 * standing still for good. Hence the fallback timer, and the flag that keeps
 * the two paths from both firing.
 */
export function playFoundStar(
  scene: Phaser.Scene,
  avatar: AvatarSprite,
  onDone: () => void,
): void {
  const container = avatar.getContainer();
  const animKey = ensureAnimation(scene);
  if (!animKey || !container?.active) {
    onDone();
    return;
  }

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onDone();
  };

  // Origin at the frame's bottom centre, seated on the overhead line: the same
  // place an expression burst sits, so the two never fight over the head.
  const sprite = scene.add.sprite(0, avatar.overheadTopY() - STAR_GAP, STAR_TEXTURE_KEY);
  sprite.setOrigin(0.5, 1);
  container.add(sprite);

  sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
    sprite.destroy();
    finish();
  });
  sprite.play(animKey);

  // The star is gone by now unless something took it away first.
  const frames = Math.max(1, Math.floor(
    (scene.textures.get(STAR_TEXTURE_KEY).getSourceImage().width) / STAR_FRAME_SIZE,
  ));
  scene.time.delayedCall((frames / STAR_FPS) * 1000 + 400, () => {
    if (sprite.active) sprite.destroy();
    finish();
  });
}
