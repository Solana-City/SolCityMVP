import { describe, expect, it } from "vitest";
import { pairQueue, pushRecent, recentMeetings, tolerance, type Ticket } from "./matchmaking";
import { MATCHMAKING } from "./config";

/**
 * Matchmaking is the ladder's anti-collusion story: a player never names an
 * opponent, the rules do. These tests pin the properties that story rests on.
 */

function ticket(over: Partial<Ticket> & { wallet: string }): Ticket {
  return { rating: 1000, enqueuedAt: 0, recent: [], ...over };
}

describe("tolerance", () => {
  it("starts narrow and widens with the wait", () => {
    expect(tolerance(0)).toBe(MATCHMAKING.BASE_TOLERANCE);
    expect(tolerance(10_000)).toBeGreaterThan(tolerance(0));
  });

  it("stops widening at the cap, however long the queue", () => {
    expect(tolerance(60 * 60_000)).toBe(MATCHMAKING.MAX_TOLERANCE);
  });
});

describe("recentMeetings", () => {
  it("counts how often the other wallet appears in the window", () => {
    const a = ticket({ wallet: "a", recent: ["b", "c", "b"] });
    const b = ticket({ wallet: "b" });
    expect(recentMeetings(a, b)).toBe(2);
  });
});

describe("pairQueue", () => {
  it("pairs two players whose ratings are close", () => {
    const { pairs, waiting } = pairQueue(
      [ticket({ wallet: "a", rating: 1000 }), ticket({ wallet: "b", rating: 1020 })],
      0,
    );
    expect(pairs).toHaveLength(1);
    expect(waiting).toHaveLength(0);
  });

  it("refuses a pairing outside the tolerance", () => {
    const { pairs, waiting } = pairQueue(
      [ticket({ wallet: "a", rating: 1000 }), ticket({ wallet: "b", rating: 1600 })],
      0,
    );
    expect(pairs).toHaveLength(0);
    expect(waiting).toHaveLength(2);
  });

  it("accepts that same pairing once both have waited long enough", () => {
    const { pairs } = pairQueue(
      [ticket({ wallet: "a", rating: 1000 }), ticket({ wallet: "b", rating: 1600 })],
      MATCHMAKING.MAX_WAIT_MS,
    );
    expect(pairs).toHaveLength(1);
  });

  it("prefers a fresh opponent over one just played", () => {
    const me = ticket({ wallet: "me", rating: 1000, recent: ["rival", "rival"] });
    const rival = ticket({ wallet: "rival", rating: 1000 });
    const stranger = ticket({ wallet: "stranger", rating: 1040 });
    const { pairs } = pairQueue([me, rival, stranger], 0);
    const mine = pairs.find((p) => p.a.wallet === "me" || p.b.wallet === "me");
    const opponent = mine?.a.wallet === "me" ? mine?.b.wallet : mine?.a.wallet;
    expect(opponent).toBe("stranger");
  });

  it("serves the longest waiting player first", () => {
    const now = 60_000;
    const waitingLongest = ticket({ wallet: "old", rating: 1000, enqueuedAt: 0 });
    const justArrived = ticket({ wallet: "new", rating: 1000, enqueuedAt: now });
    const partner = ticket({ wallet: "partner", rating: 1000, enqueuedAt: now });
    const { pairs, waiting } = pairQueue([justArrived, waitingLongest, partner], now);
    expect(pairs).toHaveLength(1);
    // The longest waiter is served; which of the two equally good candidates
    // they get is random by design, so only the leftover count is fixed.
    expect([pairs[0].a.wallet, pairs[0].b.wallet]).toContain("old");
    expect(waiting).toHaveLength(1);
    expect(waiting[0].wallet).not.toBe("old");
  });

  it("never pairs a player with themselves", () => {
    const { pairs } = pairQueue([ticket({ wallet: "alone" })], 0);
    expect(pairs).toHaveLength(0);
  });

  it("breaks ties with the injected randomness, not with entry order", () => {
    const me = ticket({ wallet: "me", rating: 1000 });
    const first = ticket({ wallet: "first", rating: 1000 });
    const second = ticket({ wallet: "second", rating: 1000 });
    const pickLast = pairQueue([me, first, second], 0, () => 0.99).pairs[0];
    const pickFirst = pairQueue([me, first, second], 0, () => 0).pairs[0];
    expect(pickLast.b.wallet).not.toBe(pickFirst.b.wallet);
  });
});

describe("pushRecent", () => {
  it("keeps the newest first and never grows past the window", () => {
    let recent: string[] = [];
    for (let i = 0; i < MATCHMAKING.RECENT_OPPONENTS + 5; i++) recent = pushRecent(recent, `op${i}`);
    expect(recent).toHaveLength(MATCHMAKING.RECENT_OPPONENTS);
    expect(recent[0]).toBe(`op${MATCHMAKING.RECENT_OPPONENTS + 4}`);
  });
});
