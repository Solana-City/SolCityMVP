import * as Phaser from "phaser";
import { TILE_SIZE, PLAYABLE_ZONE } from "../config/constants";
import { PedestrianSprite, makePedestrianLoadout } from "./PedestrianSprite";

const PEDESTRIAN_COUNT = 18;

// Speed bands: slow / medium / fast (px/s)
const SPEED_BANDS = [14, 20, 28, 36];

// Candidate spawn tiles — spread across visible streets
// Avoids known building/water tiles; the collision check will skip if blocked.
const SPAWN_TILES: [number, number][] = [
  // Central plaza area
  [99, 100], [101, 100], [103, 100], [97, 100],
  [99, 103], [101, 103], [103, 103],
  // Street corridors
  [95, 95], [105, 95], [95, 108], [105, 108],
  [110, 100], [92, 100], [99, 115], [99, 88],
  [115, 105], [88, 105], [108, 115], [92, 115],
  [100, 92], [100, 110], [106, 92], [94, 92],
];

export class PedestrianManager {
  private pedestrians: PedestrianSprite[] = [];

  spawn(
    scene: Phaser.Scene,
    collisionLayers: Phaser.Tilemaps.TilemapLayer[],
  ): void {
    const PZ = PLAYABLE_ZONE;

    for (let i = 0; i < PEDESTRIAN_COUNT; i++) {
      // Pick a spawn tile — cycle through candidates with jitter
      const base = SPAWN_TILES[i % SPAWN_TILES.length];
      const jitterX = (Math.floor(Math.random() * 5) - 2);
      const jitterY = (Math.floor(Math.random() * 5) - 2);
      const col = Math.max(PZ.col1 + 2, Math.min(PZ.col2 - 2, base[0] + jitterX));
      const row = Math.max(PZ.row1 + 2, Math.min(PZ.row2 - 2, base[1] + jitterY));

      const wx = col * TILE_SIZE + TILE_SIZE / 2;
      const wy = row * TILE_SIZE + TILE_SIZE / 2;

      const loadout = makePedestrianLoadout(i * 31337 + 42);
      const speed   = SPEED_BANDS[Math.floor(Math.random() * SPEED_BANDS.length)];

      // Stagger startup so they don't all move at the same time
      scene.time.delayedCall(i * 180, () => {
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
