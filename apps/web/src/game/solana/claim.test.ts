import { describe, it, expect } from "vitest";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { buildClaimOwnedIx } from "./claim";
import {
  buildMintPendingIx, buildMintUnlockIx, deriveWearLogPDA, decodeWearLog, type MintConfigAccount,
} from "./mint";
import { SOL_CITY_COLLECTIBLES_PROGRAM_ID, deriveUnlockPDA, deriveMintQueuePDA } from "./program";

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
  paused: false,
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
  it("name the payer's WearLog, then its MintQueue last, both of them", () => {
    for (const ix of [
      buildMintUnlockIx({ payer: claimer, index: 1600, config }),
      buildMintPendingIx({ payer: claimer, limit: 5, config }),
    ]) {
      const [log, queue] = ix.keys.slice(-2);
      expect(log.pubkey.equals(deriveWearLogPDA(claimer))).toBe(true);
      expect(log.isWritable).toBe(true);
      expect(queue.pubkey.equals(deriveMintQueuePDA(claimer))).toBe(true);
      expect(queue.isWritable).toBe(true);
    }
  });

  it("let a sponsor pay for the owner's mint, and give the owner everything", () => {
    const sponsor = Keypair.generate().publicKey;
    const { keys } = buildMintPendingIx({ payer: sponsor, owner: claimer, limit: 5, config });
    // The sponsor signs and pays; the owner signs nothing.
    expect(keys[0].pubkey.equals(sponsor)).toBe(true);
    expect(keys[0].isSigner).toBe(true);
    expect(keys[1].pubkey.equals(claimer)).toBe(true);
    expect(keys[1].isSigner).toBe(false);
    // The UnlockState, the WearLog and the MintQueue are the owner's, never
    // the sponsor's: what is minted is the owner's queue, to the owner.
    expect(keys[2].pubkey.equals(deriveUnlockPDA(claimer)[0])).toBe(true);
    expect(keys[keys.length - 2].pubkey.equals(deriveWearLogPDA(claimer))).toBe(true);
    expect(keys[keys.length - 1].pubkey.equals(deriveMintQueuePDA(claimer))).toBe(true);
    expect(keys.some((k) => k.pubkey.equals(deriveWearLogPDA(sponsor)))).toBe(false);
    expect(keys.some((k) => k.pubkey.equals(deriveMintQueuePDA(sponsor)))).toBe(false);
    // Nobody else is asked to sign.
    expect(keys.filter((k) => k.isSigner)).toHaveLength(1);
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

  it("carries the index, root, nonce and leaf index in that order", () => {
    const data = buildClaimOwnedIx({ claimer, item, proof, config, previousHolder: seller }).data;
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
