import { describe, expect, it } from "vitest";
import { batch, get, hgetall, lrange, smembers } from "@/lib/kv";
import { eventReport, recordEvent } from "./events";

const wallet = "9592QS34mPUwqA7sPAkug1kcuFddjn59QPQMzzCgKhEp";

describe("batch", () => {
  it("applies every op in one call", async () => {
    await batch([
      { op: "incrby", key: "t:n", by: 3 },
      { op: "incrby", key: "t:n" },
      { op: "hincrby", key: "t:h", field: "1,2", by: 5 },
      { op: "hincrby", key: "t:h", field: "1,2", by: 2 },
      { op: "lpushcap", key: "t:l", value: "a", cap: 2 },
      { op: "lpushcap", key: "t:l", value: "b", cap: 2 },
      { op: "lpushcap", key: "t:l", value: "c", cap: 2 },
    ]);
    expect(await get("t:n")).toBe("4");
    expect((await hgetall("t:h"))["1,2"]).toBe("7");
    expect(await lrange("t:l", 10)).toEqual(["c", "b"]);
  });
});

describe("events", () => {
  it("records and reads back averages, slow sends and users", async () => {
    await recordEvent({ kind: "latency", id: "ephemeral-move", wallet, value: 200 });
    await recordEvent({ kind: "latency", id: "ephemeral-move", wallet, value: 1_400 });
    const report = await eventReport();
    const row = report.latency.find((r) => r.id === "ephemeral-move");
    expect(row).toMatchObject({ count: 2, users: 1, slow: 1 });
    expect(row?.average).toBe(800);
  });

  /**
   * The list a seasonal item is settled from. It has to hold the winners and
   * nobody else: the hat is handed over on another cluster months later, and
   * by then this set is the only record that someone earned it.
   */
  it("keeps who won apart from who played", async () => {
    const winner = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
    const loser = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
    await recordEvent({ kind: "minigame", id: "carve-test", wallet: winner, value: 91, success: true });
    await recordEvent({ kind: "minigame", id: "carve-test", wallet: loser, value: 44, success: false });
    // Winning twice is still one entitlement.
    await recordEvent({ kind: "minigame", id: "carve-test", wallet: winner, value: 95, success: true });

    expect(await smembers("ev:minigame:carve-test:won")).toEqual([winner]);
    expect((await smembers("ev:minigame:carve-test:users")).sort()).toEqual([loser, winner].sort());
  });
});
