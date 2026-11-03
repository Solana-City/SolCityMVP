import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { Keypair, PublicKey, Transaction, SystemInstruction, type Connection } from "@solana/web3.js";

/**
 * The session key is a RANDOM key per wallet per browser (audit R-07, R-15),
 * and loading it never asks the wallet for anything. These pin the three
 * properties that decision rests on.
 */
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  keys() { return [...this.m.keys()]; }
}

let storage: MemoryStorage;

// The first import pulls in web3.js and the wallet plumbing, which under a
// full parallel run can take longer than one test's five seconds on its own.
// Paid once here, so each test measures only itself.
beforeAll(async () => {
  await import("./sessionKeys");
}, 30_000);

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("localStorage", storage);
  // A wallet request here would be a prompt; there must be none.
  vi.stubGlobal("window", { dispatchEvent: () => { throw new Error("prompted the wallet"); } });
});

async function manager() {
  const { SessionKeyManager } = await import("./sessionKeys");
  return new SessionKeyManager();
}

describe("the session key", () => {
  it("is the same key for the same wallet in the same browser, with no prompt", async () => {
    const wallet = Keypair.generate().publicKey;
    const a = await manager();
    await a.ensureForWallet(wallet);
    const b = await manager();
    await b.ensureForWallet(wallet);
    expect(b.getSessionPublicKey().equals(a.getSessionPublicKey())).toBe(true);
  });

  it("is a different key for each wallet: no slot is shared", async () => {
    const m = await manager();
    await m.ensureForWallet(Keypair.generate().publicKey);
    const first = m.getSessionPublicKey();
    await m.ensureForWallet(Keypair.generate().publicKey);
    expect(m.getSessionPublicKey().equals(first)).toBe(false);
  });

  it("is not derivable: two browsers make two different keys for one wallet", async () => {
    const wallet = Keypair.generate().publicKey;
    const a = await manager();
    await a.ensureForWallet(wallet);
    const keyA = a.getSessionPublicKey();
    storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);
    const b = await manager();
    await b.ensureForWallet(wallet);
    expect(b.getSessionPublicKey().equals(keyA)).toBe(false);
  });

  it("never reuses the old derived and shared slots", async () => {
    const wallet = Keypair.generate().publicKey;
    const old = Keypair.generate();
    const { clusterKey } = await import("@/game/config/clusterStorage");
    storage.setItem(clusterKey("sol-city-session-key"), JSON.stringify(Array.from(old.secretKey)));
    storage.setItem(`${clusterKey("sol-city-session-key")}-${wallet.toBase58()}`, JSON.stringify(Array.from(old.secretKey)));
    const m = await manager();
    await m.ensureForWallet(wallet);
    expect(m.getSessionPublicKey().equals(old.publicKey)).toBe(false);
  });
});

/**
 * A retired key was topped up with the player's SOL. Deleting it used to
 * strand that SOL; now it is sent back to the wallet first, signed by the key
 * itself, and only an empty key is deleted.
 */
describe("a retired session key", () => {
  /** Just the calls sweepRetired makes, with one balance per key. */
  function fakeConnection(balances: Map<string, number>, opts: { failSend?: boolean } = {}) {
    const sent: Transaction[] = [];
    const conn = {
      getBalance: async (k: PublicKey) => balances.get(k.toBase58()) ?? 0,
      getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 }),
      sendRawTransaction: async (raw: Buffer | Uint8Array) => {
        if (opts.failSend) throw new Error("rpc down");
        const tx = Transaction.from(Buffer.from(raw));
        sent.push(tx);
        balances.set(tx.feePayer!.toBase58(), 0);
        return "sig";
      },
      getSignatureStatuses: async () => ({ value: [{ confirmationStatus: "confirmed", err: null }] }),
    };
    return { conn: conn as unknown as Connection, sent };
  }

  async function withRetired(): Promise<{ wallet: PublicKey; old: Keypair; slot: string; m: Awaited<ReturnType<typeof manager>> }> {
    const wallet = Keypair.generate().publicKey;
    const old = Keypair.generate();
    const { clusterKey } = await import("@/game/config/clusterStorage");
    const slot = `${clusterKey("sol-city-session-key")}-${wallet.toBase58()}`;
    storage.setItem(slot, JSON.stringify(Array.from(old.secretKey)));
    const m = await manager();
    await m.ensureForWallet(wallet);
    return { wallet, old, slot, m };
  }

  it("sends everything but its own fee back to the wallet, then is deleted", async () => {
    const { wallet, old, slot, m } = await withRetired();
    const { conn, sent } = fakeConnection(new Map([[old.publicKey.toBase58(), 3_150_240]]));
    const swept = await m.sweepRetired(conn, wallet);
    expect(swept).toBe(3_145_240);
    expect(sent).toHaveLength(1);
    expect(sent[0].feePayer!.equals(old.publicKey)).toBe(true);
    const ix = SystemInstruction.decodeTransfer(sent[0].instructions[0]);
    expect(ix.toPubkey.equals(wallet)).toBe(true);
    expect(Number(ix.lamports)).toBe(3_145_240);
    expect(storage.getItem(slot)).toBeNull();
  });

  it("deletes an empty key without sending anything", async () => {
    const { wallet, slot, m } = await withRetired();
    const { conn, sent } = fakeConnection(new Map());
    expect(await m.sweepRetired(conn, wallet)).toBe(0);
    expect(sent).toHaveLength(0);
    expect(storage.getItem(slot)).toBeNull();
  });

  it("stays on disk when the sweep fails, for the next connect", async () => {
    const { wallet, old, slot, m } = await withRetired();
    const { conn } = fakeConnection(new Map([[old.publicKey.toBase58(), 1_000_000]]), { failSend: true });
    expect(await m.sweepRetired(conn, wallet)).toBe(0);
    expect(storage.getItem(slot)).not.toBeNull();
  });
});
