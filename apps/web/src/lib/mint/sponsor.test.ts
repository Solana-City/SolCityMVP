import { describe, it, expect } from "vitest";
import { Keypair } from "@solana/web3.js";
import { sponsorKeypair, sponsorMint } from "./sponsor";

describe("the sponsor wallet", () => {
  it("reads the JSON array solana-keygen writes", () => {
    const kp = Keypair.generate();
    const read = sponsorKeypair(JSON.stringify(Array.from(kp.secretKey)));
    expect(read?.publicKey.equals(kp.publicKey)).toBe(true);
  });

  it("is absent, not broken, when the variable is missing or malformed", () => {
    expect(sponsorKeypair(undefined)).toBeNull();
    expect(sponsorKeypair("")).toBeNull();
    expect(sponsorKeypair("not json")).toBeNull();
  });

  it("says unavailable without touching the network when there is no key", async () => {
    const out = await sponsorMint(Keypair.generate().publicKey, {
      sponsor: null,
      // Any call on this would throw: none must be made.
      conn: new Proxy({}, { get: () => { throw new Error("no network expected"); } }) as never,
    });
    expect(out.status).toBe("unavailable");
    expect(out.minted).toEqual([]);
  });
});
