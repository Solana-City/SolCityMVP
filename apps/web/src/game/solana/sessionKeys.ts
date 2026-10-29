import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  Connection,
} from "@solana/web3.js";
import {
  buildAuthorizeSessionIx,
  isProgramDeployed,
} from "./instructions";
import { clusterKey } from "@/game/config/clusterStorage";
import { walletRequest } from "@/game/solana/walletBus";
import { prepareWalletTx, sendWalletSigned } from "@/game/solana/walletTx";

const STORAGE_KEY = clusterKey("sol-city-session-key");

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
  /** Wallet whose deterministic session key is currently loaded (base58). */
  private derivedForWallet: string | null = null;

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

  /**
   * Ensures the session key is the DETERMINISTIC one for this wallet: derived
   * from a fixed message the wallet signs once. Because ed25519 signatures are
   * deterministic, the same wallet yields the same session key on every
   * device/browser — so it always matches the key the ER already authorized and
   * never needs a re-authorize (the step that used to hang / wedge wallets).
   *
   * Cached per-wallet in localStorage, so only the FIRST connect in a given
   * browser shows the one-time "sign message" prompt; reconnects are silent.
   * Falls back to the existing random key if the wallet can't sign messages.
   */
  async ensureForWallet(walletPublicKey: PublicKey): Promise<void> {
    const w = walletPublicKey.toBase58();
    if (this.derivedForWallet === w) return;

    const cacheKey = `${STORAGE_KEY}-${w}`;
    const cached = typeof localStorage !== "undefined" ? localStorage.getItem(cacheKey) : null;
    if (cached) {
      try {
        this.sessionKey = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(cached)));
        this.derivedForWallet = w;
        this.persist();
        return;
      } catch { /* corrupt cache — re-derive below */ }
    }

    try {
      const message = new TextEncoder().encode(
        `Solana City — session key\nWallet: ${w}\n` +
        `Signing derives your in-game session key. Only sign on solanacity.io.`
      );
      const signature = await this.requestWalletSignMessage(message);
      const hash = await crypto.subtle.digest("SHA-256", signature as BufferSource);
      this.sessionKey = Keypair.fromSeed(new Uint8Array(hash));
      this.derivedForWallet = w;
      try { localStorage.setItem(cacheKey, JSON.stringify(Array.from(this.sessionKey.secretKey))); } catch {}
      this.persist();
      console.log(`[SessionKey] derived deterministic key ${this.sessionKey.publicKey.toBase58().slice(0, 8)}… for ${w.slice(0, 8)}…`);
    } catch (err: any) {
      // Non-fatal: keep the existing (random) key. Cross-device sync just won't
      // be automatic for this wallet, but the session still works in-browser.
      console.warn("[SessionKey] deterministic derivation skipped:", err?.message);
    }
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

      // Signed by the wallet and sent by us, with preflight, after a
      // simulation: what Phantom asks of a dApp (see walletTx.ts). This used
      // to go through the wallet's own sign-and-send, which broadcasts on
      // whatever network the wallet is set to.
      const ready = await prepareWalletTx(connection, tx);
      const signed = await walletRequest<Transaction>(
        "wallet:needSignOnly", "wallet:signedTxOnly", "wallet:signOnlyError", ready,
      );
      const sig = await sendWalletSigned(connection, signed);
      await Promise.allSettled([
        connection.confirmTransaction(sig, "confirmed"),
        altConnection ? altConnection.sendRawTransaction(signed.serialize(), { skipPreflight: true }) : Promise.resolve(),
      ]);

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
   * Marks the session as locally disconnected without destroying the keypair.
   *
   * The session key must survive disconnect so that the ER's copy of the player
   * PDA (which stores the authorized session key) stays in sync with what we
   * have locally. Deleting the key and generating a new one on every disconnect
   * was the root cause of "unknown signer" on commitAndUndelegate — the ER had
   * the old key, the new session had a different key, and no instruction could
   * update the ER copy (the tx for authorize_session uses the base-layer
   * blockhash which the ER rejects).
   *
   * Key rotation is safe only AFTER a successful commitAndUndelegate brings the
   * PDA back to the base layer — call rotateKey() from OnChainMultiplayer then.
   */
  revoke(_connection?: Connection): void {
    this.authorized = false;
    this.mainWallet = null;
    // Session key intentionally kept in localStorage — see note above.
  }

  /**
   * Generates a fresh session key and persists it.
   * Call only after a successful commitAndUndelegate (PDA is back on base layer,
   * so a new key can be authorized on the next connect without ER mismatch).
   */
  rotateKey(): void {
    this.sessionKey = Keypair.generate();
    this.persist();
  }

  /**
   * Asks the wallet (via WalletSignBridge) to sign a raw message, returning the
   * signature bytes. Used only to derive the deterministic session key.
   */
  private requestWalletSignMessage(message: Uint8Array): Promise<Uint8Array> {
    return walletRequest<Uint8Array>(
      "wallet:needSignMessage", "wallet:signedMessage", "wallet:signMessageError", message,
    );
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
