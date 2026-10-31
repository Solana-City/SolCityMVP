import { describe, it, expect, beforeEach, vi } from "vitest";
import { Keypair } from "@solana/web3.js";

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

  it("deletes the old derived and shared slots instead of reusing them", async () => {
    const wallet = Keypair.generate().publicKey;
    const old = Keypair.generate();
    const { clusterKey } = await import("@/game/config/clusterStorage");
    storage.setItem(clusterKey("sol-city-session-key"), JSON.stringify(Array.from(old.secretKey)));
    storage.setItem(`${clusterKey("sol-city-session-key")}-${wallet.toBase58()}`, JSON.stringify(Array.from(old.secretKey)));
    const m = await manager();
    await m.ensureForWallet(wallet);
    expect(m.getSessionPublicKey().equals(old.publicKey)).toBe(false);
    expect(storage.getItem(clusterKey("sol-city-session-key"))).toBeNull();
    expect(storage.getItem(`${clusterKey("sol-city-session-key")}-${wallet.toBase58()}`)).toBeNull();
  });
});
