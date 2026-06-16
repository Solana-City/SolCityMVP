import * as Phaser from "phaser";
import { TILE_SIZE, PLAYABLE_ZONE } from "../config/constants";
import { PedestrianSprite, makePedestrianLoadout } from "./PedestrianSprite";
import { getTargetPedIndex, ROTATION_BATCH_MS } from "../minigames/whereIsNPC/WhereIsNPCGame";

export const PEDESTRIAN_COUNT = 96;
const SPEED_BANDS = [18, 24, 24, 30, 30, 38, 44];
const ROTATION_BATCH_SIZE = Math.ceil(PEDESTRIAN_COUNT / 4); // rotate 1/4 at a time

// 32 zones covering the full PLAYABLE_ZONE (col1:42 col2:162 row1:68 row2:130)
// Format: [centerCol, centerRow, halfRangeCol, halfRangeRow]
const SPAWN_ZONES: [number, number, number, number][] = [
  // North strip (row ~72-80)
  [ 55, 74, 8, 4], [ 75, 74, 8, 4], [ 95, 74, 8, 4], [115, 74, 8, 4],
  [135, 74, 8, 4], [155, 74, 6, 4],
  // Upper-mid strip (row ~85-95)
  [ 50, 90, 5, 6], [ 68, 90, 7, 6], [ 88, 90, 8, 6], [108, 90, 8, 6],
  [128, 90, 7, 6], [148, 90, 7, 6],
  // Center (row ~98-108)
  [ 50,102, 5, 6], [ 70,102, 8, 6], [ 90,102, 8, 6], [110,102, 8, 6],
  [130,102, 8, 6], [150,102, 6, 6],
  // Lower-mid strip (row ~112-120)
  [ 55,116, 8, 5], [ 75,116, 8, 5], [ 95,116, 8, 5], [115,116, 8, 5],
  [135,116, 8, 5], [155,116, 5, 5],
  // South strip (row ~123-128)
  [ 60,126, 8, 3], [ 80,126, 8, 3], [100,126, 8, 3], [120,126, 8, 3],
  [140,126, 8, 3],
  // Interior pockets (plazas / crossroads)
  [100, 99, 5, 5], [ 80,109, 5, 5], [120,109, 5, 5], [160, 99, 3, 6],
];

export class PedestrianManager {
  private pedestrians: PedestrianSprite[] = [];
  private currentTargetIndex = -1;
  private scene!: Phaser.Scene;
  private collisionLayers: Phaser.Tilemaps.TilemapLayer[] = [];
  private rotationBatch = 0;
  private playerContainer: Phaser.GameObjects.Container | null = null;

  spawn(scene: Phaser.Scene, collisionLayers: Phaser.Tilemaps.TilemapLayer[]): void {
    this.scene = scene;
    this.collisionLayers = collisionLayers;

    for (let i = 0; i < PEDESTRIAN_COUNT; i++) {
      scene.time.delayedCall(i * 80, () => {
        const ped = this.spawnOne(i);
        if (this.playerContainer) this.enablePedCollider(ped);
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

  /** Call after spawn() — enables collision between the player and all pedestrians. */
  setupPlayerCollider(playerContainer: Phaser.GameObjects.Container): void {
    this.playerContainer = playerContainer;
    for (const ped of this.pedestrians) this.enablePedCollider(ped);
  }

  private enablePedCollider(ped: PedestrianSprite): void {
    if (!this.playerContainer) return;
    const c = ped.getContainer();
    this.scene.physics.world.enable(c);
    const body = c.body as Phaser.Physics.Arcade.Body;
    body.setSize(TILE_SIZE * 0.5, TILE_SIZE * 0.3);
    body.setOffset(-TILE_SIZE * 0.25, -TILE_SIZE * 0.15);
    body.setImmovable(true);
    this.scene.physics.add.collider(this.playerContainer, c);
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

      const newPed = new PedestrianSprite(
        this.scene,
        col * TILE_SIZE + TILE_SIZE / 2,
        row * TILE_SIZE + TILE_SIZE / 2,
        loadout, speed, this.collisionLayers, i,
      );
      this.enablePedCollider(newPed);
      this.pedestrians[i] = newPed;
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
