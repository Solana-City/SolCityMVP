import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  ConnectionMagicRouter,
  createCommitAndUndelegateInstruction,
  delegationRecordPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { SessionKeyManager } from "../solana/sessionKeys";
import {
  buildInitializePlayerIx,
  buildAuthorizeSessionIx,
  buildDelegateIx,
  buildUpdatePositionSessionIx,
  buildRecordSwapIx,
  buildRecordTransferIx,
  buildRecordBountyIx,
  buildRecordMiniGameSessionIx,
  isProgramDeployed,
} from "../solana/instructions";
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
  | { t: "join";  w: string; x: number; y: number; d: number; m: boolean; name?: string; score?: number }
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
  score?: number;
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
  private routerConnection:    ConnectionMagicRouter;
  private ephemeralConnection: Connection;
  private baseConnection:      Connection;

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

  // Local player score (kept in sync by CityScene via updateScore())
  private localScore = 0;

  // Layer 1: BroadcastChannel
  private bc: BroadcastChannel | null = null;

  // Layer 2: MagicBlock subscriptions
  private accountSubs = new Map<string, number>(); // wallet → subscriptionId
  /** true = use ephemeral rollup; false = fall back to base layer devnet */
  private useEphemeral = false;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.routerConnection    = new ConnectionMagicRouter(ENDPOINTS.magicRouter,  "confirmed");
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

    // Session key authorization happens inside startMagicBlockMultiplayer (real)
    // or in the simulation branch below, routed to the correct connection.

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

      // Session key in sim mode — connect to base layer for authorize
      await this.sessionKeys.authorize(walletPublicKey, this.baseConnection);
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

    if (isProgramDeployed() && this.wallet) {
      this.commitAndUndelegatePlayer(this.wallet).catch(() => {});
    } else {
      const entry = transactionLog.record({
        kind: "undelegate", layer: "base",
        label: "Commit & undelegate session", status: "pending",
      });
      transactionLog.markConfirmed(entry.id, "sim:undelegate");
    }

    this._connected = false;
    this.sessionKeys.revoke(this.routerConnection);
    this.knownPlayers.clear();
  }

  // ── Send input ────────────────────────────────────────────────────────

  sendInput(x: number, y: number, direction: string, isWalking: boolean): void {
    if (!this._connected || !this.wallet) return;

    const roundX = Math.round(x);
    const roundY = Math.round(y);
    const dirNum = ({ down: 0, left: 1, right: 2, up: 3 } as Record<string, number>)[direction] ?? 0;

    // Skip if nothing actually changed — avoids flooding with idle updates
    if (
      roundX === this.lastPos.x &&
      roundY === this.lastPos.y &&
      dirNum === this.lastPos.direction &&
      isWalking === this.lastPos.isWalking
    ) return;

    const now = Date.now();
    if (now - this.lastPosSent < POS_THROTTLE_MS) return;
    this.lastPosSent = now;

    this.lastPos = { x: roundX, y: roundY, direction: dirNum, isWalking };

    // Update local registry immediately
    const walletStr = this.wallet.toBase58();
    const local = this.knownPlayers.get(walletStr);
    if (local) {
      local.x = roundX; local.y = roundY;
      local.direction = dirNum; local.isWalking = isWalking;
      local.lastUpdate = now;
    }

    // Layer 1: BroadcastChannel
    this.bc?.postMessage({
      t: "pos", w: walletStr,
      x: roundX, y: roundY,
      d: dirNum, m: isWalking,
    } satisfies BCMsg);

    // Layer 2: on-chain position update
    if (isProgramDeployed()) {
      const entry = transactionLog.recordMove({ status: "pending" });
      this.sendPositionTransaction(x, y, dirNum)
        .then(sig => {
          if (sig) transactionLog.markConfirmed(entry.id, sig);
        })
        .catch(err => {
          transactionLog.markFailed(entry.id, err?.message ?? "tx failed");
          // Log first few failures to help diagnose setup issues
          if ((this as any)._posErrCount === undefined) (this as any)._posErrCount = 0;
          if (++(this as any)._posErrCount <= 3) {
            console.warn("[Multiplayer] position tx failed:", err?.message, "| layer:", this.useEphemeral ? "ephemeral" : "base");
          }
        });
    } else {
      transactionLog.recordMove({ signature: "sim:move", status: "confirmed" });
    }
  }

  sendChat(text: string): void {
    if (!this.wallet) return;
    this.bc?.postMessage({ t: "chat", w: this.wallet.toBase58(), text } satisfies BCMsg);
  }

  /**
   * Sends a record_swap / record_transfer / record_bounty transaction
   * to the base layer when the program is deployed.
   * Main wallet signs (one popup per action — acceptable since these are rare).
   * Falls back to a no-op in simulation mode.
   */
  async recordAction(kind: "swap" | "transfer" | "bounty"): Promise<void> {
    if (!this.wallet || !isProgramDeployed()) return;

    const label = kind === "swap" ? "Record swap" : kind === "transfer" ? "Record transfer" : "Record bounty";
    const logKind = kind === "swap" ? "swap" : kind === "transfer" ? "transfer" : "bounty";
    const entry = transactionLog.record({ kind: logKind, layer: "base", label, status: "pending" });

    try {
      const ix =
        kind === "swap"     ? buildRecordSwapIx(this.wallet) :
        kind === "transfer" ? buildRecordTransferIx(this.wallet) :
                              buildRecordBountyIx(this.wallet);

      const { blockhash } = await this.baseConnection.getLatestBlockhash();
      const tx = new Transaction({
        recentBlockhash: blockhash,
        feePayer: this.wallet,
      }).add(ix);

      const sig = await this.requestWalletSign(tx);
      await this.confirmReal(this.baseConnection, sig);
      transactionLog.markConfirmed(entry.id, sig);
    } catch (err: any) {
      transactionLog.markFailed(entry.id, err?.message ?? "record failed");
    }
  }

  /**
   * Records a mini-game result via session key — no wallet popup.
   * Sends to the ephemeral rollup through the Magic Router.
   * Win: score += 100, bounty_count += 1. Loss: last_active only.
   * Falls back to transactionLog simulation when program is not deployed.
   */
  async recordMiniGame(success: boolean): Promise<void> {
    const label = success ? "Mini-game win" : "Mini-game loss";
    const entry = transactionLog.record({
      kind: "bounty", layer: "ephemeral", label, status: "pending",
    });

    if (!this.wallet || !isProgramDeployed()) {
      transactionLog.markConfirmed(entry.id, "sim:minigame");
      return;
    }

    try {
      const sessionKey = this.sessionKeys.getSessionPublicKey();
      const ix = buildRecordMiniGameSessionIx(
        this.wallet, sessionKey, success, success ? 100 : 0
      );

      const tx = new Transaction().add(ix);
      tx.feePayer = sessionKey;

      const { blockhash } = await this.routerConnection.getLatestBlockhashForTransaction(tx);
      tx.recentBlockhash = blockhash;
      this.sessionKeys.signTransaction(tx);

      const sig = await this.routerConnection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        preflightCommitment: "processed",
      });
      transactionLog.markConfirmed(entry.id, sig);
      console.log(`[Multiplayer] mini-game ${success ? "win" : "loss"} recorded:`, sig.slice(0, 12));
    } catch (err: any) {
      transactionLog.markFailed(entry.id, err?.message ?? "mini-game record failed");
    }
  }

  onPlayerAdd(cb: PlayerCallback):    void { this.addCallbacks.push(cb); }
  onPlayerRemove(cb: RemoveCallback): void { this.removeCallbacks.push(cb); }
  onPlayerChange(cb: PlayerCallback): void { this.changeCallbacks.push(cb); }

  /** Returns all currently known players (self included). */
  getActivePlayers(): OnChainPlayer[] {
    return Array.from(this.knownPlayers.values());
  }

  /** Called by CityScene when the local player's score changes. */
  updateScore(score: number): void {
    this.localScore = score;
    const walletStr = this.wallet?.toBase58();
    if (walletStr) {
      const local = this.knownPlayers.get(walletStr);
      if (local) local.score = score;
    }
  }

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
          this.handlePlayerJoin(msg.w, msg.x, msg.y, msg.d, msg.m, msg.name, msg.score);
          // Reply with our position so the new joiner sees us
          this.bc?.postMessage({
            t: "join",
            w: walletStr,
            x: this.lastPos.x || 512,
            y: this.lastPos.y || 288,
            d: this.lastPos.direction,
            m: this.lastPos.isWalking,
            name: displayName,
            score: this.localScore,
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
      score: this.localScore,
    } satisfies BCMsg);

    // Ensure clean broadcast on tab close
    window.addEventListener("beforeunload", () => {
      this.bc?.postMessage({ t: "leave", w: walletStr } satisfies BCMsg);
    });
  }

  // ── Layer 2: Devnet base layer (no ephemeral rollup delegation) ──────────
  // MagicBlock ephemeral rollup devnet endpoints are unreliable for reads
  // (getAccountInfo / WebSocket subscriptions return stale/null data).
  // Using the standard Solana devnet base layer gives reliable reads with
  // ~500ms-1s latency — good enough for cross-browser multiplayer on devnet.
  // Delegation will be re-enabled when launching on mainnet where MagicBlock
  // infrastructure is production-grade.

  private async startMagicBlockMultiplayer(wallet: PublicKey, displayName?: string): Promise<void> {
    const walletStr = wallet.toBase58();
    const [playerPDA] = derivePlayerPDA(wallet);

    console.group(`[Multiplayer] setup for ${walletStr.slice(0,8)}…`);

    // 1. Initialize PDA + authorize session key + fund session key.
    //    New player: init + auth + fund = 1 sign prompt.
    //    Existing player: auth + fund (if needed) = 1 sign prompt.
    //    Already authorized + funded: no prompt at all.
    try {
      const existing = await this.baseConnection.getAccountInfo(playerPDA);
      const sessionKey = this.sessionKeys.getSessionPublicKey();
      const name = displayName ?? walletStr.slice(0, 8);

      const SESSION_FUND_LAMPORTS = 5_000_000; // 0.005 SOL — covers ~1000 position updates
      const sessionBalance = await this.baseConnection.getBalance(sessionKey).catch(() => 0);
      const needsFunding = sessionBalance < 500_000;

      if (!existing) {
        console.log("… new player — init + auth" + (needsFunding ? " + fund" : "") + " (1 sign prompt)");
        const { blockhash } = await this.baseConnection.getLatestBlockhash();
        const tx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet })
          .add(buildInitializePlayerIx(wallet, name))
          .add(buildAuthorizeSessionIx(wallet, sessionKey));
        if (needsFunding) {
          tx.add(SystemProgram.transfer({ fromPubkey: wallet, toPubkey: sessionKey, lamports: SESSION_FUND_LAMPORTS }));
        }
        const sig = await this.requestWalletSign(tx);
        await this.confirmReal(this.baseConnection, sig);
        this.sessionKeys["authorized"] = true;
        console.log("✓ initialized + authorized:", sig.slice(0, 12));
      } else {
        console.log("✓ PDA exists — auth" + (needsFunding ? " + fund" : "") + (needsFunding ? " (1 sign prompt)" : " (may skip if cached)"));
        await this.sessionKeys.authorize(wallet, this.baseConnection, undefined, needsFunding ? SESSION_FUND_LAMPORTS : 0);
        console.log("✓ session authorized");
      }
    } catch (err: any) {
      console.warn("✗ init/auth failed:", err?.message);
    }

    // Always use base layer — no delegation on devnet
    this.useEphemeral = false;
    console.log("→ position layer: 📡 BASE DEVNET");
    console.groupEnd();

    // 2. Discover existing players via base layer getProgramAccounts
    await this.discoverPlayersFromBase(wallet);

    // 3. Subscribe to base layer program account changes (standard Solana devnet WebSocket)
    try {
      this.baseConnection.onProgramAccountChange(
        SOL_CITY_PROGRAM_ID,
        (keyedInfo) => {
          this.decodeAndUpdatePlayer(keyedInfo.accountId.toBase58(), keyedInfo.accountInfo.data);
        },
        "confirmed",
      );
      console.log("[Multiplayer] base layer subscription active");
    } catch (err) {
      console.warn("[Multiplayer] subscription failed:", err);
    }

    // 4. Per-player getAccountInfo polling every 2s — fallback for when
    //    onProgramAccountChange doesn't fire on the RPC node
    setInterval(() => this.pollKnownPlayerPDAs(wallet), 2_000);

    // 5. Full discovery every 8s to catch players who joined after initial connect
    setInterval(() => this.discoverPlayersFromBase(wallet), 8_000);

    // 6. Force a presence broadcast on next sendInput tick
    this.lastPos = { x: -1, y: -1, direction: -1, isWalking: false };
  }

  /** Discover players whose PDAs exist on devnet base layer (not delegated). */
  private async discoverPlayersFromBase(self: PublicKey): Promise<void> {
    try {
      const accounts = await this.baseConnection.getProgramAccounts(
        SOL_CITY_PROGRAM_ID,
        { commitment: "confirmed" }
      );
      let found = 0;
      for (const { pubkey, account } of accounts) {
        this.decodeAndUpdatePlayer(pubkey.toBase58(), account.data);
        found++;
      }
      if (found > 0) console.log(`[Multiplayer] base discovery: ${found} player(s)`);
    } catch (err) {
      console.info("[Multiplayer] base discovery unavailable:", err);
    }
  }

  /**
   * For each player we already know, fetch their PDA directly via getAccountInfo
   * on BOTH the base layer and the ephemeral rollup.  getAccountInfo is always
   * supported, unlike getProgramAccounts which may be disabled on some nodes.
   * The data with the higher last_active timestamp takes effect.
   */
  private async pollKnownPlayerPDAs(self: PublicKey): Promise<void> {
    const selfStr = self.toBase58();
    const wallets = [...this.knownPlayers.keys()].filter(w => w !== selfStr);
    if (wallets.length === 0) return;

    await Promise.allSettled(wallets.map(async (walletStr) => {
      try {
        const walletPub = new PublicKey(walletStr);
        const [pda] = derivePlayerPDA(walletPub);
        const info = await this.baseConnection.getAccountInfo(pda, "confirmed");
        if (info) this.decodeAndUpdatePlayer(pda.toBase58(), info.data);
      } catch { /* ignore per-player errors */ }
    }));
  }

  /**
   * Calls connection.confirmTransaction only when `sig` is a real base58
   * transaction signature.  Simulation placeholders ("sim:*") are not valid
   * base58 — passing them to getSignatureStatus triggers a tweetnacl assert
   * ("Assertion failed") that escapes the surrounding try/catch and crashes
   * the ErrorBoundary.
   */
  private async confirmReal(
    connection: Connection,
    sig: string,
    commitment: "confirmed" | "finalized" = "confirmed",
  ): Promise<void> {
    if (sig.startsWith("sim:")) return;
    await connection.confirmTransaction(sig, commitment);
  }

  private async initializePlayerPDA(wallet: PublicKey, displayName: string): Promise<void> {
    const [pda] = derivePlayerPDA(wallet);
    const existing = await this.baseConnection.getAccountInfo(pda);
    if (existing) return; // already initialized — nothing to do

    const entry = transactionLog.record({
      kind: "init", layer: "base",
      label: "Initialize player PDA", status: "pending",
    });

    try {
      const ix = buildInitializePlayerIx(wallet, displayName.slice(0, 20));
      const { blockhash } = await this.baseConnection.getLatestBlockhash();
      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet }).add(ix);

      const sig = await this.requestWalletSign(tx);
      await this.confirmReal(this.baseConnection, sig);
      transactionLog.markConfirmed(entry.id, sig);
    } catch (err: any) {
      console.error("[Multiplayer] PDA init failed:", err);
      transactionLog.markFailed(entry.id, err?.message ?? "init failed");
      throw err;
    }
  }

  private async delegateToEphemeral(wallet: PublicKey): Promise<void> {
    const entry = transactionLog.record({
      kind: "delegate", layer: "base",
      label: "Delegate PDA → Ephemeral Rollup", status: "pending",
    });
    try {
      const ix = buildDelegateIx(wallet);
      const { blockhash } = await this.baseConnection.getLatestBlockhash();
      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet }).add(ix);

      const sig = await this.requestWalletSign(tx);
      await this.confirmReal(this.baseConnection, sig);
      transactionLog.markConfirmed(entry.id, sig);
      console.log("[Multiplayer] PDA delegated to ephemeral rollup:", sig.slice(0, 12));
    } catch (err: any) {
      console.error("[Multiplayer] delegate failed:", err);
      transactionLog.markFailed(entry.id, err?.message ?? "delegate failed");
      // Non-fatal: fall back to BroadcastChannel layer
    }
  }

  /**
   * Commits the delegated player PDA back to the base layer and undelegates it.
   * Called on disconnect. Signed by the session key (no wallet popup).
   */
  private async commitAndUndelegatePlayer(wallet: PublicKey): Promise<void> {
    const entry = transactionLog.record({
      kind: "undelegate", layer: "base",
      label: "Commit & undelegate session", status: "pending",
    });
    try {
      const [playerPDA] = derivePlayerPDA(wallet);
      const sessionKey = this.sessionKeys.getSessionPublicKey();

      const ix = createCommitAndUndelegateInstruction(sessionKey, [playerPDA]);
      const { blockhash } = await this.ephemeralConnection.getLatestBlockhash();
      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: sessionKey }).add(ix);

      // Session key signs — no wallet popup required
      this.sessionKeys.signTransaction(tx);
      const sig = await this.ephemeralConnection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
      });
      transactionLog.markConfirmed(entry.id, sig);
      console.log("[Multiplayer] committed & undelegated:", sig.slice(0, 12));
    } catch (err: any) {
      transactionLog.markFailed(entry.id, err?.message ?? "undelegate failed");
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
   *   [32]  authority         Pubkey
   *   [33]  session_authority Option<Pubkey> (1-byte tag + 32 bytes if Some)
   *   [4+n] display_name      String (4-byte length prefix + n UTF-8 bytes, max 20)
   *   [4]   x                 u32
   *   [4]   y                 u32
   *   [1]   direction         u8
   *   [1]   outfit_id         u8
   *   [4]   score             u32
   *   [2]   swap_count        u16
   *   [2]   transfer_count    u16
   *   [2]   bounty_count      u16
   *   [8]   last_active       i64
   *   [8]   created_at        i64
   *
   * We read only authority, x, y, direction, display_name for the multiplayer view.
   */
  private decodeAndUpdatePlayer(pda: string, data: Buffer | Uint8Array): void {
    try {
      const buf = Buffer.from(data);
      if (buf.length < 83) return; // 8 + 32 + 33 + 4 + 4 + 4 (min)

      let offset = 8; // skip 8-byte Anchor discriminator

      // authority (32 bytes) — main wallet address
      const authority = new PublicKey(buf.slice(offset, offset + 32));
      const walletStr = authority.toBase58();
      offset += 32;

      // session_authority: Option<Pubkey> — 1 tag byte + 32 if tag=1
      const hasSession = buf.readUInt8(offset) === 1;
      offset += 1 + (hasSession ? 32 : 0);

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

      const lastActiveMs = lastActiveLo * 1000; // on-chain timestamp → ms
      const now = Date.now();

      // Immediately remove ghost players: if last_active on-chain is older than
      // 90s the player is offline (crashed/disconnected without clean logout).
      // This is more reliable than waiting for pruneStale() which only runs
      // every 15s and requires lastUpdate to have been set correctly first.
      const GHOST_THRESHOLD_MS = 90_000;
      if (now - lastActiveMs > GHOST_THRESHOLD_MS) {
        if (this.knownPlayers.has(walletStr)) {
          console.log(`[Multiplayer] pruning ghost player ${walletStr.slice(0,8)} (inactive ${Math.round((now - lastActiveMs) / 1000)}s)`);
          this.handlePlayerLeave(walletStr);
        }
        return;
      }

      // Only update if this data is newer than what we have.
      const existing = this.knownPlayers.get(walletStr);
      const onChainTs = lastActiveLo; // u32 unix seconds
      if (existing && (existing as any)._onChainTs !== undefined) {
        if (onChainTs < (existing as any)._onChainTs) return; // stale — skip
      }

      const isWalking = existing !== undefined && (x !== existing.x || y !== existing.y);
      this.handlePlayerMove(walletStr, x, y, direction, isWalking, displayName, undefined, lastActiveMs);
      const updated = this.knownPlayers.get(walletStr);
      if (updated) (updated as any)._onChainTs = onChainTs;
    } catch {
      // Corrupt or unrecognized account — skip silently
    }
  }

  // ── Position transaction (Magic Router) ──────────────────────────────

  private async sendPositionTransaction(x: number, y: number, direction: number): Promise<string | null> {
    if (!this.wallet) return null;

    const sessionKey = this.sessionKeys.getSessionPublicKey();
    const ix = buildUpdatePositionSessionIx(
      this.wallet, sessionKey,
      Math.round(x), Math.round(y), direction,
    );
    const tx = new Transaction().add(ix);
    tx.feePayer = sessionKey;

    // Helper: race a promise against a timeout so a hanging RPC call never
    // blocks position updates indefinitely (was causing "pending forever" bug).
    const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> => {
      return Promise.race([
        p,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error("rpc timeout")), ms)
        ),
      ]);
    };

    if (this.useEphemeral) {
      // Fast path: Magic Router → ephemeral rollup (sub-50ms when healthy).
      // useEphemeral is set only after a confirmed on-chain delegation check.
      try {
        const { blockhash } = await withTimeout(
          this.routerConnection.getLatestBlockhashForTransaction(
            new Transaction().add(ix)
          ),
          3_000, // 3s timeout — fall through to base layer on ephemeral RPC issues
        );
        tx.recentBlockhash = blockhash;
        this.sessionKeys.signTransaction(tx);
        return await withTimeout(
          this.routerConnection.sendRawTransaction(tx.serialize(), { skipPreflight: true }),
          3_000,
        );
      } catch (err: any) {
        console.warn("[Multiplayer] ephemeral tx failed, falling back to base layer:", err?.message);
        this.useEphemeral = false; // temporary degradation — resets on next connect
      }
    }

    // Base layer path (undelegated PDAs or ephemeral fallback).
    const { blockhash } = await withTimeout(this.baseConnection.getLatestBlockhash(), 5_000);
    tx.recentBlockhash = blockhash;
    this.sessionKeys.signTransaction(tx);
    return this.baseConnection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
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
      // IMPORTANT: do NOT resolve with a fake signature — passing non-base58
      // strings to confirmTransaction / getSignatureStatus triggers a tweetnacl
      // "Assertion failed" that escapes try/catch.  Reject instead so callers
      // fall through to their catch blocks and gracefully enter offline mode.
      const bus = (globalThis as any).__solCityGameEvents as Phaser.Events.EventEmitter | undefined;
      if (!bus) {
        clearTimeout(timeout);
        reject(new Error("wallet bus not available — session offline"));
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
    wallet: string, x: number, y: number, d: number, m: boolean, name?: string, score?: number
  ): void {
    if (this.knownPlayers.has(wallet)) {
      this.handlePlayerMove(wallet, x, y, d, m, name, score);
      return;
    }
    const player: OnChainPlayer = {
      wallet, x, y, direction: d, isWalking: m,
      lastUpdate: Date.now(), displayName: name, score,
    };
    this.knownPlayers.set(wallet, player);
    for (const cb of this.addCallbacks) cb(wallet, player);
    this.subscribeToPlayerWallet(wallet);
  }

  private handlePlayerMove(
    wallet: string, x: number, y: number, d: number, m: boolean,
    name?: string, score?: number,
    /** On-chain last_active in ms — used for prune detection. Falls back to
     *  Date.now() for BroadcastChannel messages that have no on-chain timestamp. */
    onChainLastActiveMs?: number,
  ): void {
    // Use on-chain last_active so pruneStale can detect crashed/offline players.
    // If we always use Date.now(), polling keeps refreshing lastUpdate and ghost
    // players (crashed browsers) are never removed.
    const lastUpdate = onChainLastActiveMs ?? Date.now();

    let player = this.knownPlayers.get(wallet);
    if (!player) {
      player = { wallet, x, y, direction: d, isWalking: m, lastUpdate, displayName: name, score };
      this.knownPlayers.set(wallet, player);
      for (const cb of this.addCallbacks) cb(wallet, player);
      this.subscribeToPlayerWallet(wallet);
      return;
    }
    player.x = x; player.y = y; player.direction = d; player.isWalking = m;
    player.lastUpdate = lastUpdate;
    if (name) player.displayName = name;
    if (score !== undefined) player.score = score;
    for (const cb of this.changeCallbacks) cb(wallet, player);
  }

  /** Subscribe to base layer onAccountChange for a specific player's PDA. */
  private subscribeToPlayerWallet(wallet: string): void {
    try {
      const walletPub = new PublicKey(wallet);
      const [pda] = derivePlayerPDA(walletPub);
      const key = pda.toBase58();
      if (!this.accountSubs.has(key)) {
        const subId = this.baseConnection.onAccountChange(
          pda,
          (info) => this.decodeAndUpdatePlayer(key, info.data),
          "confirmed",
        );
        this.accountSubs.set(key, subId);
      }
    } catch { /* ignore invalid wallet */ }
  }

  private handlePlayerLeave(wallet: string): void {
    if (!this.knownPlayers.has(wallet)) return;
    this.knownPlayers.delete(wallet);
    for (const cb of this.removeCallbacks) cb(wallet);
  }

  private pruneStale(): void {
    const cutoff = Date.now() - 60_000; // 60s without update = offline (was 20s)
    for (const [wallet, player] of this.knownPlayers) {
      if (wallet === this.wallet?.toBase58()) continue;
      if (player.lastUpdate < cutoff) this.handlePlayerLeave(wallet);
    }
  }
}
