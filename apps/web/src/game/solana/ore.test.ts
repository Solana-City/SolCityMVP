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
