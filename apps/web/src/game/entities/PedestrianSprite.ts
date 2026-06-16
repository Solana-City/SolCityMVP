import * as Phaser from "phaser";
import { AvatarSprite } from "./AvatarSprite";
import { TILE_SIZE } from "../config/constants";
import { LAYER_VARIANTS, type Loadout, DIRECTION_ROW, SPRITE_COLS } from "../config/paperDoll";
import { PLAYABLE_ZONE } from "../config/constants";

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

export function makePedestrianLoadout(seed: number): Loadout {
  const rng = mulberry32(seed);

  const skinRoll = rng();
  const skin = skinRoll < 0.55
    ? "Human"
    : pick(LAYER_VARIANTS.skin.filter(v => v.id !== "Human"), rng).id;

  const eyesFace = rng() < 0.95 ? "Happy" : "Terminator";
  const hair      = pick(LAYER_VARIANTS.hair,   rng).id;
  const tshirt    = pick(LAYER_VARIANTS.tshirt,  rng).id;
  const pants     = pick(LAYER_VARIANTS.pants,   rng).id;
  const hat       = rng() < 0.25 ? pick(LAYER_VARIANTS.hat,       rng).id : undefined;
  const accessory = rng() < 0.08 ? pick(LAYER_VARIANTS.accessory,  rng).id : undefined;

  return { skin, eyesFace, hair, tshirt, pants, hat, accessory };
}

type Direction = "up" | "down" | "left" | "right";
const DIRS: Direction[] = ["up", "down", "left", "right"];

const INTERACT_RANGE = TILE_SIZE * 2;

export class PedestrianSprite {
  readonly pedId: number;
  readonly loadout: Loadout;

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
    pedId: number,
  ) {
    this.scene = scene;
    this.collisionLayers = collisionLayers;
    this.speed = speed;
    this.pedId = pedId;
    this.loadout = loadout;

    this.avatar = new AvatarSprite(scene, x, y, loadout);
    this.showIdleFrame();
    this.scheduleNextMove();
  }

  get x() { return this.avatar.x; }
  get y() { return this.avatar.y; }
  getContainer() { return this.avatar.getContainer(); }

  isNearPlayer(px: number, py: number): boolean {
    const dx = this.avatar.x - px;
    const dy = this.avatar.y - py;
    return Math.sqrt(dx * dx + dy * dy) <= INTERACT_RANGE;
  }

  /** Mark/unmark this pedestrian as the hunt target (no visible indicator — player must find by appearance). */
  setAsTarget(_isTarget: boolean): void {
    // Intentionally no visual marker — the challenge is finding them by face
  }

  /** Brief flash animation when found by a player. */
  celebrateFound(): void {
    const container = this.avatar.getContainer();
    this.scene.tweens.add({
      targets: container,
      scaleX: 1.3, scaleY: 1.3,
      duration: 150,
      yoyo: true,
      repeat: 2,
      ease: "Sine.easeInOut",
    });
  }

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
    const PZ = PLAYABLE_ZONE;
    if (col < PZ.col1 || col > PZ.col2 || row < PZ.row1 || row > PZ.row2) return true;
    // Hard-block fountain basin (matches CityScene's DecorFountain collision zone)
    if (col >= 95 && col <= 103 && row >= 91 && row <= 99) {
      const inCorridor = col >= 99 && col <= 100 && row >= 97;
      if (!inCorridor) return true;
    }
    for (const layer of this.collisionLayers) {
      const tile = layer.getTileAtWorldXY(wx, wy);
      if (tile && tile.collides) return true;
    }
    return false;
  }

  private scheduleNextMove() {
    // Short pause: 200–900ms so pedestrians feel lively
    const pause = 200 + Math.random() * 700;
    this.scene.time.delayedCall(pause, () => this.doMove());
  }

  private doMove() {
    if (!this.scene?.sys?.isActive()) return;
    const container = this.avatar.getContainer();
    if (!container?.scene) return;

    const shuffled = [...DIRS].sort(() => Math.random() - 0.5);
    // Bigger steps (3–8 tiles) so they cover more ground
    const dist = (3 + Math.floor(Math.random() * 6)) * TILE_SIZE;
    let chosen: { dir: Direction; tx: number; ty: number } | null = null;

    for (const dir of shuffled) {
      let tx = container.x, ty = container.y;
      if (dir === "left")  tx -= dist;
      if (dir === "right") tx += dist;
      if (dir === "up")    ty -= dist;
      if (dir === "down")  ty += dist;

      const mx = container.x + (tx - container.x) * 0.5;
      const my = container.y + (ty - container.y) * 0.5;
      if (!this.isTileBlocked(tx, ty) && !this.isTileBlocked(mx, my)) {
        chosen = { dir, tx, ty };
        break;
      }
    }

    if (!chosen) { this.showIdleFrame(); this.scheduleNextMove(); return; }

    const { dir, tx, ty } = chosen;
    this.avatar.walk(dir);
    this.scene.tweens.killTweensOf(container);
    this.scene.tweens.add({
      targets: container, x: tx, y: ty,
      duration: (dist / this.speed) * 1000,
      ease: "Linear",
      onUpdate: () => container.setDepth(container.y),
      onComplete: () => { this.avatar.idle(); this.scheduleNextMove(); },
    });
  }

  updateDepth() { this.avatar.updateDepth(); }

  destroy() {
    this.avatar.destroy();
  }
}
