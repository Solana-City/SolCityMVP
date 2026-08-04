import * as Phaser from "phaser";

const BUBBLE_DURATION = 4000;
const BUBBLE_PADDING = 6;
const BUBBLE_FONT_SIZE = 8;
const BUBBLE_MAX_WIDTH = 150;
const BUBBLE_MAX_CHARS = 140;   // guard against spam blowing the bubble up
const BUBBLE_Y = -44;           // pointer tip sits just above the head/name label
const BUBBLE_BG = 0xe6e6ee;     // light gray
const BUBBLE_BG_ALPHA = 0.5;    // translucent so it doesn't block the scene behind it

/**
 * A temporary text bubble that appears above a game object.
 * Fades out and self-destructs after BUBBLE_DURATION ms.
 */
export class ChatBubble {
  private container: Phaser.GameObjects.Container;
  private destroyTimer: Phaser.Time.TimerEvent;

  constructor(
    scene: Phaser.Scene,
    target: Phaser.GameObjects.Container,
    text: string,
    color: string = "#14F195"
  ) {
    const clipped = text.length > BUBBLE_MAX_CHARS ? text.slice(0, BUBBLE_MAX_CHARS) + "…" : text;
    const bubbleText = scene.add.text(0, 0, clipped, {
      fontSize: `${BUBBLE_FONT_SIZE}px`,
      fontFamily: '"Press Start 2P", monospace',
      // Dark text on the light translucent bubble, with a soft light halo so it
      // stays legible over any scene color.
      color: "#14142a",
      stroke: "#f2f2f7",
      strokeThickness: 2,
      // useAdvancedWrap breaks long unbroken strings (e.g. "waaaa…") by
      // character so the bubble grows in HEIGHT, not off the screen width.
      wordWrap: { width: BUBBLE_MAX_WIDTH, useAdvancedWrap: true },
      align: "center",
      resolution: 2,
    });
    bubbleText.setOrigin(0.5, 1);

    const tw = bubbleText.width + BUBBLE_PADDING * 2;
    const th = bubbleText.height + BUBBLE_PADDING * 2;

    // Light gray, translucent — reads as a soft frosted bubble that doesn't
    // block what's behind it.
    const bg = scene.add.graphics();
    bg.fillStyle(BUBBLE_BG, BUBBLE_BG_ALPHA);
    bg.fillRoundedRect(-tw / 2, -th, tw, th, 4);
    bg.lineStyle(1, Phaser.Display.Color.HexStringToColor(color).color, 0.4);
    bg.strokeRoundedRect(-tw / 2, -th, tw, th, 4);

    // Triangle pointer
    bg.fillStyle(BUBBLE_BG, BUBBLE_BG_ALPHA);
    bg.fillTriangle(-3, 0, 3, 0, 0, 5);

    bubbleText.setPosition(0, -BUBBLE_PADDING);

    this.container = scene.add.container(0, BUBBLE_Y, [bg, bubbleText]);
    target.add(this.container);

    // Fade out and destroy
    scene.tweens.add({
      targets: this.container,
      alpha: 0,
      delay: BUBBLE_DURATION - 500,
      duration: 500,
    });

    this.destroyTimer = scene.time.delayedCall(BUBBLE_DURATION, () => {
      this.destroy();
    });
  }

  destroy(): void {
    this.destroyTimer?.destroy();
    this.container?.destroy();
  }
}
