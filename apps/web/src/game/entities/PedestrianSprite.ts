import * as Phaser from "phaser";
import { AvatarSprite } from "./AvatarSprite";
import { TILE_SIZE } from "../config/constants";
import { LAYER_ORDER, LAYER_VARIANTS, type Loadout, type LayerCategory } from "../config/paperDoll";

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

/** Generates a random pedestrian loadout.
 *  - 90 % Human skin
 *  - 90 % Happy face (no Terminator)
 *  - 10 % hat, 5 % accessory
 */
export function makePedestrianLoadout(seed: number): Loadout {
  const rng = mulberry32(seed);

  const nonHumanSkins = LAYER_VARIANTS.skin.filter(v => v.id !== "Human");
  const skin = rng() < 0.9 ? "Human" : pick(nonHumanSkins, rng).id;

  const eyesFace = rng() < 0.9 ? "Happy" : undefined;

  const hair = pick(LAYER_VARIANTS.hair, rng).id;
  const tshirt = pick(LAYER_VARIANTS.tshirt, rng).id;
  const pants = pick(LAYER_VARIANTS.pants, rng).id;

  const hat = rng() < 0.10 ? pick(LAYER_VARIANTS.hat, rng).id : undefined;
  const accessory = rng() < 0.05 ? pick(LAYER_VARIANTS.accessory, rng).id : undefined;

  return { skin, eyesFace, hair, tshirt, pants, hat, accessory };
}

type Direction = "up" | "down" | "left" | "right";
const DIRS: Direction[] = ["up", "down", "left", "right"];

export class PedestrianSprite {
  private avatar: AvatarSprite;
  private scene: Phaser.Scene;
  private collisionLayers: Phaser.Tilemaps.TilemapLayer[];
  private speed: number;         // px/s
  private isMoving = false;

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
    this.avatar.idle();
    this.scheduleNextMove();
  }

  get x() { return this.avatar.x; }
  get y() { return this.avatar.y; }

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
    // Idle pause: 0.6 – 2.5 s, randomised per pedestrian
    const pause = 600 + Math.random() * 1900;
    this.scene.time.delayedCall(pause, () => this.doMove());
  }

  private doMove() {
    if (!this.scene.sys.isActive()) return;

    const container = this.avatar.getContainer();
    if (!container || !container.scene) return;

    // Distance: 1 – 5 tiles
    const dist = (1 + Math.floor(Math.random() * 5)) * TILE_SIZE;
    const dir = DIRS[Math.floor(Math.random() * 4)];

    let tx = container.x;
    let ty = container.y;
    if (dir === "left")  tx -= dist;
    if (dir === "right") tx += dist;
    if (dir === "up")    ty -= dist;
    if (dir === "down")  ty += dist;

    if (this.isTileBlocked(tx, ty)) {
      this.avatar.idle();
      this.scheduleNextMove();
      return;
    }

    this.isMoving = true;
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
        this.isMoving = false;
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
