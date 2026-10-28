import { describe, it, expect } from "vitest";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  buildSetLinkSessionIx, LINK_NONE, LINK_WANT, LINK_DECLINED,
} from "./instructions";
import { sha256 } from "@noble/hashes/sha256";

/**
 * The friend wire, pinned.
 *
 * `set_link_session` is the only instruction behind every friend action, and
 * the three states are read by a program that cannot be changed without a
 * deploy. A number here that drifts from the program does not fail loudly: it
 * writes a link in a state nothing recognises.
 */
describe("the friend link wire", () => {
  it("has the three states the program knows, by value", () => {
    expect(LINK_NONE).toBe(0);
    expect(LINK_WANT).toBe(1);
    expect(LINK_DECLINED).toBe(2);
  });

  it("carries the Anchor discriminator for set_link_session", () => {
    const me = Keypair.generate().publicKey;
    const session = Keypair.generate().publicKey;
    const peer = Keypair.generate().publicKey;
    const ix = buildSetLinkSessionIx(me, session, peer, LINK_WANT);

    const want = Buffer.from(sha256(new TextEncoder().encode("global:set_link_session"))).subarray(0, 8);
    expect(Buffer.from(ix.data.subarray(0, 8))).toEqual(want);
  });

  it("puts the peer and the state after it, in that order", () => {
    const me = Keypair.generate().publicKey;
    const session = Keypair.generate().publicKey;
    const peer = Keypair.generate().publicKey;
    const ix = buildSetLinkSessionIx(me, session, peer, LINK_DECLINED);

    expect(ix.data.length).toBe(8 + 32 + 1);
    expect(new PublicKey(ix.data.subarray(8, 40)).toBase58()).toBe(peer.toBase58());
    expect(ix.data[40]).toBe(LINK_DECLINED);
  });

  it("writes the player's own account and asks the session key to sign", () => {
    const me = Keypair.generate().publicKey;
    const session = Keypair.generate().publicKey;
    const ix = buildSetLinkSessionIx(me, session, Keypair.generate().publicKey, LINK_WANT);

    // Own account writable, session key the only signer: the whole reason
    // this costs the player nothing.
    expect(ix.keys[0].isWritable).toBe(true);
    expect(ix.keys[0].isSigner).toBe(false);
    expect(ix.keys[1].pubkey.toBase58()).toBe(session.toBase58());
    expect(ix.keys[1].isSigner).toBe(true);
    expect(ix.keys).toHaveLength(2);
  });
});
