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
      "SCUrbanEquipament",
    ]
      .map(n => map.addTilesetImage(n, n))
      .filter((ts): ts is Phaser.Tilemaps.Tileset => ts !== null);

    // Render layers bottom-to-top (matching new map layer order)
    const RENDER_LAYERS = [
      "Camada de Blocos 15", "Street", "Grass", "GrassCenter", "Camada de Blocos 30",
      "SidewalkCenter", "Sidewalk", "Sidewalk02", "Sidewalk03", "Sidewalk04",
      "VegetationTree",
      "BuildSTEarn", "VegetationPalmBack", "DecorLightBack",
      "BuildGeneric02", "BuildGeneric04", "BuildGeneric01", "BuildGeneric03", "BuildGeneric05",
      "BuildSTBrazil", "BuildJupiter", "BuildGeneric06",
      "DecorBench", "BuildMonkeDAo",
      "DecorLightFront", "VegetationPalmFront", "VegetationPalmCenter",
      "DecorFountain", "DecorLightCenter", "BuildIndies",
    ];
    const COLLISION_LAYER_NAMES = new Set([
      "BuildSTEarn", "BuildGeneric01", "BuildGeneric02", "BuildGeneric03",
      "BuildSTBrazil", "BuildJupiter", "BuildMonkeDAo", "BuildIndies",
    ]);

    for (const name of RENDER_LAYERS) {
      const layer = map.createLayer(name, allTilesets, 0, 0);
      if (!layer) continue;
      if (COLLISION_LAYER_NAMES.has(name)) {
        layer.setCollisionByExclusion([-1]);
        this.collisionLayers.push(layer);
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
    this.cameras.main.setZoom(2);
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
        this.chat.addSystemMessage("Session started — multiplayer active");
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

    const up = this.cursors.up.isDown || this.wasd.up.isDown;
    const down = this.cursors.down.isDown || this.wasd.down.isDown;
    const left = this.cursors.left.isDown || this.wasd.left.isDown;
    const right = this.cursors.right.isDown || this.wasd.right.isDown;

    let direction: Direction | null = null;

    if (left) { this.playerBody.setVelocityX(-PLAYER_SPEED); direction = "left"; }
    else if (right) { this.playerBody.setVelocityX(PLAYER_SPEED); direction = "right"; }
    if (up) { this.playerBody.setVelocityY(-PLAYER_SPEED); direction = direction ?? "up"; }
    else if (down) { this.playerBody.setVelocityY(PLAYER_SPEED); direction = direction ?? "down"; }

    if ((left || right) && (up || down)) {
      this.playerBody.velocity.normalize().scale(PLAYER_SPEED);
    }

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
    const COLLISION_LAYERS = [
      "BuildSTEarn", "BuildGeneric01", "BuildGeneric02", "BuildGeneric03",
      "BuildSTBrazil", "BuildJupiter", "BuildMonkeDAo", "BuildIndies",
    ];

    const isTileBlocked = (c: number, r: number): boolean =>
      COLLISION_LAYERS.some(name => {
        const tile = map.getTileAt(c, r, false, name);
        return tile !== null && tile.index >= 0;
      });

    let row = topRow + 1; // start at the bottom tile of the 2-tile NPC sprite
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
