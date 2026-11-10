import { describe, it, expect } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { withoutCopies, commonCopies } from "./mint";
import { drawnCopies } from "./packs";
import {
  SOL_CITY_COLLECTIBLES_PROGRAM_ID, decodeMintQueue, deriveMintQueuePDA, type UnlockState,
} from "./program";

/**
 * The client side of "everything revealed is minted, repeats included"
 * (owner, 2026-11-10). Owed copies repeat, so every comparison here counts
 * copies; the Rust tests pin the same rules on chain.
 */
const A = 1546;
const B = 1547;

function queueBytes(wallet: PublicKey, owed: number[]): Uint8Array {
  const buf = Buffer.alloc(8 + 32 + 4 + owed.length * 2);
  wallet.toBuffer().copy(buf, 8);
  buf.writeUInt32LE(owed.length, 40);
  owed.forEach((i, k) => buf.writeUInt16LE(i, 44 + k * 2));
  return buf;
}

function state(owned: number[], size: number): UnlockState {
  return {
    authority: Keypair.generate().publicKey,
    owned,
    minted: [],
    pending: false,
    draw: { packId: 1, size, weights: [7200, 2200, 500, 100], season: 1 },
  };
}

describe("counting copies", () => {
  it("sees one copy minted out of two of the same item", () => {
    expect(withoutCopies([A, A, B], [A, B])).toEqual([A]);
  });

  it("keeps as many copies as both lists hold", () => {
    expect(commonCopies([A, A, B], [A, B, B])).toEqual([A, B]);
    expect(commonCopies([A, A], [A, A, A])).toEqual([A, A]);
  });
});

describe("the MintQueue account", () => {
  it("decodes the copies it holds, repeats and order kept", () => {
    const wallet = Keypair.generate().publicKey;
    const q = decodeMintQueue(queueBytes(wallet, [A, A, B]));
    expect(q?.wallet.equals(wallet)).toBe(true);
    expect(q?.owed).toEqual([A, A, B]);
  });

  it("is one per wallet", () => {
    const w = Keypair.generate().publicKey;
    expect(deriveMintQueuePDA(w).equals(deriveMintQueuePDA(w))).toBe(true);
    expect(deriveMintQueuePDA(w).equals(deriveMintQueuePDA(Keypair.generate().publicKey))).toBe(false);
  });
});

describe("what a draw handed out", () => {
  const wallet = Keypair.generate().publicKey;

  it("is the tail of the queue, repeats included, even of items owned before", () => {
    // Owned A before; one older copy of B still waiting; the pack drew A, A, B.
    const s = state([A, B], 3);
    const data = queueBytes(wallet, [B, A, A, B]);
    expect(drawnCopies(s, data, SOL_CITY_COLLECTIBLES_PROGRAM_ID, new Set([A]))).toEqual([A, A, B]);
  });

  it("falls back to what is new when there is no queue", () => {
    const s = state([A, B], 3);
    expect(drawnCopies(s, null, null, new Set([A]))).toEqual([B]);
  });

  it("ignores an account the program does not own", () => {
    const s = state([A, B], 2);
    const data = queueBytes(wallet, [A, B]);
    expect(drawnCopies(s, data, Keypair.generate().publicKey, new Set([A]))).toEqual([B]);
  });
});
