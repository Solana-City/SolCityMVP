/**
 * Animated street decoration: one Phaser sprite per item, anchored to a tile.
 *
 * Tiled cannot do this for us. Its animated-tile data is not played by Phaser's
 * tilemap renderer, and painting a flag into the map would also mean re-exporting
 * city.json (the map artist's file) for every prop. A sprite costs one texture
 * and one animation, is placed from a line of config here, and moves with a
 * number instead of a map export.
 *
 * Contract per item: `frameCount` frames of the same size, as a row or as a
 * grid read left to right then down, which is the order
 * `generateFrameNumbers` walks,
 * with the character's/prop's feet at the BOTTOM of the frame (origin 0.5, 1),
 * so `tileY` is the row the prop stands on. Pink chroma (215,123,186) must be
 * cleared to alpha in the file, like every other sprite sheet in the repo.
 */
import * as Phaser from "phaser";
import { TILE_SIZE } from "../config/constants";

export interface AnimatedDecorDef {
  key: string;
  /** Path under /public. */
  file: string;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  /** Frames per second of the loop. */
  frameRate: number;
  /**
   * Tile the prop stands on: its bottom edge sits on the bottom of this tile.
   * Required unless `fromLayer` says where the props are.
   */
  tileX?: number;
  tileY?: number;
  /**
   * Name of a map layer (its leaf name) that holds this prop painted, and which
   * is dropped from the map (REPLACED_MAP_LAYERS is built from these). One
   * sprite per prop, where a prop is a run of painted tiles that touch along an
   * edge (4-connected): it stands at the bottom centre of that run. So a prop
   * two tiles tall, or two wide, or both, is painted as the tiles it covers and
   * still becomes ONE sprite, and every copy of an identical prop can sit in the
   * same layer; moving or adding one in Tiled moves or adds the sprite, with no
   * change here. (Two copies painted touching each other would be read as one
   * prop: leave a tile between them, or give them layers of their own.) The
   * copies share the sheet, the animation and the texture, which is what keeps
   * ten pumpkins no dearer than one.
   */
  fromLayer?: string;
  /**
   * Row whose bottom edge sets the draw depth of a `ySort` prop, when that is
   * not the row it stands on (the default). For a prop that sits high on a
   * building, like a flag on a roof: its own height would sort it BEHIND the
   * building's layer, which is depth-sorted by the building's base, so it takes
   * the building's base row instead.
   */
  depthRow?: number;
  /** Source pixels to world pixels. 0.5 matches the character sheets. */
  scale: number;
  /** Nudge in world pixels, for art that does not land on a tile centre. */
  offsetX?: number;
  offsetY?: number;
  /**
   * Stamp a solid cell on the prop's own tile, so nobody walks through
   * the foot of the pole. It is written into the city's merged collision
   * volume, which the player, the NPCs and the pedestrians all test
   * against.
   */
  blocks?: boolean;
  /**
   * With `blocks` and `fromLayer`: stamp EVERY tile the prop was painted on, not
   * just the bottom row. For a prop whose whole body is solid (a cauldron),
   * where the painted tiles carried collision on all of them; the default is
   * its feet, which is what a pole or a tall prop with a clear top needs.
   */
  blocksWhole?: boolean;
  /**
   * Draw by where the prop meets the ground, like a palm or a lamp post:
   * the player passes in front of it from the south and behind it from the
   * north. Without this the prop always draws above the player, which is
   * right for something they walk under (the fountain's jet) and wrong for
   * something they walk around (a flag pole).
   */
  ySort?: boolean;
}

