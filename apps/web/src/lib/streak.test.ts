import { describe, expect, it } from "vitest";
import { advanceStreak, previousDay, viewStreak, type StreakRecord } from "./streak";

const empty: StreakRecord = { count: 0, best: 0, last: null, recent: [] };

describe("previousDay", () => {
  it("crosses month and year boundaries", () => {
    expect(previousDay("2026-10-01")).toBe("2026-09-30");
    expect(previousDay("2027-01-01")).toBe("2026-12-31");
    expect(previousDay("2028-03-01")).toBe("2028-02-29");
  });
});

describe("advanceStreak", () => {
  it("starts at 1", () => {
    const { record } = advanceStreak(empty, "2026-09-21");
    expect(record).toMatchObject({ count: 1, best: 1, last: "2026-09-21" });
  });

  it("grows on consecutive days", () => {
    let rec = empty;
    for (const day of ["2026-09-21", "2026-09-22", "2026-09-23"]) rec = advanceStreak(rec, day).record;
    expect(rec.count).toBe(3);
    expect(rec.best).toBe(3);
  });

  it("ignores a second check-in on the same day", () => {
    const first = advanceStreak(empty, "2026-09-21").record;
    const again = advanceStreak(first, "2026-09-21");
    expect(again.changed).toBe(false);
    expect(again.record.count).toBe(1);
  });

  it("starts over after a missed day but keeps the best", () => {
    let rec = empty;
    for (const day of ["2026-09-20", "2026-09-21", "2026-09-22"]) rec = advanceStreak(rec, day).record;
    rec = advanceStreak(rec, "2026-09-24").record;
    expect(rec.count).toBe(1);
    expect(rec.best).toBe(3);
  });

  it("keeps only the last seven days for the week strip", () => {
    let rec = empty;
    for (let d = 1; d <= 10; d++) rec = advanceStreak(rec, `2026-09-${String(d).padStart(2, "0")}`).record;
    expect(rec.recent).toHaveLength(7);
    expect(rec.recent[6]).toBe("2026-09-10");
  });
});

describe("viewStreak", () => {
  const rec: StreakRecord = { count: 4, best: 6, last: "2026-09-21", recent: [] };

  it("is alive today and tomorrow", () => {
    expect(viewStreak(rec, "2026-09-21")).toMatchObject({ current: 4, checkedInToday: true });
    expect(viewStreak(rec, "2026-09-22")).toMatchObject({ current: 4, checkedInToday: false });
  });

  it("reads 0 once a day is missed, best stays", () => {
    expect(viewStreak(rec, "2026-09-23")).toMatchObject({ current: 0, best: 6 });
  });
});
