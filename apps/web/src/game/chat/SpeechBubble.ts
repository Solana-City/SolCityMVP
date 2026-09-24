import * as Phaser from "phaser";

/**
 * The drawn speech bubble, for lines an NPC says out loud.
 *
 * ChatBubble next door is a Graphics rounded rect: right for player chat,
 * which can be any length and appears over anybody. This one is the artist's
 * bubble (assets/ui/bubble.png), so it belongs to the city rather than to the
 * UI layer. The art is 37x33 with the tail hanging off the bottom right, and
 * it is used in two pieces:
 *
 *   "bubble-box"  rows 0-25, the rounded box, stretched as a nine-slice so
 *                 the outline keeps its one-pixel weight at any size.
 *   "bubble-tail" the tail, drawn at its native size and kept the same
 *                 distance from the box's right edge as in the source art,
 *                 so it always points back at the speaker's head.
 *
 * Both frames are registered on the texture in BootScene.
 */
export const BUBBLE_TEXTURE = "speech-bubble";

/** Source geometry, so the two frames and this file cannot drift apart. */
export const BUBBLE_FRAMES = {
  box: { x: 0, y: 0, w: 37, h: 26 },
  tail: { x: 19, y: 25, w: 8, h: 8 },
  /** Gap between the tail's right edge and the box's right edge, in the art. */
  tailInset: 11,
  /** Corner sizes for the nine-slice. */
  slice: { left: 12, right: 12, top: 12, bottom: 10 },
};

const FONT_SIZE = 8;
const PADDING_X = 10;
const PADDING_Y = 8;
const MAX_WIDTH = 128;
const DURATION = 3200;
const FADE = 400;

export class SpeechBubble {
  private container: Phaser.GameObjects.Container;
  private timer: Phaser.Time.TimerEvent;

  constructor(scene: Phaser.Scene, target: Phaser.GameObjects.Container, text: string, y: number) {
    const label = scene.add.text(0, 0, text, {
      fontSize: `${FONT_SIZE}px`,
      fontFamily: '"Press Start 2P", monospace',
      color: "#14142a",
      align: "center",
      wordWrap: { width: MAX_WIDTH, useAdvancedWrap: true },
      resolution: 2,
    });
    label.setOrigin(0.5, 0.5);

    const w = Math.max(48, Math.ceil(label.width) + PADDING_X * 2);
    const h = Math.max(26, Math.ceil(label.height) + PADDING_Y * 2);

    const { box, tail, tailInset, slice } = BUBBLE_FRAMES;
    const parts: Phaser.GameObjects.GameObject[] = [];

    if (scene.textures.exists(BUBBLE_TEXTURE)) {
      const frame = scene.textures.get(BUBBLE_TEXTURE).has("bubble-box") ? "bubble-box" : undefined;
      const nine = scene.add.nineslice(
        0, -h / 2, BUBBLE_TEXTURE, frame, w, h,
        slice.left, slice.right, slice.top, slice.bottom,
      );
      parts.push(nine);
      if (scene.textures.get(BUBBLE_TEXTURE).has("bubble-tail")) {
        // Bottom right of the box, exactly as far in as the source art has it.
        const spout = scene.add.image(w / 2 - tailInset - tail.w / 2, 0, BUBBLE_TEXTURE, "bubble-tail");
        spout.setOrigin(0.5, 0);
        parts.push(spout);
      }
    }

    label.setPosition(0, -h / 2);
    parts.push(label);

    // The tail hangs off the bottom right, so the whole bubble is shifted
    // LEFT by exactly where the tail sits inside it: the tip then lands over
    // the speaker's head whatever the bubble grew to.
    const tailX = -(w / 2 - tailInset - tail.w / 2);
    this.container = scene.add.container(tailX, y, parts);
    target.add(this.container);

    scene.tweens.add({ targets: this.container, alpha: 0, delay: DURATION - FADE, duration: FADE });
    this.timer = scene.time.delayedCall(DURATION, () => this.destroy());
  }

  destroy(): void {
    this.timer?.destroy();
    this.container?.destroy();
  }
}
