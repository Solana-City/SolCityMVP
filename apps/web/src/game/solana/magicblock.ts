import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
} from "@solana/web3.js";

// MagicBlock public endpoints (free for development)
const ENDPOINTS = {
  magicRouter: "https://devnet-router.magicblock.app",
  solanaDevnet: "https://api.devnet.solana.com",
  ephemeralDevnet: "https://devnet.magicblock.app",
} as const;

/**
 * MagicBlockClient handles transaction routing between
 * Solana base layer and MagicBlock Ephemeral Rollups.
 *
 * The Magic Router inspects transaction metadata and automatically
 * routes to the fastest available endpoint:
 *   - Ephemeral Rollup for delegated accounts (sub-50ms, zero-fee)
 *   - Solana for non-delegated accounts (standard latency)
 *
 * Integration points in Sol City:
 *   - Player position state (delegated during session)
 *   - Chat messages (ephemeral, committed on session end)
 *   - NPC interaction results (committed immediately)
 *   - Outfit unlocks (committed to base layer)
 */
export class MagicBlockClient {
  private routerConnection: Connection;
  private baseConnection: Connection;
  private ephemeralConnection: Connection;

  constructor() {
    this.routerConnection = new Connection(ENDPOINTS.magicRouter, "confirmed");
    this.baseConnection = new Connection(ENDPOINTS.solanaDevnet, "confirmed");
    this.ephemeralConnection = new Connection(ENDPOINTS.ephemeralDevnet, "confirmed");
  }

  getRouterConnection(): Connection {
    return this.routerConnection;
  }

  getBaseConnection(): Connection {
    return this.baseConnection;
  }

  getEphemeralConnection(): Connection {
    return this.ephemeralConnection;
  }

  /**
   * Sends a transaction through the Magic Router.
   * The router determines whether it goes to the ephemeral rollup
   * or the Solana base layer based on account delegation state.
   *
   * For Sol City, this is used for:
   *   - Player state updates (movement, outfit changes)
   *   - Game actions (NPC interactions, item pickups)
   */
  async sendTransaction(
    tx: Transaction,
    signers: Keypair[],
    opts?: { skipPreflight?: boolean }
  ): Promise<string> {
    // Add a noop instruction with random data to ensure unique tx signature
    // (required by Magic Router to avoid duplicate detection)
    const noopIx = new TransactionInstruction({
      programId: new PublicKey("11111111111111111111111111111111"),
      keys: [],
      data: Buffer.from(crypto.getRandomValues(new Uint8Array(5))),
    });
    tx.add(noopIx);

    const { blockhash } = await this.routerConnection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = signers[0].publicKey;

    tx.sign(...signers);

    const signature = await this.routerConnection.sendRawTransaction(
      tx.serialize(),
      { skipPreflight: opts?.skipPreflight ?? true }
    );

    return signature;
  }

  /**
   * Sends a transaction using a wallet adapter (browser wallet signing).
   * Used for user-facing actions like swaps and transfers.
   */
  async sendWalletTransaction(
    tx: Transaction,
    signTransaction: (tx: Transaction) => Promise<Transaction>,
    feePayer: PublicKey
  ): Promise<string> {
    const noopIx = new TransactionInstruction({
      programId: new PublicKey("11111111111111111111111111111111"),
      keys: [],
      data: Buffer.from(crypto.getRandomValues(new Uint8Array(5))),
    });
    tx.add(noopIx);

    const { blockhash } = await this.routerConnection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = feePayer;

    const signed = await signTransaction(tx);
    const signature = await this.routerConnection.sendRawTransaction(
      signed.serialize(),
      { skipPreflight: true }
    );

    return signature;
  }
}

// Singleton instance
let instance: MagicBlockClient | null = null;

export function getMagicBlockClient(): MagicBlockClient {
  if (!instance) {
    instance = new MagicBlockClient();
  }
  return instance;
}
