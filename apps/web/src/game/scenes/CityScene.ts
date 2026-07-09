import * as Phaser from "phaser";
import { PLAYER_SPEED, TILE_SIZE, PLAYABLE_ZONE } from "../config/constants";
import { SimpleSprite, Direction } from "../entities/SimpleSprite";
import { AvatarSprite } from "../entities/AvatarSprite";
import { loadSavedLoadout, type Loadout } from "../config/paperDoll";
import { OnChainMultiplayer, OnChainPlayer } from "../multiplayer/OnChainMultiplayer";
import { ChatManager, getChannelColor } from "../chat/ChatManager";
import { ChatBubble } from "../chat/ChatBubble";
import { NPCSprite } from "../entities/NPCSprite";
import { NPC_REGISTRY } from "../config/npcRegistry";
import { PedestrianManager } from "../entities/PedestrianManager";
import { hasAlreadyFoundCurrent, markCurrentFound } from "../minigames/whereIsNPC/WhereIsNPCGame";
import { ProfileManager, profileManager } from "../config/profileManager";
import { AchievementEngine } from "../progression/achievementEngine";
import { setupEmojiKeys, showEmoji, EMOJI_REGISTRY, EmojiDef } from "../chat/EmojiSystem";

// Pixel-perfect zoom values and snapping live in config/zoomConfig.ts —
// shared with ZoomControl and the pinch-zoom hook.
import { loadZoom, snapZoom } from "../config/zoomConfig";

export class CityScene extends Phaser.Scene {
  private avatar!: AvatarSprite;
  private playerBody!: Phaser.Physics.Arcade.Body;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private collisionLayers: Phaser.Tilemaps.TilemapLayer[] = [];
  /** Layers that can render above the player — faded when they occlude the player. */
  private overheadLayers: Phaser.Tilemaps.TilemapLayer[] = [];

  private network!: OnChainMultiplayer;
  private chat!: ChatManager;
  private remotePlayers = new Map<string, SimpleSprite>();
  private nameLabels = new Map<string, Phaser.GameObjects.Text>();
  private activeBubbles = new Map<string, ChatBubble>();
  private currentDirection: Direction = "down";
  private idleDelay = 0;
  private chatInputActive = false;
  private npcSprites: NPCSprite[] = [];
  private pedestrians!: PedestrianManager;
  private interactionBlocked = false;
  private walletAddress: string | null = null;
  private profile!: ProfileManager;
  private touchDx = 0;
  private touchDy = 0;
  /**
   * Crop origin of the loaded map in original (200x200) tile coordinates.
   * Desktop loads the full city.json → origin (0,0). Mobile loads the
   * pre-cropped city-mobile.json (120x62 tiles starting at the playable
   * zone) whose layers carry offsetx/offsety restoring original world
   * positions — so world-pixel math stays in original coordinates, but
   * tile-index lookups into map data must subtract this origin.
   */
  private originCol = 0;
  private originRow = 0;

  constructor() {
    super({ key: "CityScene" });
  }

