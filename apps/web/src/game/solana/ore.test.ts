import { describe, it, expect } from "vitest";
import {
  MINER_ACCOUNT_SIZE,
  ORE_BOARD,
  ORE_CONFIG,
  ORE_TREASURY,
  automationPda,
  minerPda,
  roundPda,
  formatOre,
  needsCheckpoint,
  roundProgress,
  topMinerReward,
  winningSquare,
} from "./ore";
import { PublicKey } from "@solana/web3.js";

/**
 * Guards the hand-rolled ORE layouts. There is no TypeScript SDK for ORE v3, so
 * these offsets came from reading Rust, and the fixtures below are real mainnet
 * values captured while writing the module. If a layout drifts, this fails here
 * rather than against a player's wallet.
 */
describe("ORE account layout", () => {
  it("the miner layout adds up to the real account size", () => {
    // Observed on mainnet: miner 64S8Yxe45TZYkhSj49D3GnrY5iYKD6pnWbeYiWXajPK.
    expect(MINER_ACCOUNT_SIZE).toBe(752);
  });

  it("derives the PDAs seen in a real Deploy transaction", () => {
    // From 31GDqAvUifaVdvWu4XWL..., a Deploy by this authority.
    const authority = new PublicKey("HduQUsZUfLkSUJzEkYDvGWujX4WhM7dYNTFKYfncf2pA");
    expect(minerPda(authority).toBase58()).toBe("64S8Yxe45TZYkhSj49D3GnrY5iYKD6pnWbeYiWXajPK");
    expect(automationPda(authority).toBase58()).toBe("6RJZstfWPt8GTrLgNFT4um3Gv2MnGqb7pVAtsCxH6wVQ");
    expect(roundPda(BigInt(430144)).toBase58()).toBe("8pXhAqZcyi4Bw4iCLYNZjENnDs3qSi4ioxP3ZWcRsUR6");
  });

  it("knows the fixed program accounts", () => {
    expect(ORE_BOARD.toBase58()).toBe("BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi");
    expect(ORE_CONFIG.toBase58()).toBe("9c9X7aDRAF41faiDs94ELjT19UrGnn72wBW9hPsS4Awy");
    expect(ORE_TREASURY.toBase58()).toBe("45db2FSR4mcXdSVVZbKbwojU6uYDpMyhpEi7cC8nHaWG");
  });
});

describe("ORE helpers", () => {
  const board = {
    roundId: BigInt(430144),
    startSlot: BigInt(453892188),
    endSlot: BigInt(453892428),
    productionCostEma: BigInt(736532984),
  };

  it("measures progress through a round", () => {
    expect(roundProgress(board, 453892188)).toBe(0);
    expect(roundProgress(board, 453892308)).toBeCloseTo(0.5, 2);
    expect(roundProgress(board, 453892428)).toBe(1);
    // Clamped, so a stale slot cannot overflow a progress bar.
    expect(roundProgress(board, 453999999)).toBe(1);
  });

  it("formats ORE at 11 decimals", () => {
    expect(formatOre(BigInt(100_000_000_000))).toBe("1.0000");
    expect(formatOre(BigInt(50_000_000_000))).toBe("0.5000");
    expect(formatOre(BigInt(0))).toBe("0.0000");
  });

  it("asks for a checkpoint only when one is owed", () => {
    expect(needsCheckpoint(null, board)).toBe(false);
    // Deployed this round already: nothing owed.
    const current = { roundId: BigInt(430144), checkpointId: BigInt(430143) } as never;
    expect(needsCheckpoint(current, board)).toBe(false);
    // Left a previous round unchecked.
    const stale = { roundId: BigInt(430143), checkpointId: BigInt(430142) } as never;
    expect(needsCheckpoint(stale, board)).toBe(true);
  });
});

describe("the winning square", () => {
  /** Round 430418 on mainnet, whose entropy and winner were read from chain. */
  const round = (hex: string) =>
    ({ slotHash: Buffer.from(hex, "hex"), rewards: [], count: [], deployed: [] }) as never;

  it("derives it from the round's entropy, not from the rewards array", () => {
    expect(
      winningSquare(round("267cf01c5e5f44b75d879c3579cf7323baaa8c6792fc02796f7c78243732db2f")),
    ).toBe(24);
  });

  it("XORs the four halves, so a zeroed hash lands on square 1", () => {
    expect(winningSquare(round("00".repeat(32)))).toBe(1);
    // r1 = 5, the other three zero: 5 % 25 = 5, which is square 6.
    expect(winningSquare(round("0500000000000000" + "00".repeat(24)))).toBe(6);
    // The same value in two halves cancels out.
    expect(winningSquare(round("0500000000000000" + "0500000000000000" + "00".repeat(16)))).toBe(1);
  });

  it("sums the rewards array for the top miner's prize", () => {
    const r = { rewards: [BigInt(100_000_000_000), ...Array(24).fill(BigInt(0))] } as never;
    expect(topMinerReward(r)).toBe(BigInt(100_000_000_000));
  });
});
