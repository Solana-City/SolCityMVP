import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  accountDiscriminator,
  achievementIndices,
  achievementMask,
  ACHIEVEMENT_BITS,
  decodeFriendRequest,
  decodeFriendship,
  deriveFriendRequestPDA,
  deriveFriendshipPDA,
  FRIEND_ACCOUNT_SIZE,
  FRIEND_OFFSET,
  friendCounterpart,
  sortPair,
} from "./program";

/**
 * The friend accounts are addressed by their members, so the client and the
 * program have to agree on the byte-for-byte shape of two things: which of a
 * pair comes first, and where each field sits. Both are the kind of agreement
 * that fails silently - a wrong sort derives a PDA the program rejects as
 * unsorted, and a wrong offset reads a neighbouring pubkey - so they are
 * pinned here rather than discovered against a deployed program.
 */

/** Builds the 80 bytes the program writes, to decode back. */
function encodePair(disc: Buffer, a: PublicKey, b: PublicKey, ts: number): Uint8Array {
  const buf = Buffer.alloc(FRIEND_ACCOUNT_SIZE);
  disc.copy(buf, 0);
  a.toBuffer().copy(buf, FRIEND_OFFSET.first);
  b.toBuffer().copy(buf, FRIEND_OFFSET.second);
  buf.writeBigInt64LE(BigInt(ts), FRIEND_OFFSET.second + 32);
  return buf;
}

describe("sorting a pair", () => {
  it("orders by raw bytes, which is what Rust's Ord on Pubkey does", () => {
    const low = new PublicKey(new Uint8Array([0, ...new Array(31).fill(0)]));
    const high = new PublicKey(new Uint8Array([255, ...new Array(31).fill(0)]));
    expect(sortPair(low, high)).toEqual([low, high]);
    expect(sortPair(high, low)).toEqual([low, high]);
  });

  it("is stable whichever way the pair arrives", () => {
    for (let i = 0; i < 20; i++) {
      const x = Keypair.generate().publicKey;
      const y = Keypair.generate().publicKey;
      expect(sortPair(x, y)).toEqual(sortPair(y, x));
    }
  });

  it("does NOT follow base58 order, which is the trap it exists to avoid", () => {
    // Over enough random pairs, byte order and base58 string order disagree.
    // If they ever agreed everywhere, sorting by the string would look correct
    // and derive rejected PDAs only for some players.
    let disagreements = 0;
    for (let i = 0; i < 200; i++) {
      const x = Keypair.generate().publicKey;
      const y = Keypair.generate().publicKey;
      const [byteFirst] = sortPair(x, y);
      const stringFirst = x.toBase58() < y.toBase58() ? x : y;
      if (!byteFirst.equals(stringFirst)) disagreements++;
    }
    expect(disagreements).toBeGreaterThan(0);
  });
});

describe("deriving the accounts", () => {
  const alice = Keypair.generate().publicKey;
  const bob = Keypair.generate().publicKey;

  it("gives one friendship account per pair, in either order", () => {
    const [ab] = deriveFriendshipPDA(alice, bob);
    const [ba] = deriveFriendshipPDA(bob, alice);
    expect(ab.toBase58()).toBe(ba.toBase58());
  });

  it("keeps invites directional: who invited whom is part of the address", () => {
    const [aToB] = deriveFriendRequestPDA(alice, bob);
    const [bToA] = deriveFriendRequestPDA(bob, alice);
    expect(aToB.toBase58()).not.toBe(bToA.toBase58());
  });

  it("separates an invite from the friendship it becomes", () => {
    const [request] = deriveFriendRequestPDA(alice, bob);
    const [friendship] = deriveFriendshipPDA(alice, bob);
    expect(request.toBase58()).not.toBe(friendship.toBase58());
  });
});

describe("telling the two account kinds apart", () => {
  it("discriminates by name, since both are the same size", () => {
    const req = accountDiscriminator("FriendRequest");
    const fship = accountDiscriminator("Friendship");
    expect(req).toHaveLength(8);
    expect(fship).toHaveLength(8);
    // This inequality is the whole reason a getProgramAccounts filter can ask
    // for one kind: a dataSize filter alone would return both.
    expect(req.equals(fship)).toBe(false);
  });
});

describe("decoding", () => {
  const alice = Keypair.generate().publicKey;
  const bob = Keypair.generate().publicKey;

  it("reads a friendship back", () => {
    const [a, b] = sortPair(alice, bob);
    const bytes = encodePair(accountDiscriminator("Friendship"), a, b, 1_700_000_000);
    const f = decodeFriendship(bytes);
    expect(f?.a.toBase58()).toBe(a.toBase58());
    expect(f?.b.toBase58()).toBe(b.toBase58());
    expect(f?.since).toBe(1_700_000_000);
  });

  it("reads an invite back with its direction intact", () => {
    const bytes = encodePair(accountDiscriminator("FriendRequest"), alice, bob, 42);
    const r = decodeFriendRequest(bytes);
    expect(r?.from.toBase58()).toBe(alice.toBase58());
    expect(r?.to.toBase58()).toBe(bob.toBase58());
    expect(r?.createdAt).toBe(42);
  });

  it("refuses a buffer that is too short rather than reading past it", () => {
    expect(decodeFriendship(new Uint8Array(40))).toBeNull();
    expect(decodeFriendRequest(new Uint8Array(0))).toBeNull();
  });

  it("names the other side of a friendship", () => {
    const [a, b] = sortPair(alice, bob);
    const f = { a, b, since: 0 };
    expect(friendCounterpart(f, a).toBase58()).toBe(b.toBase58());
    expect(friendCounterpart(f, b).toBase58()).toBe(a.toBase58());
  });
});

describe("the achievement bitmask", () => {
  it("round-trips the indices it was built from", () => {
    const indices = [0, 1, 7, 8, 45, 255];
    expect([...achievementIndices(achievementMask(indices))].sort((p, q) => p - q))
      .toEqual(indices);
  });

  it("is empty when nothing is unlocked", () => {
    expect(achievementIndices(new Uint8Array(ACHIEVEMENT_BITS)).size).toBe(0);
  });

  it("holds the whole registry with room to spare", () => {
    // 46 achievements today; the mask is sized for 256 so the registry can
    // grow by appending without a redeploy. Appending only - reordering would
    // silently relabel every profile already published.
    expect(ACHIEVEMENT_BITS * 8).toBe(256);
  });

  it("drops an index that would not fit instead of corrupting a byte", () => {
    expect(achievementIndices(achievementMask([256, 1000, -1])).size).toBe(0);
  });

  it("sets the bit the program's own indexing would set", () => {
    // The program does `bits[i / 8] |= 1 << (i % 8)`. Index 9 must therefore
    // be byte 1, bit 1 - not byte 1, bit 0, and not big-endian within a byte.
    const mask = achievementMask([9]);
    expect(mask[0]).toBe(0);
    expect(mask[1]).toBe(0b10);
  });
});
