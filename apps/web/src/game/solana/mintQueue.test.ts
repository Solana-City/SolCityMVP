import { describe, it, expect, afterEach, vi } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { withoutCopies, commonCopies, requestSponsoredMint } from "./mint";
import { drawnCopies } from "./packs";
import {
  SOL_CITY_COLLECTIBLES_PROGRAM_ID, decodeMintQueue, deriveMintQueuePDA, type UnlockState,
} from "./program";
import {
  setOwedCopies, isOwedMint, setHeldItems, markHeld, isVariantUnlocked,
  hasOnChainUnlocks, setOnChainUnlocks,
} from "@/game/config/wardrobeUnlocks";
import { globalIndexOf } from "@/game/config/catalogIndex";
import { getVariant } from "@/game/config/paperDoll";

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

describe("the wardrobe after a mint", () => {
  // A real pack item, so the catalog lookups resolve.
  const RED = globalIndexOf("accessory", "Glasses_red");
  const red = getVariant("accessory", "Glasses_red")!;

  it("reads MINT NOW from the queue, so a delivered item stops asking", () => {
    const w = Keypair.generate().publicKey.toBase58();
    setOwedCopies(w, [RED]);
    expect(isOwedMint(w, "accessory", red)).toBe(true);
    // The sponsor minted it: the queue is empty, whatever `minted` said before.
    setOwedCopies(w, []);
    expect(isOwedMint(w, "accessory", red)).toBe(false);
  });

  it("counts a copy it just minted as held before the indexer lists it", () => {
    const w = Keypair.generate().publicKey.toBase58();
    setHeldItems(w, []); // the indexer has not caught up
    expect(isVariantUnlocked(w, "accessory", red)).toBe(false);
    markHeld(w, [RED]);
    expect(isVariantUnlocked(w, "accessory", red)).toBe(true);
  });

  it("tells an unlock list not read yet from one that is empty", () => {
    // An outfit written against the first lost every pack item (2026-11-11).
    const w = Keypair.generate().publicKey.toBase58();
    expect(hasOnChainUnlocks(w)).toBe(false);
    setOnChainUnlocks(w, null); // read, and the account does not exist
    expect(hasOnChainUnlocks(w)).toBe(true);
    expect(hasOnChainUnlocks(null)).toBe(false);
  });

  it("does not invent a held list when the indexer's answer is unknown", () => {
    const w = Keypair.generate().publicKey.toBase58();
    setHeldItems(w, null);
    markHeld(w, [RED]);
    // Still unknown: the wardrobe falls back to the grant list, untouched.
    setOwedCopies(w, null);
    expect(isOwedMint(w, "accessory", red)).toBe(false);
  });
});

describe("asking the sponsor", () => {
  // A queue that loses five copies per request, whose answers never arrive.
  function fakeChain(wallet: PublicKey, start: number) {
    let owed = Array.from({ length: start }, () => A);
    return {
      shrink: () => { owed = owed.slice(5); },
      conn: {
        getMultipleAccountsInfo: async () => [
          { owner: SOL_CITY_COLLECTIBLES_PROGRAM_ID, data: queueBytes(wallet, owed) },
          null,
        ],
      },
    };
  }

  afterEach(() => vi.unstubAllGlobals());

  it("keeps asking while the queue shrinks, even when every answer is lost", async () => {
    const wallet = Keypair.generate().publicKey;
    const chain = fakeChain(wallet, 15);
    vi.stubGlobal("fetch", vi.fn(async () => { chain.shrink(); throw new Error("the answer was lost"); }));
    const out = await requestSponsoredMint(wallet, { conn: chain.conn as never });
    expect(out.left).toBe(0);
    expect(out.minted).toHaveLength(15);
  });

  it("stops when the sponsor is not there", async () => {
    const wallet = Keypair.generate().publicKey;
    const chain = fakeChain(wallet, 10);
    const fetchMock = vi.fn(async () => ({ json: async () => ({ status: "unavailable" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await requestSponsoredMint(wallet, { conn: chain.conn as never });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.left).toBe(10);
    expect(out.minted).toHaveLength(0);
  });
});
