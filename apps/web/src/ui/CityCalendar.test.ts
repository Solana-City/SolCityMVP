import { describe, expect, it } from "vitest";
import { buildEntries } from "./CityCalendar";
import type { EarnListing } from "@/game/solana/superteamEarn";

const listing = (over: Partial<EarnListing>): EarnListing => ({
  title: "x", rewardAmount: null, token: "USDC", deadline: null, sponsorName: "", slug: Math.random().toString(36),
  type: "bounty", url: "https://superteam.fun", ...over,
});

describe("buildEntries", () => {
  it("folds hackathon tracks that close the same day into one entry", () => {
    const tracks = [1, 2, 3].map((n) => listing({ type: "hackathon", title: `Track ${n}`, deadline: "2026-10-13T06:59:00.000Z" }));
    const { entries } = buildEntries([], tracks);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ day: "2026-10-13", kind: "hackathon", title: "3 hackathon tracks" });
  });

  it("puts each bounty on its deadline day with the reward", () => {
    const { entries } = buildEntries([listing({ title: "Video", deadline: "2026-09-30T22:59:59.000Z", rewardAmount: 5000 })], []);
    expect(entries[0]).toMatchObject({ day: "2026-09-30", kind: "bounty", title: "Video" });
    expect(entries[0].note).toContain("5,000 USDC");
  });

  it("skips listings without a deadline and sorts by day", () => {
    const { entries } = buildEntries(
      [listing({ deadline: "2026-10-05T00:00:00Z" }), listing({ deadline: null }), listing({ deadline: "2026-09-25T00:00:00Z" })],
      [],
    );
    expect(entries.map((e) => e.day)).toEqual(["2026-09-25", "2026-10-05"]);
  });
});
