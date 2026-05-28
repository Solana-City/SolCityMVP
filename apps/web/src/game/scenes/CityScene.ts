import * as Phaser from "phaser";
import { PLAYER_SPEED, TILE_SIZE, PLAYABLE_ZONE } from "../config/constants";
import { SimpleSprite, Direction } from "../entities/SimpleSprite";
import { OnChainMultiplayer, OnChainPlayer } from "../multiplayer/OnChainMultiplayer";
import { ChatManager, getChannelColor } from "../chat/ChatManager";
import { ChatBubble } from "../chat/ChatBubble";
import { NPCSprite } from "../entities/NPCSprite";
import { NPC_REGISTRY } from "../config/npcRegistry";
import { ProfileManager, profileManager } from "../config/profileManager";
import { AchievementEngine } from "../progression/achievementEngine";
import { setupEmojiKeys, showEmoji, EMOJI_REGISTRY, EmojiDef } from "../chat/EmojiSystem";

export class CityScene extends Phaser.Scene {
  private avatar!: SimpleSprite;
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
  private chatInputActive = false;
  private npcSprites: NPCSprite[] = [];
  private interactionBlocked = false;
  private profile!: ProfileManager;
  private touchDx = 0;
  private touchDy = 0;

  constructor() {
    super({ key: "CityScene" });
  }

