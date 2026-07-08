import * as Phaser from "phaser";
import { TILE_SIZE, PLAYABLE_ZONE } from "../config/constants";
import { PedestrianSprite, makePedestrianLoadout } from "./PedestrianSprite";
import { getTargetPedIndex, advanceFindSlot, getCurrentSlot, ROTATION_BATCH_MS } from "../minigames/whereIsNPC/WhereIsNPCGame";

// The Canvas renderer on mobile redraws every sprite on the CPU each frame,
// and each pedestrian is up to 7 layered sprites — a 96-strong crowd is
// ~600 sprites per frame. A smaller crowd keeps the streets alive at a
// fraction of the draw cost.
const PEDESTRIAN_COUNT_DESKTOP = 96;
const PEDESTRIAN_COUNT_MOBILE = 40;

function getPedestrianCount(): number {
  return window.matchMedia("(pointer: coarse)").matches
    ? PEDESTRIAN_COUNT_MOBILE
    : PEDESTRIAN_COUNT_DESKTOP;
}

const SPEED_BANDS = [18, 24, 24, 30, 30, 38, 44];

// 32 zones covering the full PLAYABLE_ZONE (col1:42 col2:162 row1:68 row2:130)
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
  private count = PEDESTRIAN_COUNT_DESKTOP;
  /** Arcade group — lets us do pedGroup vs pedGroup in one collider call */
  private pedGroup!: Phaser.Physics.Arcade.Group;

  spawn(scene: Phaser.Scene, collisionLayers: Phaser.Tilemaps.TilemapLayer[]): void {
    this.scene = scene;
    this.collisionLayers = collisionLayers;
    this.count = getPedestrianCount();
    // immovable: true ensures that pedGroup.add() never resets individual body immovability
    this.pedGroup = scene.physics.add.group({ immovable: true });

    for (let i = 0; i < this.count; i++) {
      scene.time.delayedCall(i * 80, () => {
        const ped = this.spawnOne(i);
        this.pedGroup.add(ped.getContainer());
        this.pedestrians.push(ped);
        if (this.pedestrians.length === this.count) this.refreshTarget();
      });
    }

    // Gradual rotation: every ROTATION_BATCH_MS, recycle 1/4 of the crowd
    scene.time.addEvent({
      delay: ROTATION_BATCH_MS,
      loop: true,
      callback: () => this.rotateBatch(),
    });
  }

  /**
   * Call once after spawn() — wires all physics colliders:
   * peds vs tile layers, peds vs player, peds vs each other.
   */
  setupColliders(
    playerContainer: Phaser.GameObjects.Container,
    npcContainers: Phaser.GameObjects.Container[],
  ): void {
    const scene = this.scene;

    // Peds blocked by the same tile layers the player is blocked by
    for (const cl of this.collisionLayers) {
      scene.physics.add.collider(this.pedGroup, cl);
    }

    // Peds can't walk through the player
    scene.physics.add.collider(this.pedGroup, playerContainer);

    // Peds can't walk through fixed NPCs
    for (const nc of npcContainers) {
      scene.physics.add.collider(this.pedGroup, nc);
    }

    // Peds can't walk through each other
    scene.physics.add.collider(this.pedGroup, this.pedGroup);
  }

  private isBlocked(col: number, row: number): boolean {
    const wx = col * TILE_SIZE + TILE_SIZE / 2;
    const wy = row * TILE_SIZE + TILE_SIZE / 2;
    return this.collisionLayers.some(layer => {
      const tile = layer.getTileAtWorldXY(wx, wy);
      return tile !== null && tile.collides;
    });
  }

  private spawnOne(i: number): PedestrianSprite {
    const PZ = PLAYABLE_ZONE;
    const zone = SPAWN_ZONES[i % SPAWN_ZONES.length];
    const [zCol, zRow, rCol, rRow] = zone;

    let col = Math.round(zCol + (Math.random() * 2 - 1) * rCol);
    let row = Math.round(zRow + (Math.random() * 2 - 1) * rRow);
    col = Math.max(PZ.col1 + 2, Math.min(PZ.col2 - 2, col));
    row = Math.max(PZ.row1 + 2, Math.min(PZ.row2 - 2, row));

    // Scan downward up to 8 tiles to escape any collider
    let tries = 0;
    while (this.isBlocked(col, row) && tries < 8) {
      row++;
      tries++;
    }
    // If still blocked, shift right and try again
    if (this.isBlocked(col, row)) {
      col += 2;
      row = Math.max(PZ.row1 + 2, Math.min(PZ.row2 - 2,
        Math.round(zRow + (Math.random() * 2 - 1) * rRow)));
    }

    const wx = col * TILE_SIZE + TILE_SIZE / 2;
    const wy = row * TILE_SIZE + TILE_SIZE / 2;
    const loadout = makePedestrianLoadout(i * 31337 + 17);
    const speed   = SPEED_BANDS[Math.floor(Math.random() * SPEED_BANDS.length)];

    return new PedestrianSprite(this.scene, wx, wy, loadout, speed, this.collisionLayers, i);
  }

  private rotateBatch(): void {
    const batchSize = Math.ceil(this.count / 4);
    const start = this.rotationBatch * batchSize;
    const end   = Math.min(start + batchSize, this.pedestrians.length);
    this.rotationBatch = (this.rotationBatch + 1) % 4;

    for (let i = start; i < end; i++) {
      const isTarget = i === this.currentTargetIndex;
      if (isTarget) continue;

      this.pedGroup.remove(this.pedestrians[i].getContainer());
      this.pedestrians[i].destroy();

      const newSeed = i * 31337 + Date.now() % 9999;
      const loadout = makePedestrianLoadout(newSeed);
      const speed   = SPEED_BANDS[Math.floor(Math.random() * SPEED_BANDS.length)];
      const PZ = PLAYABLE_ZONE;
      const zone = SPAWN_ZONES[i % SPAWN_ZONES.length];
      const [zCol, zRow, rCol, rRow] = zone;
      let col = Math.max(PZ.col1 + 2, Math.min(PZ.col2 - 2,
        Math.round(zCol + (Math.random() * 2 - 1) * rCol)));
      let row = Math.max(PZ.row1 + 2, Math.min(PZ.row2 - 2,
        Math.round(zRow + (Math.random() * 2 - 1) * rRow)));

      let t = 0;
      while (this.isBlocked(col, row) && t < 8) { row++; t++; }

      const newPed = new PedestrianSprite(
        this.scene,
        col * TILE_SIZE + TILE_SIZE / 2,
        row * TILE_SIZE + TILE_SIZE / 2,
        loadout, speed, this.collisionLayers, i,
      );
      this.pedGroup.add(newPed.getContainer());
      this.pedestrians[i] = newPed;
    }
  }

  refreshTarget(): void {
    const newIndex = getTargetPedIndex(
      Math.floor(Date.now() / (5 * 60 * 1000)),
      this.pedestrians.length || this.count,
      getCurrentSlot(),
    );
    if (newIndex === this.currentTargetIndex) return;

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

  onTargetFound(): void {
    this.pedestrians[this.currentTargetIndex]?.celebrateFound();
    this.currentTargetIndex = -1;
    advanceFindSlot(); // advance slot so other wallets can still find the next target
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
