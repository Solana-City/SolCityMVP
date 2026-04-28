import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { getMagicBlockClient } from "./magicblock";
import {
  derivePlayerPDA,
  SOL_CITY_PROGRAM_ID,
  EPHEMERAL_CONFIG,
  OnChainPlayerState,
  getUnlockedOutfits,
} from "./program";

export type SessionStatus =
  | "disconnected"
  | "connecting"
  | "active"
  | "committing"
  | "error";

interface SessionCallbacks {
  onStatusChange?: (status: SessionStatus) => void;
  onStateUpdate?: (state: OnChainPlayerState) => void;
  onOutfitUnlock?: (outfitId: string) => void;
}

/**
 * Manages the player's ephemeral rollup session.
 *
 * Session lifecycle:
 *   1. startSession() - delegates player PDA to ephemeral rollup
 *   2. Game runs, transactions route through Magic Router
 *   3. Position commits every 3s automatically
 *   4. High-value actions (swap, mint) trigger immediate commit
 *   5. endSession() - undelegates, commits final state to Solana
 *
 * Until the Anchor program is deployed, this runs in "mock mode"
 * where session management is simulated but the architecture
 * is ready for real on-chain integration.
 */
export class SessionManager {
  private client = getMagicBlockClient();
  private wallet: PublicKey | null = null;
  private playerPDA: PublicKey | null = null;
  private status: SessionStatus = "disconnected";
  private commitInterval: ReturnType<typeof setInterval> | null = null;
  private callbacks: SessionCallbacks = {};
  private mockState: OnChainPlayerState | null = null;

  constructor(callbacks?: SessionCallbacks) {
    if (callbacks) this.callbacks = callbacks;
  }

  getStatus(): SessionStatus {
    return this.status;
  }

  getPlayerPDA(): PublicKey | null {
    return this.playerPDA;
  }

  /**
   * Starts an ephemeral session for the connected wallet.
   * Delegates the player PDA to the ephemeral rollup.
   */
  async startSession(walletPubkey: PublicKey): Promise<void> {
    this.wallet = walletPubkey;
    const [pda] = derivePlayerPDA(walletPubkey);
    this.playerPDA = pda;

    this.setStatus("connecting");

    try {
      // In production: send delegate CPI transaction via Magic Router
      // For now: initialize mock state
      this.mockState = {
        authority: walletPubkey,
        displayName: walletPubkey.toBase58().slice(0, 8),
        x: 512,
        y: 288,
        direction: 0,
        outfitId: 0,
        score: 0,
        swapCount: 0,
        transferCount: 0,
        bountyCount: 0,
        lastActive: Math.floor(Date.now() / 1000),
        createdAt: Math.floor(Date.now() / 1000),
      };

      this.setStatus("active");

      // Start periodic commits
      this.commitInterval = setInterval(() => {
        this.commitState();
      }, EPHEMERAL_CONFIG.commitFrequencyMs);

      console.log(
        `[SessionManager] session started for ${walletPubkey.toBase58().slice(0, 8)}...`
      );
    } catch (err) {
      console.error("[SessionManager] failed to start session:", err);
      this.setStatus("error");
    }
  }

  /**
   * Ends the ephemeral session.
   * Undelegates the player PDA and commits final state to Solana.
   */
  async endSession(): Promise<void> {
    if (this.status !== "active") return;

    this.setStatus("committing");

    if (this.commitInterval) {
      clearInterval(this.commitInterval);
      this.commitInterval = null;
    }

    try {
      // In production: send undelegate CPI transaction
      await this.commitState();
      this.setStatus("disconnected");
      console.log("[SessionManager] session ended, state committed");
    } catch (err) {
      console.error("[SessionManager] failed to end session:", err);
      this.setStatus("error");
    }
  }

  /**
   * Updates the player position in the ephemeral state.
   * Called every frame from CityScene.
   */
  updatePosition(x: number, y: number, direction: number): void {
    if (!this.mockState) return;
    this.mockState.x = Math.round(x);
    this.mockState.y = Math.round(y);
    this.mockState.direction = direction;
    this.mockState.lastActive = Math.floor(Date.now() / 1000);
  }

  /**
   * Records a swap action. Triggers immediate commit for high-value state.
   * Returns newly unlocked outfit IDs.
   */
  async recordSwap(): Promise<string[]> {
    if (!this.mockState) return [];

    this.mockState.swapCount += 1;
    this.mockState.score += 50;

    // Check for new outfit unlocks
    const before = getUnlockedOutfits({
      ...this.mockState,
      swapCount: this.mockState.swapCount - 1,
    });
    const after = getUnlockedOutfits(this.mockState);
    const newUnlocks = after.filter((id) => !before.includes(id));

    for (const outfitId of newUnlocks) {
      this.callbacks.onOutfitUnlock?.(outfitId);
    }

    // Immediate commit for important state changes
    await this.commitState();

    this.callbacks.onStateUpdate?.(this.mockState);
    return newUnlocks;
  }

  /**
   * Records a transfer action.
   */
  async recordTransfer(): Promise<void> {
    if (!this.mockState) return;
    this.mockState.transferCount += 1;
    this.mockState.score += 25;
    await this.commitState();
    this.callbacks.onStateUpdate?.(this.mockState);
  }

  /**
   * Records a bounty completion.
   */
  async recordBounty(): Promise<string[]> {
    if (!this.mockState) return [];

    this.mockState.bountyCount += 1;
    this.mockState.score += 30;

    const before = getUnlockedOutfits({
      ...this.mockState,
      bountyCount: this.mockState.bountyCount - 1,
    });
    const after = getUnlockedOutfits(this.mockState);
    const newUnlocks = after.filter((id) => !before.includes(id));

    for (const outfitId of newUnlocks) {
      this.callbacks.onOutfitUnlock?.(outfitId);
    }

    await this.commitState();
    this.callbacks.onStateUpdate?.(this.mockState);
    return newUnlocks;
  }

  /**
   * Gets the current player state (from ephemeral or mock).
   */
  getState(): OnChainPlayerState | null {
    return this.mockState;
  }

  // ── Internal ──────────────────────────────────

  private async commitState(): Promise<void> {
    if (!this.mockState || this.status === "disconnected") return;

    // In production: this sends the state diff to the ephemeral rollup
    // which then commits to Solana base layer.
    // For now: just log the commit.
    console.log(
      `[SessionManager] commit: score=${this.mockState.score} ` +
        `swaps=${this.mockState.swapCount} pos=(${this.mockState.x},${this.mockState.y})`
    );
  }

  private setStatus(status: SessionStatus): void {
    this.status = status;
    this.callbacks.onStatusChange?.(status);
  }
}
