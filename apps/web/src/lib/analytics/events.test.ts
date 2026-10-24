import { describe, expect, it } from "vitest";
import { batch, del, get, hgetall, lrange, sismember, smembers } from "@/lib/kv";
import { boardKey } from "@/lib/boards";
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

  /**
   * Resetting a board to start an event from zero must not take back what
   * people already earned.
   *
   * The two live in different keys on purpose, and this is the test that says
   * so: `/api/admin/board` deletes the ranking, and the entitlement the hat is
   * re-granted from is somewhere else entirely. It is also why the
   * reconciliation asks the winners set rather than inferring a win from a
   * score that a reset can erase.
   */
  it("survives the board being cleared", async () => {
    const winner = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
    await recordEvent({ kind: "minigame", id: "reset-test", wallet: winner, value: 93, success: true });

    const ranking = boardKey("game:reset-test");
    expect(ranking).toBe("ev:minigame:reset-test:best");
    await del(ranking!);

    expect(await sismember("ev:minigame:reset-test:won", winner)).toBe(true);
  });

  it("says no for a wallet that never won, without shipping the set", async () => {
    const stranger = "6dNVprDYLZ7Hh3AQbWnCbWcqNqMDH9hEHnZkLbxJUsHu";
    await recordEvent({ kind: "minigame", id: "stranger-test", wallet: stranger, value: 10, success: false });
    expect(await sismember("ev:minigame:stranger-test:won", stranger)).toBe(false);
  });
});
