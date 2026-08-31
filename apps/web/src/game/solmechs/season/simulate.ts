/**
 * Sol Mechs — season economy simulator.
 *
 * A tuning harness, not a test. Runs a whole season through the real
 * matchmaker and reports revenue, pool size, payout curve, ladder health and
 * the result of a collusion attempt.
 *
 * Deterministic: the RNG is seeded, so two runs of the same config compare
 * directly. Change a constant in `config.ts` and run it again.
 *
 *   npx tsx apps/web/src/game/solmechs/season/simulate.ts
 */
import {
  LAMPORTS_PER_SOL, PASS_PRICE_LAMPORTS, SUPPLY, ENERGY, PRIZE, ELIGIBILITY,
} from "./config";
import { applyMatch, standings, expectedScore } from "./rating";
import { newEntry, type LadderEntry } from "./types";
import { poolBreakdown, payoutTable, type Purchase } from "./prizePool";
import { MAX_MATCHES_PER_DAY } from "./energy";
import { pairQueue, pushRecent, type Ticket } from "./matchmaking";

/** mulberry32 — small, seeded, good enough for a design simulation. */
function rng(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sol = (l: number) => (l / LAMPORTS_PER_SOL).toFixed(2);
const DAY_MS = 86_400_000;

interface Scenario {
  name: string;
  passesSold: number;
  /** Share of pass holders who actually play the ladder. */
  activeRate: number;
  seasonDays: number;
  /** Chance an active player plays on any given day. */
  dailyPlayRate: number;
  /** Chance an active player buys their one pack on a day they play. */
  packBuyRate: number;
}

interface Player {
  wallet: string;
  /** Latent true strength, in rating points. What the ladder should discover. */
  skill: number;
  entry: LadderEntry;
  /** Bounded recent-opponents window, as the on-chain ticket would carry. */
  recent: string[];
  /** Feeders throw only when the queue happens to pair them with `mainOf`. */
  mainOf?: string;
}

interface DayStats {
  matches: number;
  gapSum: number;
  rematches: number;
  unmatched: number;
}

/**
 * Run one day: players with energy enqueue, the matchmaker pairs them, the
 * pairs play, repeat until budgets are spent.
 */
function runDay(
  roster: Player[],
  byWallet: Map<string, Player>,
  budgets: Map<string, number>,
  dayStart: number,
  rand: () => number,
  stats: DayStats,
): void {
  for (let round = 0; round < MAX_MATCHES_PER_DAY; round++) {
    const tickets: Ticket[] = [];
    for (const p of roster) {
      if ((budgets.get(p.wallet) ?? 0) <= 0) continue;
      tickets.push({
        wallet: p.wallet,
        rating: p.entry.rating,
        // Staggered entry, so waits differ and the tolerance widening is
        // exercised rather than every ticket seeing the same band.
        enqueuedAt: dayStart + round * 60_000 - Math.floor(rand() * 45_000),
        recent: p.recent,
      });
    }
    if (tickets.length < 2) break;

    const now = dayStart + round * 60_000;
    const { pairs, waiting } = pairQueue(tickets, now, rand);
    stats.unmatched += waiting.length;

    for (const pr of pairs) {
      const a = byWallet.get(pr.a.wallet)!;
      const b = byWallet.get(pr.b.wallet)!;

      let aWins: boolean;
      if (a.mainOf === b.wallet) aWins = false;         // a throws to its main
      else if (b.mainOf === a.wallet) aWins = true;
      else aWins = rand() < expectedScore(a.skill, b.skill);

      const [w, l] = aWins ? [a, b] : [b, a];
      const res = applyMatch(w.entry, l.entry, now);
      w.entry = res.winner;
      l.entry = res.loser;

      a.recent = pushRecent(a.recent, b.wallet);
      b.recent = pushRecent(b.recent, a.wallet);
      budgets.set(a.wallet, (budgets.get(a.wallet) ?? 0) - 1);
      budgets.set(b.wallet, (budgets.get(b.wallet) ?? 0) - 1);
      stats.matches++;
      stats.gapSum += pr.ratingGap;
      if (pr.priorMeetings > 0) stats.rematches++;
    }
  }
}

interface Outcome {
  scenario: Scenario;
  stats: DayStats;
  packsSold: number;
  passRevenue: number;
  energyRevenue: number;
  pool: ReturnType<typeof poolBreakdown>;
  eligible: number;
  activePlayers: number;
  /** Spearman rank correlation between latent skill and final rating. */
  skillCorrelation: number;
}

function makeField(count: number, prefix: string, rand: () => number): Player[] {
  return Array.from({ length: count }, (_, i) => {
    // Normal-ish skill spread via central limit; sd ~200 rating points.
    const g = (rand() + rand() + rand() + rand() + rand() + rand() - 3) / 3;
    const w = `${prefix}${i.toString().padStart(4, "0")}`;
    return { wallet: w, skill: 1000 + g * 200, entry: newEntry(w, 1000), recent: [] };
  });
}

function spearman(players: Player[]): number {
  const n = players.length;
  if (n < 2) return 0;
  const skillRank = new Map([...players].sort((a, b) => b.skill - a.skill)
    .map((p, i) => [p.wallet, i] as const));
  const ratingRank = new Map([...players].sort((a, b) => b.entry.rating - a.entry.rating)
    .map((p, i) => [p.wallet, i] as const));
  let d2 = 0;
  for (const p of players) {
    const d = skillRank.get(p.wallet)! - ratingRank.get(p.wallet)!;
    d2 += d * d;
  }
  return 1 - (6 * d2) / (n * (n * n - 1));
}

function simulate(s: Scenario, seed = 42): Outcome {
  const rand = rng(seed);
  const activePlayers = Math.round(s.passesSold * s.activeRate);
  const players = makeField(activePlayers, "w", rand);
  const byWallet = new Map(players.map((p) => [p.wallet, p]));

  const stats: DayStats = { matches: 0, gapSum: 0, rematches: 0, unmatched: 0 };
  let packsSold = 0;

  for (let day = 0; day < s.seasonDays; day++) {
    const budgets = new Map<string, number>();
    for (const p of players) {
      if (rand() > s.dailyPlayRate) continue;
      let budget = ENERGY.DAILY_FREE;
      if (rand() < s.packBuyRate) { budget += ENERGY.PACK_SIZE; packsSold++; }
      budgets.set(p.wallet, budget);
    }
    runDay(players, byWallet, budgets, day * DAY_MS, rand, stats);
  }

  const purchases: Purchase[] = [
    ...Array.from({ length: s.passesSold }, (): Purchase => ({
      source: "pass", lamports: PASS_PRICE_LAMPORTS, at: 0,
    })),
    ...Array.from({ length: packsSold }, (): Purchase => ({
      source: "energy", lamports: ENERGY.PACK_PRICE_LAMPORTS, at: 0,
    })),
  ];

  const final = standings(players.map((p) => p.entry));
  return {
    scenario: s,
    stats,
    packsSold,
    passRevenue: s.passesSold * PASS_PRICE_LAMPORTS,
    energyRevenue: packsSold * ENERGY.PACK_PRICE_LAMPORTS,
    pool: poolBreakdown(purchases),
    eligible: final.filter((e) => e.place !== null).length,
    activePlayers,
    skillCorrelation: spearman(players),
  };
}

/**
 * Collusion through the real matchmaker.
 *
 * The attacker buys N wallets and instructs each to throw whenever it is
 * paired with the main. They cannot choose when that happens: every wallet
 * enters the same queue as everyone else. This measures what buying wallets
 * is worth once opponent selection is off the table.
 */
function collusionCheck(s: Scenario, poolLamports: number, feederCounts: number[], seed = 7): void {
  console.log("\n-- collusion through the matchmaker --");
  console.log("   feeders throw to the main, but the queue decides who meets whom");

  const table = payoutTable(poolLamports);

  for (const feeders of feederCounts) {
    const rand = rng(seed);
    const players = makeField(Math.round(s.passesSold * s.activeRate), "h", rand);
    const main: Player = { wallet: "ATTACKER", skill: 1000, entry: newEntry("ATTACKER", 1000), recent: [] };
    const alts: Player[] = Array.from({ length: feeders }, (_, i) => ({
      wallet: `alt${i}`, skill: 1000, entry: newEntry(`alt${i}`, 1000), recent: [], mainOf: "ATTACKER",
    }));

    const field = [...players, main, ...alts];
    const byWallet = new Map(field.map((p) => [p.wallet, p]));
    const stats: DayStats = { matches: 0, gapSum: 0, rematches: 0, unmatched: 0 };

    for (let day = 0; day < s.seasonDays; day++) {
      const budgets = new Map<string, number>();
      for (const p of players) {
        if (rand() > s.dailyPlayRate) continue;
        budgets.set(p.wallet, ENERGY.DAILY_FREE);
      }
      // The attacker maxes out every day on every wallet they own.
      budgets.set(main.wallet, MAX_MATCHES_PER_DAY);
      for (const a of alts) budgets.set(a.wallet, MAX_MATCHES_PER_DAY);
      runDay(field, byWallet, budgets, day * DAY_MS, rand, stats);
    }

    const row = standings(field.map((p) => p.entry)).find((e) => e.wallet === "ATTACKER")!;
    const cost = feeders * (PASS_PRICE_LAMPORTS
      + ENERGY.PACK_PRICE_LAMPORTS * s.seasonDays * ENERGY.PACKS_PER_DAY);
    const won = row.place !== null && row.place <= table.length ? table[row.place - 1] : 0;
    const net = won - cost;

    console.log(`  ${String(feeders).padStart(3)} feeders -> rating ${String(row.rating).padStart(5)}`
      + `  place ${row.place === null ? " none" : String(row.place).padStart(4)}`
      + `  cost ${sol(cost).padStart(6)}  won ${sol(won).padStart(6)}`
      + `  NET ${(net >= 0 ? "+" : "") + sol(net).padStart(6)} SOL`
      + (net > 0 ? "   <-- PROFITABLE" : ""));
  }
}

function report(o: Outcome): void {
  const s = o.scenario;
  const gross = o.passRevenue + o.energyRevenue;
  const m = o.stats;
  console.log(`\n== ${s.name} ==`);
  console.log(`  passes sold          ${s.passesSold}  (${o.activePlayers} active)`);
  console.log(`  season               ${s.seasonDays} days, ${m.matches} ranked matches`);
  console.log(`  energy packs sold    ${o.packsSold}`);
  console.log("  -- revenue --");
  console.log(`  passes               ${sol(o.passRevenue)} SOL`);
  console.log(`  energy               ${sol(o.energyRevenue)} SOL`);
  console.log(`  gross                ${sol(gross)} SOL`);
  console.log("  -- prize pool --");
  console.log(`  floor / passes / energy   ${sol(o.pool.guaranteed)} / ${sol(o.pool.fromPasses)} / ${sol(o.pool.fromEnergy)} SOL`);
  console.log(`  TOTAL POOL           ${sol(o.pool.total)} SOL`);
  console.log(`  net to project       ${sol(gross - o.pool.total)} SOL`);
  console.log("  -- matchmaking --");
  console.log(`  mean rating gap      ${m.matches ? (m.gapSum / m.matches).toFixed(0) : "-"}`);
  console.log(`  rematch rate         ${m.matches ? ((m.rematches / m.matches) * 100).toFixed(1) : "-"}%`);
  console.log("  -- ladder health --");
  console.log(`  eligible for a place ${o.eligible} of ${o.activePlayers}`
    + `  (needs ${ELIGIBILITY.MIN_MATCHES} matches, ${ELIGIBILITY.MIN_DISTINCT_OPPONENTS} opponents)`);
  console.log(`  skill correlation    ${o.skillCorrelation.toFixed(3)}`);
}

function main(): void {
  console.log("Sol Mechs - season economy");
  console.log(`pass ${sol(PASS_PRICE_LAMPORTS)} SOL - pack ${sol(ENERGY.PACK_PRICE_LAMPORTS)} SOL`
    + ` - ${ENERGY.DAILY_FREE} free/day - ${ENERGY.PACKS_PER_DAY} pack/day`
    + ` - max ${MAX_MATCHES_PER_DAY} matches/day`);
  console.log(`pool = ${sol(PRIZE.GUARANTEED_LAMPORTS)} SOL floor`
    + ` + ${(PRIZE.POOL_SHARE_OF_PASS_SALE * 100).toFixed(0)}% passes`
    + ` + ${(PRIZE.POOL_SHARE_OF_ENERGY * 100).toFixed(0)}% energy`);

  const scenarios: Scenario[] = [
    { name: "floor    - 300 sold", passesSold: 300, activeRate: 0.55, seasonDays: 30, dailyPlayRate: 0.45, packBuyRate: 0.10 },
    { name: "base     - 600 sold", passesSold: 600, activeRate: 0.60, seasonDays: 30, dailyPlayRate: 0.50, packBuyRate: 0.15 },
    { name: "sold out - 1000 sold", passesSold: SUPPLY.PUBLIC, activeRate: 0.70, seasonDays: 30, dailyPlayRate: 0.60, packBuyRate: 0.25 },
  ];

  const results = scenarios.map((s) => simulate(s));
  results.forEach(report);

  const base = results[1];
  const table = payoutTable(base.pool.total);
  console.log(`\n-- payout curve (base, steepness ${PRIZE.PAYOUT_STEEPNESS}) --`);
  for (const place of [1, 2, 3, 5, 10, 25, 50]) {
    if (place <= table.length) {
      console.log(`  ${String(place).padStart(3)}.  ${sol(table[place - 1]).padStart(8)} SOL`
        + `  (${((table[place - 1] / base.pool.total) * 100).toFixed(2)}%)`);
    }
  }

  collusionCheck(scenarios[1], base.pool.total, [0, 3, 10, 30]);
}

main();
