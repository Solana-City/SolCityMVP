import * as Phaser from "phaser";
import { AvatarSprite } from "./AvatarSprite";
import { TILE_SIZE } from "../config/constants";
import { LAYER_VARIANTS, type Loadout, DIRECTION_ROW, SPRITE_COLS } from "../config/paperDoll";

// Fast seeded PRNG (mulberry32)
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return (): number => {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Generates a pedestrian loadout using all available traits from the repository.
 *
 * Distribution intent:
 *   - Skin: ~55% Human, rest spread across Feyan/Laovai/Pinki/Radio
 *   - Face: 75% Happy, 20% none, 5% Terminator
 *   - Hair/Tshirt/Pants: uniformly random from all variants
 *   - Hat: 25% chance — all hat types equally likely
 *   - Accessory: 8% chance
 */
export function makePedestrianLoadout(seed: number): Loadout {
  const rng = mulberry32(seed);

  // Skin: weighted toward Human but other species appear
  const skinRoll = rng();
  let skin: string;
  if (skinRoll < 0.55) {
    skin = "Human";
  } else {
    const others = LAYER_VARIANTS.skin.filter(v => v.id !== "Human");
    skin = pick(others, rng).id;
  }

  // Face: mostly Happy, occasional none, very rare Terminator
  const faceRoll = rng();
  let eyesFace: string | undefined;
  if (faceRoll < 0.75) {
    eyesFace = "Happy";
  } else if (faceRoll < 0.95) {
    eyesFace = undefined;           // no face overlay — shows raw skin
  } else {
    eyesFace = "Terminator";
  }

  // Base clothing — always present, full variety
  const hair      = pick(LAYER_VARIANTS.hair,   rng).id;
  const tshirt    = pick(LAYER_VARIANTS.tshirt,  rng).id;
  const pants     = pick(LAYER_VARIANTS.pants,   rng).id;

  // Optional — show up in the crowd but not overwhelming
  const hat       = rng() < 0.25 ? pick(LAYER_VARIANTS.hat,       rng).id : undefined;
  const accessory = rng() < 0.08 ? pick(LAYER_VARIANTS.accessory,  rng).id : undefined;

  return { skin, eyesFace, hair, tshirt, pants, hat, accessory };
}

type Direction = "up" | "down" | "left" | "right";
const DIRS: Direction[] = ["up", "down", "left", "right"];

export class PedestrianSprite {
  private avatar: AvatarSprite;
  private scene: Phaser.Scene;
  private collisionLayers: Phaser.Tilemaps.TilemapLayer[];
  private speed: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    loadout: Loadout,
    speed: number,
    collisionLayers: Phaser.Tilemaps.TilemapLayer[],
  ) {
    this.scene = scene;
    this.collisionLayers = collisionLayers;
    this.speed = speed;
    this.avatar = new AvatarSprite(scene, x, y, loadout);
    this.showIdleFrame();
    this.scheduleNextMove();
  }

  get x() { return this.avatar.x; }
  get y() { return this.avatar.y; }

  /**
   * Force idle frame directly on sprites, bypassing the isWalking guard.
   * Used at construction and when movement is cancelled (tile blocked).
   */
  private showIdleFrame() {
    const container = this.avatar.getContainer();
    const row = DIRECTION_ROW["down"];
    for (const child of container.list as Phaser.GameObjects.Sprite[]) {
      if (child.anims) {
        child.anims.stop();
        child.setFrame(row * SPRITE_COLS);
      }
    }
  }

  private isTileBlocked(wx: number, wy: number): boolean {
    const col = Math.floor(wx / TILE_SIZE);
    const row = Math.floor(wy / TILE_SIZE);
    for (const layer of this.collisionLayers) {
      const tile = layer.getTileAt(col, row);
      if (tile && tile.collides) return true;
    }
    return false;
  }

  private scheduleNextMove() {
    const pause = 500 + Math.random() * 2000;
    this.scene.time.delayedCall(pause, () => this.doMove());
  }

  private doMove() {
    if (!this.scene?.sys?.isActive()) return;

    const container = this.avatar.getContainer();
    if (!container?.scene) return;

    // Try up to 4 random directions; pick the first unblocked one
    const shuffled = [...DIRS].sort(() => Math.random() - 0.5);
    const dist = (2 + Math.floor(Math.random() * 4)) * TILE_SIZE;

    let chosen: { dir: Direction; tx: number; ty: number } | null = null;

    for (const dir of shuffled) {
      let tx = container.x;
      let ty = container.y;
      if (dir === "left")  tx -= dist;
      if (dir === "right") tx += dist;
      if (dir === "up")    ty -= dist;
      if (dir === "down")  ty += dist;

      if (!this.isTileBlocked(tx, ty)) {
        chosen = { dir, tx, ty };
        break;
      }
    }

    if (!chosen) {
      this.showIdleFrame();
      this.scheduleNextMove();
      return;
    }

    const { dir, tx, ty } = chosen;
    this.avatar.walk(dir);

    this.scene.tweens.killTweensOf(container);
    this.scene.tweens.add({
      targets: container,
      x: tx,
      y: ty,
      duration: (dist / this.speed) * 1000,
      ease: "Linear",
      onUpdate: () => container.setDepth(container.y),
      onComplete: () => {
        this.avatar.idle();
        this.scheduleNextMove();
      },
    });
  }

  updateDepth() {
    this.avatar.updateDepth();
  }

  destroy() {
    this.avatar.destroy();
  }
}
