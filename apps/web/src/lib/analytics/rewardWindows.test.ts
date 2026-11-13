import { describe, expect, it } from "vitest";
import { smembers } from "@/lib/kv";
import { countsAsWin } from "./rewardWindows";
import { recordEvent } from "./events";
import { HALLOWEEN_ENDS_AT } from "@/game/halloween/event";
import { PASS_ACCURACY } from "@/game/minigames/pumpkin-carving/pattern";

describe("reward windows", () => {
  const during = HALLOWEEN_ENDS_AT - 60_000;

  it("counts a carve at the pass mark during Halloween", () => {
    expect(countsAsWin("minigame", "pumpkin-carving", true, PASS_ACCURACY, during)).toBe(true);
  });

  // Audit r2, R2-02: a reported success is not a win on its own.
  it("refuses a carve below the pass mark, or after the event closed", () => {
    expect(countsAsWin("minigame", "pumpkin-carving", true, PASS_ACCURACY - 1, during)).toBe(false);
    expect(countsAsWin("minigame", "pumpkin-carving", true, 100, HALLOWEEN_ENDS_AT)).toBe(false);
    expect(countsAsWin("minigame", "pumpkin-carving", false, 100, during)).toBe(false);
  });

  it("leaves games with no reward as they were", () => {
    expect(countsAsWin("minigame", "kite-clash", true, 0, HALLOWEEN_ENDS_AT + 1)).toBe(true);
  });

  it("keeps a late Halloween win out of the winners set", async () => {
    const late = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
    await recordEvent({ kind: "minigame", id: "pumpkin-carving", wallet: late, value: 99, success: true });
    expect(await smembers("ev:minigame:pumpkin-carving:won")).not.toContain(late);
  });
});