  create(): void {
    // ── Tiled map with real sprite art ────────────────────────────────────

    const map = this.make.tilemap({ key: "city-map" });
    const tileSize = map.tileWidth;   // 24

    const isMobileMap = window.matchMedia("(pointer: coarse)").matches;
    this.originCol = isMobileMap ? PLAYABLE_ZONE.col1 : 0;
    this.originRow = isMobileMap ? PLAYABLE_ZONE.row1 : 0;

    // Add all tileset spritesheets loaded in BootScene
    const allTilesets = [
      "SCTileGrass", "SCBuildSTEarn", "SCBuildMonkeyDAO",
      "SCBuildSTBrazil", "SCBuildJupter", "SCTileFountain",
      "SCTileGround", "SCVegetationSet", "SCPalm", "SCBuildIndies",
      "SCUrbanEquipament", "SCBuildGenericBuild", "SCBuildKeepGreen",
      "SCBuildMagicBlock", "SCLogoIcon", "SCGameAssets",
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
    // NOTE: "Decor" is intentionally excluded — DecorFountain is a flat
    // plaza structure and must use fixed depth, not Y-sort.
    const Y_SORT_PREFIXES = ["Vegetation", "DecorLight", "Build", "GameAsset"];

    // Create all tile layers in order from the JSON.
    // Do NOT pass x/y — Phaser defaults to layerData.x/y which already
    // incorporates the Tiled offsetx/offsety for each layer. Passing 0,0
    // would override those offsets and shift every layer to the origin.
    for (let i = 0; i < map.layers.length; i++) {
      const layerName = map.layers[i].name;
      const layer = map.createLayer(i, allTilesets);
      if (!layer) continue;

      layer.setCollisionFromCollisionGroup();

      // DecorFountain: partial Tiled objectgroup shapes leave many faces open,
      // so the player's small body slips through even "collidable" rim tiles.
      //
      // Fix: force full 4-face collision on the inner water basin only.
      // Bounds: cols 95-103, rows 91-99 (the water + rim area).
      // Rows 88-90 (decorative arch) and outer corner tiles are intentionally
      // EXCLUDED — they sit in walkable areas around the fountain perimeter
      // and must not block the player.
      // Corridor tiles (cols 99-100, rows 97+) get resetCollision() so the
      // player can walk in/out through the staircase freely.
      if (layerName === "DecorFountain") {
        layer.forEachTile((tile: Phaser.Tilemaps.Tile) => {
          if (tile.index <= 0) return;
          // tile.x/tile.y are map-data coordinates — shift back to original
          // 200x200 coordinates before comparing against the corridor bounds.
          const col = tile.x + this.originCol;
          const row = tile.y + this.originRow;
          const inCorridor = col >= 99 && col <= 100 && row >= 97;
          if (inCorridor) {
            tile.resetCollision();
          } else {
            tile.setCollision(true, true, true, true);
          }
        }, this, 95 - this.originCol, 91 - this.originRow, 9, 9); // cols 95-103, rows 91-99 in original coords
      }

      const collidingTiles = layer.filterTiles((t: Phaser.Tilemaps.Tile) => t.collides);

      if (collidingTiles.length > 0) {
        if (Y_SORT_PREFIXES.some(p => layerName.startsWith(p))) {
          // Isolated vertical object (trunk, palm, lamp post) → y-sort.
          // depth = bottom-world-Y of the southernmost collidable tile.
          let maxBottomY = 0;
          for (const tile of collidingTiles) {
            const worldY = layer.tileToWorldY(tile.y)!;
            if (worldY + map.tileHeight > maxBottomY) {
              maxBottomY = worldY + map.tileHeight;
            }
          }
          layer.setDepth(maxBottomY);
          // Y-sorted layers can render above the player → candidate for fade.
          this.overheadLayers.push(layer);
        } else {
          // Building / fountain / large structure → always behind the player.
          layer.setDepth(i);
        }
        this.collisionLayers.push(layer);
      } else if (FOREGROUND_PREFIXES.some(p => layerName.startsWith(p))) {
        // Pure-canopy layer (no collision) → always above the player.
        layer.setDepth(FOREGROUND_DEPTH);
        // Always above the player → always a fade candidate.
        this.overheadLayers.push(layer);
      } else {
        // Ground / background layer → always below the player.
        layer.setDepth(i);
      }
    }

    // Spawn inside the fountain plaza center (col 99, row 97).
    const spawnX = 99 * tileSize + tileSize / 2;
    const spawnY = 97 * tileSize + tileSize / 2;
    this.avatar = new AvatarSprite(this, spawnX, spawnY, loadSavedLoadout());

    const container = this.avatar.getContainer();
    this.physics.world.enable(container);
    this.playerBody = container.body as Phaser.Physics.Arcade.Body;
    this.playerBody.setSize(TILE_SIZE * 0.5, TILE_SIZE * 0.3);
    this.playerBody.setOffset(-TILE_SIZE * 0.25, -TILE_SIZE * 0.2);
    this.playerBody.setCollideWorldBounds(true);
    for (const cl of this.collisionLayers) {
      this.physics.add.collider(container, cl);
    }

    // Invisible walls — MagicBlock building outer columns patch.
    //
    // Tileset analysis (cols 111-120):
    //   rows 103-108 → all overhead/decorative tiles (no collision) — this is
    //                   the back street; players must walk through freely.
    //   rows 109-111 → col 111 and col 120 have no collision tile; cols 112-119 do.
    //   row  112+    → full collision on all columns; no patch needed.
    //
    // Therefore: only patch the two outer columns for the 3-row gap (109-111).
    const T = tileSize;
    const mbWalls = this.physics.add.staticGroup();
    const addWall = (wx: number, wy: number, w: number, h: number) => {
      const r = this.add.rectangle(wx, wy, w, h).setVisible(false);
      this.physics.add.existing(r, true);
      mbWalls.add(r);
    };
    // Left outer wall: col 111, rows 109-111 (3 rows)
    addWall(111 * T + T / 2, 109 * T + (3 * T) / 2, T, 3 * T);
    // Right outer wall: col 120, rows 109-111 (3 rows)
    addWall(120 * T + T / 2, 109 * T + (3 * T) / 2, T, 3 * T);
    this.physics.add.collider(container, mbWalls);

    // ── Playable-zone boundary walls ──────────────────────────────────────────
    // Invisible strips that stop players leaving the built area.
    // ZONE_DEBUG=true renders them red so you can verify placement in-game.
    // Flip to false (and redeploy) once positions are confirmed.
    const ZONE_DEBUG = false;
    const WALL_THICKNESS = 3; // tiles
    const PZ = PLAYABLE_ZONE;
    const zoneX1    = PZ.col1 * T;
    const zoneY1    = PZ.row1 * T;
    const zoneW     = (PZ.col2 - PZ.col1) * T;
    const zoneH     = (PZ.row2 - PZ.row1) * T;
    const wallThick = WALL_THICKNESS * T;
    const zoneWalls = this.physics.add.staticGroup();
    const addZoneWall = (wx: number, wy: number, w: number, h: number) => {
      const r = this.add.rectangle(wx, wy, w, h, 0xff0000, ZONE_DEBUG ? 0.4 : 0);
      if (!ZONE_DEBUG) r.setVisible(false);
      this.physics.add.existing(r, true);
      zoneWalls.add(r);
    };
    addZoneWall(zoneX1 + zoneW / 2,            zoneY1 - wallThick / 2,            zoneW,              wallThick); // north
    addZoneWall(zoneX1 + zoneW / 2,            zoneY1 + zoneH + wallThick / 2,    zoneW,              wallThick); // south
    addZoneWall(zoneX1 - wallThick / 2,         zoneY1 + zoneH / 2,                wallThick, zoneH + wallThick * 2); // west
    addZoneWall(zoneX1 + zoneW + wallThick / 2, zoneY1 + zoneH / 2,                wallThick, zoneH + wallThick * 2); // east
    this.physics.add.collider(container, zoneWalls);

    // Bounds must cover where the map content actually renders. On mobile the
    // cropped map's layers are offset to original world positions, so the
    // bounds rectangle starts at the crop origin — with (0,0) bounds the
    // player would spawn outside them and collideWorldBounds would shove it
    // into the empty area beyond the map.
    const boundsX = this.originCol * tileSize;
    const boundsY = this.originRow * tileSize;
    this.physics.world.setBounds(boundsX, boundsY, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setBounds(boundsX, boundsY, map.widthInPixels, map.heightInPixels);

    // "YOU" label — same visual weight as NPC names for consistency.
    const youLabel = this.add.text(0, -38, "YOU", {
      fontSize: "10px", fontFamily: "monospace",
      color: "#ffffff", align: "center",
      resolution: 2,
      stroke: "#0a0a1e",
      strokeThickness: 2,
    }).setOrigin(0.5, 1);
    container.add(youLabel);

    // Camera — locked to player, no edge clamping so player stays centred
    // even at the map borders.
    //
    // Pixel-perfect invariant (see zoomConfig.ts): sprite_scale (0.5) ×
    // camera_zoom must be a whole number of device pixels, so only the
    // zooms from getValidZooms() are used. Anything else lands source
    // pixels on fractional positions → irregular pixel sizes and blurry
    // outlines — the classic "shimmy" look.
    this.cameras.main.startFollow(container, true, 1.0, 1.0);
    this.cameras.main.setZoom(loadZoom());
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

    // Chat system
    this.chat = new ChatManager();
    this.chat.addSystemMessage("Welcome to The Solana City");
    this.registry.set("chatManager", this.chat);

    // Listen for chat input from React UI
    this.game.events.on("chat:send", (text: string) => {
      const channel = this.chat.getActiveChannel();
      const color = getChannelColor(channel);

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

    this.game.events.on("chat:focus", (focused: boolean) => {
      this.chatInputActive = focused;
      // Disable Phaser keyboard capture so typing in chat doesn't trigger WASD
      if (this.input.keyboard) {
        this.input.keyboard.enabled = !focused;
      }
    });

    // Emoji system: keys 1-6 trigger emotes
    setupEmojiKeys(
      this,
      () => this.avatar.getContainer(),
      () => this.chatInputActive,
      (emoji) => {
        this.chat.addMessage("local", "local", this.profile.get().displayName, emoji.symbol, emoji.color);
      }
    );

    // Emoji trigger from React UI button
    this.game.events.on("emoji:trigger", (emoji: EmojiDef) => {
      showEmoji(this, this.avatar.getContainer(), emoji);
      this.chat.addMessage("local", "local", this.profile.get().displayName, emoji.symbol, emoji.color);
    });

    // Wardrobe panel — live preview while panel is open, persisted on Save.
    this.game.events.on("wardrobe:loadout", (loadout: Loadout) => {
      this.avatar.setLoadout(loadout);
    });

    // NPCs — position read from Tiled NPC layer, scanned to first walkable row
    for (const def of NPC_REGISTRY) {
      if (def.enabled === false) continue;
      const { wx, wy } = this.findNpcSpawn(map, def.tileX, def.tileY, tileSize);
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

    // Pedestrians + "Where Is NPC?" hunt game
    this.pedestrians = new PedestrianManager();
    this.pedestrians.spawn(this, this.collisionLayers);
    this.pedestrians.setupColliders(
      container,
      this.npcSprites.map(n => n.getContainer()),
    );

    // Sync target when round changes (check every 10 s)
    this.time.addEvent({
      delay: 10_000,
      loop: true,
      callback: () => {
        this.pedestrians.refreshTarget();
        this.game.events.emit("whereIsNPC:roundCheck");
      },
    });

    // React UI requests current target info (on mount or round change)
    this.game.events.on("whereIsNPC:requestTarget", () => {
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
    this.game.events.on("npc:close", () => {
      this.interactionBlocked = false;
    });

    // Camera zoom from UI control — always snap to a pixel-perfect value
    this.game.events.on("camera:zoom", (zoom: number) => {
      this.cameras.main.setZoom(snapZoom(zoom));
    });

    // Mobile touch input
    this.game.events.on("touch:joystick", ({ dx, dy }: { dx: number; dy: number }) => {
      this.touchDx = dx;
      this.touchDy = dy;
    });
    this.game.events.on("touch:stop", () => {
      this.touchDx = 0;
      this.touchDy = 0;
    });
    this.game.events.on("touch:interact", () => {
      if (this.chatInputActive || this.interactionBlocked) return;
      if (this.tryHuntInteraction()) return;
      const nearby = this.npcSprites.find((n) => n.isInRange);
      if (nearby) {
        this.interactionBlocked = true;
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
        this.game.events.emit("npc:interact", nearby.def);
      }
    };
    this.input.keyboard?.on("keydown-E", tryInteract);
    this.input.keyboard?.on("keydown-SPACE", tryInteract);

    // On-chain multiplayer via MagicBlock Ephemeral Rollups
    this.network = new OnChainMultiplayer();
    this.registry.set("network", this.network);

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
    this.game.events.on("wallet:connected", async (walletAddress: string) => {
      try {
        this.walletAddress = walletAddress;
        const { PublicKey } = await import("@solana/web3.js");
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

        await this.network.connect(new PublicKey(walletAddress), displayName);
        this.chat.addSystemMessage("Multiplayer session started.");

        // Warnings from multiplayer (e.g. delegated PDA detected)
        this.game.events.once("multiplayer:warning", (msg: string) => {
          this.chat.addSystemMessage(msg);
        });

        // Cross-browser chat messages received via Solana Memo / onLogs
        this.game.events.on("chat:network", ({ name, text }: { name: string; text: string }) => {
          const color = getChannelColor("global");
          this.chat.addMessage("global", name, name, text, color);
        });
      } catch (err: any) {
        console.error("[CityScene] session error:", err);
        this.chat.addSystemMessage("Session offline (local mode)");
      }
    });

    this.game.events.on("wallet:disconnected", () => {
      this.network.disconnect();
      this.chat.addSystemMessage("Session ended");
    });

    // Record on-chain when the player completes a swap/transfer/bounty.
    // ActionPanel emits these events after a successful transaction.
    this.game.events.on("game:swap",     () => this.network?.recordAction("swap"));
    this.game.events.on("game:transfer", () => this.network?.recordAction("transfer"));
    this.game.events.on("game:bounty",   () => this.network?.recordAction("bounty"));

    // Mini-game lifecycle — pause/resume the scene around fullscreen overlays.
    // game.events (not scene.events) keeps the listener alive while paused.
    this.game.events.on("minigame:launch", () => {
      this.interactionBlocked = true;
      this.playerBody.setVelocity(0);
      this.avatar.idle();
      this.scene.pause();
    });
    this.game.events.on("minigame:close", () => {
      this.scene.resume();
      this.interactionBlocked = false;
    });
    // Record result to ephemeral rollup via session key — no wallet popup.
    this.game.events.on("minigame:result", ({ success }: { success: boolean }) => {
      this.network?.recordMiniGame(success);
    });
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
    } else {
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
    // When a y-sorted or foreground layer renders above the player AND has a
    // tile at the player's world position, smoothly fade it to 0.25 so the
    // player (and NPCs / remote players) remain visible through rooftops and
    // tree canopies. Lerp ensures a smooth transition both ways.
    {
      const px = this.avatar.x;
      const py = this.avatar.y;
      for (const layer of this.overheadLayers) {
        // Layer is "overhead" only when it draws above the player's depth.
        const isAbove = layer.depth > py;
        const target = isAbove && layer.getTileAtWorldXY(px, py) !== null
          ? 0.25
          : 1.0;
        if (Math.abs(layer.alpha - target) > 0.004) {
          layer.alpha = Phaser.Math.Linear(layer.alpha, target, 0.12);
        }
      }
    }

    // NPC proximity checks
    for (const npc of this.npcSprites) {
      npc.checkProximity(this.avatar.x, this.avatar.y);
    }

    // Sync position to server
    if (this.network.connected) {
      this.network.sendInput(
        this.avatar.x,
        this.avatar.y,
        this.currentDirection,
        direction !== null
      );
    }

    // Pedestrian depth sorting
    this.pedestrians.updateDepths();

    // Interpolate remote players
    this.remotePlayers.forEach((remote, sessionId) => {
      remote.updateDepth();
    });
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
    this.game.events.emit("whereIsNPC:found", { wallet, loadout: target.loadout });

    const FOUND_LINES = [
      "Oh! You recognized me. Sharp eyes, citizen.",
      "Wow, you actually found me. I wasn't making it easy!",
      "Hey, how did you spot me so fast?",
      "Alright, alright — you got me. Well done.",
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
  }

  private addRemotePlayer(wallet: string, player: OnChainPlayer): void {
    const avatar = new SimpleSprite(this, player.x, player.y, "avatar-player");
    this.remotePlayers.set(wallet, avatar);

    const shortAddr = `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
    const displayName = player.displayName ?? shortAddr;

    const label = this.add.text(0, -38, displayName, {
      fontSize: "9px", fontFamily: "monospace",
      color: "#aaaacc", align: "center",
      resolution: 2,
      stroke: "#0a0a1e",
      strokeThickness: 2,
    }).setOrigin(0.5, 1);
    avatar.getContainer().add(label);
    this.nameLabels.set(wallet, label);

    // Clickable hit zone — opens this player's profile card in React.
    const container = avatar.getContainer();
    container.setData("wallet", wallet);
    const hitZone = this.add.rectangle(0, -24, 48, 72, 0x000000, 0);
    hitZone.setInteractive({ useHandCursor: true });
    hitZone.on("pointerdown", () => {
      this.game.events.emit("player:cardOpen", { wallet, displayName });
    });
    container.add(hitZone);

    this.chat.addSystemMessage(`${displayName} entered the city`);
  }

  private removeRemotePlayer(wallet: string): void {
    const avatar = this.remotePlayers.get(wallet);
    if (avatar) {
      avatar.destroy();
      this.remotePlayers.delete(wallet);
    }

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

    this.chat.addSystemMessage(`Player left the city`);
  }

  private updateRemotePlayer(wallet: string, player: OnChainPlayer): void {
    const avatar = this.remotePlayers.get(wallet);
    if (!avatar) return;

    const container = avatar.getContainer();
    const dx = player.x - container.x;
    const dy = player.y - container.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 300) {
      // Large gap (initial placement or reconnect) — teleport immediately
      this.tweens.killTweensOf(container);
      container.setPosition(player.x, player.y);
    } else if (dist > 2) {
      // Interpolate over 600ms — covers ~500ms devnet write-to-read latency.
      // onAccountChange fires ~100-200ms after tx confirms (~400ms slot).
      // Result: movement looks smooth and near-realtime.
      this.tweens.killTweensOf(container);
      this.tweens.add({
        targets: container,
        x: player.x,
        y: player.y,
        duration: 600,
        ease: "Linear",
      });
    }

    const dirs: Direction[] = ["down", "left", "right", "up"];
    if (player.isWalking && dirs[player.direction]) {
      avatar.walk(dirs[player.direction]);
    } else {
      avatar.idle();
    }
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
  private findNpcSpawn(
    map: Phaser.Tilemaps.Tilemap,
    col: number,
    topRow: number,
    tileSize: number
  ): { wx: number; wy: number } {
    // A tile position is blocked if ANY layer has a collidable tile there.
    // Uses Phaser's tile.collides flag set by setCollisionFromCollisionGroup().
    // col/row arrive in original 200x200 coordinates — shift by the crop
    // origin so lookups hit the right tiles in the (possibly cropped) map data.
    const isTileBlocked = (c: number, r: number): boolean =>
      map.layers.some(layerData => {
        const tile = map.getTileAt(c - this.originCol, r - this.originRow, false, layerData.name);
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
