import { Keypair, PublicKey, Transaction, Connection } from "@solana/web3.js";

const STORAGE_KEY = "sol-city-session-key";

/**
 * Manages an ephemeral keypair for the game session.
 *
 * The main wallet (Phantom) signs a one-time "approve session" transaction
 * that authorizes this ephemeral key to act on behalf of the player.
 * After that, all position updates are signed by the session key
 * automatically, with zero popups.
 *
 * The session key is stored in sessionStorage (cleared on tab close)
 * and has no SOL. The Anchor program validates that the session key
 * was authorized by the player's main wallet.
 *
 * Flow:
 *   1. Player connects Phantom
 *   2. SessionKeyManager.create() generates a fresh Keypair
 *   3. Player signs an "authorize session key" tx with Phantom (one popup)
 *   4. All subsequent game txs are signed by the session key (no popups)
 *   5. On disconnect/tab close, session key is discarded
 */
export class SessionKeyManager {
  private sessionKey: Keypair;
  private mainWallet: PublicKey | null = null;
  private authorized = false;

  constructor() {
    // Try to recover from sessionStorage (survives page refresh)
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const bytes = Uint8Array.from(JSON.parse(stored));
        this.sessionKey = Keypair.fromSecretKey(bytes);
      } catch {
        this.sessionKey = Keypair.generate();
      }
    } else {
      this.sessionKey = Keypair.generate();
    }
    this.persist();
  }

  getSessionKey(): Keypair {
    return this.sessionKey;
  }

  getSessionPublicKey(): PublicKey {
    return this.sessionKey.publicKey;
  }

  isAuthorized(): boolean {
    return this.authorized;
  }

  getMainWallet(): PublicKey | null {
    return this.mainWallet;
  }

  /**
   * Authorizes the session key by having the main wallet sign a proof.
   * In the full Anchor implementation, this would be a CPI to a
   * session token program. For now, we just mark it as authorized
   * after the wallet is connected.
   */
  async authorize(walletPublicKey: PublicKey): Promise<void> {
    this.mainWallet = walletPublicKey;
    this.authorized = true;
    console.log(
      `[SessionKey] authorized ${this.sessionKey.publicKey.toBase58().slice(0, 8)}... ` +
      `for wallet ${walletPublicKey.toBase58().slice(0, 8)}...`
    );
  }

  /**
   * Signs a transaction with the session key.
   * No wallet popup needed.
   */
  signTransaction(tx: Transaction): Transaction {
    tx.partialSign(this.sessionKey);
    return tx;
  }

  /**
   * Revokes the session key on disconnect.
   */
  revoke(): void {
    this.authorized = false;
    this.mainWallet = null;
    sessionStorage.removeItem(STORAGE_KEY);
    this.sessionKey = Keypair.generate();
    this.persist();
  }

  private persist(): void {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(Array.from(this.sessionKey.secretKey))
      );
    } catch {}
  }
}
