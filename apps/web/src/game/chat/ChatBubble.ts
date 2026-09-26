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
 * Style overrides, for lines that are not player chat. NPC speech is a solid
 * white bubble with no outline: same shape, but it grows with the text, which
 * a fixed piece of bubble art cannot do without stretching its own border.
 */
export interface BubbleStyle {
  /** Bubble fill. Defaults to the translucent light grey of player chat. */
  bg?: number;
  bgAlpha?: number;
  /** Border in the speaker's colour. On by default. */
  outline?: boolean;
  /** Height above the target's origin. Defaults to just over the head. */
  y?: number;
  /**
   * Draw above every map layer instead of inside the target's container. A
   * container child sorts with its parent, at the target's own depth, so a
   * fence post or awning y-sorted in front of the speaker paints over the
   * line. The bubble then follows the target from the scene each frame.
   */
  overlay?: boolean;
}

/** Above the tallest map layer (FOREGROUND_DEPTH in CityScene is 10000). */
const OVERLAY_DEPTH = 20000;

/**
 * A temporary text bubble that appears above a game object.
 * Fades out and self-destructs after BUBBLE_DURATION ms.
 */
export class ChatBubble {
  private container: Phaser.GameObjects.Container;
  private destroyTimer: Phaser.Time.TimerEvent;
  private follow?: () => void;
  private scene: Phaser.Scene;

  constructor(
    scene: Phaser.Scene,
    target: Phaser.GameObjects.Container,
    text: string,
    color: string = "#B7E928",
    style: BubbleStyle = {},
  ) {
    this.scene = scene;
    const clipped = text.length > BUBBLE_MAX_CHARS ? text.slice(0, BUBBLE_MAX_CHARS) + "…" : text;
    const bubbleText = scene.add.text(0, 0, clipped, {
      fontSize: `${BUBBLE_FONT_SIZE}px`,
      fontFamily: '"Press Start 2P", monospace',
      // Dark text on the light translucent bubble, with a soft light halo so it
      // stays legible over any scene color.
      color: "#14142a",
      // The halo only earns its keep on the translucent chat bubble; on a
      // solid one it just fattens the letters.
      stroke: "#f2f2f7",
      strokeThickness: style.bgAlpha === 1 ? 0 : 2,
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
    const fill = style.bg ?? BUBBLE_BG;
    const fillAlpha = style.bgAlpha ?? BUBBLE_BG_ALPHA;
    const bg = scene.add.graphics();
    bg.fillStyle(fill, fillAlpha);
    bg.fillRoundedRect(-tw / 2, -th, tw, th, 4);
    if (style.outline !== false) {
      bg.lineStyle(1, Phaser.Display.Color.HexStringToColor(color).color, 0.4);
      bg.strokeRoundedRect(-tw / 2, -th, tw, th, 4);
    }

    // Triangle pointer
    bg.fillStyle(fill, fillAlpha);
    bg.fillTriangle(-3, 0, 3, 0, 0, 5);

    bubbleText.setPosition(0, -BUBBLE_PADDING);

    const offsetY = style.y ?? BUBBLE_Y;
    this.container = scene.add.container(0, offsetY, [bg, bubbleText]);
    if (style.overlay) {
      this.container.setDepth(OVERLAY_DEPTH);
      this.follow = () => this.container.setPosition(target.x, target.y + offsetY);
      this.follow();
      scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.follow);
    } else {
      target.add(this.container);
    }

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
    if (this.follow) this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.follow);
    this.follow = undefined;
    this.destroyTimer?.destroy();
    this.container?.destroy();
  }
}
