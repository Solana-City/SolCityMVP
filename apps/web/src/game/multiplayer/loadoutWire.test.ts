import { describe, it, expect } from "vitest";
import { Keypair } from "@solana/web3.js";
import { globalIndexOf, itemAtGlobalIndex, BOOSTER_BLOCK_START } from "@/game/config/catalogIndex";
import { getBoosterPool, getChainFreeItems, DEFAULT_LOADOUT } from "@/game/config/paperDoll";
import { setOnChainUnlocks } from "@/game/config/wardrobeUnlocks";
import { encodeLoadout, decodeLoadout } from "./loadoutCodec";

/** An UnlockState account body owning exactly `owned`, as the program lays it out. */
function unlockStateBytes(owned: number[]): Uint8Array {
  const buf = Buffer.alloc(8 + 32 + 4 + owned.length * 2 + 4 + 1 + 12);
  let o = 8 + 32;
  buf.writeUInt32LE(owned.length, o); o += 4;
  for (const i of [...owned].sort((a, b) => a - b)) { buf.writeUInt16LE(i, o); o += 2; }
  buf.writeUInt32LE(0, o);
  return new Uint8Array(buf);
}

/**
 * Wardrobe enforcement fails closed now (audit R-10): the program refuses any
 * loadout value that is not a catalog index, and any pack item the wearer's
 * snapshot does not hold, and a refusal takes down the WHOLE outfit. So what
 * goes out has to be exactly what the program will accept.
 */
describe("what goes out on the wire", () => {
  const wallet = Keypair.generate().publicKey.toBase58();
  const pack = getBoosterPool()[0];
  const free = getChainFreeItems()[0];
  const packIndex = globalIndexOf(pack.category, pack.variant.id);
  const freeIndex = globalIndexOf(free.category, free.variant.id);

  it("is indices, never variant ids", () => {
    setOnChainUnlocks(wallet, unlockStateBytes([]));
    const wire = encodeLoadout({ [free.category]: free.variant.id }, wallet);
    expect(wire).toMatch(/^[a-zA-Z]+=\d+$/);
    expect(wire.endsWith(`=${freeIndex}`)).toBe(true);
  });

  it("leaves out a pack item the wallet does not own on chain", () => {
    const hat = getBoosterPool().find((r) => r.category === "hat")!;
    expect(globalIndexOf("hat", hat.variant.id)).toBeGreaterThanOrEqual(BOOSTER_BLOCK_START);
    setOnChainUnlocks(wallet, unlockStateBytes([]));
    expect(encodeLoadout({ hat: hat.variant.id }, wallet)).toBe("");
  });

  it("sends the free default for a shirt or trousers it cannot send", () => {
    // Left off, they showed the player in their underwear to everyone else.
    setOnChainUnlocks(wallet, unlockStateBytes([]));
    for (const slot of ["pants", "tshirt"] as const) {
      const item = getBoosterPool().find((r) => r.category === slot)!;
      const wire = encodeLoadout({ [slot]: item.variant.id }, wallet);
      expect(decodeLoadout(wire)[slot]).toBe(DEFAULT_LOADOUT[slot]);
    }
  });

  it("sends a pack item the wallet owns", () => {
    setOnChainUnlocks(wallet, unlockStateBytes([packIndex]));
    const wire = encodeLoadout({ [pack.category]: pack.variant.id }, wallet);
    expect(wire.endsWith(`=${packIndex}`)).toBe(true);
  });

  it("drops an item the catalog no longer has rather than sending its id", () => {
    const wire = encodeLoadout({ hat: "no_such_hat_anywhere" }, wallet);
    expect(wire).toBe("");
  });
});

describe("what is read back", () => {
  it("reads an index only in its own category's slot (audit R-38)", () => {
    const hat = getBoosterPool().find((r) => r.category === "hat")
      ?? getChainFreeItems().find((r) => r.category === "hat")!;
    const hatIndex = globalIndexOf("hat", hat.variant.id);
    expect(decodeLoadout(`H=${hatIndex}`).hat).toBe(hat.variant.id);
    // The same number in the accessory slot names nothing that is worn.
    expect(decodeLoadout(`a=${hatIndex}`).accessory).toBeUndefined();
  });
});

/**
 * The wardrobe wire is moving from variant ids to catalog indices, and the two
 * formats have to coexist: a service worker can keep an old build alive for
 * days, and a peer that cannot read the format renders a bald, naked avatar
 * rather than a person.
 *
 * `decodeLoadout` is private to OnChainMultiplayer, so what is pinned here is
 * the property the dual read depends on: that the two formats cannot be
 * confused for each other.
 */
describe("the loadout wire", () => {
  it("no variant id is all digits, so a number is always an index", () => {
    // This is the whole reason the decoder can accept both without a marker.
    // A variant called "7" would be read as catalog index 7 and silently put
    // the wrong thing on somebody's head.
    for (let i = 0; i < 20000; i++) {
      const entry = itemAtGlobalIndex(i);
      if (!entry) continue;
      expect(/^\d+$/.test(entry.variant.id), entry.variant.id).toBe(false);
    }
  });

  it("round-trips an item through its index", () => {
    const entry = itemAtGlobalIndex(globalIndexOf("hat", "hat_black"))!;
    expect(entry.variant.id).toBe("hat_black");
  });

  it("an unknown index decodes to nothing rather than to the wrong item", () => {
    // A peer on a future build naming an index this one has never heard of.
    // Dropping the slot is right; guessing is not.
    expect(itemAtGlobalIndex(60000)).toBeUndefined();
  });
});
