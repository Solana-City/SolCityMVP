import { describe, it, expect, afterEach, vi } from "vitest";
import { Transaction } from "@solana/web3.js";
import { resilientSigner, isWalletUnauthorized } from "./walletTx";

/**
 * Devnet, 2026-11-11: the adapter's signAllTransactions answered 4100 with no
 * popup while Phantom's own provider was connected as the right account.
 */
const ME = "Hzdwcpd5AjcymaewmbMEhuf6XKXBHBksAFKekX8bn4bL";
const unauthorized = Object.assign(
  new Error("The requested method and/or account has not been authorized by the user."),
  { name: "WalletSignTransactionError" },
);

function setPhantom(p: unknown) {
  (globalThis as { phantom?: unknown }).phantom = p === undefined ? undefined : { solana: p };
}

afterEach(() => setPhantom(undefined));

describe("the shop's signer", () => {
  it("signs one transaction with signTransaction, not signAllTransactions", async () => {
    const signOne = vi.fn(async <T,>(tx: T) => tx);
    const signAll = vi.fn(async <T,>(txs: T[]) => txs);
    // Mocks lose the generic signature; the signer only passes them through.
    const sign = resilientSigner({ signOne: signOne as never, signAll: signAll as never, expected: ME })!;
    const tx = new Transaction();
    expect(await sign([tx])).toEqual([tx]);
    expect(signOne).toHaveBeenCalledTimes(1);
    expect(signAll).not.toHaveBeenCalled();
  });

  it("goes through Phantom's provider when the adapter answers 4100", async () => {
    const injected = vi.fn(async <T,>(tx: T) => tx);
    setPhantom({ isConnected: true, publicKey: { toBase58: () => ME }, signTransaction: injected });
    const sign = resilientSigner({ signOne: async () => { throw unauthorized; }, expected: ME })!;
    const tx = new Transaction();
    expect(await sign([tx])).toEqual([tx]);
    expect(injected).toHaveBeenCalledTimes(1);
  });

  it("never signs through the provider as another account", async () => {
    const injected = vi.fn(async <T,>(tx: T) => tx);
    setPhantom({ isConnected: true, publicKey: { toBase58: () => "someone-else" }, signTransaction: injected, connect: async () => {} });
    const sign = resilientSigner({ signOne: async () => { throw unauthorized; }, expected: ME })!;
    await expect(sign([new Transaction()])).rejects.toBe(unauthorized);
    expect(injected).not.toHaveBeenCalled();
  });

  it("does not hide any other refusal", async () => {
    const injected = vi.fn(async <T,>(tx: T) => tx);
    setPhantom({ isConnected: true, publicKey: { toBase58: () => ME }, signTransaction: injected });
    const rejected = Object.assign(new Error("User rejected the request."), { code: 4001 });
    const sign = resilientSigner({ signOne: async () => { throw rejected; }, expected: ME })!;
    await expect(sign([new Transaction()])).rejects.toBe(rejected);
    expect(injected).not.toHaveBeenCalled();
  });

  it("knows a 4100 by its code or its words", () => {
    expect(isWalletUnauthorized({ code: 4100 })).toBe(true);
    expect(isWalletUnauthorized({ error: { code: 4100 } })).toBe(true);
    expect(isWalletUnauthorized(unauthorized)).toBe(true);
    expect(isWalletUnauthorized({ code: 4001, message: "User rejected" })).toBe(false);
  });
});
