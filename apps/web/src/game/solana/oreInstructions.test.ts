import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  buildCheckpoint,
  buildClaimOre,
  buildClaimSol,
  buildDeploy,
  maskToSquares,
  squaresToMask,
} from "./oreInstructions";

/**
 * The fixtures are a real mainnet Deploy (2QQimkFhChhi...) and a real
 * Checkpoint, decoded while writing the module. These instructions move real
 * SOL, so an encoding drift has to fail here rather than on someone's wallet.
 */
const AUTHORITY = new PublicKey("HduQUsZUfLkSUJzEkYDvGWujX4WhM7dYNTFKYfncf2pA");

describe("square masks", () => {
  it("converts both ways", () => {
    expect(squaresToMask([1])).toBe(0b1);
    expect(squaresToMask([1, 3, 5])).toBe(0b10101);
    expect(maskToSquares(0b10101)).toEqual([1, 3, 5]);
  });

  it("ignores squares off the board", () => {
    expect(squaresToMask([0, 26, 99])).toBe(0);
    expect(squaresToMask([25])).toBe(1 << 24);
  });
});

describe("Deploy", () => {
  const ix = buildDeploy(AUTHORITY, BigInt(2167236), squaresToMask([15]), BigInt(430144));

  it("encodes the 13 bytes the program reads", () => {
    expect(ix.data.length).toBe(13);
    expect(ix.data[0]).toBe(6);
    expect(ix.data.readBigUInt64LE(1)).toBe(BigInt(2167236));
    // Square 15 is bit 14, which is what the real transaction carried.
    expect(ix.data.readUInt32LE(9)).toBe(0b100000000000000);
  });

  it("passes the ten accounts in the order the program destructures", () => {
    expect(ix.keys.length).toBe(10);
    expect(ix.keys[0].isSigner).toBe(true);
    expect(ix.keys[3].pubkey.toBase58()).toBe("BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi");
    expect(ix.keys[5].pubkey.toBase58()).toBe("64S8Yxe45TZYkhSj49D3GnrY5iYKD6pnWbeYiWXajPK");
    expect(ix.keys[6].pubkey.toBase58()).toBe("8pXhAqZcyi4Bw4iCLYNZjENnDs3qSi4ioxP3ZWcRsUR6");
    expect(ix.keys[7].pubkey.toBase58()).toBe("45db2FSR4mcXdSVVZbKbwojU6uYDpMyhpEi7cC8nHaWG");
    // Everything but the two programs is written to.
    expect(ix.keys.slice(0, 8).every((k) => k.isWritable)).toBe(true);
    expect(ix.keys[8].isWritable).toBe(false);
    expect(ix.keys[9].isWritable).toBe(false);
  });

  it("carries no entropy accounts, since it only joins a live round", () => {
    expect(ix.keys.length).toBe(10);
  });
});

describe("Checkpoint", () => {
  const ix = buildCheckpoint(AUTHORITY, BigInt(430143));

  it("is one byte and eight accounts", () => {
    expect(ix.data.length).toBe(1);
    expect(ix.data[0]).toBe(2);
    expect(ix.keys.length).toBe(8);
  });

  it("points at the round being settled, not the current one", () => {
    expect(ix.keys[5].pubkey.toBase58()).toBe("BBbvJTgK3scTDJtwVx8Bgg4zNiZNancmDj4RwGcQmHSM");
  });
});

describe("claims", () => {
  it("ClaimSOL is one byte and five accounts", () => {
    const ix = buildClaimSol(AUTHORITY);
    expect(ix.data).toEqual(Buffer.from([3]));
    expect(ix.keys.length).toBe(5);
    expect(ix.keys[2].pubkey.toBase58()).toBe("64S8Yxe45TZYkhSj49D3GnrY5iYKD6pnWbeYiWXajPK");
  });

  it("ClaimORE asks for the whole reward and brings the token accounts", () => {
    const ix = buildClaimOre(AUTHORITY);
    expect(ix.data.length).toBe(9);
    expect(ix.data[0]).toBe(4);
    expect(ix.data.readBigUInt64LE(1)).toBe(BigInt(10_000));
    expect(ix.keys.length).toBe(11);
    expect(ix.keys[3].pubkey.toBase58()).toBe("oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp");
  });
});
