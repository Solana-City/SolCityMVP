import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";
import { setex } from "@/lib/kv";
import { resetSessionOwnerCache } from "@/lib/auth/sessionAuth";
import { eventsMessage, questMessage } from "@/lib/auth/requestMessages";
import { ztop } from "@/lib/kv";
import { POST as postEvents } from "@/app/api/events/route";
import { POST as postQuests } from "@/app/api/quests/route";

const alice = Keypair.generate().publicKey.toBase58();
const bob = Keypair.generate().publicKey.toBase58();
const aliceSk = Keypair.generate();
const strangerSk = Keypair.generate();

const sign = (sk: Keypair, msg: string) =>
  Buffer.from(nacl.sign.detached(new TextEncoder().encode(msg), sk.secretKey)).toString("base64");
const req = (body: unknown) => ({ json: async () => body }) as never;

beforeAll(async () => {
  // No chain in tests: an unknown session key finds no player account.
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ result: { value: null } }) })));
  await setex(`auth:sk:${aliceSk.publicKey.toBase58()}`, alice, 60);
});
beforeEach(() => resetSessionOwnerCache());

const events = (wallet: string) => JSON.stringify([{ kind: "minigame", id: "sigtest", wallet, value: 123, success: true }]);
const signedEvents = (wallet: string, sk: Keypair, ts = Date.now(), payload = events(wallet), signWallet = wallet) => ({
  wallet, sessionKey: sk.publicKey.toBase58(), ts, payload,
  signature: sign(sk, eventsMessage(signWallet, ts, payload)),
});

describe("POST /api/events", () => {
  it("records a signed score and reads it back on the board", async () => {
    const res = await postEvents(req(signedEvents(alice, aliceSk)));
    expect(res.status).toBe(200);
    expect((await res.json()).stored).toBe(1);
    expect((await ztop("ev:minigame:sigtest:best", 5))).toEqual([{ member: alice, score: 123 }]);
  });

  it("rejects an unsigned request", async () => {
    const res = await postEvents(req({ events: JSON.parse(events(bob)), wallet: bob }));
    expect(res.status).toBe(401);
    const res2 = await postEvents(req({ wallet: bob, payload: events(bob) }));
    expect(res2.status).toBe(401);
    expect(await ztop("ev:minigame:sigtest:best", 5)).not.toContainEqual({ member: bob, score: 123 });
  });

  it("rejects a stale timestamp and hands back the server clock", async () => {
    const res = await postEvents(req(signedEvents(alice, aliceSk, Date.now() - 120_000)));
    expect(res.status).toBe(401);
    expect(typeof (await res.json()).serverTs).toBe("number");
  });

  it("rejects a key that does not belong to the claimed wallet", async () => {
    const res = await postEvents(req(signedEvents(bob, aliceSk)));
    expect(res.status).toBe(401);
    const res2 = await postEvents(req(signedEvents(alice, strangerSk)));
    expect(res2.status).toBe(401);
  });

  it("rejects a signature over a different payload", async () => {
    const good = signedEvents(alice, aliceSk);
    const tampered = { ...good, payload: good.payload.replace("123", "999999") };
    expect((await postEvents(req(tampered))).status).toBe(401);
  });

  it("rejects an event for somebody else's wallet in a signed batch", async () => {
    const payload = JSON.stringify([{ kind: "minigame", id: "sigtest", wallet: bob, value: 5000 }]);
    const res = await postEvents(req(signedEvents(alice, aliceSk, Date.now(), payload)));
    expect(res.status).toBe(401);
    expect(await ztop("ev:minigame:sigtest:best", 5)).not.toContainEqual({ member: bob, score: 5000 });
  });
});

describe("POST /api/quests", () => {
  const signedQuest = (wallet: string, sk: Keypair, ts = Date.now(), action: "increment" | "claim" = "increment") => ({
    wallet, questId: "sigquest", action, target: 2, points: 50, sessionKey: sk.publicKey.toBase58(), ts,
    signature: sign(sk, questMessage(action, wallet, "sigquest", ts, { target: 2, points: 50 })),
  });

  it("advances a quest for the signing wallet", async () => {
    const res = await postQuests(req(signedQuest(alice, aliceSk)));
    expect(res.status).toBe(200);
    expect((await res.json()).quest.current).toBe(1);
  });

  it("rejects unsigned, stale, wrong-wallet and tampered requests without writing", async () => {
    const unsigned = { wallet: bob, questId: "sigquest", action: "claim", points: 99999 };
    expect((await postQuests(req(unsigned))).status).toBe(401);
    expect((await postQuests(req(signedQuest(alice, aliceSk, Date.now() - 120_000)))).status).toBe(401);
    expect((await postQuests(req(signedQuest(bob, aliceSk)))).status).toBe(401);
    // Signed as an increment, replayed as a claim with more points.
    const tampered = { ...signedQuest(alice, aliceSk), action: "claim", points: 99999 };
    expect((await postQuests(req(tampered))).status).toBe(401);
    expect(await ztop("lb:quest", 5)).not.toContainEqual(expect.objectContaining({ member: bob }));
  });
});
