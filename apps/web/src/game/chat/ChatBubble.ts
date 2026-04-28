import * as Phaser from "phaser";

const BUBBLE_DURATION = 4000;
const BUBBLE_PADDING = 6;
const BUBBLE_FONT_SIZE = 9;
const BUBBLE_MAX_WIDTH = 120;

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
    const bubbleText = scene.add.text(0, 0, text, {
      fontSize: `${BUBBLE_FONT_SIZE}px`,
      fontFamily: "monospace",
      color: "#ffffff",
      wordWrap: { width: BUBBLE_MAX_WIDTH },
      align: "center",
    });
    bubbleText.setOrigin(0.5, 1);

    const tw = bubbleText.width + BUBBLE_PADDING * 2;
    const th = bubbleText.height + BUBBLE_PADDING * 2;

    const bg = scene.add.graphics();
    bg.fillStyle(0x0a0a1e, 0.88);
    bg.fillRoundedRect(-tw / 2, -th, tw, th, 4);
    bg.lineStyle(1, Phaser.Display.Color.HexStringToColor(color).color, 0.6);
    bg.strokeRoundedRect(-tw / 2, -th, tw, th, 4);

    // Triangle pointer
    bg.fillStyle(0x0a0a1e, 0.88);
    bg.fillTriangle(-3, 0, 3, 0, 0, 5);

    bubbleText.setPosition(0, -BUBBLE_PADDING);

    this.container = scene.add.container(0, -58, [bg, bubbleText]);
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
