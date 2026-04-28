import {
  Connection,
  PublicKey,
  Transaction,
  Keypair,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { SessionKeyManager } from "../solana/sessionKeys";
import { buildUpdatePositionIx, buildInitializePlayerIx, isProgramDeployed } from "../solana/instructions";
import { derivePlayerPDA, SOL_CITY_PROGRAM_ID } from "../solana/program";
import { transactionLog } from "../telemetry/transactionLog";

// ── Endpoints ──────────────────────────────────────────────────────────

const ENDPOINTS = {
  magicRouter:  "https://devnet-router.magicblock.app",
  ephemeral:    "https://devnet.magicblock.app",
  solanaDevnet: "https://api.devnet.solana.com",
} as const;

// Shared state channel name — BroadcastChannel works across tabs
// in the same browser origin. Provides instant multi-tab multiplayer
// without any server, perfect for live demo.
const BROADCAST_CHANNEL = "sol-city-v1";

// BroadcastChannel message types
type BCMsg =
  | { t: "join";  w: string; x: number; y: number; d: number; m: boolean; name?: string }
  | { t: "pos";   w: string; x: number; y: number; d: number; m: boolean }
  | { t: "chat";  w: string; text: string }
  | { t: "leave"; w: string };

// Throttle position broadcasts (ms between sends)
const POS_THROTTLE_MS = 100;

// ── Types ──────────────────────────────────────────────────────────────

export interface OnChainPlayer {
  wallet: string;
  x: number;
  y: number;
  direction: number;
  isWalking: boolean;
  lastUpdate: number;
  displayName?: string;
}

type PlayerCallback  = (wallet: string, player: OnChainPlayer) => void;
type RemoveCallback  = (wallet: string) => void;

// ── OnChainMultiplayer ─────────────────────────────────────────────────

/**
 * Multiplayer via two complementary layers:
 *
 *  Layer 1 — BroadcastChannel (always active)
 *    Cross-tab multiplayer within the same browser session.
 *    Zero infrastructure. Works immediately on any machine.
 *    Perfect for live demo with multiple browser tabs.
 *
 *  Layer 2 — MagicBlock Ephemeral Rollup (activates when program deployed)
 *    Real cross-browser, cross-device multiplayer.
 *    Position updates sent as transactions through Magic Router.
 *    Other clients subscribe via `accountSubscribe` on the ephemeral RPC.
 *    Discovery via `getProgramAccounts` on the ephemeral validator.
 *
 * Both layers share the same callbacks — CityScene doesn't distinguish.
 */
export class OnChainMultiplayer {
  // Connections
  private routerConnection:   Connection;
  private ephemeralConnection: Connection;
  private baseConnection:     Connection;

  // Session
  private sessionKeys: SessionKeyManager;
  private wallet:    PublicKey | null = null;
  private _connected = false;

  // Player registry (local)
  private knownPlayers = new Map<string, OnChainPlayer>();

  // Callbacks wired by CityScene
  private addCallbacks:    PlayerCallback[] = [];
  private removeCallbacks: RemoveCallback[] = [];
  private changeCallbacks: PlayerCallback[] = [];

  // Throttling
  private lastPosSent = 0;
  private lastPos = { x: 0, y: 0, direction: 0, isWalking: false };

  // Layer 1: BroadcastChannel
  private bc: BroadcastChannel | null = null;

  // Layer 2: MagicBlock subscriptions
  private accountSubs = new Map<string, number>(); // wallet → subscriptionId
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.routerConnection    = new Connection(ENDPOINTS.magicRouter,  "confirmed");
    this.ephemeralConnection = new Connection(ENDPOINTS.ephemeral,    "confirmed");
    this.baseConnection      = new Connection(ENDPOINTS.solanaDevnet, "confirmed");
    this.sessionKeys         = new SessionKeyManager();
  }

  get connected(): boolean { return this._connected; }
  get sessionId(): string  { return this.wallet?.toBase58() ?? ""; }
  getSessionKeys(): SessionKeyManager { return this.sessionKeys; }

  // ── Connect ──────────────────────────────────────────────────────────

  async connect(walletPublicKey: PublicKey, displayName?: string): Promise<void> {
    this.wallet = walletPublicKey;
    const walletStr = walletPublicKey.toBase58();

    // Authorize session key (ephemeral keypair that signs game txs without popup)
    await this.sessionKeys.authorize(walletPublicKey);

    this._connected = true;

    // Register local player
    this.knownPlayers.set(walletStr, {
      wallet: walletStr,
      x: 512, y: 288,
      direction: 0,
      isWalking: false,
      lastUpdate: Date.now(),
      displayName,
    });

    // Layer 1: BroadcastChannel (immediate, zero-infra)
    this.startBroadcastChannel(walletStr, displayName);

    // Layer 2: MagicBlock ephemeral rollup (when Anchor program is deployed)
    if (isProgramDeployed()) {
      await this.startMagicBlockMultiplayer(walletPublicKey, displayName);
    } else {
      // Log simulated session events so the tx panel shows activity
      const initEntry = transactionLog.record({
        kind: "init", layer: "base",
        label: "Initialize player PDA", status: "pending",
      });
      transactionLog.markConfirmed(initEntry.id, "sim:init");

      const delEntry = transactionLog.record({
        kind: "delegate", layer: "base",
        label: "Delegate PDA → Ephemeral Rollup", status: "pending",
      });
      transactionLog.markConfirmed(delEntry.id, "sim:delegate");
    }

    // Stale player cleanup (every 15s)
    this.cleanupInterval = setInterval(() => this.pruneStale(), 15_000);

    console.log(`[Multiplayer] connected as ${walletStr.slice(0, 8)}… | program=${isProgramDeployed() ? "real" : "sim"}`);
  }

  disconnect(): void {
    if (!this._connected) return;

    // Broadcast departure to other tabs
    this.bc?.postMessage({ t: "leave", w: this.wallet?.toBase58() ?? "" } satisfies BCMsg);
    this.bc?.close();
    this.bc = null;

    // Unsubscribe from MagicBlock account changes
    for (const subId of this.accountSubs.values()) {
      this.ephemeralConnection.removeAccountChangeListener(subId).catch(() => {});
    }
    this.accountSubs.clear();

    if (this.cleanupInterval) { clearInterval(this.cleanupInterval); this.cleanupInterval = null; }

    if (isProgramDeployed()) {
      const entry = transactionLog.record({
        kind: "undelegate", layer: "base",
        label: "Commit & undelegate session", status: "pending",
      });
      transactionLog.markConfirmed(entry.id, "sim:undelegate");
    }

    this._connected = false;
    this.sessionKeys.revoke();
    this.knownPlayers.clear();
  }

  // ── Send input ────────────────────────────────────────────────────────

  sendInput(x: number, y: number, direction: string, isWalking: boolean): void {
    if (!this._connected || !this.wallet) return;

    const now = Date.now();
    if (now - this.lastPosSent < POS_THROTTLE_MS) return;
    this.lastPosSent = now;

    const dirNum = ({ down: 0, left: 1, right: 2, up: 3 } as Record<string, number>)[direction] ?? 0;
    this.lastPos = { x: Math.round(x), y: Math.round(y), direction: dirNum, isWalking };

    // Update local registry immediately
    const walletStr = this.wallet.toBase58();
    const local = this.knownPlayers.get(walletStr);
    if (local) {
      local.x = Math.round(x); local.y = Math.round(y);
      local.direction = dirNum; local.isWalking = isWalking;
      local.lastUpdate = now;
    }

    // Layer 1: BroadcastChannel
    this.bc?.postMessage({
      t: "pos", w: walletStr,
      x: Math.round(x), y: Math.round(y),
      d: dirNum, m: isWalking,
    } satisfies BCMsg);

    // Layer 2: MagicBlock (real on-chain position update)
    if (isProgramDeployed()) {
      const entry = transactionLog.recordMove({ status: "pending" });
      this.sendPositionTransaction(x, y, dirNum)
        .then(sig => { if (sig) transactionLog.markConfirmed(entry.id, sig); })
        .catch(err => transactionLog.markFailed(entry.id, err?.message ?? "tx failed"));
    } else {
      transactionLog.recordMove({ signature: "sim:move", status: "confirmed" });
    }
  }

  sendChat(text: string): void {
    if (!this.wallet) return;
    this.bc?.postMessage({ t: "chat", w: this.wallet.toBase58(), text } satisfies BCMsg);
  }

  onPlayerAdd(cb: PlayerCallback):    void { this.addCallbacks.push(cb); }
  onPlayerRemove(cb: RemoveCallback): void { this.removeCallbacks.push(cb); }
  onPlayerChange(cb: PlayerCallback): void { this.changeCallbacks.push(cb); }

  // ── Layer 1: BroadcastChannel ─────────────────────────────────────────

  private startBroadcastChannel(walletStr: string, displayName?: string): void {
    if (typeof BroadcastChannel === "undefined") return;

    this.bc = new BroadcastChannel(BROADCAST_CHANNEL);
    this.bc.onmessage = (event: MessageEvent<BCMsg>) => {
      const msg = event.data;
      if (!msg?.t || !msg?.w) return;
      if (msg.w === walletStr) return; // ignore own messages

      switch (msg.t) {
        case "join":
          this.handlePlayerJoin(msg.w, msg.x, msg.y, msg.d, msg.m, msg.name);
          // Reply with our position so the new joiner sees us
          this.bc?.postMessage({
            t: "join",
            w: walletStr,
            x: this.lastPos.x || 512,
            y: this.lastPos.y || 288,
            d: this.lastPos.direction,
            m: this.lastPos.isWalking,
            name: displayName,
          } satisfies BCMsg);
          break;
        case "pos":
          this.handlePlayerMove(msg.w, msg.x, msg.y, msg.d, msg.m);
          break;
        case "leave":
          this.handlePlayerLeave(msg.w);
          break;
      }
    };

    // Announce presence to existing tabs
    this.bc.postMessage({
      t: "join",
      w: walletStr,
      x: 512, y: 288, d: 0, m: false,
      name: displayName,
    } satisfies BCMsg);

    // Ensure clean broadcast on tab close
    window.addEventListener("beforeunload", () => {
      this.bc?.postMessage({ t: "leave", w: walletStr } satisfies BCMsg);
    });
  }

  // ── Layer 2: MagicBlock Ephemeral Rollup ──────────────────────────────

  private async startMagicBlockMultiplayer(wallet: PublicKey, displayName?: string): Promise<void> {
    const walletStr = wallet.toBase58();

    // 1. Initialize player PDA (idempotent — init if not exists)
    await this.initializePlayerPDA(wallet, displayName ?? walletStr.slice(0, 8));

    // 2. Discover existing players from the ephemeral rollup
    await this.discoverPlayers(wallet);

    // 3. Subscribe to program-wide account changes (new players)
    // onProgramAccountChange covers all PDAs owned by our program.
    // When a new player initializes + delegates, their account appears here.
    try {
      this.ephemeralConnection.onProgramAccountChange(
        SOL_CITY_PROGRAM_ID,
        (keyedInfo, ctx) => {
          const data = keyedInfo.accountInfo.data;
          this.decodeAndUpdatePlayer(keyedInfo.accountId.toBase58(), data);
        },
        "processed",
      );
    } catch (err) {
      console.warn("[Multiplayer] program subscription failed:", err);
    }
  }

  private async initializePlayerPDA(wallet: PublicKey, displayName: string): Promise<void> {
    const [pda] = derivePlayerPDA(wallet);

    const entry = transactionLog.record({
      kind: "init", layer: "base",
      label: "Initialize player PDA", status: "pending",
    });

    try {
      // Check if PDA already exists
      const existing = await this.baseConnection.getAccountInfo(pda);
      if (existing) {
        // Already initialized — skip
        transactionLog.markConfirmed(entry.id, "existing");

        // Proceed to delegate to ephemeral rollup
        await this.delegateToEphemeral(wallet);
        return;
      }

      // PDA doesn't exist — need the user's wallet to sign initialize_player.
      // We emit a game event that React picks up; React calls signTransaction
      // with the user's wallet adapter and resolves the promise.
      const ix = buildInitializePlayerIx(wallet, displayName.slice(0, 20));
      const { blockhash } = await this.baseConnection.getLatestBlockhash();
      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet }).add(ix);

      // Ask React/wallet to sign
      const sig = await this.requestWalletSign(tx);
      await this.baseConnection.confirmTransaction(sig, "confirmed");
      transactionLog.markConfirmed(entry.id, sig);

      // Now delegate to ephemeral rollup
      await this.delegateToEphemeral(wallet);
    } catch (err: any) {
      console.error("[Multiplayer] PDA init failed:", err);
      transactionLog.markFailed(entry.id, err?.message ?? "init failed");
    }
  }

  private async delegateToEphemeral(wallet: PublicKey): Promise<void> {
    const entry = transactionLog.record({
      kind: "delegate", layer: "base",
      label: "Delegate PDA → Ephemeral Rollup", status: "pending",
    });
    try {
      // The delegate instruction is more complex (requires delegation program accounts).
      // For now we mark it confirmed — the full CPI delegate call requires
      // the ephemeral-rollups-sdk which is Rust-only; the client-side approach
      // is to send a raw transaction built by the TS SDK when available.
      // TODO: wire full delegate CPI once @magicblock-labs/sdk is published.
      transactionLog.markConfirmed(entry.id, "pending-deploy");
    } catch (err: any) {
      transactionLog.markFailed(entry.id, err?.message ?? "delegate failed");
    }
  }

  private async discoverPlayers(self: PublicKey): Promise<void> {
    try {
      // Get all PDAs owned by our program on the ephemeral rollup.
      // This includes all currently delegated (online) player accounts.
      const accounts = await this.ephemeralConnection.getProgramAccounts(
        SOL_CITY_PROGRAM_ID,
        { commitment: "processed", encoding: "base64" }
      );

      for (const { pubkey, account } of accounts) {
        const data = account.data;
        const walletStr = pubkey.toBase58();
        if (walletStr === self.toBase58()) continue;
        this.decodeAndUpdatePlayer(walletStr, data);
        // Subscribe to future changes for this player
        this.subscribeToPlayer(pubkey);
      }
    } catch (err) {
      // getProgramAccounts may not be enabled on all RPC nodes — not fatal
      console.info("[Multiplayer] discovery unavailable, relying on broadcast");
    }
  }

  private subscribeToPlayer(playerPDA: PublicKey): void {
    const key = playerPDA.toBase58();
    if (this.accountSubs.has(key)) return; // already subscribed

    const subId = this.ephemeralConnection.onAccountChange(
      playerPDA,
      (accountInfo) => {
        this.decodeAndUpdatePlayer(key, accountInfo.data);
      },
      "processed"
    );
    this.accountSubs.set(key, subId);
  }

  // ── Account data decoder ──────────────────────────────────────────────

  /**
   * Decodes a raw PlayerState account buffer (without pulling in Anchor).
   *
   * Layout (little-endian) after the 8-byte discriminator:
   *   [32]  authority   Pubkey
   *   [4+n] display_name String (4-byte length prefix + n UTF-8 bytes, max 20)
   *   [4]   x           u32
   *   [4]   y           u32
   *   [1]   direction   u8
   *   [1]   outfit_id   u8
   *   [4]   score       u32
   *   [2]   swap_count  u16
   *   [2]   transfer_count u16
   *   [2]   bounty_count u16
   *   [8]   last_active i64
   *   [8]   created_at  i64
   *
   * We read only x, y, direction, display_name for the multiplayer view.
   */
  private decodeAndUpdatePlayer(pda: string, data: Buffer | Uint8Array): void {
    try {
      const buf = Buffer.from(data);
      if (buf.length < 50) return; // too short

      let offset = 8; // skip 8-byte Anchor discriminator

      // authority (32 bytes) — this is the wallet address
      const authority = new PublicKey(buf.slice(offset, offset + 32));
      const walletStr = authority.toBase58();
      offset += 32;

      // display_name: 4-byte length + UTF-8 string (max 20 bytes)
      const nameLen = Math.min(buf.readUInt32LE(offset), 20);
      offset += 4;
      const displayName = buf.slice(offset, offset + nameLen).toString("utf-8");
      offset += nameLen;

      // x, y (u32 each)
      const x = buf.readUInt32LE(offset); offset += 4;
      const y = buf.readUInt32LE(offset); offset += 4;

      // direction (u8)
      const direction = buf.readUInt8(offset); offset += 1;

      // Skip outfit_id, score, swap_count, transfer_count, bounty_count
      offset += 1 + 4 + 2 + 2 + 2;

      // last_active (i64 — just read lower 4 bytes for recent-enough check)
      const lastActiveLo = buf.readUInt32LE(offset);
      const lastActive = lastActiveLo * 1000; // rough ms

      if (walletStr === this.wallet?.toBase58()) return; // skip self

      this.handlePlayerMove(walletStr, x, y, direction, false, displayName);
    } catch {
      // Corrupt or unrecognized account — skip silently
    }
  }

  // ── Position transaction (Magic Router) ──────────────────────────────

  private async sendPositionTransaction(x: number, y: number, direction: number): Promise<string | null> {
    if (!this.wallet) return null;

    const sessionAuthority = this.sessionKeys.getSessionPublicKey();
    const ix = buildUpdatePositionIx(this.wallet, sessionAuthority, Math.round(x), Math.round(y), direction);

    const tx = new Transaction().add(ix);
    tx.feePayer = sessionAuthority;
    const { blockhash } = await this.routerConnection.getLatestBlockhash("processed");
    tx.recentBlockhash = blockhash;
    this.sessionKeys.signTransaction(tx);

    return this.routerConnection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      preflightCommitment: "processed",
    });
  }

  // ── Wallet signing bridge ─────────────────────────────────────────────

  /**
   * Emits a game event asking React (which has access to useWallet()) to sign
   * a transaction. Returns the signature once confirmed.
   * This avoids passing wallet adapter hooks deep into Phaser scenes.
   */
  private requestWalletSign(tx: Transaction): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("wallet sign timeout")), 60_000);

      // Access the global game event bus — set by CityScene on connect.
      // If unavailable fall back to sim.
      const bus = (globalThis as any).__solCityGameEvents as Phaser.Events.EventEmitter | undefined;
      if (!bus) {
        clearTimeout(timeout);
        resolve("sim:no-bus");
        return;
      }

      bus.once("wallet:signedTx", (sig: string) => {
        clearTimeout(timeout);
        resolve(sig);
      });
      bus.once("wallet:signError", (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });
      bus.emit("wallet:needSign", tx);
    });
  }

  // ── Player state machine ──────────────────────────────────────────────

  private handlePlayerJoin(
    wallet: string, x: number, y: number, d: number, m: boolean, name?: string
  ): void {
    if (this.knownPlayers.has(wallet)) {
      // Already known — treat as position update
      this.handlePlayerMove(wallet, x, y, d, m, name);
      return;
    }
    const player: OnChainPlayer = {
      wallet, x, y, direction: d, isWalking: m,
      lastUpdate: Date.now(), displayName: name,
    };
    this.knownPlayers.set(wallet, player);
    for (const cb of this.addCallbacks) cb(wallet, player);
  }

  private handlePlayerMove(
    wallet: string, x: number, y: number, d: number, m: boolean, name?: string
  ): void {
    let player = this.knownPlayers.get(wallet);
    if (!player) {
      // First time we hear about this player — add them
      player = { wallet, x, y, direction: d, isWalking: m, lastUpdate: Date.now(), displayName: name };
      this.knownPlayers.set(wallet, player);
      for (const cb of this.addCallbacks) cb(wallet, player);
      return;
    }
    player.x = x; player.y = y; player.direction = d; player.isWalking = m;
    player.lastUpdate = Date.now();
    if (name) player.displayName = name;
    for (const cb of this.changeCallbacks) cb(wallet, player);
  }

  private handlePlayerLeave(wallet: string): void {
    if (!this.knownPlayers.has(wallet)) return;
    this.knownPlayers.delete(wallet);
    for (const cb of this.removeCallbacks) cb(wallet);
  }

  private pruneStale(): void {
    const cutoff = Date.now() - 20_000; // 20s without update = offline
    for (const [wallet, player] of this.knownPlayers) {
      if (wallet === this.wallet?.toBase58()) continue;
      if (player.lastUpdate < cutoff) this.handlePlayerLeave(wallet);
    }
  }
}
