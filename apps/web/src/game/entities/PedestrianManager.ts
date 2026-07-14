import * as Phaser from "phaser";
import { TILE_SIZE, PLAYABLE_ZONE } from "../config/constants";
import { PedestrianSprite, makePedestrianLoadout, type PedestrianContext } from "./PedestrianSprite";
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

// Narrow speed band: everyone strolls at a similar, believable pace —
// no one sprints across the map or crawls.
const SPEED_BANDS = [22, 24, 26, 28, 30];

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

  getPedGroup(): Phaser.Physics.Arcade.Group { return this.pedGroup; }

  spawn(scene: Phaser.Scene, collisionLayers: Phaser.Tilemaps.TilemapLayer[]): void {
    this.scene = scene;
    this.collisionLayers = collisionLayers;
    this.count = getPedestrianCount();
    this.pedGroup = scene.physics.add.group();

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

    // Overlap fires the nudge callback without blocking — player passes through
    // peds but triggers a 1-tile nudge on contact. Using overlap (not collider)
    // prevents peds from applying physics force to the player.
    scene.physics.add.overlap(
      this.pedGroup,
      playerContainer,
      this.onPlayerCollide as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback,
      undefined,
      this,
    );

    // Peds can't walk through fixed NPCs
    for (const nc of npcContainers) {
      scene.physics.add.collider(this.pedGroup, nc);
    }

    // Peds can't walk through each other — but they must NEVER push each
    // other either. A collider transfers momentum during separation (the
    // walker drags the other along, then shoves it away), so instead an
    // overlap check halts a walking pedestrian the moment it touches a
    // neighbor: no impulse, no dragging, and since both stop at sub-pixel
    // penetration, no walking over each other.
    scene.physics.add.overlap(
      this.pedGroup,
      this.pedGroup,
      this.onPedContact as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback,
      undefined,
      this,
    );
  }

  private onPedContact(
    aObj: Phaser.Types.Physics.Arcade.GameObjectWithBody,
    bObj: Phaser.Types.Physics.Arcade.GameObjectWithBody,
  ): void {
    const a = (aObj as any).__pedestrian as PedestrianSprite | undefined;
    const b = (bObj as any).__pedestrian as PedestrianSprite | undefined;
    a?.haltFromContact();
    b?.haltFromContact();

    // Deep interpenetration (e.g. two spawns landing on the same tile, or a
    // player shove sliding one into a neighbor) is resolved with a static
    // position nudge along the shallow axis — a placement fix, not a push.
    const ba = aObj.body as Phaser.Physics.Arcade.Body;
    const bb = bObj.body as Phaser.Physics.Arcade.Body;
    const overlapX = Math.min(ba.right, bb.right) - Math.max(ba.left, bb.left);
    const overlapY = Math.min(ba.bottom, bb.bottom) - Math.max(ba.top, bb.top);
    if (overlapX <= 3 || overlapY <= 3) return;

    const ca = aObj as unknown as Phaser.GameObjects.Container;
    const cb = bObj as unknown as Phaser.GameObjects.Container;
    if (overlapX < overlapY) {
      const dir = ba.center.x <= bb.center.x ? 1 : -1;
      ca.x -= (overlapX / 2) * dir;
      cb.x += (overlapX / 2) * dir;
    } else {
      const dir = ba.center.y <= bb.center.y ? 1 : -1;
      ca.y -= (overlapY / 2) * dir;
      cb.y += (overlapY / 2) * dir;
    }
  }

  private onPlayerCollide(
    pedCont: Phaser.Types.Physics.Arcade.GameObjectWithBody,
    playerCont: Phaser.Types.Physics.Arcade.GameObjectWithBody,
  ): void {
    const ped = pedCont as unknown as Phaser.GameObjects.Container;
    const player = playerCont as unknown as Phaser.GameObjects.Container;
    const pedSprite = this.pedestrians.find(p => p.getContainer() === ped);
    if (!pedSprite) return;

    // Cancel any physics impulse before nudging so the ped doesn't slide.
    pedSprite.cancelImpulse();

    const dx = ped.x - player.x;
    const dy = ped.y - player.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const pushX = absX >= absY ? (dx >= 0 ? TILE_SIZE : -TILE_SIZE) : 0;
    const pushY = absX < absY  ? (dy >= 0 ? TILE_SIZE : -TILE_SIZE) : 0;
    pedSprite.nudge(pushX, pushY);
  }

  private isBlocked(col: number, row: number): boolean {
    const wx = col * TILE_SIZE + TILE_SIZE / 2;
    const wy = row * TILE_SIZE + TILE_SIZE / 2;
    return this.isBlockedWorld(wx, wy);
  }

  private isBlockedWorld = (wx: number, wy: number): boolean =>
    this.collisionLayers.some(layer => {
      const tile = layer.getTileAtWorldXY(wx, wy);
      return tile !== null && tile.collides;
    });

  private countPedsNear = (wx: number, wy: number, radius: number): number => {
    const r2 = radius * radius;
    let n = 0;
    for (const p of this.pedestrians) {
      const dx = p.x - wx;
      const dy = p.y - wy;
      if (dx * dx + dy * dy < r2) n++;
    }
    return n;
  };

  /** World-query callbacks each pedestrian uses to plan its strolls. */
  private pedCtx: PedestrianContext = {
    isBlocked: (wx, wy) => this.isBlockedWorld(wx, wy),
    countNear: (wx, wy, r) => this.countPedsNear(wx, wy, r),
  };

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

    return new PedestrianSprite(this.scene, wx, wy, loadout, speed, this.pedCtx, i);
  }

  /** True when a world position falls inside the camera view (plus margin) —
   *  recycling a visible pedestrian reads as a teleport, so those wait. */
  private isOnScreen(wx: number, wy: number): boolean {
    const cam = this.scene.cameras.main;
    const halfW = cam.width / cam.zoom / 2 + TILE_SIZE * 4;
    const halfH = cam.height / cam.zoom / 2 + TILE_SIZE * 4;
    return Math.abs(wx - cam.midPoint.x) < halfW && Math.abs(wy - cam.midPoint.y) < halfH;
  }

  /** Least-crowded of three random zones — respawns drift toward empty
   *  streets instead of piling onto already busy ones. */
  private pickRespawnZone(): [number, number, number, number] {
    let best = SPAWN_ZONES[Math.floor(Math.random() * SPAWN_ZONES.length)];
    let bestCount = Infinity;
    for (let k = 0; k < 3; k++) {
      const zone = SPAWN_ZONES[Math.floor(Math.random() * SPAWN_ZONES.length)];
      const n = this.countPedsNear(zone[0] * TILE_SIZE, zone[1] * TILE_SIZE, TILE_SIZE * 10);
      if (n < bestCount) { bestCount = n; best = zone; }
    }
    return best;
  }

  private rotateBatch(): void {
    const batchSize = Math.ceil(this.count / 4);
    const start = this.rotationBatch * batchSize;
    const end   = Math.min(start + batchSize, this.pedestrians.length);
    this.rotationBatch = (this.rotationBatch + 1) % 4;

    for (let i = start; i < end; i++) {
      const isTarget = i === this.currentTargetIndex;
      if (isTarget) continue;

      // Never recycle a pedestrian the player can see — despawn+respawn
      // reads as "changed position without walking". It gets its turn on a
      // later batch, once it's off screen.
      const current = this.pedestrians[i];
      if (this.isOnScreen(current.x, current.y)) continue;

      this.pedGroup.remove(current.getContainer());
      current.destroy();

      const newSeed = i * 31337 + Date.now() % 9999;
      const loadout = makePedestrianLoadout(newSeed);
      const speed   = SPEED_BANDS[Math.floor(Math.random() * SPEED_BANDS.length)];
      const PZ = PLAYABLE_ZONE;
      const [zCol, zRow, rCol, rRow] = this.pickRespawnZone();
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
        loadout, speed, this.pedCtx, i,
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
