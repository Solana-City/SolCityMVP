import { describe, it, expect } from "vitest";

import {
  SEND_TOKENS, DEFAULT_SEND_TOKEN, getSendToken, sendTokenLabel,
  normalizeAmount, explorerUrl,
} from "./sendTokens";

describe("the send catalog", () => {
  it("defaults to practice money, never the player's real balance", () => {
    expect(DEFAULT_SEND_TOKEN.cluster).toBe("devnet");
    expect(DEFAULT_SEND_TOKEN.symbol).toBe("SOL");
  });

  it("gives the two SOL entries separate ids, since the symbol cannot tell them apart", () => {
    const sols = SEND_TOKENS.filter((t) => t.symbol === "SOL");
    expect(sols).toHaveLength(2);
    expect(new Set(sols.map((t) => t.id)).size).toBe(2);
    expect(sols.map((t) => t.cluster).sort()).toEqual(["devnet", "mainnet"]);
  });

  it("has a unique id per entry, so the picker cannot resolve the wrong token", () => {
    expect(new Set(SEND_TOKENS.map((t) => t.id)).size).toBe(SEND_TOKENS.length);
  });

  it("offers the tokens the city promises: Seeker, USDC, USDT and the rest", () => {
    const symbols = new Set(SEND_TOKENS.map((t) => t.symbol));
    for (const s of ["SOL", "USDC", "USDT", "SKR", "JUP", "BONK"]) {
      expect(symbols.has(s)).toBe(true);
    }
  });

  it("treats native SOL as a null mint and every other token as an SPL mint", () => {
    for (const t of SEND_TOKENS) {
      if (t.symbol === "SOL") expect(t.mint).toBeNull();
      else expect(typeof t.mint).toBe("string");
    }
  });

  it("marks only devnet as practice, so a real token can never read as free", () => {
    for (const t of SEND_TOKENS) {
      expect(t.note).toBe(t.cluster === "devnet" ? "practice" : "real");
    }
  });

  it("names the devnet entry as devnet in a receipt, and leaves real tokens bare", () => {
    expect(sendTokenLabel(getSendToken("sol-devnet")!)).toBe("SOL (devnet)");
    expect(sendTokenLabel(getSendToken("sol")!)).toBe("SOL");
    expect(sendTokenLabel(getSendToken("usdc")!)).toBe("USDC");
  });

  it("returns nothing for an id it does not know", () => {
    expect(getSendToken("dogecoin")).toBeUndefined();
  });
});

describe("normalizeAmount", () => {
  it("accepts a comma for the decimal point, which is how half the city types", () => {
    expect(normalizeAmount("0,5")).toBe("0.5");
    expect(normalizeAmount("1,25")).toBe("1.25");
  });

  it("leaves a plain decimal alone and trims stray spaces", () => {
    expect(normalizeAmount("0.5")).toBe("0.5");
    expect(normalizeAmount("  2  ")).toBe("2");
  });

  it("rejects text that is not a number, rather than letting BigInt throw at the player", () => {
    for (const bad of ["", " ", ".", "abc", "1.2.3", "-1", "1e9", "0,5,5"]) {
      expect(normalizeAmount(bad)).toBeNull();
    }
  });
});

describe("explorerUrl", () => {
  it("sends a devnet signature to the devnet explorer and a real one to mainnet", () => {
    expect(explorerUrl("sig123", "devnet")).toContain("?cluster=devnet");
    expect(explorerUrl("sig123", "mainnet")).not.toContain("cluster=");
  });
});