export const ANIMATED_DECOR: AnimatedDecorDef[] = [
  {
    // The north plaza fountain. The water was taken OUT of the fountain
    // tileset art (SCTileFountain.png) so it could move: ONE frame carries
    // BOTH falls pouring off the S, drawn at 1:1 over the now-dry sculpture.
    //
    // Placement is not a guess. Comparing the tileset before and after the
    // water was removed gives the exact rectangle the painted water used to
    // occupy (world 1823,803 to 1968,905), and a frame's own art box is the
    // same 146 pixels wide, so the sheet lands back where the water was.
    key: "fountain-water",
    file: "assets/sprites/decor/fountain_water.png",
    frameWidth: 192,
    frameHeight: 183,
    frameCount: 6,
    frameRate: 8,
    tileX: 78,
    tileY: 39,
    // 12, not 10: the falls sat a couple of pixels left of the S.
    offsetX: 12,
    scale: 1,
  },
  {
    // Superteam Turkey flag at the TOP-RIGHT corner of the Remedi building
    // (BuildRemedi, cols 113-123 / rows 24-32): the pole stands against the
    // building's east side and the cloth flies out over the street, well above the
    // Hair Specialist at the door. Nudged by hand to col 123 / row 32: the foot
    // sits on the building's bottom row, against its east wall.
    key: "flag-st-turkey",
    file: "assets/sprites/decor/flag_st_turkey.png",
    frameWidth: 78,
    frameHeight: 183,
    frameCount: 4,
    frameRate: 6,
    tileX: 123,
    tileY: 32,
    scale: 0.5,
    blocks: true,
    ySort: true,
  },
  {
    // Superteam Vietnam flag on the EAST side of BuildSTVN (cols 107-113,
    // rows 38-44; solid body from row 41), one column clear of its east
    // wall so the pole stands on open street, not the shop's own footprint.
    // tileY 41 is the shop's own roof/body seam, so the pole rises from
    // there and the cloth flies out above the roofline, same idiom as the
    // Turkey pole beside Remedi.
    //
    // Same sheet geometry as the Turkey pole (78x183, 4 frames, drawn at 2x,
    // so scale 0.5). The foot occupies source x 0-24 of the 78, which puts it
    // 13px left of the sprite centre: tileX 108 plus offsetX 13 therefore
    // stands the FOOT on tile 114, the cell `blocks` stamps.
    key: "flag-st-vietnam",
    file: "assets/sprites/decor/flag_st_vietnam.png",
    frameWidth: 78,
    frameHeight: 183,
    frameCount: 4,
    frameRate: 6,
    tileX: 114,
    tileY: 41,
    offsetX: 13,
    scale: 0.5,
    blocks: true,
    ySort: true,
  },
  // ── The city's three painted flags, now waving ───────────────────
  //
  // These replace tile layers rather than adding to the map, so each one is
  // measured rather than placed by eye: the art box of the painted flag in
  // city.json and the art box of frame 0 line up pixel for pixel, which also
  // settles the scale (1 for all three: the sheets are drawn at world
  // resolution, unlike the Turkey sheet, which is a 2x draw of the same pole).
  // CityScene drops the layers listed in REPLACED_MAP_LAYERS below.
  {
    // Solana flag on the south beach path (DecorSolanaFlag, cols 33-34 /
    // rows 93-96). Painted art sat at world 797,2232 to 836,2327 and the
    // sheet's own art box is the same 40x96, so tile 33 plus half a tile puts
    // it back where it was.
    key: "flag-solana",
    file: "assets/sprites/decor/flag_solana.png",
    frameWidth: 48,
    frameHeight: 96,
    frameCount: 6,
    frameRate: 6,
    tileX: 33,
    tileY: 96,
    offsetX: 12,
    scale: 1,
    // The pole foot was the one solid cell on the old layer (33,96).
    blocks: true,
    ySort: true,
  },
  {
    // Solana flag on the east side of the Breakpoint 26 stand (BuildStandBP26,
    // cols 88-95 / rows 38-43): the pole's foot on col 96, on the stand's
    // bottom row, and the cloth flying out over col 97, in the gap before the
    // Superteam Earn tent (solid from col 98).
    //
    // The same sheet geometry as the Turkey and Vietnam poles (78x183, 4
    // frames, a 2x draw, so scale 0.5), the foot at source x 6-18: tile 96 plus
    // offsetX 13 stands it on tile 96, the cell `blocks` stamps.
    key: "flag-solana-bp26",
    file: "assets/sprites/decor/flag_solana_bp26.png",
    frameWidth: 78,
    frameHeight: 183,
    frameCount: 4,
    frameRate: 6,
    tileX: 96,
    tileY: 43,
    offsetX: 13,
    scale: 0.5,
    blocks: true,
    ySort: true,
  },
  {
    // Superteam Brasil flag by the lighthouse walk (DecorSTBrFlag, cols 54-55
    // / rows 86-89). Painted art at world 1299,2064 to 1338,2159.
    key: "flag-st-brasil",
    file: "assets/sprites/decor/flag_st_brasil.png",
    frameWidth: 48,
    frameHeight: 96,
    frameCount: 8,
    frameRate: 6,
    tileX: 54,
    tileY: 89,
    offsetX: 12,
    scale: 1,
    // Matches the old layer's one solid cell (54,89).
    blocks: true,
    ySort: true,
  },
  {
    // MonkeDAO flag, moved (2026-09-25) from the strip between the banana
    // stand and the tower to the open corner EAST of the MonkeDAO tower,
    // where it has room. The painted flag stood at cols 51-54 / rows 24-30;
    // this stands with its foot on tile 68, row 29, on the pavement between
    // the tower's east wall (which ends at col 65) and the grass verge.
    //
    // The sheet's pole is not centred in its frame: the foot occupies x 0-24
    // of 78, so the sprite centre sits 27px right of the pole. tileX 69 plus
    // offsetX 3 therefore puts the FOOT on tile 68.
    key: "flag-monkedao",
    file: "assets/sprites/decor/flag_monkedao.png",
    frameWidth: 78,
    frameHeight: 183,
    frameCount: 4,
    frameRate: 6,
    tileX: 69,
    tileY: 29,
    offsetX: 3,
    scale: 1,
    // Out in the open now, so it behaves like the other poles: one solid
    // cell under the foot, and y-sorted rather than always-on-top. Nothing
    // of the tower reaches this far east, so nothing can paint over it.
    blocks: true,
    ySort: true,
  },
  {
    // The Seeker building's screen (BuildSeeker, cols 104-111 / rows 25-32).
    //
    // The placement is arithmetic, not an eye match. The building footprint is
    // exactly 192x192, the size of one frame in the artist's original strip, so
    // the animation lines up by construction. pack-animation-sheet.mjs cropped
    // the art out of that frame from (60, 86) at 72x103, and every frame shared
    // that box, so the crop moved nothing. Building corner (2496, 600) plus the
    // crop puts the content at x 2556..2628, y 686..789: centre x 2592, bottom
    // y 789, which is this tile plus the offsets below.
    //
    // Scale is 1, not the 0.5 the character sheets use: this art is drawn at
    // map resolution, where 192 source px are the building's 8 tiles.
    key: "decor-seeker-screen",
    file: "assets/sprites/buildings/SCBuildSEEKER.png",
    frameWidth: 72,
    frameHeight: 103,
    frameCount: 87,
    // TODO: the artist's intended speed is not recorded anywhere. 12fps makes
    // the 87 frames a 7.25s loop; this is the one number to tune.
    frameRate: 12,
    tileX: 107,
    tileY: 32,
    offsetX: 12,
    offsetY: -3,
    scale: 1,
    // No `blocks`: the building already has its own collision, and stamping a
    // cell here would add a stray one in front of the door.
    //
    // y-sorted so a player standing south of the building walks in front of
    // the screen, and the depth lands on the building's own bottom row.
    ySort: true,
  },
  {
    // Superteam Kazakhstan flag on the EAST side of the yurt (BuildSTKZ, cols
    // 26-32 / rows 14-20): the pole's foot on col 33, on the yurt's bottom row,
    // against its east wall, and the cloth flying out over cols 33-34.
    //
    // The same sheet geometry as the other poles (78x183, 4 frames, a 2x draw,
    // so scale 0.5), the foot at source x 0-24: tile 33 plus offsetX 13 stands
    // it on tile 33, the cell `blocks` stamps. 6fps like the others; the artist
    // did not give a speed for this one.
    key: "flag-st-kz",
    file: "assets/sprites/decor/flag_stkz.png",
    frameWidth: 78,
    frameHeight: 183,
    frameCount: 4,
    frameRate: 6,
    tileX: 33,
    tileY: 20,
    offsetX: 13,
    scale: 0.5,
    blocks: true,
    ySort: true,
  },
  // ── Halloween ────────────────────────────────────────────────────
  //
  // Three props, each painted on a map layer of its own (every copy of it in
  // the same layer) and replaced by sprites read off that layer, so they are
  // placed in Tiled and not here. Every sheet is 24px frames at world resolution,
  // so scale 1, and frame 0 is identical pixel for pixel to the painted tile(s)
  // it replaces: the feet are on the tile's bottom edge, no offset. The artist
  // set 150ms a frame, which is 1000/150 fps.
  //
  // Each is solid on its foot tile, as the painted tile was (SCHalloween's
  // collision shapes), and y-sorted so the player passes in front of a pumpkin
  // from the south and behind it from the north.
  {
    // Candle: 12 frames, one tile.
    key: "decor-halloween-candle",
    file: "assets/sprites/decor/halloween_candle.png",
    frameWidth: 24, frameHeight: 24, frameCount: 12, frameRate: 1000 / 150,
    fromLayer: "DecorHalloweenCandle",
    scale: 1, blocks: true, ySort: true,
  },
  {
    // Plain pumpkin: 3 frames, one tile (layer DecorHalloweenPumpkin02).
    key: "decor-halloween-pumpkin",
    file: "assets/sprites/decor/halloween_pumpkin4.png",
    frameWidth: 24, frameHeight: 24, frameCount: 3, frameRate: 1000 / 150,
    fromLayer: "DecorHalloweenPumpkin02",
    scale: 1, blocks: true, ySort: true,
  },
  {
    // Pumpkin with a candle: 3 frames, 24x36, two tiles tall; stands on the
    // lower of them (layer DecorHalloweenPumpkinCandle).
    key: "decor-halloween-pumpkin-candle",
    file: "assets/sprites/decor/halloween_pumpkin3.png",
    frameWidth: 24, frameHeight: 36, frameCount: 3, frameRate: 1000 / 150,
    fromLayer: "DecorHalloweenPumpkinCandle",
    scale: 1, blocks: true, ySort: true,
  },
  {
    // The cauldron: 6 frames of 48x48, two tiles wide and two tall (layer
    // DecorHalloweenBoiler), standing on the bottom edge of its lower tiles.
    // 150ms a frame like the other Halloween props; the sheet came without a
    // speed of its own.
    key: "decor-halloween-boiler",
    file: "assets/sprites/decor/halloween_boiler.png",
    frameWidth: 48, frameHeight: 48, frameCount: 6, frameRate: 1000 / 150,
    fromLayer: "DecorHalloweenBoiler",
    scale: 1, blocks: true, blocksWhole: true, ySort: true,
  },
  // ── Flags that were painted into a building's tileset art ─────────────
  //
  // The artist took them OUT of the tileset PNGs (the way the fountain's water
  // was), and drew them as a sheet the size of the whole building: one frame is
  // the building's footprint, flags on a transparent canvas. Cropped here to the
  // box the flags move in, so the texture is the flags and not 12x26 tiles of
  // nothing. Each sprite is placed by the crop's world position (the building's
  // top left, plus the crop's offset in the frame), and sorts with the building
  // (`depthRow`), never behind it. 150ms a frame, 3 frames.
  {
    // BuildColosseum, cols 104-117 / rows 9-21: six flags on its roofline and
    // walls. Crop at (6,1) of the 336x312 frame, 324x163.
    key: "decor-colosseum-flags",
    file: "assets/sprites/decor/colosseum_flags.png",
    frameWidth: 324, frameHeight: 163, frameCount: 3, frameRate: 1000 / 150,
    tileX: 111, tileY: 15, offsetX: -12, offsetY: -4,
    depthRow: 21,
    scale: 1, ySort: true,
  },
  {
    // BuildSTBrLighthouse, cols 50-61 / rows 60-85 (its layer carried a pixel
    // offset until the artist zeroed it, which is why the cells used to read
    // 54-65 / 52-77): the flag at the top of the tower. Crop at (149,12) of the
    // 288x624 frame, 48x37.
    key: "decor-lighthouse-flag",
    file: "assets/sprites/decor/lighthouse_flag.png",
    frameWidth: 48, frameHeight: 37, frameCount: 3, frameRate: 1000 / 150,
    tileX: 57, tileY: 62, offsetX: -7, offsetY: -23,
    depthRow: 85,
    scale: 1, ySort: true,
  },
];

