import * as Phaser from "phaser";
import { TILE_SIZE } from "../config/constants";
import { PedestrianSprite, makePedestrianLoadout, type PedestrianContext } from "./PedestrianSprite";
import { getTargetPedIndex, advanceFindSlot, getCurrentSlot, resetCitizenTimer, ROTATION_BATCH_MS } from "../minigames/whereIsNPC/WhereIsNPCGame";

// The Canvas renderer on mobile redraws every sprite on the CPU each frame,
// and each pedestrian is up to 7 layered sprites — a 96-strong crowd is
// ~600 sprites per frame. A smaller crowd keeps the streets alive at a
// fraction of the draw cost.
const PEDESTRIAN_COUNT_DESKTOP = 96;
const PEDESTRIAN_COUNT_MOBILE = 40;

// The shared hunt derives its target index from this fixed pool, NOT the
// device-dependent crowd size — so every client (desktop or mobile) resolves the
// same citizen for a given round. Must be ≤ the smallest crowd (mobile) so the
// index always exists locally.
const HUNT_TARGET_POOL = PEDESTRIAN_COUNT_MOBILE;

function getPedestrianCount(): number {
  return window.matchMedia("(pointer: coarse)").matches
    ? PEDESTRIAN_COUNT_MOBILE
    : PEDESTRIAN_COUNT_DESKTOP;
}

// Narrow speed band: everyone strolls at a similar, believable pace —
// no one sprints across the map or crawls.
const SPEED_BANDS = [22, 24, 26, 28, 30];

/**
 * Where a citizen may stand: every tile actually reachable on foot from the
 * player's spawn, flood-filled from the live collision layers at startup.
 *
 * This replaces a hand-written table of 32 spawn zones that still described the
 * old 200x200 city (cols 42-162, rows 68-130). Against SCMap01.1 (135x115) a
 * third of that box does not exist and the rest covers only ~20% of the walkable
 * streets, so citizens piled into one corner. Worse, the zone pick only asked
 * "is this exact tile a collider" — nothing stopped it landing someone in the
 * sea or inside a sealed courtyard, where they were stuck for good.
 *
 * Deriving the set from reachability makes both failures unrepresentable: a tile
 * is a candidate only if the player could walk to it.
 */
function collectWalkableTiles(
  map: Phaser.Tilemaps.Tilemap,
  isBlocked: (col: number, row: number) => boolean,
  fromCol: number,
  fromRow: number,
): { col: number; row: number }[] {
  const { width, height } = map;
  const seen = new Uint8Array(width * height);
  const out: { col: number; row: number }[] = [];
  if (isBlocked(fromCol, fromRow)) return out;

  const stack: [number, number][] = [[fromCol, fromRow]];
  seen[fromRow * width + fromCol] = 1;
  while (stack.length > 0) {
    const [col, row] = stack.pop()!;
    out.push({ col, row });
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nc >= width || nr < 0 || nr >= height) continue;
      const i = nr * width + nc;
      if (seen[i] || isBlocked(nc, nr)) continue;
      seen[i] = 1;
      stack.push([nc, nr]);
    }
  }
  return out;
}

export class PedestrianManager {
  private pedestrians: PedestrianSprite[] = [];
  private currentTargetIndex = -1;
  private scene!: Phaser.Scene;
  private collisionLayers: Phaser.Tilemaps.TilemapLayer[] = [];
  private rotationBatch = 0;
  private count = PEDESTRIAN_COUNT_DESKTOP;
  /** Every tile a citizen may stand on — see collectWalkableTiles. */
  private walkable: { col: number; row: number }[] = [];
  /** Arcade group — lets us do pedGroup vs pedGroup in one collider call */
  private pedGroup!: Phaser.Physics.Arcade.Group;

  getPedGroup(): Phaser.Physics.Arcade.Group { return this.pedGroup; }

  spawn(
    scene: Phaser.Scene,
    collisionLayers: Phaser.Tilemaps.TilemapLayer[],
    map: Phaser.Tilemaps.Tilemap,
    spawnCol: number,
    spawnRow: number,
  ): void {
    this.scene = scene;
    this.collisionLayers = collisionLayers;
    this.count = getPedestrianCount();
    this.pedGroup = scene.physics.add.group();

    this.walkable = collectWalkableTiles(
      map,
      (col, row) => this.isBlocked(col, row),
      spawnCol,
      spawnRow,
    );
    if (this.walkable.length === 0) {
      console.warn("[pedestrians] no walkable tiles found — crowd disabled");
      return;
    }

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

    // Any interpenetration — not just deep overlaps — is resolved with a
    // static position nudge along the shallow axis (a placement fix, not a
    // push). This used to only fire past a 3px-on-both-axes threshold, so
    // shallow/grazing contacts (the common case) never got separated: both
    // pedestrians would halt and just sit there overlapping until their own
    // independent random move timer fired again, which often picked a
    // direction right back into the same neighbor — reading as two peds
    // stuck glued to each other for a while.
    const ba = aObj.body as Phaser.Physics.Arcade.Body;
    const bb = bObj.body as Phaser.Physics.Arcade.Body;
    const overlapX = Math.min(ba.right, bb.right) - Math.max(ba.left, bb.left);
    const overlapY = Math.min(ba.bottom, bb.bottom) - Math.max(ba.top, bb.top);
    if (overlapX <= 0 || overlapY <= 0) return;

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
    const { col, row } = this.pickSpawnTile();
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

  /** Least-crowded of three random walkable tiles — spawns drift toward empty
   *  streets instead of piling onto already busy ones. */
  private pickSpawnTile(): { col: number; row: number } {
    let best = this.walkable[Math.floor(Math.random() * this.walkable.length)];
    let bestCount = Infinity;
    for (let k = 0; k < 3; k++) {
      const tile = this.walkable[Math.floor(Math.random() * this.walkable.length)];
      const n = this.countPedsNear(
        tile.col * TILE_SIZE, tile.row * TILE_SIZE, TILE_SIZE * 10,
      );
      if (n < bestCount) { bestCount = n; best = tile; }
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

      // Canonical per-index appearance (same seed as the initial spawn) so
      // pedestrian index `i` looks identical on every client — that's what lets
      // the shared hunt's target citizen match city-wide even after rotations.
      const newSeed = i * 31337 + 17;
      const loadout = makePedestrianLoadout(newSeed);
      const speed   = SPEED_BANDS[Math.floor(Math.random() * SPEED_BANDS.length)];
      const { col, row } = this.pickSpawnTile();

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
    // Derive the target from a FIXED pool (not the device-dependent crowd size)
    // so desktop (96 peds) and mobile (40) pick the SAME index for a given round
    // — indices 0..HUNT_TARGET_POOL-1 exist and share a canonical appearance on
    // every client, so the target citizen is identical city-wide.
    const newIndex = getTargetPedIndex(getCurrentSlot(), HUNT_TARGET_POOL);
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
    resetCitizenTimer(); // the next citizen gets a fresh full countdown
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
