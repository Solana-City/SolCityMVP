import * as Phaser from "phaser";
import { PublicKey } from "@solana/web3.js";
import { PLAYER_SPEED, TILE_SIZE } from "../config/constants";
import { Direction } from "../entities/SimpleSprite";
import { AvatarSprite } from "../entities/AvatarSprite";
import { loadSavedLoadout, DEFAULT_LOADOUT, type Loadout } from "../config/paperDoll";
import { OnChainMultiplayer, OnChainPlayer } from "../multiplayer/OnChainMultiplayer";
import { ChatManager, getChannelColor, SELF_COLOR } from "../chat/ChatManager";
import { containsLink, maskLinks } from "../chat/linkFilter";
import { ChatBubble } from "../chat/ChatBubble";
import { TradeBubble } from "../chat/TradeBubble";
import { decodeTrade, encodeTrade, tradeLogLine, type TradeSide } from "../chat/tradeBroadcast";

/** Chat-log color for stock trade lines. */
const TRADE_COLOR = "#FFB547";

/**
 * Friendly names for the ?at= deep link, so a shared link can read
 * ?at=stocklana instead of an internal NPC id. Any NPC id also works as is.
 */
const NPC_DEEP_LINKS: Record<string, string> = {
  stocklana: "stocks-broker",
  stocks: "stocks-broker",
  jupiter: "swap-npc",
  swap: "swap-npc",
  send: "send-npc",
  earn: "pratik",
  magicblock: "magic-man",
  mechs: "mech-handler",
  kite: "kite-pro",
  guide: "sol-guide",
};
import { NPCSprite } from "../entities/NPCSprite";
import { NPC_REGISTRY } from "../config/npcRegistry";
import { PedestrianManager, cullContainer } from "../entities/PedestrianManager";
import { hasAlreadyFoundCurrent, markCurrentFound, isCitizenExpired, advanceFindSlot, resetCitizenTimer, isHuntOnChain, getRoundIndex } from "../minigames/whereIsNPC/WhereIsNPCGame";
import { ProfileManager, profileManager } from "../config/profileManager";
import { AchievementEngine } from "../progression/achievementEngine";
import { onMiniGameFinished, onStockTraded, watchNpcConversations, stopWatchingNpcConversations } from "../progression/outfitRewards";
import { showEmoji, EmojiDef } from "../chat/EmojiSystem";
import { soundManager } from "../audio/SoundManager";
import { publishMinimap } from "../minimap/MinimapHost";
import { createStockExchange } from "../world/StockExchange";
import { createAnimatedDecor, REPLACED_MAP_LAYERS } from "../world/AnimatedDecor";
import { readLastPosition, saveLastPosition } from "../world/lastPosition";
import { buildPhysicsLayer, mergeGroundRun } from "../world/mergeLayers";
import { SparseLayer, SPARSE_MAX_TILES, GROUND_CHUNK_TILES, type CityLayer } from "../world/sparseLayer";
import { bakeStaticLayers, type BakedGround } from "../world/groundBake";
import { LANDMARK_LAYERS } from "../minimap/categories";
import { cachedName, onNames, requestNames, NAME_CHANGED_EVENT } from "../names/nameService";
import { track } from "../telemetry/track";
import { startHeatmap } from "../telemetry/heatmap";
import { startMemStats } from "../telemetry/memStats";

// Pixel-perfect zoom values and snapping live in config/zoomConfig.ts —
// shared with ZoomControl and the pinch-zoom hook.
import { loadZoom, snapZoom, viewScale } from "../config/zoomConfig";

/**
 * Set on the Phaser.Game once CityScene.create() has registered its listeners.
 * React reads it so a wallet that connected during boot still gets delivered
 * even if it subscribes to "scene:ready" after the event already fired.
 */
export type GameWithSceneReady = Phaser.Game & { __solCitySceneReady?: boolean };

/**
 * The connected wallet, mirrored by React on every change so CityScene can PULL
 * it at startup instead of relying on having been subscribed when it was
 * pushed. See the handshake in create().
 */
export type SolCityWalletHost = typeof globalThis & { __solCityWallet?: string | null };

/**
 * What this client knows about a remote player's motion: the last position
 * the chain gave, when it arrived, the velocity measured between the last two
 * positions, and the sender's own walking flag when it sends one.
 */
interface RemoteTarget {
  x: number;
  y: number;
  dir: Direction;
  /** When the position last changed (local clock). */
  movedAt: number;
  /** Velocity between the last two positions, px/s. */
  vx: number;
  vy: number;
  /** Sender says it is walking; undefined for clients without the flag. */
  walking?: boolean;
}

/** Camera follow damping: ~200ms to settle on the player (see startFollow). */
const CAMERA_LERP = 0.16;

export class CityScene extends Phaser.Scene {
  private avatar!: AvatarSprite;
  private playerBody!: Phaser.Physics.Arcade.Body;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private collisionLayers: Phaser.Tilemaps.TilemapLayer[] = [];
  /** Layers that can render above the player — faded when they occlude the player. */
  private overheadLayers: CityLayer[] = [];
  /** City objects drawn as Blitters, culled to the camera every frame. */
  private sparseLayers: SparseLayer[] = [];
  /** Static layers baked into textures, drawn once (see world/groundBake.ts). */
  private bakedGround: BakedGround | null = null;

  private network!: OnChainMultiplayer;
  private chat!: ChatManager;
  private remotePlayers = new Map<string, AvatarSprite>();
  /** JSON of the loadout last applied to each remote avatar — to skip rebuilds. */
  private remoteLoadoutKey = new Map<string, string>();
  /**
   * wallet → where that player is according to the chain, the way they face,
   * and when that position last changed. Remote avatars walk toward it every
   * frame (followRemote) rather than being tweened to it.
   */
  private remoteTarget = new Map<string, RemoteTarget>();
  /** Per-remote expression auto-revert timers. */
  private remoteExprTimers = new Map<string, Phaser.Time.TimerEvent>();
  /** Per-remote last position + last dust time, so remotes kick up foot dust too. */
  private remoteDust = new Map<string, { lastX: number; lastY: number; lastDustAt: number }>();
  private nameLabels = new Map<string, Phaser.GameObjects.Text>();
  private activeBubbles = new Map<string, ChatBubble>();
  // Debounce "entered the city" — wallet reconnects clear knownPlayers and
  // re-discover the same players, which would spam the chat on every reconnect.
  private recentJoins = new Map<string, number>();
  // Debounce transient wallet flaps: the adapter emits disconnect→connect on
  // auto-connect retries / re-renders. Acting on each disconnect tears the
  // session down (commit_and_undelegate + rotateKey), and the rapid reconnect
  // then reads the ER with a rotated key it can't match → InvalidSessionKey
  // (6000) on every move. We delay the disconnect and cancel it if a reconnect
  // for the same wallet arrives, so a flap never undelegates.
  private walletFlapTimer: ReturnType<typeof setTimeout> | null = null;
  private currentDirection: Direction = "down";
  private idleDelay = 0;
  // Footstep dust — kicked up behind the feet while walking, ramping in
  // intensity the longer you keep moving.
  private dustEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private walkStartAt = 0;   // time.now the current unbroken walk began (0 = idle)
  private lastDustAt = 0;
  /** Auto-revert timer for the current facial expression (null = none active). */
  private expressionTimer: Phaser.Time.TimerEvent | null = null;
  private chatInputActive = false;
  private npcSprites: NPCSprite[] = [];
  private pedestrians!: PedestrianManager;
  private interactionBlocked = false;
  private walletAddress: string | null = null;
  /** Wallet whose session handshake is in flight — see the connect guard. */
  private walletConnecting: string | null = null;
  private profile!: ProfileManager;
  private touchDx = 0;
  private touchDy = 0;
  /** Every game-level listener this scene added, so shutdown can undo them. */
  private gameEventHandlers: Array<[string, (...args: never[]) => void]> = [];

  constructor() {
    super({ key: "CityScene" });
  }

  /**
   * Subscribe to a GAME-level event and remember it for teardown.
   *
   * `game.events` outlives the scene, so anything registered on it in create()
   * survives a scene restart and a second create() would stack a duplicate of
   * every handler — two wallet sessions opened for one connect, every chat line
   * appended twice, and so on. Scene-level `this.events` cleans itself up; this
   * is the bus that does not.
   */
  private onGameEvent(name: string, fn: (...args: never[]) => void): void {
    this.game.events.on(name, fn);
    this.gameEventHandlers.push([name, fn]);
  }

  private teardownGameEvents(): void {
    for (const [name, fn] of this.gameEventHandlers) {
      this.game.events.off(name, fn);
    }
    this.gameEventHandlers = [];
  }

