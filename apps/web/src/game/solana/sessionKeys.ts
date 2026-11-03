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

/**
 * Where a wallet's session key lives: one slot PER WALLET, `<prefix>-<wallet>`.
 *
 * `v2` because the keys stored before it were derived from a fixed message
 * (see `ensureForWallet`), and those must not be picked up again. The old
 * slots are deleted as each wallet moves over.
 */
const STORAGE_PREFIX = clusterKey("sol-city-session-key-v2");
/** The pre-v2 slots: one shared by every wallet, and one per wallet. */
const LEGACY_SHARED = clusterKey("sol-city-session-key");
/** The one signature a sweep pays for, out of the swept key itself. */
const SWEEP_FEE_LAMPORTS = 5_000;

/**
 * Manages the session key: a keypair the wallet authorizes once on chain
 * (`authorize_session`), which then signs every in-game write with no popup.
 *
 * ── A RANDOM key per wallet, per browser (audit R-07, R-15) ─────────────────
 *
 * It used to be DERIVED, from the wallet's signature over one fixed message,
 * so that every device produced the same key and none ever had to authorize
 * again. That made the key exactly as safe as that signature: any page that
 * got a player to sign the same text owned their session key for good, with
 * no way to replace it, because re-deriving gave the same key again. It is
 * the "game-wallet phishing" Ailton's audit found in Dungeons & Moles.
 *
 * Now each browser makes its own random key for each wallet and keeps it.
 * Same device, nothing changes: the key is still there next time and nothing
 * is asked. A new device authorizes its own key, in a transaction the player
 * was signing anyway where the flow allows it, and authorizing it replaces
 * the old one on chain. That is the trade, chosen on purpose (owner's call,
 * 2026-10-31): moving between two devices costs one approval on the switch,
 * and in exchange a leaked key dies the next time the player logs in.
 *
 * Kept per wallet, not in one shared slot, so two wallets in one browser no
 * longer sign with each other's key.
 *
 * In simulation mode (program not deployed) authorize() is a no-op.
 */
export class SessionKeyManager {
  private sessionKey: Keypair;
  private mainWallet: PublicKey | null = null;
  private authorized = false;
  /** Wallet whose key is currently loaded (base58). */
  private loadedForWallet: string | null = null;
  /** Discarded keys still on disk, waiting for sweepRetired. */
  private retired: { slot: string; key: Keypair }[] = [];

  constructor() {
    // A placeholder until a wallet is known. Never stored: a key with no
    // wallet is a key nobody can authorize.
    this.sessionKey = Keypair.generate();
  }

  /**
   * Loads THIS wallet's session key, or creates one. Never prompts.
   *
   * The name is kept from when this derived the key from a signature; it now
   * only picks the right slot. Call it before reading the key for a wallet.
   */
  async ensureForWallet(walletPublicKey: PublicKey): Promise<void> {
    const w = walletPublicKey.toBase58();
    if (this.loadedForWallet === w) return;

    const slot = `${STORAGE_PREFIX}-${w}`;
    let loaded: Keypair | null = null;
    try {
      const stored = localStorage.getItem(slot);
      if (stored) loaded = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(stored)));
    } catch { /* unreadable or corrupt: a new key below */ }

    this.sessionKey = loaded ?? Keypair.generate();
    this.loadedForWallet = w;
    this.authorized = false;
    this.persist();

    // The derived key and the shared slot go, since leaving them would keep
    // the phishable secret on disk long after nothing reads it. But not
    // before their balance goes home: each was topped up with the player's
    // SOL, and deleting it here used to strand that SOL for good. They are
    // queued for sweepRetired, which deletes each slot once it is empty.
    this.retired = [];
    for (const slot of [`${LEGACY_SHARED}-${w}`, LEGACY_SHARED]) {
      try {
        const stored = localStorage.getItem(slot);
        if (!stored) continue;
        const key = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(stored)));
        if (key.publicKey.equals(this.sessionKey.publicKey)) {
          localStorage.removeItem(slot);
        } else {
          this.retired.push({ slot, key });
        }
      } catch {
        // Unreadable: there is no key to sweep, only a secret to delete.
        try { localStorage.removeItem(slot); } catch { /* blocked */ }
      }
    }
  }

  /**
   * Sends what a discarded session key still holds back to the wallet, then
   * deletes it. Signed by that key alone, so it needs nothing from the
   * player and opens no popup.
   *
   * Everything goes, rent floor included: a system account may be emptied to
   * zero (it is the in-between, above zero and below the floor, that is
   * refused). The key pays its own 5,000-lamport fee, so a balance no larger
   * than that is dust and the slot is just deleted.
   *
   * The shared pre-v2 slot belonged to whichever wallet used this browser
   * last, which in practice is the same person; it goes to the wallet
   * connected now.
   *
   * Returns the lamports sent home. A failure keeps the slot for next time.
   */
  async sweepRetired(connection: Connection, wallet: PublicKey): Promise<number> {
    if (!isProgramDeployed()) return 0;
    let swept = 0;
    for (const { slot, key } of this.retired.splice(0)) {
      try {
        const balance = await connection.getBalance(key.publicKey);
        const amount = balance - SWEEP_FEE_LAMPORTS;
        if (amount > 0) {
          const { blockhash } = await connection.getLatestBlockhash();
          const tx = new Transaction({ recentBlockhash: blockhash, feePayer: key.publicKey })
            .add(SystemProgram.transfer({ fromPubkey: key.publicKey, toPubkey: wallet, lamports: amount }));
          tx.sign(key);
          const sig = await connection.sendRawTransaction(tx.serialize());
          // Polled, not confirmed over a websocket, which these RPCs drop. A
          // sweep that lands after we give up is harmless: next time the key
          // reads empty and its slot is simply deleted.
          let landed = false;
          for (let i = 0; i < 10 && !landed; i++) {
            await new Promise((r) => setTimeout(r, 1_000));
            const st = (await connection.getSignatureStatuses([sig])).value[0];
            if (st?.err) throw new Error(`sweep failed: ${JSON.stringify(st.err)}`);
            landed = st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized";
          }
          if (!landed) throw new Error("sweep not confirmed yet");
          swept += amount;
          console.log(`[SessionKey] returned ${amount} lamports from a retired key: ${sig.slice(0, 12)}`);
        }
        localStorage.removeItem(slot);
      } catch (err: any) {
        // Kept on disk, so the next connect tries again.
        console.warn("[SessionKey] retired key not swept yet:", err?.message);
      }
    }
    return swept;
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
    this.authorized = false;
    this.persist();
  }

  /** Into this wallet's own slot. Nothing is stored before a wallet is known. */
  private persist(): void {
    if (!this.loadedForWallet) return;
    try {
      localStorage.setItem(
        `${STORAGE_PREFIX}-${this.loadedForWallet}`,
        JSON.stringify(Array.from(this.sessionKey.secretKey))
      );
    } catch {}
  }
}
