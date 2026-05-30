import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  Connection,
} from "@solana/web3.js";
import {
  buildAuthorizeSessionIx,
  buildRevokeSessionIx,
  isProgramDeployed,
} from "./instructions";

const STORAGE_KEY = "sol-city-session-key";

/**
 * Manages an ephemeral keypair for the game session.
 *
 * Flow:
 *   1. Player connects Phantom
 *   2. SessionKeyManager.create() generates a fresh Keypair
 *   3. authorize() calls `authorize_session` on-chain — one wallet popup
 *   4. All position updates are signed by the session key (no more popups)
 *   5. On disconnect, revoke() calls `revoke_session` on-chain
 *
 * In simulation mode (program not deployed) authorize() is a no-op.
 */
export class SessionKeyManager {
  private sessionKey: Keypair;
  private mainWallet: PublicKey | null = null;
  private authorized = false;

  constructor() {
    const stored = localStorage.getItem(STORAGE_KEY);
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

  getSessionKey(): Keypair       { return this.sessionKey; }
  getSessionPublicKey(): PublicKey { return this.sessionKey.publicKey; }
  isAuthorized(): boolean         { return this.authorized; }
  getMainWallet(): PublicKey | null { return this.mainWallet; }

  /**
   * Authorizes the session key on-chain via `authorize_session`.
   * In simulation mode (program not deployed) just marks authorized locally.
   * In deployed mode: builds + sends the tx via WalletSignBridge (one popup).
   *
   * Pass `connection` explicitly so the caller can route to base layer
   * (account not yet delegated) or through the Magic Router (already delegated).
   */
  /**
   * Authorize session key on BOTH connections simultaneously.
   * We cannot reliably detect delegation status, so we broadcast the signed
   * authorize_session tx to both base layer and the Magic Router.
   * The correct layer (wherever the live PDA resides) will accept it.
   */
  async authorize(
    walletPublicKey: PublicKey,
    connection: Connection,
    altConnection?: Connection,
    fundLamports = 0,
  ): Promise<void> {
    this.mainWallet = walletPublicKey;

    if (!isProgramDeployed()) {
      this.authorized = true;
      console.log(
        `[SessionKey] sim-authorized ${this.sessionKey.publicKey.toBase58().slice(0, 8)}` +
        `... for ${walletPublicKey.toBase58().slice(0, 8)}...`
      );
      return;
    }

    try {
      const ix = buildAuthorizeSessionIx(walletPublicKey, this.sessionKey.publicKey);
      const { blockhash } = await connection.getLatestBlockhash();
      const tx = new Transaction({
        recentBlockhash: blockhash,
        feePayer: walletPublicKey,
      }).add(ix);
      // Bundle SOL transfer into this tx so no extra sign prompt is needed.
      if (fundLamports > 0) {
        tx.add(SystemProgram.transfer({
          fromPubkey: walletPublicKey,
          toPubkey: this.sessionKey.publicKey,
          lamports: fundLamports,
        }));
      }

      const sig = await this.requestWalletSign(tx);
      if (!sig.startsWith("sim:")) {
        // Broadcast signed tx to primary connection AND alt connection concurrently.
        // One will succeed (correct layer), the other will silently reject.
        const raw = tx.serialize();
        await Promise.allSettled([
          connection.confirmTransaction(sig, "confirmed"),
          altConnection ? altConnection.sendRawTransaction(raw, { skipPreflight: true }) : Promise.resolve(),
        ]);
      }

      this.authorized = true;
      console.log(
        `[SessionKey] authorized on-chain: ${sig.slice(0, 12)}... ` +
        `session=${this.sessionKey.publicKey.toBase58().slice(0, 8)}...`
      );
    } catch (err: any) {
      this.authorized = true;
      console.warn("[SessionKey] on-chain authorize failed, using local auth:", err?.message);
    }
  }

  /**
   * Signs a transaction with the session key (no popup).
   */
  signTransaction(tx: Transaction): Transaction {
    tx.partialSign(this.sessionKey);
    return tx;
  }

  /**
   * Revokes the session key on-chain and discards the local keypair.
   * Called on wallet disconnect. Pass the Magic Router connection so
   * the revoke_session tx is routed correctly when the account is delegated.
   */
  async revoke(connection?: Connection): Promise<void> {
    this.authorized = false;

    if (isProgramDeployed() && this.mainWallet && connection) {
      try {
        const ix = buildRevokeSessionIx(this.mainWallet);
        const { blockhash } = await connection.getLatestBlockhash();
        const tx = new Transaction({
          recentBlockhash: blockhash,
          feePayer: this.mainWallet,
        }).add(ix);
        this.requestWalletSign(tx).catch(() => {});
      } catch {}
    }

    this.mainWallet = null;
    localStorage.removeItem(STORAGE_KEY);
    this.sessionKey = Keypair.generate();
    this.persist();
  }

  /**
   * Requests the user's wallet (via WalletSignBridge in React) to sign a tx.
   * Returns the transaction signature.
   */
  private requestWalletSign(tx: Transaction): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("wallet sign timeout")),
        60_000
      );

      const bus = (globalThis as any).__solCityGameEvents as
        | { once: (event: string, cb: (...a: any[]) => void) => void; emit: (event: string, ...a: any[]) => void }
        | undefined;

      if (!bus) {
        clearTimeout(timeout);
        // Reject — do NOT resolve with a fake signature. Passing non-base58
        // strings to confirmTransaction crashes via tweetnacl assertion.
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

  private persist(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(Array.from(this.sessionKey.secretKey))
      );
    } catch {}
  }
}
