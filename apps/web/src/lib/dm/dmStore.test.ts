import { beforeAll, describe, expect, it, vi } from "vitest";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";
import { setex } from "@/lib/kv";
import { dmMessage } from "./dmMessage";
import { poll, send, setDmsOff, verifyEd25519 } from "./dmStore";

const alice = Keypair.generate().publicKey.toBase58();
const bob = Keypair.generate().publicKey.toBase58();
const aliceSk = Keypair.generate();
const bobSk = Keypair.generate();
const strangerSk = Keypair.generate();

beforeAll(async () => {
  // No chain in tests: an unknown session key finds no player account.
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ result: { value: null } }) })));
  await setex(`dm:sk:${aliceSk.publicKey.toBase58()}`, alice, 60);
  await setex(`dm:sk:${bobSk.publicKey.toBase58()}`, bob, 60);
});

describe("signatures", () => {
  it("accepts the session key's signature and rejects a tampered message", () => {
    const msg = dmMessage("send", alice, 123, { to: bob, text: "gm ✨" });
    const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(msg), aliceSk.secretKey)).toString("base64");
    expect(verifyEd25519(aliceSk.publicKey.toBase58(), msg, sig)).toBe(true);
    expect(verifyEd25519(aliceSk.publicKey.toBase58(), msg.replace("gm", "gn"), sig)).toBe(false);
  });
});

describe("delivery", () => {
  it("refuses an offline recipient", async () => {
    expect(await send(alice, aliceSk.publicKey.toBase58(), bob, "hi")).toBe("offline");
  });

  it("delivers once the recipient is polling, then drains the inbox", async () => {
    expect((await poll(bob, bobSk.publicKey.toBase58())).ok).toBe(true);
    expect(await send(alice, aliceSk.publicKey.toBase58(), bob, "hi bob")).toBe("sent");
    const res = await poll(bob, bobSk.publicKey.toBase58());
    expect(res.ok && res.messages.map((m) => [m.from, m.text])).toEqual([[alice, "hi bob"]]);
    const again = await poll(bob, bobSk.publicKey.toBase58());
    expect(again.ok && again.messages).toEqual([]);
  });

  it("respects DMs turned off", async () => {
    await setDmsOff(bob, true);
    expect(await send(alice, aliceSk.publicKey.toBase58(), bob, "hi")).toBe("off");
    const res = await poll(bob, bobSk.publicKey.toBase58());
    expect(res.ok && res.off).toBe(true);
    await setDmsOff(bob, false);
  });

  it("rejects a session key that isn't the sender's", async () => {
    expect(await send(alice, strangerSk.publicKey.toBase58(), bob, "hi")).toBe("unauthorized");
    expect((await poll(bob, strangerSk.publicKey.toBase58())).ok).toBe(false);
  });
});
