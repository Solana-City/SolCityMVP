import { describe, expect, it } from "vitest";
import { Connection, Keypair } from "@solana/web3.js";
import { packUnavailableReason, readPackConfig, type OnChainPack } from "./packs";

/**
 * The emergency stop (audit R-44) as the client sees it: the flag is read off
 * the end of PackConfig, a config from before the pause reads as open, and a
 * paused shop says so instead of offering a purchase the program refuses.
 */
const OLD_LEN = 8 + 96 + 2 + 8 * 21 + 1;

function configBytes(paused: boolean | null): Buffer {
  const d = Buffer.alloc(paused === null ? OLD_LEN : OLD_LEN + 33);
  Keypair.generate().publicKey.toBuffer().copy(d, 8);
  d.writeUInt16LE(1, 8 + 96);
  d.writeUInt8(1, OLD_LEN - 1 - 8 * 21);
  // One pack: id 0, season 1, enabled.
  d.writeUInt16LE(1, 8 + 96 + 2 + 1);
  d.writeUInt8(1, 8 + 96 + 2 + 20);
  d.writeUInt8(1, OLD_LEN - 1);
  if (paused !== null) d.writeUInt8(paused ? 1 : 0, OLD_LEN);
  return d;
}

function conn(data: Buffer): Connection {
  return { getAccountInfo: async () => ({ data }) } as unknown as Connection;
}

describe("the shop pause", () => {
  it("reads the flag after the pack table", async () => {
    expect((await readPackConfig(conn(configBytes(true))))?.paused).toBe(true);
    expect((await readPackConfig(conn(configBytes(false))))?.paused).toBe(false);
  });

  it("reads a config from before the pause as open", async () => {
    const cfg = await readPackConfig(conn(configBytes(null)));
    expect(cfg?.paused).toBe(false);
    expect(cfg?.packs).toHaveLength(1);
  });

  it("names the pause before anything else", async () => {
    const cfg = (await readPackConfig(conn(configBytes(true))))!;
    const pack: OnChainPack = cfg.packs[0];
    expect(packUnavailableReason(pack, cfg)).toMatch(/paused/);
    expect(packUnavailableReason(pack, { ...cfg, paused: false })).toBeNull();
  });
});
