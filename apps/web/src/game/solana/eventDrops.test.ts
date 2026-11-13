import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  eventLeaf, eventRoot, eventProof, verifyEventProof, decodeEventDrop,
  buildClaimEventItemIx, deriveEventDropPDA, deriveEventClaimPDA, toHex, fromHex,
} from "./eventDrops";
import { ixDiscriminator } from "./instructions";
import { globalIndexOf, EVENT_BLOCK_START, EVENT_BLOCK_END } from "@/game/config/catalogIndex";

const wallet = (n: number) => new PublicKey(new Uint8Array(32).fill(n));

describe("event drop proofs", () => {
  // Pinned on the program side too (event_drops tests in
  // sol-city-collectibles): if either hash changes, one of them fails.
  it("builds the root the program checks against", () => {
    const leaves = [1, 2, 3].map((n) => eventLeaf(1, wallet(n)));
    expect(toHex(eventRoot(leaves))).toBe(
      "8849ed3ecd2f15719c8c3a44a51fb7732e287949e67efb8fa1e6e173c293d3f0",
    );
    expect(eventProof(leaves, leaves[1])!.map(toHex)).toEqual([
      "76538fc7df6737b28e382e8174d44fc86b985d016950db7eb9a55e2a6f8d24d6",
      "81be021b6a1b1af81c7a7da23ec7b41c8f71e80fdd02edffb8ff55f94105f658",
    ]);
  });

  it("proves every winner, for any list size, and nobody else", () => {
    for (const size of [1, 2, 3, 7, 10, 33, 100]) {
      const leaves = Array.from({ length: size }, (_, i) => eventLeaf(1, wallet(i + 1)));
      const root = eventRoot(leaves);
      for (const leaf of leaves) {
        const proof = eventProof(leaves, leaf)!;
        expect(proof.length).toBeLessThanOrEqual(Math.ceil(Math.log2(size)));
        expect(verifyEventProof(root, leaf, proof)).toBe(true);
      }
      expect(eventProof(leaves, eventLeaf(1, wallet(200)))).toBeNull();
    }
  });

  it("does not let a proof for one event claim another", () => {
    const leaves = [1, 2, 3].map((n) => eventLeaf(1, wallet(n)));
    const proof = eventProof(leaves, leaves[0])!;
    expect(verifyEventProof(eventRoot(leaves), eventLeaf(2, wallet(1)), proof)).toBe(false);
  });

  it("is the same root whatever order the list comes in, and with repeats", () => {
    const a = [1, 2, 3, 4, 5].map((n) => eventLeaf(1, wallet(n)));
    const b = [a[3], a[0], a[4], a[1], a[2], a[0]];
    expect(toHex(eventRoot(b))).toBe(toHex(eventRoot(a)));
  });
});

describe("event drop accounts and instruction", () => {
  it("decodes id, index and root after the discriminator", () => {
    const data = new Uint8Array(8 + 36);
    data.set([1, 0, 0x34, 0x12], 8);
    data.fill(7, 12);
    const drop = decodeEventDrop(data)!;
    expect(drop.id).toBe(1);
    expect(drop.index).toBe(0x1234);
    expect(drop.root).toEqual(new Uint8Array(32).fill(7));
  });

  it("encodes claim_event_item as id u16, then the proof as a Vec", () => {
    const proof = [fromHex("aa".repeat(32)), fromHex("bb".repeat(32))];
    const ix = buildClaimEventItemIx(wallet(1), 1, 34752, proof);
    expect(ix.data.subarray(0, 8)).toEqual(ixDiscriminator("claim_event_item"));
    expect([...ix.data.subarray(8, 14)]).toEqual([1, 0, 2, 0, 0, 0]);
    expect(ix.data.length).toBe(8 + 2 + 4 + 64);
    expect(ix.keys[0]).toMatchObject({ isSigner: true, isWritable: true });
    expect(ix.keys[2].pubkey.equals(deriveEventDropPDA(1))).toBe(true);
  });

  // The receipt is what stops a second claim after a sale (audit r2, R2-01).
  // It goes last, writable, and is keyed by item and wallet, not by drop.
  it("sends the claim receipt for this item and wallet, last", () => {
    const ix = buildClaimEventItemIx(wallet(1), 1, 34752, []);
    const last = ix.keys[ix.keys.length - 1];
    expect(last.pubkey.equals(deriveEventClaimPDA(34752, wallet(1)))).toBe(true);
    expect(last).toMatchObject({ isSigner: false, isWritable: true });
    expect(deriveEventClaimPDA(34752, wallet(1)).equals(deriveEventClaimPDA(34752, wallet(2)))).toBe(false);
    expect(deriveEventClaimPDA(34752, wallet(1)).equals(deriveEventClaimPDA(34753, wallet(1)))).toBe(false);
  });

  it("the Halloween reward sits in the event block the program accepts", () => {
    const index = globalIndexOf("hat", "Pumpkin_head");
    expect(index).toBeGreaterThanOrEqual(EVENT_BLOCK_START);
    expect(index).toBeLessThan(EVENT_BLOCK_END);
  });
});
