import { describe, it, expect, vi, beforeEach } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { verifySessionOwner, resetSessionOwnerCache } from "./sessionAuth";
import { DELEGATION_PROGRAM_ID, SOL_CITY_PROGRAM_ID, derivePlayerPDA } from "@/game/solana/program";
import { delegationRecordPdaFromDelegatedAccount } from "@magicblock-labs/ephemeral-rollups-sdk";
import { ER_VALIDATORS } from "@/game/multiplayer/erValidators";

/**
 * The server trusts a session key only if it is the one on the CURRENT copy
 * of the player account (audit R-16). A delegated account has two copies, and
 * the base one is frozen at delegation: a key the player has since replaced
 * is still written there. It must not vouch for anybody.
 */
const wallet = Keypair.generate().publicKey;
// Fresh keys per test: a match is remembered in the store for its few
// minutes, and that memory is the cache working, not the copy being chosen.
let oldKey = "";
let newKey = "";

function playerBytes(sessionKey: string): string {
  const buf = Buffer.alloc(8 + 32 + 1 + 32);
  wallet.toBuffer().copy(buf, 8);
  buf[40] = 1;
  new PublicKey(sessionKey).toBuffer().copy(buf, 41);
  return buf.toString("base64");
}

/** The delegation record on base names the US rollup (validator in bytes 8..40). */
const RECORD = delegationRecordPdaFromDelegatedAccount(derivePlayerPDA(wallet)[0]).toBase58();
const US = ER_VALIDATORS.find((v) => v.id === "us")!;
function recordBytes(): string {
  const buf = Buffer.alloc(8 + 32 + 32);
  new PublicKey(US.identity).toBuffer().copy(buf, 8);
  return buf.toString("base64");
}

/** Answers getAccountInfo: the rollup one way, every base endpoint another. */
function chain(base: { owner: string; key: string }, rollup: { key: string } | null) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: string }) => {
    const address = init?.body ? JSON.parse(init.body).params?.[0] : undefined;
    if (address === RECORD) {
      return { json: async () => ({ result: { value: { owner: DELEGATION_PROGRAM_ID.toBase58(), data: [recordBytes(), "base64"] } } }) };
    }
    // Only the rollup the record names may vouch: any other host answers nothing.
    const isRollup = String(url) === US.rpc || String(url).startsWith(US.rpc);
    if (!isRollup && String(url).includes("magicblock")) return { json: async () => ({ result: { value: null } }) };
    const value = isRollup
      ? (rollup ? { owner: SOL_CITY_PROGRAM_ID.toBase58(), data: [playerBytes(rollup.key), "base64"] } : null)
      : { owner: base.owner, data: [playerBytes(base.key), "base64"] };
    return { json: async () => ({ result: { value } }) };
  }));
}

describe("which copy vouches for a session key", () => {
  beforeEach(() => {
    resetSessionOwnerCache();
    oldKey = Keypair.generate().publicKey.toBase58();
    newKey = Keypair.generate().publicKey.toBase58();
  });

  it("delegated: the rollup's key passes, the frozen base key does not", async () => {
    chain({ owner: DELEGATION_PROGRAM_ID.toBase58(), key: oldKey }, { key: newKey });
    expect(await verifySessionOwner(wallet.toBase58(), newKey)).toBe(true);
    resetSessionOwnerCache();
    expect(await verifySessionOwner(wallet.toBase58(), oldKey)).toBe(false);
  });

  it("not delegated: the base key passes, whatever a rollup still shows", async () => {
    chain({ owner: SOL_CITY_PROGRAM_ID.toBase58(), key: oldKey }, { key: newKey });
    expect(await verifySessionOwner(wallet.toBase58(), oldKey)).toBe(true);
    resetSessionOwnerCache();
    expect(await verifySessionOwner(wallet.toBase58(), newKey)).toBe(false);
  });
});
