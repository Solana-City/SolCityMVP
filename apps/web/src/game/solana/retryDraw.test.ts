import { describe, it, expect } from "vitest";
import { Keypair, SystemProgram, SYSVAR_SLOT_HASHES_PUBKEY } from "@solana/web3.js";
import { buildRetryDrawIx, ixDiscriminator } from "./instructions";
import {
  SOL_CITY_COLLECTIBLES_PROGRAM_ID, deriveUnlockPDA, deriveSeasonDropsPDA,
  VRF_QUEUE_DEVNET, VRF_PROGRAM_ID, deriveVrfIdentityPDA,
} from "./program";

/**
 * `retry_draw`, pinned against the program's `RetryDraw` accounts.
 *
 * The one path a player reaches only when something has already gone wrong,
 * so it is the one least likely to be exercised by hand before it matters.
 * An account out of order here fails with a constraint error that says
 * nothing useful to somebody whose pack is stuck.
 */
describe("the retry_draw instruction", () => {
  const payer = Keypair.generate().publicKey;
  const seed = new Uint8Array(32).fill(7);
  const ix = buildRetryDrawIx({ payer, season: 3, clientSeed: seed });

  it("goes to the collectibles program with the discriminator and the seed", () => {
    expect(ix.programId.equals(SOL_CITY_COLLECTIBLES_PROGRAM_ID)).toBe(true);
    expect(ix.data.subarray(0, 8).equals(ixDiscriminator("retry_draw"))).toBe(true);
    expect(ix.data.length).toBe(8 + 32);
    expect([...ix.data.subarray(8)]).toEqual([...seed]);
  });

  it("names the accounts in RetryDraw's order", () => {
    const keys = ix.keys.map((k) => k.pubkey.toBase58());
    expect(keys).toEqual([
      payer,
      deriveUnlockPDA(payer)[0],
      deriveSeasonDropsPDA(3)[0],
      VRF_QUEUE_DEVNET,
      deriveVrfIdentityPDA()[0],
      VRF_PROGRAM_ID,
      SYSVAR_SLOT_HASHES_PUBKEY,
      SystemProgram.programId,
    ].map((k) => k.toBase58()));
  });

  it("takes the drop table from the season it is given, which is the draw's", () => {
    const other = buildRetryDrawIx({ payer, season: 4, clientSeed: seed });
    expect(other.keys[2].pubkey.equals(deriveSeasonDropsPDA(4)[0])).toBe(true);
    expect(other.keys[2].pubkey.equals(ix.keys[2].pubkey)).toBe(false);
  });

  it("signs with the payer only and writes nothing it does not have to", () => {
    expect(ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58()))
      .toEqual([payer.toBase58()]);
    // The unlock account is read, not written: the callback is what writes.
    expect(ix.keys[1].isWritable).toBe(false);
    expect(ix.keys[3].isWritable).toBe(true);
  });
});
