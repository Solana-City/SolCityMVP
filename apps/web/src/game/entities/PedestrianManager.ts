import * as Phaser from "phaser";
import { TILE_SIZE, PLAYABLE_ZONE } from "../config/constants";
import { PedestrianSprite, makePedestrianLoadout } from "./PedestrianSprite";
import { getTargetPedIndex, ROTATION_BATCH_MS } from "../minigames/whereIsNPC/WhereIsNPCGame";

export const PEDESTRIAN_COUNT = 48;
const SPEED_BANDS = [14, 20, 20, 28, 28, 36];
const ROTATION_BATCH_SIZE = Math.ceil(PEDESTRIAN_COUNT / 4); // rotate 1/4 at a time

const SPAWN_ZONES: [number, number, number, number][] = [
  [100, 100,  8,  8],
  [ 80,  76,  8,  4], [100,  76,  8,  4], [120,  76,  8,  4], [140,  76,  8,  4],
  [ 80, 122,  8,  4], [100, 120,  8,  4], [120, 122,  8,  4], [140, 120,  8,  4],
  [ 55,  90,  6,  8], [ 55, 108,  6,  8],
  [150,  90,  6,  8], [150, 108,  6,  8],
  [ 72,  98,  6,  8], [ 72, 112,  6,  8],
  [130,  98,  6,  8], [130, 112,  6,  8],
  [ 88, 104,  5,  5], [113, 104,  5,  5],
];

export class PedestrianManager {
  private pedestrians: PedestrianSprite[] = [];
  private currentTargetIndex = -1;
  private scene!: Phaser.Scene;
  private collisionLayers: Phaser.Tilemaps.TilemapLayer[] = [];
  private rotationBatch = 0;

  spawn(scene: Phaser.Scene, collisionLayers: Phaser.Tilemaps.TilemapLayer[]): void {
    this.scene = scene;
    this.collisionLayers = collisionLayers;

    for (let i = 0; i < PEDESTRIAN_COUNT; i++) {
      scene.time.delayedCall(i * 80, () => {
        const ped = this.spawnOne(i);
        this.pedestrians.push(ped);
        // Update target marker once all are spawned
        if (this.pedestrians.length === PEDESTRIAN_COUNT) this.refreshTarget();
      });
    }

    // Gradual rotation: every ROTATION_BATCH_MS, recycle 1/4 of the crowd
    scene.time.addEvent({
      delay: ROTATION_BATCH_MS,
      loop: true,
      callback: () => this.rotateBatch(),
    });
  }

  private spawnOne(i: number): PedestrianSprite {
    const PZ = PLAYABLE_ZONE;
    const zone = SPAWN_ZONES[i % SPAWN_ZONES.length];
    const [zCol, zRow, rCol, rRow] = zone;
    const col = Math.round(zCol + (Math.random() * 2 - 1) * rCol);
    const row = Math.round(zRow + (Math.random() * 2 - 1) * rRow);
    const clampedCol = Math.max(PZ.col1 + 2, Math.min(PZ.col2 - 2, col));
    const clampedRow = Math.max(PZ.row1 + 2, Math.min(PZ.row2 - 2, row));

    const wx = clampedCol * TILE_SIZE + TILE_SIZE / 2;
    const wy = clampedRow * TILE_SIZE + TILE_SIZE / 2;
    const loadout = makePedestrianLoadout(i * 31337 + 17);
    const speed   = SPEED_BANDS[Math.floor(Math.random() * SPEED_BANDS.length)];

    return new PedestrianSprite(this.scene, wx, wy, loadout, speed, this.collisionLayers, i);
  }

  /** Recycle one batch (1/4 of crowd) in place — gives gradual visual refresh. */
  private rotateBatch(): void {
    const start = this.rotationBatch * ROTATION_BATCH_SIZE;
    const end   = Math.min(start + ROTATION_BATCH_SIZE, this.pedestrians.length);
    this.rotationBatch = (this.rotationBatch + 1) % 4;

    for (let i = start; i < end; i++) {
      const isTarget = i === this.currentTargetIndex;
      if (isTarget) continue; // never recycle the hunt target

      this.pedestrians[i].destroy();
      // Use a fresh seed for new appearance
      const newSeed = i * 31337 + Date.now() % 9999;
      const loadout = makePedestrianLoadout(newSeed);
      const speed   = SPEED_BANDS[Math.floor(Math.random() * SPEED_BANDS.length)];
      const PZ = PLAYABLE_ZONE;
      const zone = SPAWN_ZONES[i % SPAWN_ZONES.length];
      const [zCol, zRow, rCol, rRow] = zone;
      const col = Math.max(PZ.col1 + 2, Math.min(PZ.col2 - 2,
        Math.round(zCol + (Math.random() * 2 - 1) * rCol)));
      const row = Math.max(PZ.row1 + 2, Math.min(PZ.row2 - 2,
        Math.round(zRow + (Math.random() * 2 - 1) * rRow)));

      this.pedestrians[i] = new PedestrianSprite(
        this.scene,
        col * TILE_SIZE + TILE_SIZE / 2,
        row * TILE_SIZE + TILE_SIZE / 2,
        loadout, speed, this.collisionLayers, i,
      );
    }
  }

  /** Called when a new game round begins — update target marker. */
  refreshTarget(): void {
    const newIndex = getTargetPedIndex(
      Math.floor(Date.now() / (5 * 60 * 1000)),
      this.pedestrians.length || PEDESTRIAN_COUNT,
    );
    if (newIndex === this.currentTargetIndex) return;

    // Clear old marker
    if (this.currentTargetIndex >= 0 && this.pedestrians[this.currentTargetIndex]) {
      this.pedestrians[this.currentTargetIndex].setAsTarget(false);
    }
    this.currentTargetIndex = newIndex;
    if (this.pedestrians[newIndex]) {
      this.pedestrians[newIndex].setAsTarget(true);
    }
  }

  getTargetPedestrian(): PedestrianSprite | null {
    return this.pedestrians[this.currentTargetIndex] ?? null;
  }

  getTargetLoadout() {
    return this.pedestrians[this.currentTargetIndex]?.loadout ?? null;
  }

  /** Called when player finds the target — celebrate then pick new target. */
  onTargetFound(): void {
    this.pedestrians[this.currentTargetIndex]?.celebrateFound();
    // Force a new target next frame
    this.currentTargetIndex = -1;
    this.scene.time.delayedCall(800, () => this.refreshTarget());
  }

  updateDepths(): void {
    for (const p of this.pedestrians) p.updateDepth();
  }

  destroy(): void {
    for (const p of this.pedestrians) p.destroy();
    this.pedestrians = [];
  }
}