  create(): void {
    // Drop every game-level listener when this scene goes away, and stop the
    // outfit-reward subscription with it — both live on buses that outlast the
    // scene, so without this a restart would double them.
    this.events.once("shutdown", () => {
      this.teardownGameEvents();
      stopWatchingNpcConversations();
    });

    // ── Tiled map with real sprite art ────────────────────────────────────

    const map = this.make.tilemap({ key: "city-map" });
    const tileSize = map.tileWidth;   // 24

    // Add all tileset spritesheets loaded in BootScene. Names MUST match the
    // embedded tileset names in city.json and the loaded image keys.
    const allTilesets = [
      "SCTileGrass", "SCBuildMonkeyDAO", "SCBuildJupter",
      "SCTileFountain", "SCTileGround", "SCVegetationSet", "SCPalm",
      "SCBuildIndies", "SCUrbanEquipament", "SCBuildGenericBuild",
      "SCBuildKeepGreen", "SCGameAssets", "ScTileBeach",
      "ScBuildSTBrazilLighthouse", "SCBuildSTBrStands", "SCBuildMagicBlock02",
      "SCBuildSTEarn", "SCBuildSolanaCity",
      "SCBuildSolMechs", "SCBuildDungeousMoles", "SCBuildStoklana",
      "SCBuildRemedi",
    ]
      .map(n => map.addTilesetImage(n, n))
      .filter((ts): ts is Phaser.Tilemaps.Tileset => ts !== null);

    // Pure-canopy layers (no collidable tiles) — always above the player.
    const FOREGROUND_PREFIXES = ["VegetationTree"];
    const FOREGROUND_DEPTH = 10000;

    // Isolated vertical objects: trees, palms, lamp posts.
    // These y-sort with the player: depth = bottom-Y of their southernmost
    // collidable tile, so the player renders in front when approaching from
    // the south and behind when approaching from the north.
    // NOTE: "Decor" is intentionally excluded — a bare "Decor" layer falls to
    // the default (fixed depth, always behind, never fades — see the final
    // `else` below). DecorFountain (the sculpture) opts into ABOVE_HEAD_PREFIXES
    // instead. DecorFountainBase (2026-09-01) deliberately stays on the
    // default too, NOT here: it's a flat plaza/pool basin, not a vertical
    // object with one clear "meets the ground" row — the busiest-row math
    // below picked the pool's south rim (row 39) as that row, which sits
    // BELOW the spawn tile (row 38), so the player spawned "behind" (hidden
    // under) their own spawn plaza. The default fixed-depth/always-behind
    // treatment is what "Building / fountain / large structure" already
    // meant before today — collision still fully applies, and it's never a
    // fade candidate since it never joins overheadLayers.
    const Y_SORT_PREFIXES = ["Vegetation", "DecorLight", "Build", "GameAsset", "Rock"];

    // Standing decoration that has NO collision but still has to sort against
    // buildings — e.g. the ST Brasil welcome sign, which stands in front of the
    // lighthouse. Without this they fall through to `depth = layer index`, a
    // number in the tens, while any Y-sorted building sits at its bottom-Y in
    // the thousands — so the building always paints over them.
    const Y_SORT_NO_COLLISION_PREFIXES = ["DecorSign"];

    // Layers that always draw above the player: the SolanaCity gantry banners
    // the player walks under, the planter palms flanking the central bridge
    // whose fronds hang over the walkway, and the beach parasols the player
    // stands beneath.
    //
    // Y-sorting is not an option for these. A tilemap layer carries ONE depth,
    // and each of these layers holds several copies spread across the map —
    // the banners at rows 67, 82 and 98, the palm pairs at rows 74, 90 and 105,
    // the parasols scattered down the sand — so any single base row is right
    // for one copy and wrong for the rest. They were all falling through to
    // `depth = layer index` and the player walked over the top of them.
    //
    // DecorFountain (the sculpture) joins this list by request (2026-09-01):
    // the plaza's centerpiece is tall enough that the player should read as
    // walking in front of/under it, not behind it — same treatment as the
    // gantries above, still blocked by whatever collision is authored on the
    // layer. Matched by EXACT name, not prefix, below — DecorFountainBase (the
    // foundation the player spawns on) must NOT inherit this: it y-sorts like
    // a building instead (see Y_SORT_PREFIXES).
    //
    // The three flag layers used to be listed here as above-head decor. They
    // are gone from the map now: a waving sprite draws each of them (see
    // world/AnimatedDecor, REPLACED_MAP_LAYERS) and y-sorts off its own pole
    // foot, so the player walks in front of a flag from the south and behind
    // it from the north instead of always under it.
    const ABOVE_HEAD_PREFIXES = [
      "DecorBilboard", "DecorPalmBridge", "DecorSTBrUmbrella", "DecorSolanaUmbrella",
    ];

    // Create all tile layers in order from the JSON.
    // Do NOT pass x/y — Phaser defaults to layerData.x/y which already
    // incorporates the Tiled offsetx/offsety for each layer. Passing 0,0
    // would override those offsets and shift every layer to the origin.
    const allLayers: CityLayer[] = [];
    // Contiguous runs of flat ground (no collision, no fade, no y-sort) are
    // collapsed after this loop — see the consolidation pass below. Runs must
    // stay contiguous in draw order for the result to be pixel-identical, so a
    // layer that is NOT plain ground closes the run it interrupts.
    const groundRuns: Phaser.Tilemaps.TilemapLayer[][] = [];
    let groundRun: Phaser.Tilemaps.TilemapLayer[] = [];
    const closeGroundRun = () => {
      if (groundRun.length > 1) groundRuns.push(groundRun);
      groundRun = [];
    };
    for (let i = 0; i < map.layers.length; i++) {
      const layerName = map.layers[i].name;

      // Painted art an AnimatedDecor sprite now draws instead: never built, so
      // the static cloth cannot show under the animated one and its collision
      // never reaches the merged volume (the sprite stamps its own foot).
      //
      // Skipped BEFORE createLayer, and never destroyed: TilemapLayer.destroy
      // removes the layer from the tilemap by default, which splices
      // map.layers while this loop walks it by index — every later layer
      // shifts down one and the loop stops that many short. That is what ate
      // the MonkeDAO banana stand, the layer right after a dropped one.
      if (REPLACED_MAP_LAYERS.has(layerName.slice(layerName.lastIndexOf("/") + 1))) {
        closeGroundRun();
        continue;
      }

      const layer = map.createLayer(i, allTilesets);
      if (!layer) continue;
      allLayers.push(layer);

      layer.setCollisionFromCollisionGroup();

      // Phaser reports a grouped layer as "Group/Name". Match every rule below
      // on the leaf, so a layer keeps its render behaviour wherever the artist
      // files it in Tiled — the bridge palms live inside the Ground group, and
      // matching the full path silently dropped them to `depth = layer index`.
      const leafName = layerName.slice(layerName.lastIndexOf("/") + 1);

      // Collider*: barrier layers — ColliderInvisible is hand-drawn in Tiled,
      // ColliderAuto is generated by patch-map-collision.mjs (solid decor the
      // tilesets forgot, plus everything walled off from the spawn, so the sea
      // and interior pockets can never be walked or spawned into). Their tiles
      // aren't decorated with per-tile collision shapes, so force full collision
      // on every painted tile and hide the layer.
      if (leafName.startsWith("Collider")) {
        layer.forEachTile((tile: Phaser.Tilemaps.Tile) => {
          if (tile.index > 0) tile.setCollision(true, true, true, true);
        });
        layer.setVisible(false);
      }

      const collidingTiles = layer.filterTiles((t: Phaser.Tilemaps.Tile) => t.collides);

      const isAboveHead = leafName === "DecorFountain" || ABOVE_HEAD_PREFIXES.some(p => leafName.startsWith(p));

      if (collidingTiles.length > 0) {
        if (isAboveHead) {
          // Blocks (planter bases) but still draws over the player.
          layer.setDepth(FOREGROUND_DEPTH);
          this.overheadLayers.push(layer);
        } else if (Y_SORT_PREFIXES.some(p => leafName.startsWith(p))) {
          // Isolated vertical object (trunk, palm, lamp post) → y-sort.
          // depth = bottom-world-Y of the southernmost collidable ROW that
          // actually carries the object's mass.
          //
          // Not simply the southernmost collidable tile: a layer often holds a
          // building plus a detached prop. BuildIndies carries the house AND
          // the "GAMES on SOLANA" sign, whose two feet sit one row south of the
          // house's front wall — and those two tiles dragged the whole layer's
          // depth down a row, so anyone standing in FRONT of the house was
          // drawn behind it, which reads as walking under the facade. A handful
          // of tiles does not define where a building meets the ground.
          const tilesPerRow = new Map<number, number>();
          for (const tile of collidingTiles) {
            tilesPerRow.set(tile.y, (tilesPerRow.get(tile.y) ?? 0) + 1);
          }
          const busiestRow = Math.max(...tilesPerRow.values());
          let baseTileY = -1;
          for (const [tileY, count] of tilesPerRow) {
            if (count * 4 < busiestRow) continue; // sparse outlier row
            if (tileY > baseTileY) baseTileY = tileY;
          }
          const maxBottomY = layer.tileToWorldY(baseTileY)! + map.tileHeight;
          layer.setDepth(maxBottomY);
          // Y-sorted layers can render above the player → candidate for fade.
          this.overheadLayers.push(layer);
        } else {
          // Building / fountain / large structure → always behind the player.
          layer.setDepth(i);
        }
        this.collisionLayers.push(layer);
      } else if (isAboveHead || FOREGROUND_PREFIXES.some(p => leafName.startsWith(p))) {
        // Overhead structure or pure canopy → always above the player.
        layer.setDepth(FOREGROUND_DEPTH);
        // Always above the player → always a fade candidate.
        this.overheadLayers.push(layer);
      } else if (Y_SORT_NO_COLLISION_PREFIXES.some(p => leafName.startsWith(p))) {
        // Collision-free standing decor → y-sort off its own painted base, so
        // it sits in front of buildings whose base is further north and behind
        // the player once they walk past it.
        let maxBottomY = 0;
        layer.forEachTile((tile: Phaser.Tilemaps.Tile) => {
          if (tile.index <= 0) return;
          const bottom = layer.tileToWorldY(tile.y)! + map.tileHeight;
          if (bottom > maxBottomY) maxBottomY = bottom;
        });
        layer.setDepth(maxBottomY);
        this.overheadLayers.push(layer);
      } else {
        // Ground / background layer → always below the player.
        layer.setDepth(i);
        // Landmarks are read back by name for the minimap labels, so they
        // keep their own layer even when they are flat ground.
        if (LANDMARK_LAYERS[leafName]) closeGroundRun();
        else groundRun.push(layer);
        continue;
      }
      closeGroundRun();
    }
    closeGroundRun();

    // ── Consolidation pass ────────────────────────────────────────────
    // Only flat ground and collision are touched here; every layer that fades
    // or y-sorts is left exactly as authored, so a palm still goes
    // transparent on its own. See world/mergeLayers.ts.
    const layersBefore = allLayers.length;
    const dropped = new Set<CityLayer>();
    groundRuns.forEach((run, n) => {
      const merged = mergeGroundRun(map, allTilesets, run, `__ground${n}`);
      if (merged.length === 0) return; // not reproducible exactly — left alone
      allLayers.splice(allLayers.indexOf(run[0]), 0, ...merged);
      for (const l of run) dropped.add(l);
    });
    for (let i = allLayers.length - 1; i >= 0; i--) {
      if (dropped.has(allLayers[i])) allLayers.splice(i, 1);
    }

    // One collision volume for the whole city: the player, 96 pedestrians and
    // every NPC used to be tested against ~74 separate tile layers per frame.
    const collisionSources = this.collisionLayers;
    const physics = buildPhysicsLayer(map, allTilesets, collisionSources);
    if (physics) {
      this.collisionLayers = [physics.layer, ...physics.leftovers];
      // The Collider* layers are pure geometry — never drawn, no art to keep.
      // Their tiles now live in the merged volume, so the originals are dead
      // weight. Visible layers stay: only their collider moved.
      for (const src of collisionSources) {
        if (src.visible || physics.leftovers.includes(src)) continue;
        const at = allLayers.indexOf(src);
        if (at >= 0) allLayers.splice(at, 1);
        src.destroy(true);
      }
    }
    // ── Objects off the grid ──────────────────────────────────────────
    // Every palm, lamp post and building still keeps its own depth and its
    // own alpha, so it fades on its own exactly as authored; it just stops
    // paying for 15,525 empty cells. See world/sparseLayer.ts.
    // `?tiles=legacy` keeps the old tilemaps, to compare the two side by side.
    const legacyTiles = new URLSearchParams(window.location.search).get("tiles") === "legacy";
    if (!legacyTiles) {
      const keepAsTilemap = new Set<CityLayer>(this.collisionLayers);
      for (let i = 0; i < allLayers.length; i++) {
        const src = allLayers[i];
        if (!(src instanceof Phaser.Tilemaps.TilemapLayer)) continue;
        if (keepAsTilemap.has(src) || !src.visible) continue;
        let painted = 0;
        src.forEachTile((t: Phaser.Tilemaps.Tile) => { if (t.index > 0) painted++; });
        if (painted === 0) continue;
        // Dense layers (the ground) go in chunks: the tilemap renderer
        // recomputes texture coordinates and a transform for every visible
        // tile, every frame — ~35% of a profiled frame — where a Bob is a
        // precomputed quad, and off-screen chunks are skipped whole.
        const chunk = painted > SPARSE_MAX_TILES ? GROUND_CHUNK_TILES : 0;
        // Y-sorted layers (not the always-on-top foreground) sort each of
        // their objects by its own base, not by the layer's southernmost one.
        const ySorted = this.overheadLayers.includes(src) && src.depth !== FOREGROUND_DEPTH;
        const sparse = SparseLayer.from(this, src, chunk, ySorted);
        if (!sparse) continue; // not reproducible exactly — stays a tilemap
        allLayers[i] = sparse;
        const at = this.overheadLayers.indexOf(src);
        if (at >= 0) this.overheadLayers[at] = sparse;
        this.sparseLayers.push(sparse);
      }
    }
    // ── Static layers, drawn once ─────────────────────────────────────
    // Ground and never-fading buildings sit below everything that moves and
    // never change, so their pixels are baked once into chunk textures instead
    // of being redrawn as ~10k tile quads every frame. Anything that fades or
    // y-sorts stays live. Skipped if any static layer is still a tilemap, since
    // baking the rest would reorder it. See world/groundBake.ts.
    if (!legacyTiles) {
      const overhead = new Set<CityLayer>(this.overheadLayers);
      const statics = this.sparseLayers.filter((l) => !overhead.has(l));
      const liveStaticTilemap = allLayers.some((l) =>
        l instanceof Phaser.Tilemaps.TilemapLayer && l.visible && !overhead.has(l));
      // The bake draws at the highest static depth, which is only right while
      // every fading / y-sorted layer sits above that (today: 110 vs 552). A
      // map edit that breaks it gets the unbaked, per-layer path instead.
      const maxStatic = Math.max(-Infinity, ...statics.map((l) => l.depth));
      const minOverhead = Math.min(Infinity, ...this.overheadLayers.map((l) => l.depth));
      if (minOverhead <= maxStatic) {
        console.warn(`[CityScene] static bake skipped: a fading layer (depth ${minOverhead}) sits inside the static range (up to ${maxStatic})`);
      }
      if (!liveStaticTilemap && minOverhead > maxStatic) {
        this.bakedGround = bakeStaticLayers(this, statics);
        if (this.bakedGround) {
          const baked = this.bakedGround;
          this.events.once("shutdown", () => baked.destroy());
          console.log(`[CityScene] baked ${statics.length} static layers (${baked.tiles.toLocaleString()} tiles) into ${baked.chunks} chunk textures`);
        }
      }
    }
    console.log(
      `[CityScene] layers ${layersBefore} → ${allLayers.length}` +
      ` (${this.sparseLayers.length} as blitters${legacyTiles ? ", legacy mode" : ""})` +
      ` | collision layers → ${this.collisionLayers.length}` +
      ` | tile cells ${map.layers.reduce((n, l) => n + l.width * l.height, 0).toLocaleString()}`,
    );

    // Stocklana exchange: the building is Tiled art (BuildStocklana); this
    // only draws live market data into its blank screens.
    const destroyStockScreens = createStockExchange(
      this, allLayers.find(l => l.layer.name.endsWith("BuildStocklana")),
    );
    this.events.once("shutdown", destroyStockScreens);

    // Waving props (the Superteam Turkey flag by the Remedi building): sprites,
    // not tiles, since Phaser does not play Tiled's tile animations.
    const destroyDecor = createAnimatedDecor(this, FOREGROUND_DEPTH, this.collisionLayers[0]);
    this.events.once("shutdown", destroyDecor);

    // Spawn on the central fountain's walkway (col 78, row 38) — the two-tile
    // flight of steps climbing from the south path up to the sculpture...
    let spawnX = 78 * tileSize + tileSize / 2;
    let spawnY = 38 * tileSize + tileSize / 2;
    // ...unless this is a reload of a session already in progress. The page
    // reloads itself on a new build, a failed chunk or a wallet error caught
    // mid-render, and landing back at the fountain every time is the part the
    // player actually feels. A spot saved in the last half hour is used, as
    // long as nothing solid stands there now (the map may have changed).
    // ...or in front of a named NPC, for a link that drops someone straight
    // at a building: ?at=stocks-broker (aliases in NPC_DEEP_LINKS). Beats
    // asking a first-time visitor to find the place on the map.
    const atParam = new URLSearchParams(window.location.search).get("at")?.toLowerCase() ?? "";
    const atTarget = atParam
      ? NPC_REGISTRY.find((n) => n.enabled !== false && n.id === (NPC_DEEP_LINKS[atParam] ?? atParam))
      : undefined;
    let facing: Direction | null = null;
    if (atTarget) {
      const npcSpot = this.findNpcSpawn(map, atTarget.tileX, atTarget.tileY, tileSize);
      const col = Math.floor(npcSpot.wx / tileSize);
      const npcRow = Math.floor(npcSpot.wy / tileSize);
      // Stand a tile south of the NPC, the first row that is actually free, so
      // the talk prompt is already up when the scene fades in.
      for (let row = npcRow + 1; row <= npcRow + 4; row++) {
        const x = col * tileSize + tileSize / 2;
        const y = row * tileSize + tileSize / 2;
        const blocked = this.collisionLayers.some((l) => {
          const t = l.getTileAt(col, row);
          return t !== null && t.collides;
        });
        if (blocked) continue;
        spawnX = x + (atTarget.offsetX ?? 0);
        spawnY = y;
        facing = "up";
        break;
      }
      console.log(`[CityScene] deep link ?at=${atParam} → ${atTarget.name}`);
    }

    const resume = !atTarget && readLastPosition();
    if (resume && !this.collisionLayers.some((l) => {
      const t = l.getTileAtWorldXY(resume.x, resume.y);
      return t !== null && t.collides;
    })) {
      spawnX = resume.x;
      spawnY = resume.y;
      console.log(`[CityScene] resumed at ${resume.x},${resume.y} (${Math.round((Date.now() - resume.at) / 1000)}s ago)`);
    }
    this.avatar = new AvatarSprite(this, spawnX, spawnY, loadSavedLoadout());
    if (facing) {
      // walk() then idle() is how a direction is committed without moving.
      this.currentDirection = facing;
      this.avatar.walk(facing);
      this.avatar.idle();
    }

    const container = this.avatar.getContainer();
    this.physics.world.enable(container);
    this.playerBody = container.body as Phaser.Physics.Arcade.Body;
    this.playerBody.setSize(TILE_SIZE * 0.5, TILE_SIZE * 0.3);
    this.playerBody.setOffset(-TILE_SIZE * 0.25, -TILE_SIZE * 0.2);
    this.playerBody.setCollideWorldBounds(true);
    for (const cl of this.collisionLayers) {
      this.physics.add.collider(container, cl);
    }

    this.createFootDust();

    // Keep the resume point fresh: every few seconds while walking, and once
    // more the moment the tab is hidden (a reload gives no warning).
    const saveSpot = () => { if (this.avatar) saveLastPosition(this.avatar.x, this.avatar.y); };
    const saveTimer = this.time.addEvent({ delay: 3_000, loop: true, callback: saveSpot });
    const onHide = () => saveSpot();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    this.events.once("shutdown", () => {
      saveTimer.remove();
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    });

    // Memory census: __solCityStats() in the console, and a [mem] line a minute.
    const stopMemStats = startMemStats(this);
    this.events.once("shutdown", stopMemStats);

    // Where the player can go = the tilesets' authored collision + the
    // ColliderInvisible barrier layer + the world bounds (the map edges). No
    // hand-placed walls — the map itself defines the playable area now.
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    // Own name tag: the nickname once there is one ("YOU" until then), small
    // and seated just above the outfit (AvatarSprite.attachLabel).
    const youLabel = this.add.text(0, -34, "YOU", {
      fontSize: "5px", fontFamily: '"Press Start 2P", monospace',
      color: "#14F195", align: "center",
      resolution: 4,
      stroke: "#0a0a1e",
      strokeThickness: 2,
    }).setOrigin(0.5, 1);
    container.add(youLabel);
    this.avatar.attachLabel(youLabel);
    const showOwnName = () => {
      const n = this.walletAddress ? cachedName(this.walletAddress) : null;
      youLabel.setText(n ?? "YOU");
    };
    const onNameChanged = () => showOwnName();
    window.addEventListener(NAME_CHANGED_EVENT, onNameChanged);
    // Remote tags update as names resolve or change.
    const offNames = onNames((names) => {
      for (const [wallet, name] of Object.entries(names)) {
        if (wallet === this.walletAddress) showOwnName();
        this.nameLabels.get(wallet)?.setText(name);
        if (wallet === this.walletAddress) showOwnName();
      }
    });
    // Renames elsewhere reach us within a minute.
    const nameRefresh = this.time.addEvent({
      delay: 60_000, loop: true,
      callback: () => requestNames([...this.remotePlayers.keys()], true),
    });
    this.events.once("shutdown", () => {
      window.removeEventListener(NAME_CHANGED_EVENT, onNameChanged);
      offNames();
      nameRefresh.remove();
    });

    // Camera — locked to player, no edge clamping so player stays centred
    // even at the map borders.
    //
    // Pixel-perfect invariant (see zoomConfig.ts): sprite_scale (0.5) ×
    // camera_zoom must be a whole number of device pixels, so only the
    // zooms from getValidZooms() are used. Anything else lands source
    // pixels on fractional positions → irregular pixel sizes and blurry
    // outlines — the classic "shimmy" look.
    // Damping, not a rigid lock. At 1.0 the camera was pinned to the player
    // every frame, so every step and every correction from the joystick threw
    // the whole city sideways; on a phone that reads as jitter. 0.16 settles
    // in about 200ms: the view trails a step behind and catches up, which is
    // what makes walking feel smooth. `roundPixels` below keeps the art crisp
    // while the scroll lands between pixels.
    this.cameras.main.startFollow(container, true, CAMERA_LERP, CAMERA_LERP);
    // Start ON the player: a fresh camera sits at 0,0 and would otherwise
    // glide across the map on the first frames.
    this.cameras.main.centerOn(container.x, container.y);
    this.cameras.main.setZoom(loadZoom());
    this.applyZoomSmoothing(loadZoom());
    this.cameras.main.setBackgroundColor(0x061a2c);
    this.cameras.main.roundPixels = true;

    // Input — keyboard plugin may be null on certain mobile browsers/configs;
    // guard every access so a missing keyboard doesn't crash CityScene.
    const kb = this.input.keyboard;
    if (kb) {
      this.cursors = kb.createCursorKeys();
      this.wasd = {
        up:    kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        down:  kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        left:  kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      };
    } else {
      // Provide inert stub objects so update() can read .isDown without crashing
      const stub = { isDown: false } as Phaser.Input.Keyboard.Key;
      this.cursors = { up: stub, down: stub, left: stub, right: stub,
        shift: stub, space: stub } as unknown as Phaser.Types.Input.Keyboard.CursorKeys;
      this.wasd = { up: stub, down: stub, left: stub, right: stub };
    }

    // Profile system — singleton, shared with React UI
    this.profile = profileManager;
    this.registry.set("profileManager", this.profile);

    // Achievement engine — mounted once per page load. It listens to
    // profile changes and fires unlock events on the progression bus.
    // The engine stores itself on the registry so it isn't re-created
    // on scene restarts.
    if (!this.registry.get("achievementEngine")) {
      const engine = new AchievementEngine(this.profile);
      this.registry.set("achievementEngine", engine);
    }

    // Superteam Brasil outfit grants (Kuka, and the full citizen roll call).
    // Re-subscribes rather than stacking, so a scene restart is harmless.
    watchNpcConversations();

    // Chat system
    this.chat = new ChatManager();
    this.chat.addSystemMessage("Welcome to The Solana City");
    this.registry.set("chatManager", this.chat);

    // Listen for chat input from React UI
    this.onGameEvent("chat:send", (text: string) => {
      // The panel already refuses links; this is the backstop.
      if (containsLink(text)) {
        this.chat.addSystemMessage("Links are not allowed in chat.");
        return;
      }
      const channel = this.chat.getActiveChannel();
      track("chat", channel.startsWith("dm:") ? "dm" : channel, { label: "message sent" });
      const color = channel.startsWith("dm:") ? getChannelColor(channel) : SELF_COLOR;

      this.chat.addMessage(
        channel,
        this.network?.sessionId ?? "local",
        this.profile.get().displayName,
        text,
        color
      );

      this.showBubble(this.avatar.getContainer(), text, color);

      if (this.network?.connected) {
        this.network.sendChat(text);
      }
    });

    // Cross-browser chat messages received via Solana Memo / onLogs.
    // Registered here, NOT inside the wallet:connected handler where it used to
    // live: game.events outlives a session, so every reconnect added another
    // copy and each network message got appended to the chat once per connect.
    this.onGameEvent("chat:network", ({ wallet, name, text: raw }: { wallet?: string; name: string; text: string }) => {
      if (wallet) requestNames([wallet]);
      const shown = (wallet ? cachedName(wallet) : null) ?? name;
      // Stock trades ride the chat pipe as a tag: render them as a trade tag
      // over the trader instead of a chat line.
      const trade = decodeTrade(raw);
      if (trade) {
        this.chat.addMessage("city", shown, shown, tradeLogLine(trade), TRADE_COLOR);
        const trader = wallet ? this.remotePlayers.get(wallet) : undefined;
        if (trader) new TradeBubble(this, trader.getContainer(), trade);
        return;
      }
      // A modified client can still write a link on-chain: mask it on arrival.
      const text = maskLinks(raw);
      const color = getChannelColor("city");
      this.chat.addMessage("city", shown, shown, text, color);
      // Float the message over the sender's avatar, if they're in view.
      const avatar = wallet ? this.remotePlayers.get(wallet) : undefined;
      if (avatar) this.showBubble(avatar.getContainer(), text, color);
    });

    // Our own stock trade (Stocks Broker panel). Always shown over our head;
    // announced to the city unless the player opted out in the panel.
    this.onGameEvent("game:stock-trade", (e: { side: TradeSide; ticker?: string; basketId?: string; usd?: number; share?: boolean }) => {
      const trade = { side: e.side, ticker: e.ticker, basketId: e.basketId, usd: e.usd };
      new TradeBubble(this, this.avatar.getContainer(), trade);
      this.chat.addMessage("city", "local", this.profile.get().displayName, tradeLogLine(trade), TRADE_COLOR);
      if (e.share && this.network?.connected) this.network.sendChat(encodeTrade(trade));
      // First trade at Stocklana earns the Trader Shades.
      onStockTraded();
    });

    this.onGameEvent("chat:focus", (focused: boolean) => {
      this.chatInputActive = focused;
      // Disable Phaser keyboard capture so typing in chat doesn't trigger WASD
      if (this.input.keyboard) {
        this.input.keyboard.enabled = !focused;
      }
    });

    // Emoji hotkeys (1-6) are disabled for now — the emotes are underused
    // and lack final art, and freeing 1-6 keeps them clear for the
    // expression wheel. The chat 🎭 picker still works via emoji:trigger.
    // (setupEmojiKeys intentionally not called.)

    // Emoji trigger from React UI button
    this.onGameEvent("emoji:trigger", (emoji: EmojiDef) => {
      track("expression", `emoji-${emoji.id}`, { label: emoji.symbol });
      showEmoji(this, this.avatar.getContainer(), emoji);
      this.chat.addMessage("city", "local", this.profile.get().displayName, emoji.symbol, emoji.color);
    });

    // Facial expression trigger from the React expressions picker. Swaps the
    // player's own face for a few seconds, then auto-reverts. Local only.
    this.onGameEvent("expression:trigger", (expr: { textureKey: string }) => {
      track("expression", expr.textureKey.replace(/^pd-expr-/, "").toLowerCase());
      this.avatar.setExpression(expr.textureKey);
      soundManager.play("emote");
      this.network.sendExpression(expr.textureKey); // let others see the reaction
      this.expressionTimer?.remove(false);
      this.expressionTimer = this.time.delayedCall(3500, () => {
        this.avatar.setExpression(null);
        this.expressionTimer = null;
      });
    });

    // Wardrobe panel — live preview while panel is open, persisted on Save.
    this.onGameEvent("wardrobe:loadout", (loadout: Loadout) => {
      this.avatar.setLoadout(loadout);
      this.network.updateLoadout(loadout); // broadcast so others re-render our look
    });

    // ── Network + wallet, before the world is populated ───────────────────
    // This block used to sit AFTER the NPC and pedestrian setup below. That
    // made login hostage to world population: anything throwing while placing
    // NPCs or flood-filling the crowd meant `this.network` was never built and
    // the "wallet:connected" listener never registered, so connecting a wallet
    // did nothing at all for the rest of the session — silently, since the
    // throw only showed up in the console. Infrastructure comes first.

    // On-chain multiplayer via MagicBlock Ephemeral Rollups
    this.network = new OnChainMultiplayer();
    this.registry.set("network", this.network);

    // Where people walk, sampled every few seconds rather than taken from the
    // position sync, which fires ten times a second and would be all noise.
    const stopHeatmap = startHeatmap(() =>
      this.avatar ? { x: this.avatar.x, y: this.avatar.y } : null);
    this.events.once("shutdown", stopHeatmap);

    // Register callbacks immediately so they are active during discovery.
    // CRITICAL: setupNetworkCallbacks must be called BEFORE network.connect()
    // because discoverPlayers/discoverPlayersFromBase fire addCallbacks during
    // connect(). If callbacks are registered after connect(), discovered players
    // never get sprites in the scene.
    this.setupNetworkCallbacks();

    // Expose game event bus globally so the multiplayer layer can
    // ask React (which owns useWallet) to sign transactions.
    (globalThis as any).__solCityGameEvents = this.game.events;

    // Keep multiplayer score in sync with local profile
    this.profile.onChange((p) => {
      this.network?.updateScore(p.score);
    });

    // Listen for wallet connection from React to start on-chain session
    this.onGameEvent("wallet:connected", async (walletAddress: string) => {
      // A reconnect cancels any pending flap-disconnect for this wallet.
      if (this.walletFlapTimer) { clearTimeout(this.walletFlapTimer); this.walletFlapTimer = null; }
      // Ignore re-fires for a wallet we're already connected to (adapter flaps).
      if (this.network.connected && this.walletAddress === walletAddress) {
        // The adapter re-fires on reconnects; the connect screen is waiting on
        // this event, so say again that the session is already up.
        this.game.events.emit("multiplayer:ready", this.network.visibleToOthers);
        return;
      }
      // ...and for one whose handshake is still running. connect() takes seconds
      // (PDA init, then delegation), and network.connected stays false the whole
      // time, so the check above alone would let a second event start a parallel
      // session on the same PDA — which lands as a broken session the player can
      // only escape by disconnecting and connecting again.
      if (this.walletConnecting === walletAddress) return;
      this.walletConnecting = walletAddress;
      // Enter the map immediately; the on-chain session comes up in the
      // background (moves before delegation land as sim/base, as before).
      try {
        this.walletAddress = walletAddress;
        requestNames([walletAddress], true);
        showOwnName();
        this.profile.setWallet(walletAddress);
        const displayName = this.profile.get().displayName;
        this.network.updateScore(this.profile.get().score);

        // WalletSignBridge polls every 300ms to register on __solCityGameEvents.
        // On auto-reconnect the wallet:connected event fires before it registers,
        // causing all requestWalletSign calls to time out (60s) and fail.
        // Wait up to 1s for "walletBridge:ready"; fall through immediately if
        // already registered (normal case after user manually clicks Connect).
        await new Promise<void>(resolve => {
          const bus = (globalThis as any).__solCityGameEvents;
          const fallback = setTimeout(resolve, 1000);
          bus?.once("walletBridge:ready", () => { clearTimeout(fallback); resolve(); });
        });

        await this.network.connect(new PublicKey(walletAddress), displayName, loadSavedLoadout());
        this.chat.addSystemMessage("Multiplayer session started.");
        // The connect screen waits on this before letting the player in, so
        // nobody walks into a city that cannot see them (see ConnectScreen).
        this.game.events.emit("multiplayer:ready", this.network.visibleToOthers);

        // Warnings from multiplayer (e.g. delegated PDA detected)
        this.game.events.once("multiplayer:warning", (msg: string) => {
          this.chat.addSystemMessage(msg);
        });
      } catch (err: any) {
        console.error("[CityScene] session error:", err);
        this.chat.addSystemMessage("Session offline (local mode)");
        this.game.events.emit("multiplayer:ready", false);
      } finally {
        // Cleared either way: a failed handshake must stay retryable.
        if (this.walletConnecting === walletAddress) this.walletConnecting = null;
      }
    });

    // The "hidden from the city" badge asks for another go at the on-chain
    // setup — the player keeps playing while it runs.
    this.onGameEvent("multiplayer:retry", () => {
      this.chat.addSystemMessage("Reconnecting to the city...");
      this.network.retryOnline()
        .then(() => {
          this.chat.addSystemMessage(
            this.network.visibleToOthers
              ? "You are back in the shared city."
              : "Still offline to other players. Try again in a moment.");
        })
        .catch(() => this.chat.addSystemMessage("Reconnect failed. Try again in a moment."));
    });

    this.onGameEvent("wallet:disconnected", () => {
      // Debounce: a transient flap fires disconnect then connect right after.
      // Wait; if a reconnect cancels this, the session is never torn down (no
      // undelegate/rotate, so no 6000). Only a real disconnect proceeds.
      if (this.walletFlapTimer) return;
      this.walletFlapTimer = setTimeout(() => {
        this.walletFlapTimer = null;
        if (!this.network.connected) return;
        this.network.disconnect();
        this.chat.addSystemMessage("Session ended");
      }, 1200);
    });

    // ── Wallet handshake ──────────────────────────────────────────────────
    // Announce that the two listeners above are live, then PULL whatever React
    // already has. Both halves are needed.
    //
    // Push alone loses the wallet: PhaserGame calls onGameReady the instant
    // `new Phaser.Game()` returns, long before BootScene finishes preloading
    // and far before this line, so React emitting on `game` by itself lands on
    // an emitter with no subscribers and Phaser drops it silently.
    //
    // Waiting for "scene:ready" fixes that but introduces its own single point
    // of failure — if anything further down create() throws, the event never
    // goes out and the wallet is stranded for the whole session. Reading the
    // mirrored value here means the handshake completes whichever side is late,
    // and this runs immediately after the listeners rather than at the end of
    // create() so no later failure can skip it.
    //
    // Emitting both ways is safe: the connect handler ignores a wallet whose
    // handshake is already in flight.
    (this.game as GameWithSceneReady).__solCitySceneReady = true;
    this.game.events.emit("scene:ready");

    const pendingWallet = (globalThis as SolCityWalletHost).__solCityWallet;
    if (pendingWallet) {
      this.game.events.emit("wallet:connected", pendingWallet);
    }

    // NPCs — position read from Tiled NPC layer, scanned to first walkable row
    for (const def of NPC_REGISTRY) {
      if (def.enabled === false) continue;
      const spawn = this.findNpcSpawn(map, def.tileX, def.tileY, tileSize);
      const wx = spawn.wx + (def.offsetX ?? 0);
      const wy = spawn.wy + (def.offsetY ?? 0);
      const npc = new NPCSprite(this, def, wx, wy, this.collisionLayers);
      this.npcSprites.push(npc);

      const npcContainer = npc.getContainer();
      this.physics.world.enable(npcContainer);
      const npcBody = npcContainer.body as Phaser.Physics.Arcade.Body;
      npcBody.setSize(TILE_SIZE * 0.6, TILE_SIZE * 0.4);
      npcBody.setOffset(-TILE_SIZE * 0.3, -TILE_SIZE * 0.2);
      npcBody.setImmovable(true);
      this.physics.add.collider(container, npcContainer);
    }

    // Minimap: drawn from these same layers, so it always matches the map.
    publishMinimap(this, map, allLayers, {
      player: () => {
        const c = this.avatar?.getContainer();
        return c ? { x: c.x, y: c.y } : null;
      },
      npcs: () => this.npcSprites,
      players: () => [...this.remotePlayers].map(([wallet, avatar]) => ({
        wallet, avatar, name: this.nameLabels.get(wallet)?.text ?? `${wallet.slice(0, 4)}...`,
      })),
    });
    // The full map is a modal: keys typed while it is open must not walk.
    this.onGameEvent("minimap:open", (open: boolean) => {
      if (this.input.keyboard) this.input.keyboard.enabled = !open;
    });

    // Fast travel from the city map: fade out, land on the nearest walkable
    // tile beside the target (never inside a building or on top of an NPC),
    // fade back in. Position sync picks the new spot up on the next update.
    let travelling = false;
    this.onGameEvent("player:teleport", ({ x, y }: { x: number; y: number }) => {
      if (travelling || !this.avatar) return;
      const spot = this.findTravelSpot(map, x, y);
      if (!spot) return;
      travelling = true;
      this.interactionBlocked = true;
      this.playerBody.setVelocity(0, 0);
      const cam = this.cameras.main;
      cam.fadeOut(260, 6, 8, 20);
      cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        const c = this.avatar.getContainer();
        this.playerBody.reset(spot.x, spot.y);
        c.setPosition(spot.x, spot.y);
        // Fast travel is a cut, not a pan: without this the camera would
        // slide across the city behind the fade.
        cam.centerOn(spot.x, spot.y);
        cam.fadeIn(320, 6, 8, 20);
        cam.once(Phaser.Cameras.Scene2D.Events.FADE_IN_COMPLETE, () => {
          travelling = false;
          this.interactionBlocked = false;
        });
      });
    });

    // Pedestrians + "Where Is NPC?" hunt game
    this.pedestrians = new PedestrianManager();
    this.pedestrians.spawn(this, this.collisionLayers, map, 78, 38);
    this.pedestrians.setupColliders(
      container,
      this.npcSprites.map(n => n.getContainer()),
    );

    // Citizen expiry + target sync. When the current citizen's per-citizen
    // countdown runs out unfound, rotate to the next one and reset the
    // timer (a find does the same via onTargetFound). Checked often so the
    // swap is prompt rather than lagging the 0:00 mark.
    this.time.addEvent({
      delay: 2_000,
      loop: true,
      callback: () => {
        if (isCitizenExpired()) {
          if (isHuntOnChain()) {
            // Shared hunt: crank the on-chain round forward (first-writer-wins;
            // guarded to one attempt per round). The poll then advances everyone.
            this.network?.expireRound(getRoundIndex());
          } else {
            advanceFindSlot();
            resetCitizenTimer();
          }
        }
        this.pedestrians.refreshTarget();
        this.game.events.emit("whereIsNPC:roundCheck");
      },
    });

    // React UI requests current target info (on mount or round change)
    this.onGameEvent("whereIsNPC:requestTarget", () => {
      const loadout = this.pedestrians.getTargetLoadout();
      if (loadout) this.game.events.emit("whereIsNPC:targetInfo", loadout);
    });

    // G key — toggle collision debug overlay (desktop only)
    this.input.keyboard?.on("keydown-G", () => {
      this.physics.world.drawDebug = !this.physics.world.drawDebug;
      if (!this.physics.world.drawDebug) {
        this.physics.world.debugGraphic?.clear();
      }
    });

    // NPC interaction listener from React
    this.onGameEvent("npc:close", () => {
      this.interactionBlocked = false;
    });

    // Camera zoom from UI control — always snap to a pixel-perfect value
    this.onGameEvent("camera:zoom", (zoom: number) => {
      const z = snapZoom(zoom);
      this.cameras.main.setZoom(z);
      this.applyZoomSmoothing(z);
    });

    // Mobile touch input
    this.onGameEvent("touch:joystick", ({ dx, dy }: { dx: number; dy: number }) => {
      this.touchDx = dx;
      this.touchDy = dy;
    });
    this.onGameEvent("touch:stop", () => {
      this.touchDx = 0;
      this.touchDy = 0;
    });
    this.onGameEvent("touch:interact", () => {
      if (this.chatInputActive || this.interactionBlocked) return;
      if (this.tryHuntInteraction()) return;
      const nearby = this.npcSprites.find((n) => n.isInRange);
      if (nearby) {
        this.interactionBlocked = true;
        nearby.faceToward(this.avatar.x, this.avatar.y);
        track("npc", nearby.def.id, { label: nearby.def.name });
        this.game.events.emit("npc:interact", nearby.def);
      }
    });

    // E / Space for NPC interaction (desktop only — mobile uses the ACT button)
    const tryInteract = () => {
      if (this.chatInputActive || this.interactionBlocked) return;
      if (this.tryHuntInteraction()) return;
      const nearby = this.npcSprites.find((n) => n.isInRange);
      if (nearby) {
        this.interactionBlocked = true;
        nearby.faceToward(this.avatar.x, this.avatar.y);
        track("npc", nearby.def.id, { label: nearby.def.name });
        this.game.events.emit("npc:interact", nearby.def);
      }
    };
    this.input.keyboard?.on("keydown-E", tryInteract);
    this.input.keyboard?.on("keydown-SPACE", tryInteract);

    // Record on-chain when the player completes a swap/transfer/bounty.
    // ActionPanel emits these events after a successful transaction.
    this.onGameEvent("game:swap",     () => this.network?.recordAction("swap"));
    this.onGameEvent("game:transfer", () => this.network?.recordAction("transfer"));
    this.onGameEvent("game:bounty",   () => this.network?.recordAction("bounty"));

    // Mini-game lifecycle — pause/resume the scene around fullscreen overlays.
    // game.events (not scene.events) keeps the listener alive while paused.
    this.onGameEvent("minigame:launch", () => {
      this.interactionBlocked = true;
      this.playerBody.setVelocity(0);
      this.avatar.idle();
      this.scene.pause();
      // pause() only stops update(); Phaser keeps RENDERING a paused scene, so
      // the whole city was still drawing every frame behind the overlay.
      this.scene.setVisible(false);
    });
    this.onGameEvent("minigame:close", () => {
      this.scene.setVisible(true);
      this.scene.resume();
      this.interactionBlocked = false;
    });
    // Record result to ephemeral rollup via session key — no wallet popup.
    this.onGameEvent("minigame:result", ({ id, success }: { id?: string; success: boolean }) => {
      this.network?.recordMiniGame(success);
      if (id) onMiniGameFinished(id, success);
    });

  }

  /** One-time setup: a tiny dust dot texture + a manual particle emitter. */
  private createFootDust(): void {
    if (!this.textures.exists("foot-dust")) {
      const g = this.add.graphics();
      // Light dusty gray — reads as a soft kick-up puff, not dirt.
      g.fillStyle(0xd8d8d8, 1);
      g.fillCircle(2, 2, 2);
      g.generateTexture("foot-dust", 4, 4);
      g.destroy();
    }

    this.dustEmitter = this.add.particles(0, 0, "foot-dust", {
      lifespan: 440,
      speed: { min: 4, max: 14 },
      angle: { min: 0, max: 360 },
      // Small puffs that shrink to nothing; the stagger of emit times gives
      // a natural range of on-screen sizes without one big lead particle.
      scale: { start: 0.5, end: 0 },
      alpha: { start: 0.4, end: 0 },
      gravityY: -8,          // drifts up a touch as it fades, like settling dust
      frequency: -1,         // manual emission only (emitParticleAt)
      emitting: false,
    });
  }

  /**
   * Emits a small puff of dust behind the feet. Cadence + particle count
   * ramp up the longer the player walks unbroken, so a long stroll kicks up
   * progressively more than a single step.
   */
  private emitFootDust(now: number, vx: number, vy: number): void {
    if (!this.dustEmitter) return;
    const streak = now - this.walkStartAt;
    const interval = streak > 1500 ? 115 : 150;
    if (now - this.lastDustAt < interval) return;
    this.lastDustAt = now;

    // 2 particles per puff, +1 per ~0.9s of continuous walking, capped at 4.
    const count = Math.min(4, 2 + Math.floor(streak / 900));
    this.emitDustPuff(this.avatar.getContainer(), vx, vy, count);
  }

  /** Kicks up a dust puff behind a container's feet — shared by the local
   *  player and every remote player so the whole crowd leaves footfalls. */
  private emitDustPuff(c: Phaser.GameObjects.Container, vx: number, vy: number, count: number): void {
    if (!this.dustEmitter) return;
    // Position at the feet, nudged backward (opposite the movement vector).
    const len = Math.hypot(vx, vy) || 1;
    const fx = c.x - (vx / len) * 6;
    const fy = c.y - (vy / len) * 2 + 1;
    // Just under the player in the depth sort so the puff sits behind them.
    this.dustEmitter.setDepth(c.depth - 1);
    this.dustEmitter.emitParticleAt(fx, fy, count);
  }

  update(): void {
    if (this.chatInputActive || this.interactionBlocked) {
      this.playerBody.setVelocity(0);
      this.avatar.idle();
      // Still check NPC proximity for prompt display even when blocked
      for (const npc of this.npcSprites) {
        npc.checkProximity(this.avatar.x, this.avatar.y);
      }
      return;
    }

    this.playerBody.setVelocity(0);

    const kbUp    = this.cursors.up.isDown    || this.wasd.up.isDown;
    const kbDown  = this.cursors.down.isDown  || this.wasd.down.isDown;
    const kbLeft  = this.cursors.left.isDown  || this.wasd.left.isDown;
    const kbRight = this.cursors.right.isDown || this.wasd.right.isDown;

    let direction: Direction | null = null;
    let vx = 0, vy = 0;

    // Keyboard (digital)
    if (kbLeft)       { vx = -PLAYER_SPEED; direction = "left"; }
    else if (kbRight) { vx =  PLAYER_SPEED; direction = "right"; }
    if (kbUp)         { vy = -PLAYER_SPEED; direction = direction ?? "up"; }
    else if (kbDown)  { vy =  PLAYER_SPEED; direction = direction ?? "down"; }
    if (vx !== 0 && vy !== 0) {
      vx *= 0.7071;
      vy *= 0.7071;
    }

    // Touch joystick (analog) — overrides keyboard when active
    const touchActive = Math.abs(this.touchDx) > 0.1 || Math.abs(this.touchDy) > 0.1;
    if (touchActive) {
      vx = this.touchDx * PLAYER_SPEED;
      vy = this.touchDy * PLAYER_SPEED;
      if (Math.abs(this.touchDx) >= Math.abs(this.touchDy)) {
        direction = this.touchDx < 0 ? "left" : "right";
      } else {
        direction = this.touchDy < 0 ? "up" : "down";
      }
    }

    this.playerBody.setVelocity(vx, vy);

    if (direction) {
      this.idleDelay = 0;
      this.avatar.walk(direction);
      this.currentDirection = direction;
      // Footstep tick — SoundManager throttles to a natural walk cadence,
      // so calling every frame is fine. Local player only (never the crowd).
      soundManager.playFootstep();
      // Footstep dust — track the unbroken-walk streak so it ramps up.
      const now = this.time.now;
      if (this.walkStartAt === 0) this.walkStartAt = now;
      this.emitFootDust(now, vx, vy);
    } else {
      this.walkStartAt = 0; // stopped — reset the intensity ramp
      // Delay idle by ~8 frames so a brief tap shows at least 1 walk animation
      // frame (frameRate=8 → 125ms/frame; 8 game frames ≈ 133ms at 60fps).
      if (this.idleDelay < 8) {
        this.idleDelay++;
      } else {
        this.avatar.idle();
      }
    }

    this.avatar.updateDepth();

    // ── Overhead fade ─────────────────────────────────────────────────────
    // Fade a layer only while it actually HIDES the player: it has to draw
    // above them AND cover their body.
    //
    // The body part matters. `avatar.y` is the feet, and testing that tile
    // alone fired whenever the player merely stood on a tile the layer
    // happened to paint — brushing the front of a building, or walking past
    // its base — which read as the whole building blinking translucent for no
    // reason. The player is drawn upward from their feet, so occlusion happens
    // at the torso and head; sample there instead.
    {
      const px = this.avatar.x;
      const py = this.avatar.y;
      // Off-screen objects are not drawn at all (a Blitter does not cull itself).
      const view = this.cameras.main.worldView;
      for (const s of this.sparseLayers) s.cull(view);
      this.bakedGround?.cull(view);
      // Characters off screen are not drawn either (Phaser never culls a
      // Container on its own). The pad covers a sprite's full height above
      // its feet, and the one frame the camera view lags behind.
      const CHARACTER_PAD = 96;
      this.pedestrians?.cull(view, CHARACTER_PAD);
      for (const avatar of this.remotePlayers.values()) {
        cullContainer(avatar.getContainer(), view, CHARACTER_PAD);
      }

      for (const layer of this.overheadLayers) {
        // Converted layers fade per object: walking behind one palm used to
        // fade every palm on its layer, including ones across the screen.
        if (layer instanceof SparseLayer) { layer.updateFade(px, py); continue; }
        // Layer is "overhead" only when it draws above the player's depth.
        const isAbove = layer.depth > py;
        const covers = isAbove && (
          layer.getTileAtWorldXY(px, py - TILE_SIZE) !== null ||
          layer.getTileAtWorldXY(px, py - TILE_SIZE * 1.5) !== null
        );
        const target = covers ? 0.25 : 1.0;
        if (Math.abs(layer.alpha - target) > 0.004) {
          layer.alpha = Phaser.Math.Linear(layer.alpha, target, 0.12);
        }
      }
    }

    // NPC proximity checks
    for (const npc of this.npcSprites) {
      npc.checkProximity(this.avatar.x, this.avatar.y);
    }

    // Sync position to server (always call — sendInput handles sim-log when not connected)
    this.network.sendInput(
      this.avatar.x,
      this.avatar.y,
      this.currentDirection,
      direction !== null
    );

    // Pedestrian depth sorting
    this.pedestrians.updateDepths();

    // Walk remote players toward their chain position + kick up their foot dust.
    const dustNow = this.time.now;
    const followDt = Math.min(this.game.loop.delta, 100) / 1000;
    const followNow = Date.now();
    this.remotePlayers.forEach((remote, wallet) => {
      const target = this.remoteTarget.get(wallet);
      if (target) this.followRemote(remote, target, followDt, followNow);
      remote.updateDepth();
      const c = remote.getContainer();
      const prev = this.remoteDust.get(wallet);
      if (prev) {
        const rvx = c.x - prev.lastX;
        const rvy = c.y - prev.lastY;
        if (Math.hypot(rvx, rvy) > 0.4 && dustNow - prev.lastDustAt > 140) {
          this.emitDustPuff(c, rvx, rvy, 2);
          prev.lastDustAt = dustNow;
        }
        prev.lastX = c.x;
        prev.lastY = c.y;
      } else {
        this.remoteDust.set(wallet, { lastX: c.x, lastY: c.y, lastDustAt: 0 });
      }
    });
  }

  /**
   * Picks crisp vs smooth canvas scaling for the current zoom. Device pixels
   * per source pixel = viewScale × the REAL device dpr; below 1 the art is shown
   * sub-pixel (a standard-DPI desktop zoomed out past 1×, where the forced 2×
   * backing store downsamples sub-integer), and nearest-neighbor drops pixels —
   * the "broken" zoom-out. Use smooth scaling only there; at ≥1 device-px per
   * source-px keep crisp nearest, so the default look is unchanged and mobile
   * (real dpr 2, where 0.5× lands on whole pixels) stays crisp too.
   */
  private applyZoomSmoothing(zoom: number): void {
    const canvas = this.game.canvas as HTMLCanvasElement | null;
    if (!canvas) return;
    const realDpr = window.devicePixelRatio || 1;
    canvas.style.imageRendering = viewScale(zoom) * realDpr < 1 ? "auto" : "pixelated";
  }

  // ── "Where Is NPC?" hunt ──────────────────────────

  private tryHuntInteraction(): boolean {
    const target = this.pedestrians.getTargetPedestrian();
    if (!target) return false;
    if (!target.isNearPlayer(this.avatar.x, this.avatar.y)) return false;

    const wallet = this.walletAddress ?? "guest";

    // Each wallet can only find the same target NPC once
    if (hasAlreadyFoundCurrent(wallet)) {
      this.game.events.emit("npc:interact", {
        id: "hunt-already-found",
        name: "Citizen",
        role: "Already found!",
        tileX: 0, tileY: 0,
        color: 0x9945FF,
        dialog: ["You already found me this round! Wait for someone new to appear."],
        action: { type: "placeholder", label: "Got it!" },
      });
      return true;
    }

    markCurrentFound(wallet);
    this.pedestrians.onTargetFound();

    if (isHuntOnChain()) {
      // Shared hunt: the on-chain claim is first-writer-wins, so only the first
      // finder city-wide scores. Award the "found" banner (and its on-chain
      // points) only if OUR claim landed first; the round then advances for all.
      this.network?.claimFind(getRoundIndex()).then((won) => {
        if (won) {
          this.game.events.emit("whereIsNPC:found", { wallet, loadout: target.loadout });
          track("hunt", "found", { value: 1, label: "found the citizen" });
        }
      });
    } else {
      this.game.events.emit("whereIsNPC:found", { wallet, loadout: target.loadout });
      track("hunt", "found", { value: 1, label: "found the citizen" });
    }

    const FOUND_LINES = [
      "Oh! You recognized me. Sharp eyes, citizen.",
      "Wow, you actually found me. I wasn't making it easy!",
      "Hey, how did you spot me so fast?",
      "Alright, alright, you got me. Well done.",
      "I can't believe it! Nobody finds me this quickly.",
      "You have a talent for this. Have we met before?",
      "Caught! You must walk these streets a lot.",
    ];
    const line = FOUND_LINES[Math.floor(Math.random() * FOUND_LINES.length)];
    this.game.events.emit("npc:interact", {
      id: "hunt-target",
      name: "Citizen",
      role: "Found!",
      tileX: 0, tileY: 0,
      color: 0xFFD700,
      dialog: [line],
      action: { type: "placeholder", label: "Nice!" },
    });
    return true;
  }

  // ── Network setup ──────────────────────────────────

  private setupNetworkCallbacks(): void {
    this.network.onPlayerAdd((wallet, player) => {
      if (wallet === this.network.sessionId) return;
      this.addRemotePlayer(wallet, player);
    });

    this.network.onPlayerRemove((wallet) => {
      this.removeRemotePlayer(wallet);
    });

    this.network.onPlayerChange((wallet, player) => {
      if (wallet === this.network.sessionId) return;
      this.updateRemotePlayer(wallet, player);
    });

    this.network.onPlayerExpression((wallet, textureKey) => {
      if (wallet === this.network.sessionId) return;
      this.applyRemoteExpression(wallet, textureKey);
    });
  }

  private addRemotePlayer(wallet: string, player: OnChainPlayer): void {
    // Idempotent — if this wallet already has an avatar (e.g. a reconnect
    // re-discovered them), refresh it instead of stacking a second sprite over
    // the first, which would orphan the old one and show a duplicate.
    if (this.remotePlayers.has(wallet)) {
      this.updateRemotePlayer(wallet, player);
      return;
    }
    const avatar = new AvatarSprite(this, player.x, player.y, player.loadout ?? DEFAULT_LOADOUT);
    this.remotePlayers.set(wallet, avatar);
    this.remoteLoadoutKey.set(wallet, JSON.stringify(player.loadout ?? {}));

    // Nickname from the registry; a short wallet only until it resolves (or
    // for players who haven't picked one).
    const shortAddr = `${wallet.slice(0, 4)}..${wallet.slice(-4)}`;
    const displayName = cachedName(wallet) ?? shortAddr;
    requestNames([wallet]);

    const label = this.add.text(0, -34, displayName, {
      fontSize: "5px", fontFamily: '"Press Start 2P", monospace',
      color: "#e2e2f5", align: "center",
      resolution: 4,
      stroke: "#0a0a1e",
      strokeThickness: 2,
    }).setOrigin(0.5, 1);
    avatar.getContainer().add(label);
    avatar.attachLabel(label);
    this.nameLabels.set(wallet, label);

    // Clickable hit zone — opens this player's profile card in React.
    const container = avatar.getContainer();
    container.setData("wallet", wallet);
    const hitZone = this.add.rectangle(0, -24, 48, 72, 0x000000, 0);
    hitZone.setInteractive({ useHandCursor: true });
    hitZone.on("pointerdown", () => {
      this.game.events.emit("player:cardOpen", { wallet, displayName: cachedName(wallet) ?? displayName });
    });
    container.add(hitZone);

    const now = Date.now();
    if (now - (this.recentJoins.get(wallet) ?? 0) > 30_000) {
      this.chat.addSystemMessage(`${displayName} entered the city`);
      this.recentJoins.set(wallet, now);
    }
  }

  private removeRemotePlayer(wallet: string): void {
    const avatar = this.remotePlayers.get(wallet);
    if (avatar) {
      avatar.destroy();
      this.remotePlayers.delete(wallet);
    }
    this.remoteLoadoutKey.delete(wallet);
    this.remoteTarget.delete(wallet);
    this.remoteDust.delete(wallet);
    const exprTimer = this.remoteExprTimers.get(wallet);
    if (exprTimer) { exprTimer.remove(false); this.remoteExprTimers.delete(wallet); }

    const label = this.nameLabels.get(wallet);
    if (label) {
      label.destroy();
      this.nameLabels.delete(wallet);
    }

    const bubble = this.activeBubbles.get(wallet);
    if (bubble) {
      bubble.destroy();
      this.activeBubbles.delete(wallet);
    }

    // Only announce departure if the player was here long enough to matter.
    // Rapid disconnect-reconnect cycles (wallet adapter loops) produce a
    // "left" within seconds of "entered" — suppress those to keep chat clean.
    const joinedAt = this.recentJoins.get(wallet) ?? 0;
    if (Date.now() - joinedAt > 30_000) {
      this.chat.addSystemMessage(`Player left the city`);
    }
  }

  private updateRemotePlayer(wallet: string, player: OnChainPlayer): void {
    const avatar = this.remotePlayers.get(wallet);
    if (!avatar) return;

    const container = avatar.getContainer();
    const dx = player.x - container.x;
    const dy = player.y - container.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 180) {
      // A jump no walk covers in one sample: fast travel (or a reconnect).
      // Onlookers see the same fade the traveller does: out where they
      // stood, in where they land, instead of a slide across the map.
      this.tweens.killTweensOf(container);
      this.tweens.add({
        targets: container,
        alpha: 0,
        duration: 220,
        ease: "Quad.easeIn",
        onComplete: () => {
          container.setPosition(player.x, player.y);
          this.tweens.add({ targets: container, alpha: 1, duration: 300, ease: "Quad.easeOut" });
        },
      });
    } else if (container.alpha < 1 && !this.tweens.isTweening(container)) {
      container.setAlpha(1);
    }

    // Where they are now; followRemote() walks the avatar there. Legs are
    // decided by what the avatar actually does on screen, not by comparing
    // samples — two identical samples in a row (push, then poll) used to
    // read as "stopped" and freeze the legs mid-walk.
    const dirs: Direction[] = ["down", "left", "right", "up"];
    const prevTarget = this.remoteTarget.get(wallet);
    const now = Date.now();
    const moved = !prevTarget || prevTarget.x !== player.x || prevTarget.y !== player.y;
    let vx = prevTarget?.vx ?? 0;
    let vy = prevTarget?.vy ?? 0;
    // A stop keeps the last velocity: prediction is off anyway once the sender
    // says it stopped, and followRemote needs the direction of travel to tell
    // an overshoot (ease back) from lagging behind (walk on).
    if (player.walkFlag !== false && moved && prevTarget) {
      // Velocity from the last two positions over their arrival gap. Arrival
      // times jitter, so the gap is clamped, the speed capped, and the result
      // blended with the previous estimate.
      // Never divide by less than one send interval (200ms): two samples that
      // land close together were still sent ~200ms apart, and dividing by
      // their arrival gap inflated the speed — the remote looked faster.
      const dtS = Phaser.Math.Clamp(now - prevTarget.movedAt, 200, 600) / 1000;
      let nvx = (player.x - prevTarget.x) / dtS;
      let nvy = (player.y - prevTarget.y) / dtS;
      const sp = Math.hypot(nvx, nvy);
      const cap = PLAYER_SPEED * 1.5;
      if (sp > cap) { nvx *= cap / sp; nvy *= cap / sp; }
      vx = prevTarget.walking === false ? nvx : (vx + nvx) / 2;
      vy = prevTarget.walking === false ? nvy : (vy + nvy) / 2;
    }
    this.remoteTarget.set(wallet, {
      x: player.x,
      y: player.y,
      dir: dirs[player.direction] ?? prevTarget?.dir ?? "down",
      movedAt: moved ? now : prevTarget?.movedAt ?? 0,
      vx, vy,
      walking: player.walkFlag,
    });

    // Apply a changed outfit (only when it actually differs — setLoadout
    // rebuilds every layer, so guard against per-move churn).
    if (player.loadout) {
      const lkey = JSON.stringify(player.loadout);
      if (lkey !== this.remoteLoadoutKey.get(wallet)) {
        avatar.setLoadout(player.loadout);
        this.remoteLoadoutKey.set(wallet, lkey);
      }
    }

  }

  /**
   * Moves a remote avatar toward where that player most likely is NOW.
   *
   * The chain position is already old when it arrives: taken at send time,
   * then a network hop later. While the sender says it is walking, the aim
   * point runs ahead of that position along the measured velocity, by the
   * sample's age plus the one-way latency, capped at REMOTE_PREDICT_MAX_MS.
   * That hides the send interval and the network instead of showing them.
   *
   * If no new position arrives within REMOTE_PREDICT_STALE_MS the player has
   * probably stopped or hit a wall (a blocked sender stops sending), so the
   * prediction is dropped and the avatar settles back on the real position.
   * Settling back is done without walking legs, so an overshoot at a stop
   * reads as a small slide, not a step backwards.
   *
   * The avatar itself walks toward the aim point at the player's speed and
   * only speeds up (to 2.5x) when it has fallen behind — a late sample, a
   * burst after a stall.
   */
  private followRemote(
    avatar: AvatarSprite,
    t: RemoteTarget,
    dt: number,
    now: number,
  ): void {
    const REMOTE_LAG_S = 0.45;            // slack before the avatar speeds up to catch up
    const REMOTE_CATCHUP_MAX = 1.3;       // never more than 1.3x its own walking speed
    const REMOTE_SETTLE_SPEED = 50;       // px/s when easing back from an overshoot
    const REMOTE_WALK_HOLD_MS = 280;      // flagless senders: keep legs going between samples
    const REMOTE_LATENCY_MS = 140;        // send → rollup → push to this screen
    const REMOTE_PREDICT_MAX_MS = 320;    // never predict further ahead than this
    const REMOTE_PREDICT_STALE_MS = 450;  // no new sample for this long: assume stopped (network spikes reach ~480ms)

    const age = now - t.movedAt;
    const predicting = t.walking === true && age < REMOTE_PREDICT_STALE_MS;
    const ahead = predicting ? Math.min(age + REMOTE_LATENCY_MS, REMOTE_PREDICT_MAX_MS) / 1000 : 0;
    // The prediction never runs into a wall: someone walking into a building
    // stops moving (and stops sending), so an unchecked prediction carried
    // their avatar half a second deep into it.
    const [aimX, aimY] = ahead > 0
      ? this.clearRay(t.x, t.y, t.x + t.vx * ahead, t.y + t.vy * ahead)
      : [t.x, t.y];

    const c = avatar.getContainer();
    const dx = aimX - c.x;
    const dy = aimY - c.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 180) return; // a jump: updateRemotePlayer fades them across

    if (dist <= 0.75) {
      if (t.walking === true || (t.walking === undefined && age < REMOTE_WALK_HOLD_MS)) avatar.walk(t.dir);
      else avatar.idle();
      return;
    }

    // Past the real position along the way they were going: the prediction
    // overshot a stop. Ease back slowly, legs still — snapping back at walking
    // speed is what read as the avatar bouncing off the spot.
    const overshot = !predicting && (dx * t.vx + dy * t.vy) < 0;
    const ownSpeed = Math.max(PLAYER_SPEED, Math.hypot(t.vx, t.vy));
    const speed = overshot
      ? REMOTE_SETTLE_SPEED
      : ownSpeed * Phaser.Math.Clamp(dist / (ownSpeed * REMOTE_LAG_S), 1, REMOTE_CATCHUP_MAX);
    const step = Math.min(dist, speed * dt);
    this.stepAvoidingWalls(c, (dx / dist) * step, (dy / dist) * step, dist > ownSpeed * REMOTE_LAG_S);

    if (overshot || (t.walking === false && dist < 12)) {
      avatar.idle();
      return;
    }
    // Face the way the avatar is really moving on this screen.
    const dir: Direction = Math.abs(dx) > Math.abs(dy)
      ? (dx < 0 ? "left" : "right")
      : (dy < 0 ? "up" : "down");
    avatar.walk(dir);
  }

  /** True when a character's feet at (wx, wy) would stand on a solid tile. */
  private isSolidAt(wx: number, wy: number): boolean {
    return this.collisionLayers.some((layer) => {
      const tile = layer.getTileAtWorldXY(wx, wy);
      return tile !== null && tile.collides;
    });
  }

  /** The last free point on the straight line from (x0,y0) toward (x1,y1). */
  private clearRay(x0: number, y0: number, x1: number, y1: number): [number, number] {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.ceil(len / 6);
    let fx = x0, fy = y0;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const px = x0 + (x1 - x0) * k;
      const py = y0 + (y1 - y0) * k;
      if (this.isSolidAt(px, py)) break;
      fx = px; fy = py;
    }
    return [fx, fy];
  }

  /**
   * Moves a remote avatar by (mx, my) without walking it through walls: a
   * straight line between two samples taken either side of a corner cuts
   * through the building. Blocked diagonally, it slides along whichever axis
   * is free. `force` lets it through anyway when it has fallen far behind,
   * so a concave corner can never trap it.
   */
  private stepAvoidingWalls(c: Phaser.GameObjects.Container, mx: number, my: number, force: boolean): void {
    const nx = c.x + mx, ny = c.y + my;
    if (force || this.isSolidAt(c.x, c.y) || !this.isSolidAt(nx, ny)) { c.x = nx; c.y = ny; return; }
    if (!this.isSolidAt(nx, c.y)) { c.x = nx; return; }
    if (!this.isSolidAt(c.x, ny)) { c.y = ny; }
  }

  /** Plays a remote player's facial expression, auto-reverting after 3.5s. */
  private applyRemoteExpression(wallet: string, textureKey: string): void {
    const avatar = this.remotePlayers.get(wallet);
    if (!avatar) return;
    avatar.setExpression(textureKey);
    soundManager.play("emote");
    this.remoteExprTimers.get(wallet)?.remove(false);
    this.remoteExprTimers.set(wallet, this.time.delayedCall(3500, () => {
      avatar.setExpression(null);
      this.remoteExprTimers.delete(wallet);
    }));
  }

  private showBubble(
    target: Phaser.GameObjects.Container,
    text: string,
    color: string
  ): void {
    new ChatBubble(this, target, text, color);
  }

  /**
   * Given the NPC's tile column and the row of its TOP tile in the Tiled NPC
   * layer, scans downward from the bottom tile (topRow + 1) until it finds a
   * row that has no collision tile in any building layer. Returns world-pixel
   * centre coordinates for that clear row.
   */
  /**
   * Walkable tile nearest a fast-travel target, searched in growing rings.
   * Targets are NPC spawns (whose tile the NPC stands on) and building
   * front edges, so anything within a tile of an NPC is avoided and tiles
   * north of the target are penalised: players land in front of things.
   */
  private findTravelSpot(map: Phaser.Tilemaps.Tilemap, wx: number, wy: number): { x: number; y: number } | null {
    const ts = map.tileWidth;
    const blocked = (c: number, r: number): boolean => {
      if (c < 0 || r < 0 || c >= map.width || r >= map.height) return true;
      return this.collisionLayers.some((layer) => {
        const t = layer.getTileAt(c, r);
        return t !== null && t.collides;
      });
    };
    const nearNpc = (x: number, y: number) =>
      this.npcSprites.some((n) => {
        const c = n.getContainer();
        return Math.abs(c.x - x) < ts * 1.2 && Math.abs(c.y - y) < ts * 1.2;
      });
    const c0 = Math.floor(wx / ts);
    const r0 = Math.floor(wy / ts);
    for (let radius = 0; radius <= 14; radius++) {
      const ring: Array<[number, number]> = [];
      for (let dc = -radius; dc <= radius; dc++) {
        for (let dr = -radius; dr <= radius; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
          ring.push([dc, dr]);
        }
      }
      // Prefer south (in front of things), then closest.
      ring.sort((a, b) => (Math.hypot(a[0], a[1]) + (a[1] < 0 ? 3 : 0)) - (Math.hypot(b[0], b[1]) + (b[1] < 0 ? 3 : 0)));
      for (const [dc, dr] of ring) {
        const c = c0 + dc, r = r0 + dr;
        if (blocked(c, r)) continue;
        const x = c * ts + ts / 2, y = r * ts + ts / 2;
        if (nearNpc(x, y)) continue;
        return { x, y };
      }
    }
    return null;
  }

  private findNpcSpawn(
    map: Phaser.Tilemaps.Tilemap,
    col: number,
    topRow: number,
    tileSize: number
  ): { wx: number; wy: number } {
    // A tile position is blocked if the merged collision volume has a
    // collidable tile there. Read in WORLD space: layers are cropped to what
    // they paint and carry their own offsets, so a layer-local (col, row) no
    // longer names the same spot on the map.
    const isTileBlocked = (c: number, r: number): boolean =>
      this.collisionLayers.some(layer => {
        const tile = layer.getTileAtWorldXY(c * tileSize + tileSize / 2, r * tileSize + tileSize / 2);
        return tile !== null && tile.collides;
      });

    let row = topRow + 1;
    const maxScan = topRow + 12;
    while (row < maxScan && isTileBlocked(col, row)) {
      row++;
    }

    return {
      wx: col * tileSize + tileSize / 2,
      wy: row * tileSize + tileSize / 2,
    };
  }
}
