import { describe, it, expect } from "vitest";

import { DONATION_WALLET, LAMPORTS_PER_SOL, formatSol, shortWallet } from "./donationWallet";

describe("the donation wallet", () => {
  it("is a plausible base58 Solana address, since money is sent to it", () => {
    expect(DONATION_WALLET).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });
});

describe("formatSol", () => {
  it("shows a whole-SOL total to two places", () => {
    expect(formatSol(2 * LAMPORTS_PER_SOL)).toBe("2.00");
    expect(formatSol(12.345 * LAMPORTS_PER_SOL)).toBe("12.35");
  });

  it("gives a small donation three places, so it does not round away to nothing", () => {
    expect(formatSol(0.25 * LAMPORTS_PER_SOL)).toBe("0.250");
    expect(formatSol(0.001 * LAMPORTS_PER_SOL)).toBe("0.001");
  });

  it("says a dust amount is below the threshold rather than showing it as zero", () => {
    expect(formatSol(1)).toBe("<0.001");
    expect(formatSol(999)).toBe("<0.001");
  });

  it("shows a true zero as zero, which is what an empty board reads", () => {
    expect(formatSol(0)).toBe("0");
  });
});

describe("shortWallet", () => {
  it("keeps both ends, which is what makes an address recognisable", () => {
    expect(shortWallet(DONATION_WALLET)).toBe("FSej…UExm");
  });
});
