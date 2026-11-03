import { describe, it, expect } from "vitest";
import { Keypair } from "@solana/web3.js";
import { decodePresenceBoard, PRESENCE_BOARD_LEN, PRESENCE_SLOTS, PRESENCE_TTL_SECS } from "./presenceBoard";

/**
 * The board is read by offset, against the layout the program pins in its own
 * test (PresenceBoard: 8 + 32 + 240 x 40). These pin the reading side.
 */
function board(slots: { wallet: Uint8Array; seen: number }[]): Buffer {
  const buf = Buffer.alloc(PRESENCE_BOARD_LEN);
  slots.forEach((s, i) => {
    const at = 40 + i * 40;
    Buffer.from(s.wallet).copy(buf, at);
    buf.writeBigInt64LE(BigInt(s.seen), at + 32);
  });
  return buf;
}

describe("a presence board", () => {
  it("is 9,640 bytes, the size the program allocates", () => {
    expect(PRESENCE_BOARD_LEN).toBe(8 + 32 + PRESENCE_SLOTS * 40);
    expect(PRESENCE_BOARD_LEN).toBe(9_640);
  });

  it("lists the wallets seen within the freshness window", () => {
    const a = Keypair.generate().publicKey;
    const b = Keypair.generate().publicKey;
    const now = 1_000_000;
    const data = board([
      { wallet: a.toBytes(), seen: now - 5 },
      { wallet: b.toBytes(), seen: now - PRESENCE_TTL_SECS - 1 }, // closed a tab, never said so
    ]);
    expect(decodePresenceBoard(data, now)).toEqual([a.toBase58()]);
  });

  it("skips empty slots", () => {
    expect(decodePresenceBoard(board([]), 1_000_000)).toEqual([]);
  });

  it("reads nothing from an account that is not a board", () => {
    expect(decodePresenceBoard(Buffer.alloc(100), 1)).toEqual([]);
  });
});
