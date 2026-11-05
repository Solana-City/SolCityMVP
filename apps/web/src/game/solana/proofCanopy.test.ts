import { describe, it, expect } from "vitest";
import { Keypair } from "@solana/web3.js";
import { treeShapeOf, trimProof } from "./sealedPacks";

/**
 * The proof the indexer returns is the whole path; Bubblegum wants only what
 * the canopy does not hold. Sending the whole path made opening a sealed pack
 * 1575 bytes, over the 1232 a transaction may have (devnet, 2026-11-05).
 */

/** A tree account of the given shape: header fields set, the rest zeros. */
function treeAccount(maxDepth: number, maxBuffer: number, canopyDepth: number): Uint8Array {
  const tree = 24 + maxBuffer * (32 + 32 * maxDepth + 8) + (32 * maxDepth + 40);
  const canopy = 32 * (2 ** (canopyDepth + 1) - 2);
  const buf = Buffer.alloc(56 + tree + canopy);
  buf.writeUInt8(1, 0);            // account type: concurrent merkle tree
  buf.writeUInt8(0, 1);            // header version V1
  buf.writeUInt32LE(maxBuffer, 2);
  buf.writeUInt32LE(maxDepth, 6);
  return buf;
}

describe("a tree's shape, read from its account", () => {
  it("is depth 20, canopy 8 for the 60,600-byte tree mint-setup creates", () => {
    const data = treeAccount(20, 64, 8);
    expect(data.length).toBe(60_600);
    expect(treeShapeOf(data)).toEqual({ maxDepth: 20, canopyDepth: 8 });
  });

  it("reads a tree without a canopy as canopy 0", () => {
    expect(treeShapeOf(treeAccount(14, 64, 0))).toEqual({ maxDepth: 14, canopyDepth: 0 });
  });

  it("reads other shapes too", () => {
    expect(treeShapeOf(treeAccount(14, 64, 10)).canopyDepth).toBe(10);
    expect(treeShapeOf(treeAccount(17, 64, 8)).canopyDepth).toBe(8);
  });
});

describe("trimming the proof", () => {
  const full = Array.from({ length: 20 }, () => Keypair.generate().publicKey);

  it("keeps the nodes nearest the leaf, depth minus canopy of them", () => {
    const trimmed = trimProof(full, { maxDepth: 20, canopyDepth: 8 });
    expect(trimmed).toHaveLength(12);
    expect(trimmed).toEqual(full.slice(0, 12));
  });

  it("leaves a proof alone when the tree has no canopy, or is unknown", () => {
    expect(trimProof(full, { maxDepth: 20, canopyDepth: 0 })).toHaveLength(20);
    expect(trimProof(full, null)).toHaveLength(20);
  });

  it("does not grow an indexer's proof that came already trimmed", () => {
    expect(trimProof(full.slice(0, 12), { maxDepth: 20, canopyDepth: 8 })).toHaveLength(12);
  });
});
