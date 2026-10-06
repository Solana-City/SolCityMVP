import { describe, it, expect } from "vitest";
import {
  cityClaims,
  claimLogLine,
  countSquares,
  decodeClaim,
  encodeClaim,
  pruneClaims,
  recordClaim,
} from "./claimBroadcast";

describe("claim announcements", () => {
  it("survives a round trip", () => {
    const claim = { roundId: 430144, squares: 0b10101, sol: 0.05 };
    const decoded = decodeClaim(encodeClaim(claim));
    expect(decoded).toEqual({ roundId: 430144, squares: 0b10101, sol: 0.05 });
  });

  it("rejects anything that is not a claim", () => {
    expect(decodeClaim("hello")).toBeNull();
    expect(decodeClaim("§trade:buy:NVDA:10")).toBeNull();
    // A hand-typed tag must not be able to invent a square outside the board.
    expect(decodeClaim("§ore:430144:999999999:1")).toBeNull();
    expect(decodeClaim("§ore:0:1:1")).toBeNull();
    expect(decodeClaim("§ore:430144:0:1")).toBeNull();
  });

  it("counts squares in the mask", () => {
    expect(countSquares(0)).toBe(0);
    expect(countSquares(0b1)).toBe(1);
    expect(countSquares(0b10101)).toBe(3);
  });

  it("writes one line a player can read", () => {
    expect(claimLogLine({ roundId: 1, squares: 0b1, sol: 0.01 })).toBe("staked 0.010 SOL on 1 square");
    expect(claimLogLine({ roundId: 1, squares: 0b111, sol: 0.06 })).toBe("staked 0.060 SOL on 3 squares");
  });
});

describe("the city's claim map", () => {
  it("spreads a claim across its squares and counts the crowd", () => {
    recordClaim("alice", { roundId: 500, squares: 0b11, sol: 0.1 });
    recordClaim("bob", { roundId: 500, squares: 0b1, sol: 0.2 });
    const { squares, citizens } = cityClaims(500);
    expect(citizens).toBe(2);
    // Square 1: both of them, 0.05 from Alice plus 0.2 from Bob.
    expect(squares[0].citizens).toBe(2);
    expect(squares[0].sol).toBeCloseTo(0.25, 6);
    // Square 2: Alice's other half.
    expect(squares[1].citizens).toBe(1);
    expect(squares[1].sol).toBeCloseTo(0.05, 6);
    expect(squares[2].citizens).toBe(0);
  });

  it("ignores other rounds, and forgets them when they pass", () => {
    recordClaim("carol", { roundId: 501, squares: 0b100, sol: 0.3 });
    expect(cityClaims(500).citizens).toBe(2);
    expect(cityClaims(501).citizens).toBe(1);
    pruneClaims(501);
    expect(cityClaims(500).citizens).toBe(0);
    expect(cityClaims(501).citizens).toBe(1);
  });
});
