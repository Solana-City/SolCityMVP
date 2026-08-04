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
import { derivePlayerPDA, SOL_CITY_PROGRAM_ID, DELEGATION_PROGRAM_ID } from "../solana/program";
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
  /** Poll/discovery timers — cleared on disconnect so they don't stack across reconnects. */
  private discoveryTimers: ReturnType<typeof setInterval>[] = [];
  /** Program-wide and chat-log subscriptions — removed on disconnect. The
   *  wallet adapter can cycle connect/disconnect rapidly; leaking one
   *  subscription per cycle is what trips devnet's connection-level rate
   *  limit ("Connection rate limits exceeded"). */
  private programSubId: number | null = null;
  private logsSubId: number | null = null;

  constructor() {
    this.routerConnection    = new ConnectionMagicRouter(ENDPOINTS.magicRouter,  "confirmed");
    this.ephemeralConnection = new Connection(ENDPOINTS.ephemeral,    "confirmed");
    // disableRetryOnRateLimit: web3.js otherwise auto-retries 429s with its
    // own delays ("Retrying after 2000ms..." console spam), stacking on top
    // of our polling intervals and extending the rate-limit window. Our
    // exponential backoff below is the single retry authority.
    this.baseConnection      = new Connection(ENDPOINTS.solanaDevnet, {
      commitment: "confirmed",
      disableRetryOnRateLimit: true,
    });
    this.sessionKeys         = new SessionKeyManager();
  }

  // ── Base-layer RPC backoff ────────────────────────────────────────────
  // api.devnet.solana.com rate-limits aggressively. When it returns 429 we
  // back off exponentially (5s → 60s) instead of hammering it — hammering
  // extends the ban, which makes discovery fail, which makes remote players
  // flap in and out of the city.
  private rpcBackoffMs = 0;
  private rpcBackoffUntil = 0;

  private rpcAvailable(): boolean {
    return Date.now() >= this.rpcBackoffUntil;
  }

  private noteRpcSuccess(): void {
    this.rpcBackoffMs = 0;
  }

  private isRateLimitError(err: unknown): boolean {
    const msg = (err as Error)?.message ?? String(err);
    return msg.includes("429") || /too many requests|rate limit/i.test(msg);
  }

  private noteRpcError(err: unknown): void {
    if (!this.isRateLimitError(err)) return;
    this.rpcBackoffMs = Math.min(Math.max(this.rpcBackoffMs * 2, 5_000), 60_000);
    this.rpcBackoffUntil = Date.now() + this.rpcBackoffMs;
    console.warn(`[Multiplayer] devnet RPC rate-limited — backing off ${this.rpcBackoffMs / 1000}s`);
  }

  /**
   * Runs a base-layer RPC call with retries on 429. The recurring pollers
   * simply skip rate-limited ticks, but the one-shot connect sequence
   * (init / authorize / delegate) must eventually succeed or the session
   * silently degrades to the base-layer fallback for its whole lifetime —
   * exactly what a transient 429 during the connect burst was causing.
   */
  private async baseRpcWithRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      // Honor the global backoff window, plus a growing delay between tries.
      const wait = Math.max(this.rpcBackoffUntil - Date.now(), i === 0 ? 0 : 2_000 * i);
      if (wait > 0) await new Promise(r => setTimeout(r, Math.min(wait, 15_000)));
      try {
        const res = await fn();
        this.noteRpcSuccess();
        return res;
      } catch (err) {
        lastErr = err;
        this.noteRpcError(err);
        if (!this.isRateLimitError(err)) throw err; // real error — don't mask it
      }
    }
    throw lastErr;
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

    // Unsubscribe per-player account listeners. Subs are created on the
    // base connection (subscribeToPlayerWallet) or the ephemeral one
    // (subscribeToPlayer) — try both; removing an unknown id is a no-op.
    for (const subId of this.accountSubs.values()) {
      this.baseConnection.removeAccountChangeListener(subId).catch(() => {});
      this.ephemeralConnection.removeAccountChangeListener(subId).catch(() => {});
    }
    this.accountSubs.clear();

    // Remove the program-wide and chat-log subscriptions — leaking these
    // across reconnect cycles exhausts devnet's connection-level rate limit.
    if (this.programSubId !== null) {
      this.baseConnection.removeProgramAccountChangeListener(this.programSubId).catch(() => {});
      this.programSubId = null;
    }
    if (this.logsSubId !== null) {
      this.baseConnection.removeOnLogsListener(this.logsSubId).catch(() => {});
      this.logsSubId = null;
    }

    if (this.cleanupInterval) { clearInterval(this.cleanupInterval); this.cleanupInterval = null; }
    for (const t of this.discoveryTimers) clearInterval(t);
    this.discoveryTimers = [];

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

  /**
   * Manual recovery: forces a fresh commit_and_undelegate + full reconnect,
   * even mid-session. Use this to unstick a wallet whose PDA is delegated
   * from a session that never cleanly undelegated (e.g. a closed tab) —
   * without it, that wallet's every future connect attempt skips
   * delegate_pda entirely (it already looks delegated) and never re-prompts
   * for a fresh delegation signature.
   */
  async resetSession(): Promise<void> {
    if (!this.wallet) throw new Error("resetSession: not connected");
    const wallet = this.wallet;
    const displayName = this.knownPlayers.get(wallet.toBase58())?.displayName;
    const [playerPDA] = derivePlayerPDA(wallet);

    this.disconnect();

    // Poll the BASE layer until ownership actually reverts to our program —
    // a fixed sleep here previously reconnected before the ephemeral
    // rollup's commit+undelegate had settled. Reconnecting too early reads
    // the PDA as still delegated, so the client skips delegate_pda and
    // re-authorizes on the (about to be torn down) old rollup session
    // instead — moves work for a bit, then start failing once the rollup
    // actually finishes undelegating out from under it.
    const maxAttempts = 15; // ~12s worst case
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 800));
      try {
        const info = await this.baseRpcWithRetry(() => this.baseConnection.getAccountInfo(playerPDA));
        if (info && !info.owner.equals(DELEGATION_PROGRAM_ID)) {
          console.log(`[Multiplayer] undelegate settled on base layer after ${(i + 1) * 800}ms`);
          break;
        }
      } catch { /* keep polling */ }
      if (i === maxAttempts - 1) {
        console.warn("[Multiplayer] undelegate didn't settle in time — reconnecting anyway");
      }
    }

    await this.connect(wallet, displayName);
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
      // Record the layer this move will actually be sent to — when
      // delegation failed and we fall back to base devnet, the explorer
      // link must query base, not the ER (which would show nothing).
      const entry = transactionLog.recordMove({
        status: "pending",
        layer: this.useEphemeral ? "ephemeral" : "base",
      });
      this.sendPositionTransaction(x, y, dirNum)
        .then(sig => {
          if (sig) {
            this.trackMoveConfirmation(entry.id, sig);
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
    if (this.logsSubId !== null) return; // already subscribed — don't stack
    try {
      this.logsSubId = this.baseConnection.onLogs(
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

    // 1. Read PDA + delegation state FIRST — where the live copy of the
    //    account resides decides which cluster authorize_session must target.
    //    A delegated PDA is owned by the delegation program on base, so a
    //    base-layer authorize can never write it; and the ER rejects txs
    //    built with base blockhashes. The old "broadcast to both" approach
    //    therefore updated NEITHER copy, leaving the ER with a stale session
    //    key and every move failing with InvalidSessionKey (custom 6000).
    let isDelegated = false;
    try {
      const existing = await this.baseRpcWithRetry(() => this.baseConnection.getAccountInfo(playerPDA));

      // Read delegation status straight off the account we already fetched
      // (owner == delegation program while delegated) instead of a second,
      // independently-fallible lookup. That second lookup used to swallow
      // RPC errors (rate limits, network blips) and silently default to
      // "not delegated" — which then sent authorize_session to the base
      // layer against an account it no longer owns, failing every time with
      // AccountOwnedByWrongProgram (custom 3007). One fetch, no failure mode.
      if (existing) {
        isDelegated = existing.owner.equals(DELEGATION_PROGRAM_ID);
        console.log(`${isDelegated ? "✓ delegated" : "○ not delegated"} (owner check)`);
      }

      const sessionKey = this.sessionKeys.getSessionPublicKey();
      const name = displayName ?? walletStr.slice(0, 8);

      const SESSION_FUND_LAMPORTS = 5_000_000; // 0.005 SOL — covers ~1000 position updates
      const sessionBalance = await this.baseConnection.getBalance(sessionKey).catch(() => 0);
      const needsFunding = sessionBalance < 500_000;

      if (!existing) {
        console.log("… new player — init + auth" + (needsFunding ? " + fund" : "") + " (1 sign prompt)");
        const { blockhash } = await this.baseRpcWithRetry(() => this.baseConnection.getLatestBlockhash());
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
      } else if (!isDelegated) {
        console.log("✓ PDA on base — auth" + (needsFunding ? " + fund (1 sign prompt)" : " (may skip if cached)"));
        await this.sessionKeys.authorize(wallet, this.baseConnection, undefined, needsFunding ? SESSION_FUND_LAMPORTS : 0);
        console.log("✓ session authorized");
      } else {
        // Delegated: the ER copy is the authoritative session state.
        // Re-authorize on the rollup only if its stored key differs from ours
        // — when in sync this whole branch needs no wallet prompt.
        await this.syncSessionKeyOnEr(wallet, playerPDA);
        if (needsFunding) {
          console.log("… funding session key (1 sign prompt)");
          const { blockhash } = await this.baseRpcWithRetry(() => this.baseConnection.getLatestBlockhash());
          const fundTx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet })
            .add(SystemProgram.transfer({ fromPubkey: wallet, toPubkey: sessionKey, lamports: SESSION_FUND_LAMPORTS }));
          const sig = await this.requestWalletSign(fundTx);
          await this.confirmReal(this.baseConnection, sig);
        }
      }
    } catch (err: any) {
      console.warn("✗ init/auth failed:", err?.message);
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

    // Source of truth for the write layer is the account OWNER, not the
    // delegation-record probe above (which can 429 and wrongly leave
    // useEphemeral=false). A delegated PDA is owned by the delegation program
    // and can ONLY be written on the ER — a base write always fails with
    // AccountOwnedByWrongProgram (custom 3007), which is exactly the "dropped"
    // base moves we saw. If the PDA is delegated on-chain, force ER.
    try {
      const owner = (await this.baseConnection.getAccountInfo(playerPDA))?.owner;
      if (owner && owner.equals(DELEGATION_PROGRAM_ID) && !this.useEphemeral) {
        console.log("✓ PDA delegated on-chain — forcing ER writes (base would 3007)");
        this.useEphemeral = true;
      }
    } catch { /* keep the decision above */ }

    console.log(`→ position layer: ${this.useEphemeral ? "🚀 EPHEMERAL ROLLUP" : "📡 BASE DEVNET"}`);
    console.groupEnd();

    // 2. Discover existing players via base layer getProgramAccounts.
    //    Deferred a few seconds: the connect sequence just fired a burst of
    //    base-layer calls, and getProgramAccounts on top of it is what tips
    //    the public RPC into 429 — which used to kill delegation itself.
    setTimeout(() => this.discoverPlayersFromBase(wallet), 3_000);

    // 3. Subscribe to base layer program account changes (standard Solana devnet WebSocket)
    try {
      if (this.programSubId === null) {
        this.programSubId = this.baseConnection.onProgramAccountChange(
          SOL_CITY_PROGRAM_ID,
          (keyedInfo) => {
            this.decodeAndUpdatePlayer(keyedInfo.accountId.toBase58(), keyedInfo.accountInfo.data);
          },
          "confirmed",
        );
        console.log("[Multiplayer] base layer subscription active");
      }
    } catch (err) {
      console.warn("[Multiplayer] subscription failed:", err);
    }

    // 4. Batched PDA polling every 5s — fallback for when
    //    onProgramAccountChange doesn't fire on the RPC node.
    //    (One getMultipleAccountsInfo call per tick, not N getAccountInfo.)
    for (const t of this.discoveryTimers) clearInterval(t);
    this.discoveryTimers = [
      // Poll live positions from the ER (fast, sub-100ms) — this is the
      // real-time load now that reads come off the rollup, not frozen base.
      setInterval(() => this.pollKnownPlayerPDAs(wallet), 1_500),
      // Refresh the online roster from the ER. getProgramAccounts on the ER is
      // cheap (~20ms) and returns exactly the delegated (online) players.
      setInterval(() => this.discoverPlayersFromBase(wallet), 12_000),
    ];

    // 6. Cross-browser chat via Solana Memo + onLogs
    this.subscribeCrossNetworkChat();

    // 7. Force a presence broadcast on next sendInput tick
    this.lastPos = { x: -1, y: -1, direction: -1, isWalking: false };
  }

  /**
   * Discovers the ONLINE roster from the ER. Delegated player PDAs live on the
   * rollup with fresh positions; the base copy of a delegated account is frozen
   * at its pre-delegation state (spawn) — base discovery is why everyone showed
   * up stuck at 512,288. The ER is the authoritative live view.
   * (Method name kept for its callers.)
   */
  private async discoverPlayersFromBase(_self: PublicKey): Promise<void> {
    try {
      const accounts = await this.ephemeralConnection.getProgramAccounts(
        SOL_CITY_PROGRAM_ID,
        { commitment: "confirmed" }
      );
      console.log(`[Multiplayer] ER getProgramAccounts: ${accounts.length} online player(s)`);
      let added = 0;
      for (const { pubkey, account } of accounts) {
        const before = this.knownPlayers.size;
        this.decodeAndUpdatePlayer(pubkey.toBase58(), account.data);
        if (this.knownPlayers.size > before) added++;
      }
      if (added > 0) console.log(`[Multiplayer] discovery: ${added} new player(s)`);
    } catch (err: any) {
      console.warn("[Multiplayer] ER discovery failed:", err?.message);
    }
  }

  /**
   * Polls the PDAs of every known player in ONE batched RPC call
   * (getMultipleAccountsInfo) — fallback for when onProgramAccountChange
   * doesn't fire on the RPC node. Batching is the biggest 429 saver: the
   * previous per-player getAccountInfo fan-out multiplied request volume by
   * the number of players every 2 seconds.
   */
  private async pollKnownPlayerPDAs(self: PublicKey): Promise<void> {
    const selfStr = self.toBase58();
    const wallets = [...this.knownPlayers.keys()].filter(w => w !== selfStr);
    if (wallets.length === 0) return;

    try {
      // Read from the ER, not base: the ER copy carries live positions; the
      // base copy of a delegated PDA is frozen at spawn.
      const pdas = wallets.map(w => derivePlayerPDA(new PublicKey(w))[0]);
      const infos = await this.ephemeralConnection.getMultipleAccountsInfo(pdas, "confirmed");
      infos.forEach((info, i) => {
        if (info) this.decodeAndUpdatePlayer(pdas[i].toBase58(), info.data);
      });
    } catch { /* transient ER read error — next tick retries */ }
  }

  // Only one move verification runs at a time, and after a verified success
  // we trust the pipe for VERIFY_HEALTHY_WINDOW_MS before sampling again —
  // moves arrive at up to 2/s and each verification polls for a few seconds,
  // so verifying every signature would meaningfully raise RPC volume. A
  // systemic failure (unauthorized session key, dropped txs) still surfaces
  // within one sample window and turns the batch red in the UI.
  private static readonly VERIFY_HEALTHY_WINDOW_MS = 10_000;
  private moveVerifyBusy = false;
  private lastVerifyOkAt = 0;
  private firstVerifiedLogged = false;

  /**
   * Learns what actually happened to a move tx sent with skipPreflight.
   * sendRawTransaction always returns the tx's own signature (it is derived
   * from the signed bytes, not assigned by the node), so holding a signature
   * proves nothing. getSignatureStatuses distinguishes the three outcomes:
   *   status with err  → executed and failed (session key problem, etc.)
   *   status without err → landed successfully
   *   status null after retries → dropped, never processed — this is exactly
   *     the case where the explorer shows an empty/unknown transaction.
   */
  private async trackMoveConfirmation(entryId: string, sig: string): Promise<void> {
    // Attach the signature immediately so the explorer link exists while pending.
    transactionLog.attachSignature(entryId, sig);

    if (
      this.moveVerifyBusy ||
      Date.now() - this.lastVerifyOkAt < OnChainMultiplayer.VERIFY_HEALTHY_WINDOW_MS
    ) {
      // Sampled out — a recent or in-flight verification covers systemic failures.
      transactionLog.markConfirmed(entryId, sig);
      return;
    }
    this.moveVerifyBusy = true;
    try {
      const conn = this.useEphemeral ? this.ephemeralConnection : this.baseConnection;
      for (const delayMs of [800, 1500, 3000]) {
        await new Promise(r => setTimeout(r, delayMs));
        const st = await conn.getSignatureStatuses([sig]);
        const s = st?.value?.[0];
        if (s) {
          if (s.err) {
            transactionLog.markFailed(entryId, `on-chain error: ${JSON.stringify(s.err)}`);
            console.warn("[Multiplayer] move tx FAILED on-chain:", sig.slice(0, 12), s.err);
            this.lastVerifyOkAt = 0; // unhealthy — verify the next move too
          } else {
            transactionLog.markConfirmed(entryId, sig);
            this.lastVerifyOkAt = Date.now();
            if (!this.firstVerifiedLogged) {
              this.firstVerifiedLogged = true;
              console.log("[Multiplayer] ✓ first position tx verified on-chain:", sig.slice(0, 12));
            }
          }
          return;
        }
      }
      transactionLog.markFailed(entryId, "dropped — never landed on the rollup");
      console.warn("[Multiplayer] move tx dropped (no status after 5s):", sig.slice(0, 12));
      this.lastVerifyOkAt = 0; // unhealthy — verify the next move too
    } catch {
      // Status RPC unavailable — keep the optimistic confirm rather than
      // reporting a failure we haven't observed.
      transactionLog.markConfirmed(entryId, sig);
    } finally {
      this.moveVerifyBusy = false;
    }
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

  /**
   * Reads session_authority from a raw PlayerState buffer.
   * Layout: 8-byte discriminator + 32-byte authority + Option<Pubkey>
   * (1-byte tag at offset 40, 32-byte key at 41 when tag = 1).
   */
  private readSessionAuthority(data: Buffer | Uint8Array): PublicKey | null {
    const buf = Buffer.from(data);
    if (buf.length < 8 + 32 + 33) return null;
    if (buf.readUInt8(40) !== 1) return null;
    return new PublicKey(buf.slice(41, 73));
  }

  /**
   * Ensures the ER's copy of the player PDA authorizes the CURRENT session
   * key. While delegated, that copy is the authoritative session state:
   * the base account is owned by the delegation program (unwritable by our
   * program), so the fix has to run on the rollup itself — ER blockhash,
   * wallet signs locally (sign-only bridge), sent to the ER endpoint.
   */
  private async syncSessionKeyOnEr(wallet: PublicKey, playerPDA: PublicKey): Promise<void> {
    const sessionKey = this.sessionKeys.getSessionPublicKey();

    let erSession: PublicKey | null = null;
    try {
      const info = await OnChainMultiplayer.withTimeout(
        this.ephemeralConnection.getAccountInfo(playerPDA), 5_000
      );
      erSession = info ? this.readSessionAuthority(info.data) : null;
    } catch (e: any) {
      console.warn("○ ER PDA read failed:", e?.message);
    }

    if (erSession && erSession.equals(sessionKey)) {
      this.sessionKeys["authorized"] = true;
      console.log("✓ ER session key in sync — no prompt needed");
      return;
    }

    console.log(
      `… ER session key ${erSession ? `stale (${erSession.toBase58().slice(0, 8)}… on ER)` : "unreadable"}` +
      " — re-authorizing on the rollup (1 sign prompt)"
    );
    const ix = buildAuthorizeSessionIx(wallet, sessionKey);
    const { blockhash } = await OnChainMultiplayer.withTimeout(
      this.ephemeralConnection.getLatestBlockhash(), 5_000
    );
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet }).add(ix);
    const signed = await this.requestWalletSignOnly(tx);
    const sig = await this.ephemeralConnection.sendRawTransaction(signed.serialize(), {
      skipPreflight: true,
    });

    // Verify it landed — a silent drop here would leave every subsequent
    // move failing with InvalidSessionKey again.
    for (const delayMs of [800, 1500, 3000]) {
      await new Promise(r => setTimeout(r, delayMs));
      const st = await this.ephemeralConnection.getSignatureStatuses([sig]);
      const s = st?.value?.[0];
      if (s) {
        if (s.err) throw new Error(`ER authorize failed: ${JSON.stringify(s.err)}`);
        this.sessionKeys["authorized"] = true;
        console.log("✓ session key re-authorized on ER:", sig.slice(0, 12));
        return;
      }
    }
    throw new Error("ER authorize dropped — no status after 5s");
  }

  private async delegateToEphemeral(wallet: PublicKey): Promise<void> {
    const entry = transactionLog.record({
      kind: "delegate", layer: "base",
      label: "Delegate PDA → Ephemeral Rollup", status: "pending",
    });
    try {
      const ix = buildDelegateIx(wallet);
      const { blockhash } = await this.baseRpcWithRetry(() => this.baseConnection.getLatestBlockhash());
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

  // Helper: race a promise against a timeout so a hanging RPC call never
  // blocks position updates indefinitely (was causing "pending forever" bug).
  private static withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error("rpc timeout")), ms)
      ),
    ]);
  }

  /**
   * Cached recent blockhash for move txs. Moves fire at 2/s and fetching a
   * fresh blockhash per tx doubled RPC volume on the move path — which is
   * what pushed the endpoints into rate limiting and made sends time out.
   * Validity margins: ER blocks are ~50ms so 150 blocks ≈ 7.5s (cache 3s);
   * base layer blockhashes live ~60s+ (cache 20s). If a cached hash ever
   * expires early the tx is dropped and the status verifier flags it.
   */
  private cachedMoveBlockhash: { hash: string; fetchedAt: number; layer: "ephemeral" | "base" } | null = null;

  private async getMoveBlockhash(layer: "ephemeral" | "base"): Promise<string> {
    const ttlMs = layer === "ephemeral" ? 3_000 : 20_000;
    const now = Date.now();
    const cached = this.cachedMoveBlockhash;
    if (cached && cached.layer === layer && now - cached.fetchedAt < ttlMs) {
      return cached.hash;
    }
    const conn = layer === "ephemeral" ? this.ephemeralConnection : this.baseConnection;
    const { blockhash } = await OnChainMultiplayer.withTimeout(conn.getLatestBlockhash(), 5_000);
    this.cachedMoveBlockhash = { hash: blockhash, fetchedAt: now, layer };
    return blockhash;
  }

  private async sendPositionTransaction(x: number, y: number, direction: number): Promise<string | null> {
    if (!this.wallet) return null;

    const sessionKey = this.sessionKeys.getSessionPublicKey();
    const ix = buildUpdatePositionSessionIx(
      this.wallet, sessionKey,
      Math.round(x), Math.round(y), direction,
    );

    if (this.useEphemeral) {
      // Direct path to ephemeral RPC — returns a real ER tx hash. A single
      // retry with a FRESH blockhash covers the dominant failure ("null
      // signature"): the 3s-cached ER blockhash occasionally expires between
      // reuse, so the first send throws — the retry rebuilds+re-signs against a
      // new hash instead of dropping the move outright.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (attempt === 1) this.cachedMoveBlockhash = null; // force a fresh hash on the retry
          const tx = new Transaction().add(ix);
          tx.feePayer = sessionKey;
          tx.recentBlockhash = await this.getMoveBlockhash("ephemeral");
          this.sessionKeys.signTransaction(tx);
          // Actual execution outcome is verified by trackMoveConfirmation
          // (sampled getSignatureStatuses) in the caller.
          return await OnChainMultiplayer.withTimeout(
            this.ephemeralConnection.sendRawTransaction(tx.serialize(), { skipPreflight: true }),
            6_000,
          );
        } catch (err: any) {
          // Don't permanently disable ER — rate limits and transient errors clear up.
          this.cachedMoveBlockhash = null;
          if (attempt === 1) {
            console.warn("[Multiplayer] ephemeral tx skipped:", err?.message);
            return null;
          }
        }
      }
      return null;
    }

    // Base layer path — only used when the PDA is genuinely NOT delegated.
    // (A delegated PDA is forced onto the ER path above, since a base write to
    // it always fails with AccountOwnedByWrongProgram / custom 3007.)
    try {
      const tx = new Transaction().add(ix);
      tx.feePayer = sessionKey;
      tx.recentBlockhash = await this.getMoveBlockhash("base");
      this.sessionKeys.signTransaction(tx);
      return await OnChainMultiplayer.withTimeout(
        this.baseConnection.sendRawTransaction(tx.serialize(), { skipPreflight: true }),
        6_000,
      );
    } catch (err) {
      this.cachedMoveBlockhash = null;
      throw err;
    }
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

  /**
   * Asks the wallet to SIGN a transaction without sending it — used when the
   * tx must be submitted to a different cluster than the app connection
   * (e.g. authorize_session on the ephemeral rollup). Returns the signed tx.
   */
  private requestWalletSignOnly(tx: Transaction): Promise<Transaction> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("wallet sign timeout")), 60_000);

      const bus = (globalThis as any).__solCityGameEvents as Phaser.Events.EventEmitter | undefined;
      if (!bus) {
        clearTimeout(timeout);
        reject(new Error("wallet bus not available — session offline"));
        return;
      }

      bus.once("wallet:signedTxOnly", (signed: Transaction) => {
        clearTimeout(timeout);
        resolve(signed);
      });
      bus.once("wallet:signOnlyError", (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });
      bus.emit("wallet:needSignOnly", tx);
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
