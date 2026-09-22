import { describe, expect, it } from "vitest";
import { batch, get, hgetall, lrange } from "@/lib/kv";
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
});
