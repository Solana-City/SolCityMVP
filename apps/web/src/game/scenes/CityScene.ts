import * as Phaser from "phaser";
import { TILE_SIZE, MAP_COLS, MAP_ROWS, PLAYER_SPEED } from "../config/constants";
import { getMapData, getSpawnPoint } from "../utils/mapGenerator";
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
  private collisionGroup!: Phaser.Physics.Arcade.StaticGroup;

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

    // Collision: create static bodies for each blocked tile
    this.collisionGroup = this.physics.add.staticGroup();
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const idx = r * width + c;
        if (collision[idx] === 0) {
          const bx = c * TILE_SIZE + TILE_SIZE / 2;
          const by = r * TILE_SIZE + TILE_SIZE / 2;
          const block = this.add.rectangle(bx, by, TILE_SIZE, TILE_SIZE);
          block.setVisible(false);
          this.physics.add.existing(block, true);
          this.collisionGroup.add(block);
        }
      }
    }

    // Local player sprite. The "avatar-player" texture should always be
    // loaded; if somehow missing (network error during boot), we just
    // ship the first available NPC sprite as a hard fallback. No more
    // chef placeholder — that's been removed from the pipeline.
    const spawn = getSpawnPoint();
    const spawnX = spawn.x * TILE_SIZE + TILE_SIZE / 2;
    const spawnY = spawn.y * TILE_SIZE + TILE_SIZE / 2;
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
    this.physics.add.collider(container, this.collisionGroup);
    this.physics.world.setBounds(0, 0, MAP_COLS * TILE_SIZE, MAP_ROWS * TILE_SIZE);

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

    // Building facades + decorative props layered above the tilemap
    this.createDecoratives();

    // NPCs with collision bodies
    for (const def of NPC_REGISTRY) {
      const npc = new NPCSprite(this, def);
      this.npcSprites.push(npc);

      // Add static collision body so player can't walk through NPCs
      const npcContainer = npc.getContainer();
      this.physics.world.enable(npcContainer);
      const npcBody = npcContainer.body as Phaser.Physics.Arcade.Body;
      npcBody.setSize(TILE_SIZE * 0.6, TILE_SIZE * 0.4);
      npcBody.setOffset(-TILE_SIZE * 0.3, -TILE_SIZE * 0.2);
      npcBody.setImmovable(true);
      this.physics.add.collider(container, npcContainer);
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

  private reshape(flat: number[], cols: number, rows: number): number[][] {
    const grid: number[][] = [];
    for (let r = 0; r < rows; r++) {
      grid.push(flat.slice(r * cols, (r + 1) * cols));
    }
    return grid;
  }

  // ── Decoratives ────────────────────────────────────────────────────────────

  /**
   * Renders pixel-art building facades and street props above the tilemap.
   * Everything here is visual-only — physics colliders are already handled
   * by the tile collision layer created above.
   */
  private createDecoratives(): void {
    this.generateBuildingTextures();
    this.placeBuildingFacades();
    this.placeLampPosts();
    this.placeBenches();
    this.placeTreeProps();
    this.placeFountain();
  }

  // Pre-render building facade textures into the texture cache
  private generateBuildingTextures(): void {
    const T = TILE_SIZE;

    const defs: Array<{ key: string; accentColor: string; label: string; labelColor: string }> = [
      { key: "facade-jupiter",   accentColor: "#FFD700", label: "JUPITER",    labelColor: "#FFD700" },
      { key: "facade-post",      accentColor: "#00D1FF", label: "POST",        labelColor: "#00D1FF" },
      { key: "facade-superteam", accentColor: "#9945FF", label: "SUPERTEAM",   labelColor: "#9945FF" },
      { key: "facade-generic",   accentColor: "#14F195", label: "BUILDING",    labelColor: "#14F195" },
    ];

    for (const def of defs) {
      if (this.textures.exists(def.key)) continue;
      const W = T * 3; // 96px — 3 tiles wide
      const H = T * 4; // 128px — 4 tiles tall (extra height above roof)

      const canvas = document.createElement("canvas");
      canvas.width  = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;

      // --- Invisible at bottom (blends with floor tiles) ---
      // Facade starts from row 1 tile up (the "wall" portion)
      const wallTop  = T;      // 32px down = 1 tile
      const wallH    = T * 2;  // 64px of wall
      const roofTop  = 0;
      const roofH    = T;      // 32px roof

      // Roof
      ctx.fillStyle = "#111128";
      ctx.fillRect(0, roofTop, W, roofH);
      // Roof edge highlight
      ctx.fillStyle = def.accentColor;
      ctx.globalAlpha = 0.50;
      ctx.fillRect(2, roofTop + roofH - 3, W-4, 2);
      ctx.globalAlpha = 1;
      // Roof detail: small antenna/orb
      ctx.fillStyle = def.accentColor;
      ctx.globalAlpha = 0.80;
      ctx.fillRect(W/2 - 2, roofTop+4, 4, 12);  // antenna pole
      ctx.fillRect(W/2 - 5, roofTop+4, 10, 4);  // crossbar
      ctx.globalAlpha = 1;

      // Wall
      ctx.fillStyle = "#1e1e3a";
      ctx.fillRect(0, wallTop, W, wallH);
      // Wall left/right edge shadows
      ctx.fillStyle = "#000000";
      ctx.globalAlpha = 0.30;
      ctx.fillRect(0, wallTop, 3, wallH);
      ctx.fillRect(W-3, wallTop, 3, wallH);
      ctx.globalAlpha = 1;

      // Window grid — 3 cols × 2 rows
      const winW = 14; const winH = 10;
      const winCols = 3; const winRows = 2;
      const xPad = Math.floor((W - winCols * (winW + 6)) / 2);
      const yPad = Math.floor(wallH / (winRows + 1));

      for (let wr = 0; wr < winRows; wr++) {
        for (let wc = 0; wc < winCols; wc++) {
          const wx = xPad + wc * (winW + 6);
          const wy = wallTop + yPad * (wr + 0.8);
          // Recess
          ctx.fillStyle = "#0a0a20";
          ctx.fillRect(wx-1, wy-1, winW+2, winH+2);
          // Glass
          ctx.fillStyle = "#d0e8ff";
          ctx.fillRect(wx, wy, winW, winH);
          // Lit interior
          ctx.fillStyle = "#ffe88a";
          ctx.globalAlpha = 0.65;
          ctx.fillRect(wx+1, wy+1, winW-2, winH-2);
          // Reflection
          ctx.fillStyle = "#ffffff";
          ctx.globalAlpha = 0.70;
          ctx.fillRect(wx+1, wy+1, 2, 2);
          ctx.globalAlpha = 1;
          // Frame bars
          ctx.fillStyle = "#404060";
          ctx.fillRect(wx + winW/2, wy, 1, winH);
          ctx.fillRect(wx, wy + winH/2, winW, 1);
        }
      }

      // Neon sign band
      const signY = wallTop + wallH - 16;
      ctx.fillStyle = "#0c0c22";
      ctx.fillRect(4, signY, W-8, 14);
      ctx.fillStyle = def.accentColor;
      ctx.globalAlpha = 0.90;
      ctx.fillRect(4, signY, W-8, 2);
      ctx.fillRect(4, signY+12, W-8, 2);
      ctx.globalAlpha = 1;
      // Label text — rendered at 2× pixel scale for sharpness
      ctx.save();
      ctx.scale(1, 1);
      ctx.fillStyle = def.labelColor;
      ctx.font      = "bold 7px monospace";
      ctx.textAlign = "center";
      ctx.globalAlpha = 1;
      ctx.fillText(def.label, W/2, signY + 9);
      ctx.restore();

      // Foundation (bottom, overlaps tile floor)
      ctx.fillStyle = "#0e0e28";
      ctx.fillRect(0, wallTop + wallH, W, T);
      // Neon bottom glow
      ctx.fillStyle = def.accentColor;
      ctx.globalAlpha = 0.50;
      ctx.fillRect(6, wallTop + wallH, W-12, 2);
      ctx.globalAlpha = 1;

      this.textures.addCanvas(def.key, canvas);
    }
  }

  private placeBuildingFacades(): void {
    const T = TILE_SIZE;

    // Each entry: [texture key, tile col, tile row (top of facade tiles)]
    const facades: [string, number, number][] = [
      ["facade-jupiter",   10, 3],  // Jupiter Exchange: cols 10-12, rows 3-4
      ["facade-post",      20, 3],  // Post Station: cols 20-22, rows 3-4
      ["facade-superteam", 20, 17], // Superteam Hub: cols 20-22, rows 17-19
      ["facade-generic",   10, 21], // Generic building: cols 10-12, rows 21-23
      ["facade-generic",   18, 21], // Generic building: cols 18-20, rows 21-23
    ];

    for (const [key, col, row] of facades) {
      // World-space pixel X = col * T + half facade width (centre)
      const wx = col * T + (T * 3) / 2;
      // World-space pixel Y = row * T — position facade so roof is above the top tile
      const wy = row * T; // anchor at bottom of facade canvas = top of building block
      const img = this.add.image(wx, wy, key);
      img.setOrigin(0.5, 1.0);    // anchor bottom-centre
      img.depth = wy - 0.5;       // render just below the NPCs standing in front
    }
  }

  private placeLampPosts(): void {
    const T = TILE_SIZE;
    // Lamp post texture — 6×20px
    if (!this.textures.exists("lamp")) {
      const c = document.createElement("canvas");
      c.width = 6; c.height = 20;
      const ctx = c.getContext("2d")!;
      // Pole
      ctx.fillStyle = "#888898"; ctx.fillRect(2, 4, 2, 16);
      // Arm
      ctx.fillStyle = "#aaaabc"; ctx.fillRect(0, 4, 5, 2);
      // Bulb
      ctx.fillStyle = "#ffffc0"; ctx.fillRect(0, 0, 5, 5);
      ctx.fillStyle = "#ffffff"; ctx.fillRect(1, 0, 3, 2);
      this.textures.addCanvas("lamp", c);
    }

    // Place lamps along col-5 path (N-S) and col-25 path (N-S)
    // and along row-6 path (E-W) and row-13 / row-20
    const lampPositions: [number, number][] = [
      // col 5 N-S path, every 4 tiles
      [5, 7], [5, 10], [5, 14], [5, 17],
      // col 25 N-S path
      [25, 7], [25, 10], [25, 14], [25, 17],
      // row 6 E-W path, every 4 tiles (avoid NPC zones)
      [9, 6], [13, 6], [17, 6], [21, 6],
      // row 13
      [8, 13], [12, 13], [16, 13], [19, 13], [23, 13],
      // row 20
      [9, 20], [13, 20], [17, 20], [21, 20],
    ];

    for (const [col, row] of lampPositions) {
      const wx = col * T + T / 2;
      const wy = row * T + T / 2;
      const lamp = this.add.image(wx, wy, "lamp");
      lamp.setOrigin(0.5, 1.0);
      lamp.depth = wy;
    }
  }

  private placeBenches(): void {
    const T = TILE_SIZE;
    if (!this.textures.exists("bench")) {
      const c = document.createElement("canvas");
      c.width = 14; c.height = 8;
      const ctx = c.getContext("2d")!;
      // Seat slats
      ctx.fillStyle = "#7a5a30"; ctx.fillRect(0, 2, 14, 3);
      ctx.fillStyle = "#9a7a50"; ctx.fillRect(0, 2, 14, 1);
      ctx.fillStyle = "#5a3a18"; ctx.fillRect(4, 2, 1, 6);
      ctx.fillStyle = "#5a3a18"; ctx.fillRect(9, 2, 1, 6);
      // Armrests
      ctx.fillStyle = "#9a7a50"; ctx.fillRect(0, 1, 2, 3);
      ctx.fillStyle = "#9a7a50"; ctx.fillRect(12, 1, 2, 3);
      this.textures.addCanvas("bench", c);
    }

    const benches: [number, number][] = [
      // Around the park area
      [7, 11], [11, 11], [7, 8], [11, 8],
      // Plaza benches
      [14, 9], [19, 9], [14, 11], [19, 11],
    ];
    for (const [col, row] of benches) {
      const wx = col * T + T / 2;
      const wy = row * T + T / 2;
      const bench = this.add.image(wx, wy, "bench");
      bench.setOrigin(0.5, 0.5);
      bench.depth = wy;
    }
  }

  private placeTreeProps(): void {
    const T = TILE_SIZE;
    if (!this.textures.exists("tree")) {
      const c = document.createElement("canvas");
      c.width = 20; c.height = 28;
      const ctx = c.getContext("2d")!;
      // Trunk
      ctx.fillStyle = "#5a3a1a"; ctx.fillRect(8, 18, 4, 10);
      ctx.fillStyle = "#7a5a30"; ctx.fillRect(8, 18, 2, 10);
      // Canopy layers (3 layers, top smaller)
      const layers: [number, number, number, string][] = [
        [2,  12, 16, "#1a8a1a"],
        [1,  7,  18, "#1e9e1e"],
        [0,  2,  20, "#16801a"],
      ];
      for (const [x, cy, w, col] of layers) {
        ctx.fillStyle = col; ctx.fillRect(x, cy, w, 7);
        // Top highlight
        ctx.fillStyle = "#30c030"; ctx.globalAlpha = 0.40;
        ctx.fillRect(x+2, cy, w-4, 2);
        ctx.globalAlpha = 1;
      }
      this.textures.addCanvas("tree", c);
    }

    // Trees around park area (rows 7-10, cols 7-11)
    const treeTiles: [number, number][] = [
      [7, 7], [9, 7], [11, 7],
      [8, 10], [10, 10],
    ];
    for (const [col, row] of treeTiles) {
      const wx = col * T + T / 2 + (col % 2 === 0 ? 4 : -4);
      const wy = row * T + T - 4;
      const tree = this.add.image(wx, wy, "tree");
      tree.setOrigin(0.5, 1.0);
      tree.depth = wy;
    }
  }

  private placeFountain(): void {
    const T = TILE_SIZE;
    if (!this.textures.exists("fountain")) {
      const c = document.createElement("canvas");
      c.width = 24; c.height = 20;
      const ctx = c.getContext("2d")!;
      // Basin
      ctx.fillStyle = "#404070"; ctx.fillRect(2, 10, 20, 8);
      ctx.fillStyle = "#6060a0"; ctx.fillRect(3, 11, 18, 6);
      ctx.fillStyle = "#0b3b5c"; ctx.fillRect(4, 12, 16, 4);
      // Water shimmer
      ctx.fillStyle = "#00d1ff"; ctx.globalAlpha = 0.50;
      ctx.fillRect(5, 13, 14, 1);
      ctx.fillRect(7, 15, 10, 1);
      ctx.globalAlpha = 1;
      // Centre pillar
      ctx.fillStyle = "#8080b0"; ctx.fillRect(11, 4, 2, 8);
      // Water spray
      ctx.fillStyle = "#00d1ff"; ctx.globalAlpha = 0.70;
      ctx.fillRect(12, 0, 1, 5);
      ctx.fillRect(10, 1, 1, 4);
      ctx.fillRect(14, 1, 1, 4);
      ctx.fillRect(8, 2, 1, 3);
      ctx.fillRect(16, 2, 1, 3);
      ctx.globalAlpha = 1;
      this.textures.addCanvas("fountain", c);
    }

    // Place in the centre of the plaza (around tiles 15-16, 8-10)
    const wx = 16 * T;
    const wy = 9 * T;
    const fountain = this.add.image(wx, wy, "fountain");
    fountain.setOrigin(0.5, 0.8);
    fountain.depth = wy;
  }
}
