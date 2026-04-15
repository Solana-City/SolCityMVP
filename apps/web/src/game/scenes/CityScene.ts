import Phaser from "phaser";
import { TILE_SIZE, MAP_COLS, MAP_ROWS, PLAYER_SPEED } from "../config/constants";
import { getMapData, getSpawnPoint } from "../utils/mapGenerator";
import { SimpleSprite, Direction } from "../entities/SimpleSprite";
import { OnChainMultiplayer, OnChainPlayer } from "../multiplayer/OnChainMultiplayer";
import { ChatManager, getChannelColor } from "../chat/ChatManager";
import { ChatBubble } from "../chat/ChatBubble";
import { NPCSprite } from "../entities/NPCSprite";
import { NPC_REGISTRY } from "../config/npcRegistry";
import { ProfileManager } from "../config/profileManager";
import { setupEmojiKeys, showEmoji, EMOJI_REGISTRY, EmojiDef } from "../chat/EmojiSystem";

export class CityScene extends Phaser.Scene {
  private avatar!: SimpleSprite;
  private playerBody!: Phaser.Physics.Arcade.Body;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private collisionLayer!: Phaser.Tilemaps.TilemapLayer;

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
    const { ground, collision, width, height } = getMapData();

    const map = this.make.tilemap({
      data: this.reshape(ground, width, height),
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
    });

    const tileset = map.addTilesetImage("tileset", "tileset", TILE_SIZE, TILE_SIZE, 0, 0);
    if (!tileset) return;
    map.createLayer(0, tileset, 0, 0);

    const collisionMap = this.make.tilemap({
      data: this.reshape(
        collision.map((v) => (v === 0 ? 0 : -1)),
        width, height
      ),
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
    });
    const collisionTileset = collisionMap.addTilesetImage("tileset", "tileset", TILE_SIZE, TILE_SIZE, 0, 0);
    if (!collisionTileset) return;
    this.collisionLayer = collisionMap.createLayer(0, collisionTileset, 0, 0)!;
    this.collisionLayer.setVisible(false);
    this.collisionLayer.setCollisionByExclusion([-1]);

    // Local player using full sprite sheet
    const spawn = getSpawnPoint();
    const spawnX = spawn.x * TILE_SIZE + TILE_SIZE / 2;
    const spawnY = spawn.y * TILE_SIZE + TILE_SIZE / 2;
    this.avatar = new SimpleSprite(this, spawnX, spawnY, "avatar-chef");

    const container = this.avatar.getContainer();
    this.physics.world.enable(container);
    this.playerBody = container.body as Phaser.Physics.Arcade.Body;
    this.playerBody.setSize(TILE_SIZE * 0.6, TILE_SIZE * 0.4);
    this.playerBody.setOffset(-TILE_SIZE * 0.3, -TILE_SIZE * 0.1);
    this.playerBody.setCollideWorldBounds(true);
    this.physics.add.collider(container, this.collisionLayer);
    this.physics.world.setBounds(0, 0, MAP_COLS * TILE_SIZE, MAP_ROWS * TILE_SIZE);

    // "YOU" label
    const youLabel = this.add.text(0, -40, "YOU", {
      fontSize: "8px", fontFamily: "monospace",
      color: "#ffffff", align: "center",
    }).setOrigin(0.5, 1);
    container.add(youLabel);

    // Camera
    this.cameras.main.setBounds(0, 0, MAP_COLS * TILE_SIZE, MAP_ROWS * TILE_SIZE);
    this.cameras.main.startFollow(container, true, 0.08, 0.08);
    this.cameras.main.setZoom(2);
    this.cameras.main.setBackgroundColor(0x061a2c);

    // Input
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      up: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    // Profile system
    this.profile = new ProfileManager();
    this.registry.set("profileManager", this.profile);

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

    // NPCs
    for (const def of NPC_REGISTRY) {
      this.npcSprites.push(new NPCSprite(this, def));
    }

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

    // Listen for wallet connection from React to start on-chain session
    this.game.events.on("wallet:connected", async (walletAddress: string) => {
      try {
        const { PublicKey } = await import("@solana/web3.js");
        await this.network.connect(new PublicKey(walletAddress));
        this.profile.setWallet(walletAddress);
        this.chat.addSystemMessage("Session started (on-chain)");
        this.setupNetworkCallbacks();
      } catch {
        this.chat.addSystemMessage("Failed to start on-chain session");
      }
    });

    this.game.events.on("wallet:disconnected", () => {
      this.network.disconnect();
      this.chat.addSystemMessage("Session ended");
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
    const avatar = new SimpleSprite(this, player.x, player.y, "avatar-chef");
    this.remotePlayers.set(wallet, avatar);

    const name = `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;

    const label = this.add.text(0, -40, name, {
      fontSize: "7px", fontFamily: "monospace",
      color: "#aaaacc", align: "center",
    }).setOrigin(0.5, 1);
    avatar.getContainer().add(label);
    this.nameLabels.set(wallet, label);

    this.chat.addSystemMessage(`${name} entered the city`);
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

  private reshape(flat: number[], cols: number, rows: number): number[][] {
    const grid: number[][] = [];
    for (let r = 0; r < rows; r++) {
      grid.push(flat.slice(r * cols, (r + 1) * cols));
    }
    return grid;
  }
}
