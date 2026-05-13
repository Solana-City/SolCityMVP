import * as Phaser from "phaser";
import { PLAYER_SPEED, TILE_SIZE } from "../config/constants";
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
      "SCBuildMagicBlock", "SCLogoIcon",
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
    //
    // Buildings, fountains, and other large floor-level structures must NOT
    // y-sort — the player can be inside their walkable area (e.g. fountain
    // outer ring) at a lower Y than the collidable zone, which would wrongly
    // put the whole structure in front of the player. They stay at layer_index
    // depth (always rendered behind the player, like floor tiles).
    const Y_SORT_PREFIXES = ["Vegetation", "DecorLight", "Build"];

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
        } else {
          // Building / fountain / large structure → always behind the player.
          layer.setDepth(i);
        }
        this.collisionLayers.push(layer);
      } else if (FOREGROUND_PREFIXES.some(p => layerName.startsWith(p))) {
        // Pure-canopy layer (no collision) → always above the player.
        layer.setDepth(FOREGROUND_DEPTH);
      } else {
        // Ground / background layer → always below the player.
        layer.setDepth(i);
      }
    }

    // Spawn at the centre plaza (col 99, row 97 — inside GrassCenter)
    const spawnX = 99  * tileSize + tileSize / 2;
    const spawnY = 97  * tileSize + tileSize / 2;
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

    // Invisible walls — MagicBlock building sides (rows 103-111 lack tile-level
    // collision on the outer columns, so the player can slip inside from the sides).
    const T = tileSize;
    const mbWalls = this.physics.add.staticGroup();
    const addWall = (wx: number, wy: number, w: number, h: number) => {
      const r = this.add.rectangle(wx, wy, w, h).setVisible(false);
      this.physics.add.existing(r, true);
      mbWalls.add(r);
    };
    // Left outer wall: col 111, rows 103-111
    addWall(111 * T + T / 2, 103 * T + (9 * T) / 2, T, 9 * T);
    // Right outer wall: col 120, rows 103-111
    addWall(120 * T + T / 2, 103 * T + (9 * T) / 2, T, 9 * T);
    // Top cap: cols 111-120, rows 103-108 (no tile collision above the inner wall at row 109)
    addWall(111 * T + (10 * T) / 2, 103 * T + (6 * T) / 2, 10 * T, 6 * T);
    this.physics.add.collider(container, mbWalls);
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
      const npc = new NPCSprite(this, def, wx, wy);
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
