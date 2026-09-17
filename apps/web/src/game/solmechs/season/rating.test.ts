import { describe, expect, it } from "vitest";
import {
  expectedScore, kFactor, rateMatch, repeatPairingWeight, softReset, standings,
} from "./rating";
import { newEntry, type LadderEntry } from "./types";
import { ELIGIBILITY, RATING } from "./config";

/**
 * The ladder's maths. These are the numbers a season's payout is computed
 * from, and the program enforces its own copy of them, so a silent change
 * here is a disagreement with the chain rather than a cosmetic tweak.
 */

function entry(over: Partial<LadderEntry> = {}): LadderEntry {
  return { ...newEntry("wallet", RATING.START), ...over };
}

describe("expectedScore", () => {
  it("is even between equal ratings", () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5, 5);
  });

  it("treats 400 points as 10 to 1 odds, which is what a rating point means", () => {
    expect(expectedScore(1400, 1000)).toBeCloseTo(10 / 11, 3);
    expect(expectedScore(1000, 1400)).toBeCloseTo(1 / 11, 3);
  });

  it("is symmetric: the two expectations always sum to one", () => {
    for (const [a, b] of [[1000, 1200], [900, 1750], [1600, 1601]]) {
      expect(expectedScore(a, b) + expectedScore(b, a)).toBeCloseTo(1, 9);
    }
  });
});

describe("kFactor", () => {
  it("is high while placing, so a new account converges fast", () => {
    expect(kFactor(entry({ wins: 2, losses: 3 }))).toBe(RATING.K_PROVISIONAL);
  });

  it("settles once the placement matches are played", () => {
    expect(kFactor(entry({ wins: 6, losses: 6 }))).toBe(RATING.K_ESTABLISHED);
  });

  it("tightens at the top of the ladder", () => {
    expect(kFactor(entry({ wins: 30, losses: 5, rating: RATING.K_TIGHTEN_ABOVE }))).toBe(RATING.K_TIGHT);
  });
});

describe("repeatPairingWeight", () => {
  it("counts the first meetings in full", () => {
    expect(repeatPairingWeight(0)).toBe(1);
    expect(repeatPairingWeight(RATING.repeatPairingFree)).toBe(1);
  });

  it("halves every half-life after that", () => {
    const over = RATING.repeatPairingFree + RATING.repeatPairingHalfLife;
    expect(repeatPairingWeight(over)).toBeCloseTo(0.5, 5);
  });

  it("never reaches zero, so a rematch in a small pool still counts", () => {
    expect(repeatPairingWeight(50)).toBe(RATING.repeatPairingFloor);
  });
});

describe("rateMatch", () => {
  it("moves the winner up and the loser down", () => {
    const winner = entry({ wallet: "a" });
    const loser = entry({ wallet: "b" });
    const update = rateMatch(winner, loser);
    expect(update.winnerRating).toBeGreaterThan(winner.rating);
    expect(update.loserRating).toBeLessThan(loser.rating);
  });

  it("pays almost nothing for beating a much weaker opponent", () => {
    const strong = entry({ wallet: "a", rating: 1800, wins: 40, losses: 10 });
    const weak = entry({ wallet: "b", rating: 900, wins: 40, losses: 10 });
    const update = rateMatch(strong, weak);
    expect(update.winnerGain).toBeLessThan(2);
  });

  it("scores both sides against the PRE-match ratings, so order cannot matter", () => {
    const a = entry({ wallet: "a", rating: 1200, wins: 20, losses: 20 });
    const b = entry({ wallet: "b", rating: 1000, wins: 20, losses: 20 });
    const first = rateMatch(a, b);
    const second = rateMatch({ ...a }, { ...b });
    expect(first).toEqual(second);
  });

  it("decays a pairing that keeps repeating", () => {
    const winner = entry({ wallet: "a", meetings: { b: 10 } });
    const loser = entry({ wallet: "b", meetings: { a: 10 } });
    const fresh = rateMatch(entry({ wallet: "a" }), entry({ wallet: "b" }));
    const repeated = rateMatch(winner, loser);
    expect(repeated.winnerGain).toBeLessThan(fresh.winnerGain);
  });

  it("never drops a rating below the floor", () => {
    const winner = entry({ wallet: "a", rating: 1800 });
    const loser = entry({ wallet: "b", rating: RATING.FLOOR });
    expect(rateMatch(winner, loser).loserRating).toBeGreaterThanOrEqual(RATING.FLOOR);
  });
});

describe("standings", () => {
  it("only places accounts that met both eligibility floors", () => {
    const eligible = entry({
      wallet: "eligible",
      rating: 1100,
      wins: ELIGIBILITY.MIN_MATCHES,
      losses: 0,
      meetings: Object.fromEntries(
        Array.from({ length: ELIGIBILITY.MIN_DISTINCT_OPPONENTS }, (_, i) => [`op${i}`, 1]),
      ),
    });
    const tooFew = entry({ wallet: "tooFew", rating: 1900, wins: 2, losses: 0 });

    const table = standings([tooFew, eligible]);
    const byWallet = Object.fromEntries(table.map((row) => [row.wallet, row]));

    expect(byWallet.eligible.place).toBe(1);
    expect(byWallet.tooFew.place).toBeNull();
    expect(byWallet.tooFew.ineligibleReason).toBe("matches");
  });

  it("orders by rating and breaks ties reproducibly", () => {
    const a = entry({ wallet: "a", rating: 1200, wins: 10, losses: 0, lastMatchAt: 10 });
    const b = entry({ wallet: "b", rating: 1200, wins: 4, losses: 0, lastMatchAt: 20 });
    const once = standings([a, b]).map((r) => r.wallet);
    const twice = standings([b, a]).map((r) => r.wallet);
    expect(once).toEqual(twice);
    // Fewer matches for the same rating ranks higher.
    expect(once[0]).toBe("b");
  });
});

describe("softReset", () => {
  it("pulls a season's rating halfway back to the start", () => {
    expect(softReset(RATING.START)).toBe(RATING.START);
    expect(softReset(1800)).toBe(1400);
    expect(softReset(600)).toBe(800);
  });
});