/**
 * Tile layers whose art is now drawn by a sprite above. CityScene drops them
 * when it builds the map, so the static cloth never shows under the animated
 * one, and their collision does not reach the merged volume either: each
 * sprite stamps its own foot with `blocks` instead.
 */
export const REPLACED_MAP_LAYERS: ReadonlySet<string> = new Set([
  "DecorSolanaFlag", "DecorSTBrFlag", "DecorMonkeDaoFlag",
  ...ANIMATED_DECOR.flatMap((d) => (d.fromLayer ? [d.fromLayer] : [])),
]);

/**
 * Where one copy of an item stands: the tile its foot is on (`tileX`, `tileY`)
 * and `shiftX`, how far right of that tile's centre its centre is (a prop an
 * even number of tiles wide is centred on a tile edge). `feet` are the columns
 * of its bottom row, where `blocks` stamps its collision, and `cells` every
 * tile it was painted on, where `blocksWhole` does.
 */
interface Placement { tileX: number; tileY: number; shiftX: number; feet: number[]; cells: Array<[number, number]> }

/** Where an item stands: its own tile, or each prop painted on its layer. */
function placements(d: AnimatedDecorDef, map?: Phaser.Tilemaps.Tilemap): Placement[] {
  if (!d.fromLayer) {
    const tileX = d.tileX ?? 0;
    const tileY = d.tileY ?? 0;
    return [{ tileX, tileY, shiftX: 0, feet: [tileX], cells: [[tileX, tileY]] }];
  }
  if (!map) {
    console.warn(`[AnimatedDecor] "${d.key}" needs the map to read layer "${d.fromLayer}"`);
    return [];
  }
  const out: Placement[] = [];
  // Tiled files can hold more than one layer under a name (and group paths
  // prefix it), so every layer whose leaf name matches is read, one by one.
  for (const layer of map.layers) {
    if (layer.name.slice(layer.name.lastIndexOf("/") + 1) !== d.fromLayer) continue;
    // The map is cropped to what each layer paints (world/cropMap), the margin
    // moving into the layer's pixel offset: a cell's column is its place in the
    // layer plus that offset, in tiles.
    const originX = Math.round(layer.x / map.tileWidth);
    const originY = Math.round(layer.y / map.tileHeight);
    const painted = (x: number, y: number) => (layer.data[y]?.[x]?.index ?? 0) > 0;
    const seen = new Set<number>();
    for (let y = 0; y < layer.height; y++) {
      for (let x = 0; x < layer.width; x++) {
        if (!painted(x, y) || seen.has(y * layer.width + x)) continue;
        // Flood the run of touching tiles this one belongs to.
        let minX = x, maxX = x, maxY = y;
        const cells: Array<[number, number]> = [[originX + x, originY + y]];
        const stack: Array<[number, number]> = [[x, y]];
        seen.add(y * layer.width + x);
        while (stack.length) {
          const [cx, cy] = stack.pop()!;
          minX = Math.min(minX, cx); maxX = Math.max(maxX, cx); maxY = Math.max(maxY, cy);
          for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
            if (!painted(nx, ny) || seen.has(ny * layer.width + nx)) continue;
            seen.add(ny * layer.width + nx);
            stack.push([nx, ny]);
            cells.push([originX + nx, originY + ny]);
          }
        }
        const feet: number[] = [];
        for (let fx = minX; fx <= maxX; fx++) if (painted(fx, maxY)) feet.push(originX + fx);
        out.push({ tileX: originX + minX, tileY: originY + maxY, shiftX: ((maxX - minX) * TILE_SIZE) / 2, feet, cells });
      }
    }
  }
  return out;
}

