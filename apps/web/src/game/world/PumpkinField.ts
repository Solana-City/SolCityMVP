import * as Phaser from "phaser";
import { TILE_SIZE } from "../config/constants";
import { PUMPKINS_PER_HUNT, foundCount, remainingSpots, takeSpot } from "../halloween/pumpkinHunt";

/**
 * The pumpkins of Jack O' Lantern's hunt, standing in the city.
 *
 * Deliberately NOT a physics body and not a shared entity. A pumpkin belongs
 * to the player who is looking at it (see halloween/pumpkinHunt): nobody else
 * sees this one, nobody can take it first, and it needs no collider because
 * walking into it is the whole interaction. A distance check in the scene's
 * own update is the cheapest thing that does that, and five sprites is not a
 * budget worth managing.
 *
 * It bobs, because a thing you are meant to spot across a street has to move.
 */
const BOB_PIXELS = 3;
const BOB_MS = 1400;
/** Close enough to be standing on it. Under a tile, like the NPC prompt. */
const PICKUP_RANGE = TILE_SIZE * 0.9;

export const PUMPKIN_TEXTURE = "halloween-pumpkin";
export const PUMPKIN_TEXTURE_PATH = "assets/sprites/world/pumpkin.png";

interface Standing {
  spot: number;
  sprite: Phaser.GameObjects.Image;
}

export class PumpkinField {
  private readonly scene: Phaser.Scene;
  private readonly wallet: string;
  private standing: Standing[] = [];
  private destroyed = false;

  constructor(scene: Phaser.Scene, wallet: string) {
    this.scene = scene;
    this.wallet = wallet;

    if (!scene.textures.exists(PUMPKIN_TEXTURE)) return;

    for (const { spot, tileX, tileY } of remainingSpots(wallet)) {
      const x = tileX * TILE_SIZE + TILE_SIZE / 2;
      const y = tileY * TILE_SIZE + TILE_SIZE / 2;
      const sprite = scene.add.image(x, y, PUMPKIN_TEXTURE);
      sprite.setOrigin(0.5, 1);
      // Y-sorted like every other standing prop: the player passes in front
      // of it from the south and behind it from the north.
      sprite.setDepth(y);
      scene.tweens.add({
        targets: sprite,
        y: y - BOB_PIXELS,
        duration: BOB_MS / 2,
        ease: "Sine.easeInOut",
        yoyo: true,
        repeat: -1,
      });
      this.standing.push({ spot, sprite });
    }
  }

  /** True when there is nothing left of this wallet's five in the city. */
  get empty(): boolean {
    return this.standing.length === 0;
  }

  /**
   * Called from the scene's update with the player's position. Returns the
   * spot just picked up, so the scene can say so, or null.
   */
  update(px: number, py: number): number | null {
    if (this.destroyed || this.standing.length === 0) return null;
    for (let i = 0; i < this.standing.length; i++) {
      const { spot, sprite } = this.standing[i];
      // Against the sprite's anchored foot rather than its bobbing middle, so
      // how close you have to stand does not breathe with the animation.
      if (Phaser.Math.Distance.Between(px, py, sprite.x, sprite.y) > PICKUP_RANGE) continue;
      // The store is asked first: it is what makes a pickup idempotent, and a
      // sprite removed for a pickup that did not count would be a pumpkin
      // gone for nothing.
      if (!takeSpot(this.wallet, spot)) continue;
      this.standing.splice(i, 1);
      this.scene.tweens.killTweensOf(sprite);
      this.popAndDestroy(sprite);
      // Said where the player is looking. The quest card counts this too, but
      // it is on the other side of the screen and may be collapsed, and a
      // pickup that only animates does not say how many are left to find.
      this.floatCount(sprite.x, sprite.y);
      return spot;
    }
    return null;
  }

  /** A short lift and fade where the pumpkin was, so a pickup is felt. */
  private popAndDestroy(sprite: Phaser.GameObjects.Image): void {
    this.scene.tweens.add({
      targets: sprite,
      y: sprite.y - 14,
      alpha: 0,
      scale: 1.4,
      duration: 260,
      ease: "Quad.easeOut",
      onComplete: () => sprite.destroy(),
    });
  }

  /** The running total, rising out of the spot the pumpkin stood on. */
  private floatCount(x: number, y: number): void {
    const label = this.scene.add.text(
      x,
      y - 18,
      `${Math.min(foundCount(), PUMPKINS_PER_HUNT)}/${PUMPKINS_PER_HUNT}`,
      {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: "8px",
        color: "#ffb347",
        stroke: "#1a0702",
        strokeThickness: 4,
      },
    );
    label.setOrigin(0.5, 1);
    label.setDepth(y + 1);
    this.scene.tweens.add({
      targets: label,
      y: label.y - 16,
      alpha: 0,
      duration: 900,
      ease: "Quad.easeOut",
      onComplete: () => label.destroy(),
    });
  }

  destroy(): void {
    this.destroyed = true;
    for (const { sprite } of this.standing) {
      this.scene.tweens.killTweensOf(sprite);
      sprite.destroy();
    }
    this.standing = [];
  }
}
