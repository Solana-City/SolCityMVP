import * as Phaser from "phaser";
import { TILE_SIZE, PLAYABLE_ZONE } from "../config/constants";
import { PedestrianSprite, makePedestrianLoadout } from "./PedestrianSprite";

const PEDESTRIAN_COUNT = 48;

// Speed bands: slow / medium / fast (px/s)
const SPEED_BANDS = [14, 20, 20, 28, 28, 36];   // weighted toward medium

/**
 * Spawn zones spread across the full PLAYABLE_ZONE (col 42–162, row 68–130).
 * Each zone is a [centerCol, centerRow, radiusCol, radiusRow] rect.
 * Pedestrians are placed randomly inside each rect.
 * The collision check in PedestrianSprite will discard blocked starting tiles.
 */
const SPAWN_ZONES: [number, number, number, number][] = [
  // Central plaza & fountain
  [100, 100,  8,  8],
  // North district
  [ 80,  76,  8,  4],
  [100,  76,  8,  4],
  [120,  76,  8,  4],
  [140,  76,  8,  4],
  // South district
  [ 80, 122,  8,  4],
  [100, 120,  8,  4],
  [120, 122,  8,  4],
  [140, 120,  8,  4],
  // West corridor
  [ 55,  90,  6,  8],
  [ 55, 108,  6,  8],
  // East corridor
  [150,  90,  6,  8],
  [150, 108,  6,  8],
  // Mid-west
  [ 72,  98,  6,  8],
  [ 72, 112,  6,  8],
  // Mid-east
  [130,  98,  6,  8],
  [130, 112,  6,  8],
  // STEarn / tent area
  [ 88, 104,  5,  5],
  // MonkeyDAO area
  [113, 104,  5,  5],
];

export class PedestrianManager {
  private pedestrians: PedestrianSprite[] = [];

  spawn(
    scene: Phaser.Scene,
    collisionLayers: Phaser.Tilemaps.TilemapLayer[],
  ): void {
    const PZ = PLAYABLE_ZONE;

    for (let i = 0; i < PEDESTRIAN_COUNT; i++) {
      // Pick a random zone, then a random tile inside it
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

      // Stagger startup — 80 ms apart so they don't all tick on frame 1
      scene.time.delayedCall(i * 80, () => {
        const ped = new PedestrianSprite(scene, wx, wy, loadout, speed, collisionLayers);
        this.pedestrians.push(ped);
      });
    }
  }

  updateDepths(): void {
    for (const p of this.pedestrians) p.updateDepth();
  }

  destroy(): void {
    for (const p of this.pedestrians) p.destroy();
    this.pedestrians = [];
  }
}
