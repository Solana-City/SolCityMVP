import { describe, it, expect } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { buildMintPendingTxs, MINTS_PER_TX, type MintConfigAccount } from "./mint";
import { ixDiscriminator } from "./instructions";

/**
 * The transactions that deliver a pack without asking twice.
 *
 * What is being pinned here is that they can be BUILT at all before the draw
 * exists: nothing below knows which cosmetics are coming, and that is the
 * whole reason the wallet can sign them next to the payment.
 */
describe("the pre-signed mint", () => {
  const config: MintConfigAccount = {
    admin: Keypair.generate().publicKey,
    merkleTree: Keypair.generate().publicKey,
    collectionMint: Keypair.generate().publicKey,
    royaltyRecipient: Keypair.generate().publicKey,
    sellerFeeBasisPoints: 500,
    symbol: "SCC",
    baseUri: "https://example.test/",
  };
  const wallet = Keypair.generate().publicKey;
  // Any 32 bytes in base58 will do: nothing here reaches a network.
  const blockhash = new PublicKey(new Uint8Array(32).fill(7)).toBase58();

  const build = (items: number) => buildMintPendingTxs({ wallet, config, items, blockhash });

  it("sends a whole pack in one transaction", () => {
    expect(build(5)).toHaveLength(1);
    expect(MINTS_PER_TX).toBeGreaterThanOrEqual(5);
  });

  it("splits a bundle, and the last chunk asks only for what is left", () => {
    const txs = build(12);
    expect(txs).toHaveLength(3);
    const limits = txs.map((tx) => tx.instructions[1].data.readUInt8(8));
    expect(limits).toEqual([5, 5, 2]);
  });

  it("carries mint_pending and no index at all", () => {
    const [ix] = build(5).map((tx) => tx.instructions[1]);
    expect(ix.data.subarray(0, 8).equals(ixDiscriminator("mint_pending"))).toBe(true);
    // Eight bytes of discriminator and one of count. An index would be two
    // more, and those two bytes are what nobody can know yet.
    expect(ix.data).toHaveLength(9);
  });

  /**
   * The subtlety worth a test of its own.
   *
   * Equal chunks share a blockhash, a signer and their instructions, so
   * without something to tell them apart they hash to ONE signature and the
   * network keeps a single copy. Half a bundle would quietly never arrive.
   */
  it("makes equal chunks distinct transactions", () => {
    const txs = build(10);
    expect(txs).toHaveLength(2);
    const [a, b] = txs.map((tx) => tx.compileMessage().serialize().toString("hex"));
    expect(a).not.toBe(b);
  });

  it("asks for a compute limit, which the default 200k would not cover", () => {
    const [tx] = build(5);
    expect(tx.instructions[0].programId.toBase58())
      .toBe("ComputeBudget111111111111111111111111111111");
    expect(tx.instructions[0].data.readUInt32LE(1)).toBeGreaterThan(200_000);
    // And still inside what a transaction may ask for.
    expect(tx.instructions[0].data.readUInt32LE(1)).toBeLessThanOrEqual(1_400_000);
  });

  it("has nothing to do for nothing owed", () => {
    expect(build(0)).toHaveLength(0);
  });
});