/** Call from BootScene.preload. */
export function preloadAnimatedDecor(scene: Phaser.Scene): void {
  for (const d of ANIMATED_DECOR) {
    scene.load.spritesheet(d.key, d.file, { frameWidth: d.frameWidth, frameHeight: d.frameHeight });
  }
}

/**
 * Spawns every item. `foregroundDepth` is the city's above-the-player depth,
 * used by everything that is not `ySort`. `collision` is the city's merged
 * collision volume, where a `blocks` prop stamps its foot. `map` is read for
 * the items placed by `fromLayer`.
 * Returns a cleanup for the scene's shutdown.
 */
export function createAnimatedDecor(
  scene: Phaser.Scene,
  foregroundDepth: number,
  collision?: Phaser.Tilemaps.TilemapLayer,
  map?: Phaser.Tilemaps.Tilemap,
): () => void {
  const sprites: Phaser.GameObjects.Sprite[] = [];
  for (const d of ANIMATED_DECOR) {
    if (!scene.textures.exists(d.key)) {
      console.warn(`[AnimatedDecor] texture "${d.key}" not loaded`);
      continue;
    }
    if (!scene.anims.exists(`${d.key}-loop`)) {
      scene.anims.create({
        key: `${d.key}-loop`,
        frames: scene.anims.generateFrameNumbers(d.key, { start: 0, end: d.frameCount - 1 }),
        frameRate: d.frameRate,
        repeat: -1,
      });
    }
    for (const at of placements(d, map)) {
      const baseY = (at.tileY + 1) * TILE_SIZE;
      const sprite = scene.add
        .sprite(at.tileX * TILE_SIZE + TILE_SIZE / 2 + at.shiftX + (d.offsetX ?? 0), baseY + (d.offsetY ?? 0), d.key)
        .setOrigin(0.5, 1)
        .setScale(d.scale)
        // A y-sorted prop follows the same rule as a y-sorted layer: depth is
        // the world Y where it meets the ground.
        .setDepth(d.ySort ? (d.depthRow !== undefined ? (d.depthRow + 1) * TILE_SIZE : baseY) : foregroundDepth);
      sprite.anims.play(`${d.key}-loop`);
      sprites.push(sprite);

      // Only ever written into the invisible merged volume — stamping a cell
      // into a layer that IS drawn would paint a stray tile on the map.
      if (d.blocks && collision && !collision.visible) {
        // Any index does: the volume is never drawn, only collided against.
        const solid: Array<[number, number]> = d.blocksWhole ? at.cells : at.feet.map((fx) => [fx, at.tileY]);
        for (const [sx, sy] of solid) {
          const cell = collision.putTileAt(1, sx, sy, false);
          if (cell) {
            cell.setCollision(true, true, true, true, false);
            collision.calculateFacesAt(sx, sy);
          }
        }
      }
    }
  }
  return () => { for (const s of sprites) s.destroy(); };
}
