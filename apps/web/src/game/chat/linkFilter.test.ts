import { describe, expect, it } from "vitest";
import { containsLink, maskLinks } from "./linkFilter";

describe("containsLink", () => {
  it.each([
    "go to https://claim-sol.xyz now",
    "http://x.io",
    "hxxps://drainer.site/claim",
    "www.freeairdrop.com",
    "claim at solana-airdrop.xyz",
    "join t.me/supportsol",
    "discord.gg/abc123",
    "sol dot io",
    "airdrop[.]com",
    "airdrop (.) com",
    "visit phantom.app/connect",
    "solana:9592QS34mPUwqA7sPAkug1kcuFddjn59QPQMzzCgKhEp",
  ])("blocks %s", (text) => {
    expect(containsLink(text)).toBe(true);
  });

  it.each([
    "gm everyone",
    "price is 1.5 SOL",
    "wait... what",
    "ok.",
    "lets meet at the fountain",
    "e.g. the swap guy",
    "v2.0 is live",
  ])("allows %s", (text) => {
    expect(containsLink(text)).toBe(false);
  });
});

describe("maskLinks", () => {
  it("masks the link and keeps the rest", () => {
    expect(maskLinks("free sol at claim.xyz hurry")).toBe("free sol at [link removed] hurry");
  });

  it("leaves clean text alone", () => {
    expect(maskLinks("gm 1.5 SOL")).toBe("gm 1.5 SOL");
  });
});
