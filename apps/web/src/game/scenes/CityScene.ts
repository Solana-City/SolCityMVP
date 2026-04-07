import Phaser from "phaser";
import { TILE_SIZE, MAP_COLS, MAP_ROWS, PLAYER_SPEED } from "../config/constants";
import { getMapData, getSpawnPoint } from "../utils/mapGenerator";
import { AvatarSprite } from "../entities/AvatarSprite";
import { Direction } from "../config/outfitRegistry";
import { NetworkManager, RemotePlayer } from "../multiplayer/NetworkManager";
import { ChatManager, CHANNEL_CONFIG } from "../chat/ChatManager";
import { ChatBubble } from "../chat/ChatBubble";
import { NPCSprite } from "../entities/NPCSprite";
import { NPC_REGISTRY } from "../config/npcRegistry";

export class CityScene extends Phaser.Scene {
  private avatar!: AvatarSprite;
  private playerBody!: Phaser.Physics.Arcade.Body;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private collisionLayer!: Phaser.Tilemaps.TilemapLayer;

  private network!: NetworkManager;
  private chat!: ChatManager;
  private remotePlayers = new Map<string, AvatarSprite>();
  private nameLabels = new Map<string, Phaser.GameObjects.Text>();
  private activeBubbles = new Map<string, ChatBubble>();
  private currentDirection: Direction = "down";
  private chatInputActive = false;
  private npcSprites: NPCSprite[] = [];
  private interactionBlocked = false;

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

    // Local player
    const spawn = getSpawnPoint();
    const spawnX = spawn.x * TILE_SIZE + TILE_SIZE / 2;
    const spawnY = spawn.y * TILE_SIZE + TILE_SIZE / 2;
    this.avatar = new AvatarSprite(this, spawnX, spawnY, "default");

    const container = this.avatar.getContainer();
    this.physics.world.enable(container);
    this.playerBody = container.body as Phaser.Physics.Arcade.Body;
    this.playerBody.setSize(TILE_SIZE * 0.6, TILE_SIZE * 0.4);
    this.playerBody.setOffset(-TILE_SIZE * 0.3, -TILE_SIZE * 0.1);
    this.playerBody.setCollideWorldBounds(true);
    this.physics.add.collider(container, this.collisionLayer);
    this.physics.world.setBounds(0, 0, MAP_COLS * TILE_SIZE, MAP_ROWS * TILE_SIZE);

    // "YOU" label
    const youLabel = this.add.text(0, -32, "YOU", {
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

    // Chat system
    this.chat = new ChatManager();
    this.chat.addSystemMessage("Welcome to The Solana City");

    // Expose chat manager to React via registry
    this.registry.set("chatManager", this.chat);

    // Listen for chat input from React UI
    this.game.events.on("chat:send", (text: string) => {
      const channel = this.chat.getActiveChannel();
      if (channel === "system") return;

      this.chat.addMessage(
        channel,
        this.network?.sessionId ?? "local",
        "You",
        text,
        CHANNEL_CONFIG[channel].color
      );

      this.showBubble(this.avatar.getContainer(), text, CHANNEL_CONFIG[channel].color);

      if (this.network?.connected) {
        this.network.sendChat(text);
      }
    });

    this.game.events.on("chat:focus", (focused: boolean) => {
      this.chatInputActive = focused;
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

    // Network
    this.network = new NetworkManager();
    this.setupNetwork();
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

  private async setupNetwork(): Promise<void> {
    try {
      await this.network.connect();
      this.chat.addSystemMessage("Connected to server");

      this.network.onPlayerAdd((sessionId, player) => {
        if (sessionId === this.network.sessionId) return;
        this.addRemotePlayer(sessionId, player);
      });

      this.network.onPlayerRemove((sessionId) => {
        this.removeRemotePlayer(sessionId);
      });

      this.network.onPlayerChange((sessionId, player) => {
        if (sessionId === this.network.sessionId) return;
        this.updateRemotePlayer(sessionId, player);
      });

      this.network.onChat((sessionId, msg) => {
        if (sessionId === this.network.sessionId) return;
        const remote = this.remotePlayers.get(sessionId);
        const wallet = msg.slice(0, 8);
        this.chat.addMessage("local", sessionId, wallet, msg, "#14F195");
        if (remote) {
          this.showBubble(remote.getContainer(), msg, "#14F195");
        }
      });
    } catch {
      this.chat.addSystemMessage("Offline mode (server not running)");
    }
  }

  private addRemotePlayer(sessionId: string, player: RemotePlayer): void {
    const avatar = new AvatarSprite(this, player.x, player.y, player.outfitId);
    this.remotePlayers.set(sessionId, avatar);

    const name = player.wallet
      ? `${player.wallet.slice(0, 4)}...${player.wallet.slice(-4)}`
      : sessionId.slice(0, 6);

    const label = this.add.text(0, -32, name, {
      fontSize: "7px", fontFamily: "monospace",
      color: "#aaaacc", align: "center",
    }).setOrigin(0.5, 1);
    avatar.getContainer().add(label);
    this.nameLabels.set(sessionId, label);

    this.chat.addSystemMessage(`${name} entered the city`);
  }

  private removeRemotePlayer(sessionId: string): void {
    const avatar = this.remotePlayers.get(sessionId);
    if (avatar) {
      avatar.destroy();
      this.remotePlayers.delete(sessionId);
    }

    const label = this.nameLabels.get(sessionId);
    if (label) {
      label.destroy();
      this.nameLabels.delete(sessionId);
    }

    const bubble = this.activeBubbles.get(sessionId);
    if (bubble) {
      bubble.destroy();
      this.activeBubbles.delete(sessionId);
    }

    this.chat.addSystemMessage(`Player left the city`);
  }

  private updateRemotePlayer(sessionId: string, player: RemotePlayer): void {
    const avatar = this.remotePlayers.get(sessionId);
    if (!avatar) return;

    // Smooth interpolation
    const container = avatar.getContainer();
    this.tweens.add({
      targets: container,
      x: player.x,
      y: player.y,
      duration: 100,
      ease: "Linear",
    });

    if (player.isWalking) {
      avatar.walk(player.direction as Direction);
    } else {
      avatar.idle();
    }

    if (player.outfitId !== "default") {
      avatar.setOutfit(player.outfitId);
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
