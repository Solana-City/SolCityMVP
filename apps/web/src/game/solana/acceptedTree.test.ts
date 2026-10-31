import { describe, it, expect } from "vitest";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { buildOpenPackFromAssetIx } from "./sealedPacks";
import { acceptedTreeSlot, deriveAcceptedTreePDA, type MintConfigAccount } from "./mint";
import { SOL_CITY_COLLECTIBLES_PROGRAM_ID } from "./program";

/**
 * A sealed pack from before a tree rotation still opens, and as itself.
 *
 * The owner's rule (2026-10-31): an old pack opens with the terms it was sold
 * with, and is never stuck. On the client that comes down to two things that
 * are easy to get quietly wrong: burning it in the tree it actually lives in,
 * not the config's, and passing that tree's marker. Both are pinned here.
 */
const current = Keypair.generate().publicKey;
const old = Keypair.generate().publicKey;
const config = {
  admin: Keypair.generate().publicKey,
  merkleTree: current,
  collectionMint: Keypair.generate().publicKey,
  royaltyRecipient: Keypair.generate().publicKey,
  sellerFeeBasisPoints: 500,
  symbol: "SCC",
  baseUri: "https://example.test/",
} as MintConfigAccount;

const build = (tree: PublicKey) => buildOpenPackFromAssetIx({
  opener: Keypair.generate().publicKey,
  pack: { id: 1, season: 1, price: BigInt(1), size: 5, weights: [7200, 2200, 500, 100], enabled: false },
  mintConfig: config,
  clientSeed: new Uint8Array(32),
  proof: { root: Keypair.generate().publicKey, proof: [Keypair.generate().publicKey], nodeIndex: 0, tree },
  nonce: 3,
  metadata: Buffer.alloc(0),
});

describe("the accepted-tree slot", () => {
  it("is empty (the program id) for the current tree", () => {
    expect(acceptedTreeSlot(current, config).equals(SOL_CITY_COLLECTIBLES_PROGRAM_ID)).toBe(true);
  });

  it("is that tree's own marker for an old tree", () => {
    expect(acceptedTreeSlot(old, config).equals(deriveAcceptedTreePDA(old))).toBe(true);
    expect(deriveAcceptedTreePDA(old).equals(deriveAcceptedTreePDA(current))).toBe(false);
  });
});

describe("opening a sealed pack", () => {
  it("burns in the tree the pack lives in, with that tree's marker", () => {
    const keys = build(old).keys;
    expect(keys[6].pubkey.equals(old)).toBe(true);
    // System program, then accepted_tree, then the proof.
    expect(keys[14].pubkey.equals(SystemProgram.programId)).toBe(true);
    expect(keys[15].pubkey.equals(deriveAcceptedTreePDA(old))).toBe(true);
    expect(keys.length).toBe(17);
  });

  it("passes no marker for a pack in the current tree", () => {
    const keys = build(current).keys;
    expect(keys[6].pubkey.equals(current)).toBe(true);
    expect(keys[15].pubkey.equals(SOL_CITY_COLLECTIBLES_PROGRAM_ID)).toBe(true);
  });

  it("keeps the pack's own season, whatever tree holds it", () => {
    // Terms come from the pack id, never from the tree: season 1's table.
    expect(build(old).keys[3].pubkey.equals(build(current).keys[3].pubkey)).toBe(true);
  });
});
