import { describe, it, expect } from "vitest";
import { PublicKey, Keypair } from "@solana/web3.js";
import { encodeMetadataArgs } from "./sealedPacks";

/**
 * The metadata encoding, pinned byte for byte.
 *
 * This is the one place in the pack flow where being subtly wrong produces no
 * error worth reading. Bubblegum hashes these bytes to find the leaf, so a
 * field in the wrong order, or one flag inverted, yields a proof that simply
 * does not burn. The transaction fails and nothing says why.
 *
 * It cannot be checked against a live tree in a unit test, so what is checked
 * here is that the layout does not drift: the shape was derived from the
 * program's MetadataArgs once, and these assertions are what make a later
 * edit to it loud.
 */
describe("the sealed pack's metadata encoding", () => {
  const collection = new PublicKey("11111111111111111111111111111112");
  const creator = Keypair.generate().publicKey;

  const encode = () => encodeMetadataArgs({
    name: "Sol City Pack #1",
    symbol: "SCC",
    uri: "https://example.test/pack-1.json",
    sellerFeeBasisPoints: 500,
    collectionMint: collection,
    creator,
  });

  it("writes each string as a 4-byte length and its bytes", () => {
    const b = encode();
    expect(b.readUInt32LE(0)).toBe("Sol City Pack #1".length);
    const afterName = 4 + "Sol City Pack #1".length;
    expect(b.readUInt32LE(afterName)).toBe("SCC".length);
  });

  it("puts the royalty where the program reads it", () => {
    const b = encode();
    const at = 4 + "Sol City Pack #1".length + 4 + "SCC".length
      + 4 + "https://example.test/pack-1.json".length;
    expect(b.readUInt16LE(at)).toBe(500);
    expect(b[at + 2]).toBe(1);   // primary_sale_happened
    expect(b[at + 3]).toBe(0);   // is_mutable
  });

  /**
   * The subtlety worth a test of its own.
   *
   * `mint_pack` passes `verified: false`, and Bubblegum's
   * MintToCollectionV1 flips it to true before hashing, because setting it is
   * what that instruction is FOR. The leaf on chain is therefore the verified
   * version, so rebuilding it as false would hash to something that is not in
   * the tree. Both programs are right and the two values differ on purpose.
   */
  it("rebuilds the collection as VERIFIED, which is not what mint_pack passed", () => {
    const b = encode();
    const at = 4 + "Sol City Pack #1".length + 4 + "SCC".length
      + 4 + "https://example.test/pack-1.json".length;
    // sfbp(2) + sale(1) + mutable(1) + edition None(1) + standard Some(2)
    const collectionAt = at + 2 + 1 + 1 + 1 + 2;
    expect(b[collectionAt]).toBe(1);      // Option::Some
    expect(b[collectionAt + 1]).toBe(1);  // verified = true
    expect(new PublicKey(b.subarray(collectionAt + 2, collectionAt + 34)).toBase58())
      .toBe(collection.toBase58());
  });

  it("ends with one unverified creator holding the whole share", () => {
    const b = encode();
    const tail = b.subarray(b.length - 34);
    expect(new PublicKey(tail.subarray(0, 32)).toBase58()).toBe(creator.toBase58());
    expect(tail[32]).toBe(0);    // verified: creators are never verified here
    expect(tail[33]).toBe(100);  // the whole royalty share
  });

  it("is stable: the same input gives the same bytes", () => {
    expect(encode().equals(encode())).toBe(true);
  });
});