  create(): void {
    // ── Tiled map with real sprite art ────────────────────────────────────
    const map = this.make.tilemap({ key: "city-map" });
    const tileSize  = map.tileWidth;   // 24
    const mapWidth  = map.width;        // 200
    const mapHeight = map.height;       // 200

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

    // Isolated vertical objects: trees, palms, lamp posts, fountains.
    // These y-sort with the player: depth = bottom-Y of their southernmost
    // collidable tile, so the player renders in front when approaching from
    // the south and behind when approaching from the north.
    // "Decor" layers (e.g. DecorFountain) are included here so the overhead
    // sculpture/logo part fades when the player walks behind it, matching the
    // same treatment as palms and trees.
    const Y_SORT_PREFIXES = ["Vegetation", "DecorLight", "Decor", "Build", "GameAsset"];

    // Create all tile layers in order from the JSON.
    // Do NOT pass x/y — Phaser defaults to layerData.x/y which already
    // incorporates the Tiled offsetx/offsety for each layer. Passing 0,0
    // would override those offsets and shift every layer to the origin.
    for (let i = 0; i < map.layers.length; i++) {
      const layerName = map.layers[i].name;
      const layer = map.createLayer(i, allTilesets);
      if (!layer) continue;

      layer.setCollisionFromCollisionGroup();
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

    // Spawn south of the fountain plaza (col 99, row 103).
    // Row 97 is inside the fountain basin which now has collision — spawning
    // there would trap the player inside the blocked water area.
    const spawnX = 99  * tileSize + tileSize / 2;
    const spawnY = 103 * tileSize + tileSize / 2;
    const playerTextureKey = this.textures.exists("avatar-player")
      ? "avatar-player"
      : "avatar-sol-guide";
    this.avatar = new SimpleSprite(this, spawnX, spawnY, playerTextureKey);

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

    // ── Fountain collision patches ────────────────────────────────────────────
    //
    // SCTileFountain tileset analysis (fountain at cols 93-104, rows 88-100):
    //   The tileset defines collision objects only on the water-rim tiles (the
    //   outer ring at col 96, col 103, row 93, row 99). Interior water tiles
    //   AND the top decorative arch tiles (rows 88-90) have NO collision object,
    //   so setCollisionFromCollisionGroup() ignores them entirely.
    //
    //   Gaps that allow the player to enter and get trapped:
    //     • rows 88-90 (decorative arch) — no collision at all
    //     • rows 91-92 (water surface, north approach) — no collision
    //     • col 95 (leftmost water column) — no collision for rows 91-99
    //     • interior tiles at cols 97, 101-102, rows 94-99 — no collision
    //
    //   Intended walkable centre path: col 99, rows 91-100 (Sol NPC stands at
    //   99,99 and player spawns at 99,97 — that column must remain open).
    //
    //   Fix: four invisible static walls seal every gap while the 1-tile gap at
    //   col 99 is preserved between the left and right basin walls.
    //
    //   Wall geometry (tile-coord → world-px with tileSize=24):
    //     top arch   : cols 93-104 (12 T wide), rows 88-90 (3 T tall)
    //     left basin : cols 95-98  (4 T wide),  rows 91-99 (9 T tall)
    //     right basin: cols 100-103(4 T wide),  rows 91-99 (9 T tall)
    //     bottom base: cols 93-101 (9 T wide),  row 100    (1 T tall)
    const fountainWalls = this.physics.add.staticGroup();
    const addFW = (wx: number, wy: number, w: number, h: number) => {
      const r = this.add.rectangle(wx, wy, w, h).setVisible(false);
      this.physics.add.existing(r, true);
      fountainWalls.add(r);
    };
    // Rectangle centre formula: first_col*T + (num_cols/2)*T, same for rows.
    // Top decorative arch — cols 93-104 (12 wide), rows 88-90 (3 tall)
    addFW( 99   * T,  89.5 * T, 12 * T, 3 * T);
    // Left water basin  — cols 95-98  (4 wide),  rows 91-99 (9 tall)
    // Right edge = 99*T → exactly the left edge of the col-99 centre path.
    addFW( 97   * T,  95.5 * T,  4 * T, 9 * T);
    // Right water basin — cols 100-103 (4 wide), rows 91-99 (9 tall)
    // Left edge = 100*T → exactly the right edge of the col-99 centre path.
    addFW(102   * T,  95.5 * T,  4 * T, 9 * T);
    // Bottom base stones — cols 93-101 (9 wide), row 100 (1 tall)
    addFW( 97.5 * T, 100.5 * T,  9 * T,     T);
    this.physics.add.collider(container, fountainWalls);

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

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    // "YOU" label — same visual weight as NPC names for consistency.
    const youLabel = this.add.text(0, -38, "YOU", {
      fontSize: "10px", fontFamily: "monospace",
      color: "#ffffff", align: "center",
      resolution: 2,
      stroke: "#0a0a1e",
      strokeThickness: 2,
    }).setOrigin(0.5, 1);
    container.add(youLabel);

    // Camera — locked to player, no edge clamping so player stays centered
    // even at the map borders. Zoom is an integer (2×) so every source
    // pixel maps to exactly N screen pixels — no fractional sampling,
    // which is the industry-standard way to keep pixel art crisp.
    this.cameras.main.startFollow(container, true, 1.0, 1.0);
    const storedZoom = parseFloat(localStorage.getItem("solcity:zoom") ?? "");
    const isTouchDevice = window.matchMedia("(pointer: coarse)").matches;
    this.cameras.main.setZoom(isNaN(storedZoom) ? (isTouchDevice ? 1.5 : 2) : storedZoom);
    this.cameras.main.setBackgroundColor(0x061a2c);
    this.cameras.main.roundPixels = true;

    // Input
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      up: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

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

    // Outfit change from profile panel (maps outfit ID to sprite sheet key)
    this.game.events.on("profile:outfit", (outfitId: string) => {
      const textureKey = `avatar-${outfitId}`;
      if (this.textures.exists(textureKey)) {
        this.avatar.setTexture(textureKey);
      }
    });


    // NPCs — position read from Tiled NPC layer, scanned to first walkable row
    for (const def of NPC_REGISTRY) {
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

    // G key — toggle collision debug overlay
    this.input.keyboard!.on("keydown-G", () => {
      this.physics.world.drawDebug = !this.physics.world.drawDebug;
      if (!this.physics.world.drawDebug) {
        this.physics.world.debugGraphic?.clear();
      }
    });

    // NPC interaction listener from React
    this.game.events.on("npc:close", () => {
      this.interactionBlocked = false;
    });

    // Camera zoom from UI control
    this.game.events.on("camera:zoom", (zoom: number) => {
      this.cameras.main.setZoom(zoom);
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
      const nearby = this.npcSprites.find((n) => n.isInRange);
      if (nearby) {
        this.interactionBlocked = true;
        this.game.events.emit("npc:interact", nearby.def);
      }
    });

    // E key for NPC interaction (handled here, not in React, to check proximity)
    this.input.keyboard!.on("keydown-E", () => {
      if (this.chatInputActive || this.interactionBlocked) return;

      const nearby = this.npcSprites.find((n) => n.isInRange);
      if (nearby) {
        this.interactionBlocked = true;
        this.game.events.emit("npc:interact", nearby.def);
      }
    });

    // On-chain multiplayer via MagicBlock Ephemeral Rollups
    this.network = new OnChainMultiplayer();
    this.registry.set("network", this.network);

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
        const { PublicKey } = await import("@solana/web3.js");
        this.profile.setWallet(walletAddress);
        const displayName = this.profile.get().displayName;
        this.network.updateScore(this.profile.get().score);
        await this.network.connect(new PublicKey(walletAddress), displayName);
        this.chat.addSystemMessage("Multiplayer session started.");
        this.setupNetworkCallbacks();
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
      this.avatar.walk(direction);
      this.currentDirection = direction;
    } else {
      this.avatar.idle();
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

    // Interpolate remote players
    this.remotePlayers.forEach((remote, sessionId) => {
      remote.updateDepth();
    });
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
    this.tweens.add({
      targets: container,
      x: player.x,
      y: player.y,
      duration: 100,
      ease: "Linear",
    });

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
    const isTileBlocked = (c: number, r: number): boolean =>
      map.layers.some(layerData => {
        const tile = map.getTileAt(c, r, false, layerData.name);
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
