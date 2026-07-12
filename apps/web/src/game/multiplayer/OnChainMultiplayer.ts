import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

// Solana Memo program — same address on mainnet and devnet
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
// Chat message prefix in memo data
const CHAT_PREFIX = "solcity-chat:";
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

// Throttle position broadcasts. 500ms = 2 tx/s — stays under devnet ER rate limits.
const POS_THROTTLE_MS = 500;

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
  // Wallets temporarily blocked from re-discovery after ghost-pruning.
  // Prevents the add→prune→rediscover cycle for accounts with stale on-chain timestamps.
  private blockedPlayers = new Map<string, number>(); // wallet → unblock-at epoch ms

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
    if (this._connected) return; // prevent duplicate initialization from wallet adapter re-fires
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

    // Not connected — log sim entry so the activity log stays active without a wallet
    if (!this._connected || !this.wallet) {
      transactionLog.recordMove({ signature: "sim:move", status: "confirmed" });
      return;
    }

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
          if (sig) {
            transactionLog.markConfirmed(entry.id, sig);
            // Log first confirmed tx so we know writes are working
            if (!(this as any)._firstConfirmed) {
              (this as any)._firstConfirmed = true;
              console.log("[Multiplayer] ✓ first position tx confirmed:", sig.slice(0,12));
            }
          } else {
            transactionLog.markFailed(entry.id, "null signature");
            console.warn("[Multiplayer] position tx returned null sig");
          }
        })
        .catch(err => {
          transactionLog.markFailed(entry.id, err?.message ?? "tx failed");
          if ((this as any)._posErrCount === undefined) (this as any)._posErrCount = 0;
          if (++(this as any)._posErrCount <= 3) {
            console.warn("[Multiplayer] position tx failed:", err?.message);
          }
        });
    } else {
      transactionLog.recordMove({ signature: "sim:move", status: "confirmed" });
    }
  }

  sendChat(text: string): void {
    if (!this.wallet) return;
    // Layer 1: BroadcastChannel (same browser, instant)
    this.bc?.postMessage({ t: "chat", w: this.wallet.toBase58(), text } satisfies BCMsg);
    // Layer 2: Solana Memo (cross-browser, ~500ms latency)
    if (isProgramDeployed()) {
      this.sendChatMemo(text).catch(() => {}); // fire-and-forget
    }
  }

  /**
   * Sends a Solana Memo transaction so other browsers receive the chat.
   * The memo text is: "solcity-chat:DISPLAY_NAME:MESSAGE"
   * The player PDA is included as a readonly account so getSignaturesForAddress
   * on the PDA returns this tx — used for polling fallback.
   * Primary channel: onLogs subscription fires in near real-time.
   */
  private async sendChatMemo(text: string): Promise<void> {
    if (!this.wallet) return;
    const sessionKey = this.sessionKeys.getSessionPublicKey();
    const [pda] = derivePlayerPDA(this.wallet);
    const displayName = this.knownPlayers.get(this.wallet.toBase58())?.displayName
      ?? this.wallet.toBase58().slice(0, 8);

    const memoText = `${CHAT_PREFIX}${displayName}:${text.slice(0, 200)}`;
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: sessionKey, isSigner: true,  isWritable: false },
        { pubkey: pda,        isSigner: false, isWritable: false }, // for signature lookup
      ],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memoText, "utf-8"),
    });
    const tx = new Transaction().add(ix);
    tx.feePayer = sessionKey;
    const { blockhash } = await this.baseConnection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    this.sessionKeys.signTransaction(tx);
    await this.baseConnection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  }

  /** Subscribe to Memo program logs for real-time cross-browser chat. */
  private subscribeCrossNetworkChat(): void {
    try {
      this.baseConnection.onLogs(
        MEMO_PROGRAM_ID,
        (logs) => {
          if (logs.err) return;
          for (const log of logs.logs) {
            // Memo program emits: 'Program log: Memo (len N): "TEXT"'
            const match = log.match(/Memo \(\d+ bytes\):\s*"(.+)"/);
            if (!match) continue;
            const raw = match[1];
            if (!raw.startsWith(CHAT_PREFIX)) continue;

            const withoutPrefix = raw.slice(CHAT_PREFIX.length);
            const colon = withoutPrefix.indexOf(":");
            if (colon === -1) continue;
            const senderName = withoutPrefix.slice(0, colon);
            const message    = withoutPrefix.slice(colon + 1);

            // Emit as a chat event so CityScene handles it
            const bus = (globalThis as any).__solCityGameEvents;
            bus?.emit("chat:network", { name: senderName, text: message });
          }
        },
        "confirmed",
      );
      console.log("[Multiplayer] cross-browser chat subscription active");
    } catch (err) {
      console.warn("[Multiplayer] chat subscription failed:", err);
    }
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

  /** Returns what we know about one player (for the click-to-view profile card). */
  getPlayer(wallet: string): OnChainPlayer | undefined {
    return this.knownPlayers.get(wallet);
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

    // Close any stale channel before creating a new one — prevents duplicate listeners
    // that accumulate when connect() is called more than once in the same session.
    this.bc?.close();
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
        // Pass routerConnection as altConnection so authorize_session is broadcast
        // to both base layer AND the ER router, registering the session key on
        // the ephemeral rollup. Without this, commitAndUndelegate fails with
        // "unknown signer" because the ER doesn't know the current session key.
        await this.sessionKeys.authorize(wallet, this.baseConnection, this.routerConnection, needsFunding ? SESSION_FUND_LAMPORTS : 0);
        console.log("✓ session authorized");
      }
    } catch (err: any) {
      console.warn("✗ init/auth failed:", err?.message);
    }

    // Check if PDA is already delegated to the ephemeral rollup (on-chain, reliable).
    let isDelegated = false;
    try {
      const delegationRecord = delegationRecordPdaFromDelegatedAccount(playerPDA);
      const recordInfo = await this.baseConnection.getAccountInfo(delegationRecord);
      isDelegated = recordInfo !== null;
      console.log(`${isDelegated ? "✓ delegated" : "○ not delegated"} (on-chain check)`);
    } catch (e: any) {
      console.log("○ delegation check failed:", e?.message);
    }

    // Delegate or reuse delegation so position writes go to the ephemeral rollup.
    try {
      if (!isDelegated) {
        console.log("… delegating PDA to ephemeral rollup (1 sign prompt)");
        await this.delegateToEphemeral(wallet);
        const delegationRecord = delegationRecordPdaFromDelegatedAccount(playerPDA);
        const info = await this.baseConnection.getAccountInfo(delegationRecord);
        this.useEphemeral = info !== null;
      } else {
        this.useEphemeral = true;
        console.log("✓ already delegated — using ephemeral rollup");
      }
    } catch (err: any) {
      console.warn("○ delegation skipped:", err?.message);
      this.useEphemeral = false;
    }
    console.log(`→ position layer: ${this.useEphemeral ? "🚀 EPHEMERAL ROLLUP" : "📡 BASE DEVNET"}`);
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

    // 6. Cross-browser chat via Solana Memo + onLogs
    this.subscribeCrossNetworkChat();

    // 7. Force a presence broadcast on next sendInput tick
    this.lastPos = { x: -1, y: -1, direction: -1, isWalking: false };
  }

  /** Discover players whose PDAs exist on devnet base layer. */
  private async discoverPlayersFromBase(self: PublicKey): Promise<void> {
    try {
      const accounts = await this.baseConnection.getProgramAccounts(
        SOL_CITY_PROGRAM_ID,
        { commitment: "confirmed" }
      );
      console.log(`[Multiplayer] getProgramAccounts: ${accounts.length} account(s) on base layer`);
      let added = 0;
      for (const { pubkey, account } of accounts) {
        const before = this.knownPlayers.size;
        this.decodeAndUpdatePlayer(pubkey.toBase58(), account.data);
        if (this.knownPlayers.size > before) added++;
      }
      if (added > 0) console.log(`[Multiplayer] discovery: ${added} new player(s) added`);
    } catch (err: any) {
      console.warn("[Multiplayer] base discovery FAILED:", err?.message);
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
      kind: "undelegate", layer: "ephemeral",
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
      // PDA is back on base layer — safe to rotate session key now so the next
      // connect can re-authorize a fresh key on base layer before re-delegating.
      this.sessionKeys.rotateKey();
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

      // last_active (i64 — read lower 4 bytes; fits in u32 until year 2106)
      const lastActiveLo = buf.readUInt32LE(offset);
      const lastActiveMs = lastActiveLo * 1000; // on-chain Unix seconds → ms

      if (walletStr === this.wallet?.toBase58()) return; // skip self
      const now = Date.now();

      // Skip wallets that were recently ghost-pruned — prevents the rapid
      // add→prune→rediscover cycle for accounts with stale on-chain timestamps
      // (e.g. ER-active players whose base-layer last_active is old, or dead
      // test accounts that keep appearing via getProgramAccounts).
      const blockedUntil = this.blockedPlayers.get(walletStr);
      if (blockedUntil !== undefined) {
        if (now < blockedUntil) return; // still blocked
        this.blockedPlayers.delete(walletStr); // block expired — allow re-discovery
      }

      const GHOST_THRESHOLD_MS = 120_000; // 2 minutes on-chain inactivity
      const BLOCK_DURATION_MS  = 600_000; // 10 minutes before we try again
      const isKnown = this.knownPlayers.has(walletStr);
      if (isKnown && now - lastActiveMs > GHOST_THRESHOLD_MS) {
        console.log(`[Multiplayer] ghost-pruning ${walletStr.slice(0,8)} (${Math.round((now - lastActiveMs) / 60_000)}min stale) — blocked for 10 min`);
        this.handlePlayerLeave(walletStr);
        this.blockedPlayers.set(walletStr, now + BLOCK_DURATION_MS);
        return;
      }

      // Only update if this data is newer than what we have.
      const existing = this.knownPlayers.get(walletStr);
      const onChainTs = lastActiveLo; // u32 unix seconds
      if (existing && (existing as any)._onChainTs !== undefined) {
        if (onChainTs < (existing as any)._onChainTs) return; // stale — skip
      }

      const isWalking = existing !== undefined && (x !== existing.x || y !== existing.y);
      this.handlePlayerMove(walletStr, x, y, direction, isWalking, displayName);
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
      // Direct path to ephemeral RPC — returns a real ER tx hash indexable on
      // explorer.magicblock.app. The router path returned opaque router IDs.
      try {
        const { blockhash } = await withTimeout(
          this.ephemeralConnection.getLatestBlockhash(),
          3_000,
        );
        tx.recentBlockhash = blockhash;
        this.sessionKeys.signTransaction(tx);
        const sig = await withTimeout(
          this.ephemeralConnection.sendRawTransaction(tx.serialize(), { skipPreflight: true }),
          3_000,
        );
        // Fire-and-forget confirmation — lets us see in console if the ER instruction
        // actually succeeded (vs. just being accepted into the queue with skipPreflight).
        this.ephemeralConnection.confirmTransaction(sig, "confirmed").then(r => {
          if (r.value.err) {
            console.warn("[Multiplayer] ER tx FAILED on-chain:", sig.slice(0, 12), r.value.err);
          }
        }).catch(() => {});
        return sig;
      } catch (err: any) {
        // Don't permanently disable ER — rate limits and transient errors clear up.
        // Return null so the log entry is marked failed; next throttle interval retries.
        console.warn("[Multiplayer] ephemeral tx skipped:", err?.message);
        return null;
      }
    }

    // Base layer path — only used when delegation is not active.
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
  ): void {
    // Always use Date.now() for lastUpdate so polling keeps players visible
    // even when on-chain writes are temporarily failing (e.g. delegated PDAs).
    // Ghost removal is handled by the 2-min threshold in decodeAndUpdatePlayer.
    const lastUpdate = Date.now();

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
    const cutoff = Date.now() - 300_000; // 5 min — generous window for unreliable writes
    for (const [wallet, player] of this.knownPlayers) {
      if (wallet === this.wallet?.toBase58()) continue;
      if (player.lastUpdate < cutoff) this.handlePlayerLeave(wallet);
    }
  }
}
