import { describe, it, expect } from "vitest";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { buildClaimOwnedIx } from "./claim";
import {
  buildMintPendingIx, buildMintUnlockIx, deriveWearLogPDA, decodeWearLog, type MintConfigAccount,
} from "./mint";
import { SOL_CITY_COLLECTIBLES_PROGRAM_ID, deriveUnlockPDA } from "./program";

/**
 * One asset, one wearer (audit R-21), pinned on the client side: the mints
 * name the wallet's WearLog, and a claim names the previous holder's log and
 * unlocks exactly where `ClaimOwnedFromAsset` expects them.
 */
const config: MintConfigAccount = {
  admin: Keypair.generate().publicKey,
  merkleTree: Keypair.generate().publicKey,
  collectionMint: Keypair.generate().publicKey,
  royaltyRecipient: Keypair.generate().publicKey,
  sellerFeeBasisPoints: 500,
  symbol: "SCC",
  baseUri: "https://example.test/",
};
const claimer = Keypair.generate().publicKey;
const seller = Keypair.generate().publicKey;
const item = { index: 1600, assetId: Keypair.generate().publicKey, leafId: 7 };
const proof = {
  root: Keypair.generate().publicKey,
  proof: [Keypair.generate().publicKey, Keypair.generate().publicKey],
  nodeIndex: 0,
  tree: config.merkleTree,
};

describe("the mints", () => {
  it("name the payer's WearLog last, both of them", () => {
    for (const ix of [
      buildMintUnlockIx({ payer: claimer, index: 1600, config }),
      buildMintPendingIx({ payer: claimer, limit: 5, config }),
    ]) {
      const last = ix.keys[ix.keys.length - 1];
      expect(last.pubkey.equals(deriveWearLogPDA(claimer))).toBe(true);
      expect(last.isWritable).toBe(true);
    }
  });
});

describe("a claim", () => {
  it("takes the right from the previous holder when there is one", () => {
    const keys = buildClaimOwnedIx({ claimer, item, proof, config, previousHolder: seller }).keys;
    expect(keys[5].pubkey.equals(SystemProgram.programId)).toBe(true);
    expect(keys[7].pubkey.equals(deriveWearLogPDA(claimer))).toBe(true);
    expect(keys[8].pubkey.equals(deriveWearLogPDA(seller))).toBe(true);
    expect(keys[8].isWritable).toBe(true);
    expect(keys[9].pubkey.equals(deriveUnlockPDA(seller)[0])).toBe(true);
    expect(keys[9].isWritable).toBe(true);
    // Then the proof.
    expect(keys.slice(10).map((k) => k.pubkey.toBase58())).toEqual(proof.proof.map((p) => p.toBase58()));
  });

  it("passes the program id for both when nobody's right comes from this asset", () => {
    const keys = buildClaimOwnedIx({ claimer, item, proof, config, previousHolder: null }).keys;
    expect(keys[8].pubkey.equals(SOL_CITY_COLLECTIBLES_PROGRAM_ID)).toBe(true);
    expect(keys[9].pubkey.equals(SOL_CITY_COLLECTIBLES_PROGRAM_ID)).toBe(true);
    expect(keys[8].isWritable).toBe(false);
  });

  it("carries the index, root, nonce and leaf index in that order", () => {
    const data = buildClaimOwnedIx({ claimer, item, proof, config, previousHolder: null }).data;
    expect(data.readUInt16LE(8)).toBe(1600);
    expect(new PublicKey(data.subarray(10, 42)).equals(proof.root)).toBe(true);
    expect(data.readBigUInt64LE(42)).toBe(BigInt(7));
    expect(data.readUInt32LE(50)).toBe(7);
  });
});

describe("a WearLog", () => {
  it("decodes the entries the program writes", () => {
    const asset = Keypair.generate().publicKey;
    const buf = Buffer.alloc(8 + 32 + 4 + 34);
    seller.toBuffer().copy(buf, 8);
    buf.writeUInt32LE(1, 40);
    buf.writeUInt16LE(1600, 44);
    asset.toBuffer().copy(buf, 46);
    const log = decodeWearLog(buf)!;
    expect(log.wallet.equals(seller)).toBe(true);
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0].index).toBe(1600);
    expect(log.entries[0].asset.equals(asset)).toBe(true);
  });

  it("refuses bytes that claim more entries than they hold", () => {
    const buf = Buffer.alloc(8 + 32 + 4);
    buf.writeUInt32LE(3, 40);
    expect(decodeWearLog(buf)).toBeNull();
  });
});
