/**
 * Sol Mechs — season economy simulator.
 *
 * A tuning harness, not a test. Runs a whole season over several sales
 * scenarios and reports revenue, pool size, payout curve, ladder health and
 * the result of a worst-case collusion attack.
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

// ── deterministic RNG ────────────────────────────────────────────────────────
/** mulberry32 — small, seeded, good enough for a design simulation. */
function rng(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sol = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(2);

// ── scenario ─────────────────────────────────────────────────────────────────
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
}

interface Outcome {
  scenario: Scenario;
  matches: number;
  packsSold: number;
  passRevenue: number;
  energyRevenue: number;
  pool: ReturnType<typeof poolBreakdown>;
  eligible: number;
  activePlayers: number;
  /** Spearman-ish rank correlation between latent skill and final rating. */
  skillCorrelation: number;
}

function simulate(s: Scenario, seed = 42): Outcome {
  const rand = rng(seed);
  const activePlayers = Math.round(s.passesSold * s.activeRate);

  const players: Player[] = Array.from({ length: activePlayers }, (_, i) => {
    // Normal-ish skill spread via central limit; sd ~200 rating points.
    const g = (rand() + rand() + rand() + rand() + rand() + rand() - 3) / 3;
    return {
      wallet: `w${i.toString().padStart(4, "0")}`,
      skill: 1000 + g * 200,
      entry: newEntry(`w${i.toString().padStart(4, "0")}`, 1000),
    };
  });
  const byWallet = new Map(players.map((p) => [p.wallet, p]));

  let matches = 0;
  let packsSold = 0;

  for (let day = 0; day < s.seasonDays; day++) {
    // Who shows up, and how many matches each wants today.
    const queue: string[] = [];
    for (const p of players) {
      if (rand() > s.dailyPlayRate) continue;
      let budget = ENERGY.DAILY_FREE;
      if (rand() < s.packBuyRate) { budget += ENERGY.PACK_SIZE; packsSold++; }
      for (let i = 0; i < budget; i++) queue.push(p.wallet);
    }

    // Rating-proximity matchmaking: sort by rating and pair neighbours, so a
    // player mostly faces people near their level.
    //
    // The pairing must SKIP PAST a same-wallet neighbour rather than skip the
    // pair. A player queues several entries at the same rating, so they land
    // adjacent in the sort; dropping those pairs silently discarded most of
    // the queue and made every ladder-health number meaningless.
    queue.sort((a, b) => byWallet.get(a)!.entry.rating - byWallet.get(b)!.entry.rating);
    const taken = new Array<boolean>(queue.length).fill(false);
    for (let i = 0; i < queue.length; i++) {
      if (taken[i]) continue;
      let j = i + 1;
      while (j < queue.length && (taken[j] || queue[j] === queue[i])) j++;
      if (j >= queue.length) break;
      taken[i] = true; taken[j] = true;

      const a = byWallet.get(queue[i])!;
      const b = byWallet.get(queue[j])!;

      // Outcome is decided by LATENT skill, not by rating — that is what makes
      // the correlation at the end a real measure of whether the ladder works.
      const pA = expectedScore(a.skill, b.skill);
      const aWins = rand() < pA;
      const [w, l] = aWins ? [a, b] : [b, a];
      const res = applyMatch(w.entry, l.entry, day);
      w.entry = res.winner;
      l.entry = res.loser;
      matches++;
    }
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
  const eligible = final.filter((e) => e.place !== null).length;

  // Rank correlation between latent skill and achieved rating.
  const bySkill = [...players].sort((a, b) => b.skill - a.skill).map((p) => p.wallet);
  const byRating = [...players].sort((a, b) => b.entry.rating - a.entry.rating).map((p) => p.wallet);
  const skillRank = new Map(bySkill.map((w, i) => [w, i]));
  const ratingRank = new Map(byRating.map((w, i) => [w, i]));
  const n = players.length;
  let d2 = 0;
  for (const p of players) {
    const d = skillRank.get(p.wallet)! - ratingRank.get(p.wallet)!;
    d2 += d * d;
  }
  const skillCorrelation = n > 1 ? 1 - (6 * d2) / (n * (n * n - 1)) : 0;

  return {
    scenario: s,
    matches,
    packsSold,
    passRevenue: s.passesSold * PASS_PRICE_LAMPORTS,
    energyRevenue: packsSold * ENERGY.PACK_PRICE_LAMPORTS,
    pool: poolBreakdown(purchases),
    eligible,
    activePlayers,
    skillCorrelation,
  };
}

// ── the collusion arbitrage ──────────────────────────────────────────────────
/**
 * Worst-case collusion: buy N wallets, throw every match to a main account.
 *
 * Assumes the attacker can choose who their feeders play, which a real
 * matchmaker must not allow — so this measures the cost of getting
 * matchmaking wrong, not the expected case. Reports cost against prize won.
 */
function collusionCheck(s: Scenario, poolLamports: number, feederCounts: number[], seed = 7): void {
  console.log("\n── collusion: a farmed account vs an honest ladder ──");
  console.log("  worst case — the attacker pairs feeders with the main at will,");
  console.log("  every feeder throws every match, and the main also plays honestly.");

  for (const feeders of feederCounts) {
    const rand = rng(seed);
    const honestCount = Math.round(s.passesSold * s.activeRate);

    const players: Player[] = Array.from({ length: honestCount }, (_, i) => {
      const g = (rand() + rand() + rand() + rand() + rand() + rand() - 3) / 3;
      const w = `h${i.toString().padStart(4, "0")}`;
      return { wallet: w, skill: 1000 + g * 200, entry: newEntry(w, 1000) };
    });

    // Average skill: the question is whether money alone buys a place.
    const main: Player = { wallet: "ATTACKER", skill: 1000, entry: newEntry("ATTACKER", 1000) };
    const alts: Player[] = Array.from({ length: feeders }, (_, i) => {
      const w = `alt${i}`;
      return { wallet: w, skill: 1000, entry: newEntry(w, 1000) };
    });

    const field = [...players, main, ...alts];
    const byWallet = new Map(field.map((p) => [p.wallet, p]));

    for (let day = 0; day < s.seasonDays; day++) {
      // The attack: every feeder spends its whole day throwing to the main.
      for (const alt of alts) {
        for (let i = 0; i < MAX_MATCHES_PER_DAY; i++) {
          const res = applyMatch(main.entry, alt.entry, day);
          main.entry = res.winner;
          alt.entry = res.loser;
        }
      }

      // Honest field, plus the main queueing normally.
      const queue: string[] = [];
      for (const p of [...players, main]) {
        if (rand() > s.dailyPlayRate) continue;
        for (let i = 0; i < ENERGY.DAILY_FREE; i++) queue.push(p.wallet);
      }
      queue.sort((a, b) => byWallet.get(a)!.entry.rating - byWallet.get(b)!.entry.rating);
      const taken = new Array<boolean>(queue.length).fill(false);
      for (let i = 0; i < queue.length; i++) {
        if (taken[i]) continue;
        let j = i + 1;
        while (j < queue.length && (taken[j] || queue[j] === queue[i])) j++;
        if (j >= queue.length) break;
        taken[i] = true; taken[j] = true;
        const a = byWallet.get(queue[i])!;
        const b = byWallet.get(queue[j])!;
        const aWins = rand() < expectedScore(a.skill, b.skill);
        const [w, l] = aWins ? [a, b] : [b, a];
        const res = applyMatch(w.entry, l.entry, day);
        w.entry = res.winner;
        l.entry = res.loser;
      }
    }

    // Feeders are excluded from the honest board the way a real payout would
    // exclude them only if detected — so we score them in, worst case.
    const board = standings(field.map((p) => p.entry));
    const row = board.find((e) => e.wallet === "ATTACKER")!;
    const cost = feeders * (PASS_PRICE_LAMPORTS
      + ENERGY.PACK_PRICE_LAMPORTS * s.seasonDays * ENERGY.PACKS_PER_DAY);
    const place = row.place;

    // Prize won against cost paid.
    const table = payoutTable(poolLamports);
    const won = place !== null && place <= table.length ? table[place - 1] : 0;
    const net = won - cost;
    console.log(`  ${String(feeders).padStart(3)} feeders -> rating ${String(row.rating).padStart(5)}`
      + `  place ${place === null ? " none" : String(place).padStart(4)}`
      + `  cost ${sol(cost).padStart(6)}  won ${sol(won).padStart(6)}`
      + `  NET ${(net >= 0 ? "+" : "") + sol(net).padStart(6)} SOL`
      + (net > 0 ? "   <-- PROFITABLE" : ""));
  }
}

// ── report ───────────────────────────────────────────────────────────────────
function report(o: Outcome): void {
  const s = o.scenario;
  const gross = o.passRevenue + o.energyRevenue;

  console.log(`\n══ ${s.name} ══`);
  console.log(`  passes sold          ${s.passesSold}  (${o.activePlayers} active)`);
  console.log(`  season               ${s.seasonDays} days, ${o.matches} ranked matches`);
  console.log(`  energy packs sold    ${o.packsSold}`);
  console.log("  ── revenue ──");
  console.log(`  passes               ${sol(o.passRevenue)} SOL`);
  console.log(`  energy               ${sol(o.energyRevenue)} SOL   <- recurring`);
  console.log(`  gross                ${sol(gross)} SOL`);
  console.log("  ── prize pool ──");
  console.log(`  guaranteed floor     ${sol(o.pool.guaranteed)} SOL`);
  console.log(`  from passes          ${sol(o.pool.fromPasses)} SOL`);
  console.log(`  from energy          ${sol(o.pool.fromEnergy)} SOL`);
  console.log(`  TOTAL POOL           ${sol(o.pool.total)} SOL`);
  console.log(`  net to project       ${sol(gross - o.pool.total)} SOL   <- negative means the floor is subsidised`);
  console.log("  ── ladder health ──");
  console.log(`  eligible for a place ${o.eligible} of ${o.activePlayers}`
    + `  (needs ${ELIGIBILITY.MIN_MATCHES} matches, ${ELIGIBILITY.MIN_DISTINCT_OPPONENTS} opponents)`);
  console.log(`  skill correlation    ${o.skillCorrelation.toFixed(3)}   <- 1.0 = ladder perfectly ranks true skill`);
}

function main(): void {
  console.log("Sol Mechs — season economy");
  console.log(`pass ${sol(PASS_PRICE_LAMPORTS)} SOL · pack ${sol(ENERGY.PACK_PRICE_LAMPORTS)} SOL`
    + ` · ${ENERGY.DAILY_FREE} free/day · ${ENERGY.PACKS_PER_DAY} pack/day`
    + ` · max ${MAX_MATCHES_PER_DAY} matches/day`);
  console.log(`pool = ${sol(PRIZE.GUARANTEED_LAMPORTS)} SOL floor`
    + ` + ${(PRIZE.POOL_SHARE_OF_PASS_SALE * 100).toFixed(0)}% of passes`
    + ` + ${(PRIZE.POOL_SHARE_OF_ENERGY * 100).toFixed(0)}% of energy`);

  const scenarios: Scenario[] = [
    { name: "floor    — 300 sold, quiet", passesSold: 300, activeRate: 0.55, seasonDays: 30, dailyPlayRate: 0.45, packBuyRate: 0.10 },
    { name: "base     — 600 sold", passesSold: 600, activeRate: 0.60, seasonDays: 30, dailyPlayRate: 0.50, packBuyRate: 0.15 },
    { name: "sold out — 1000 sold, hot", passesSold: SUPPLY.PUBLIC, activeRate: 0.70, seasonDays: 30, dailyPlayRate: 0.60, packBuyRate: 0.25 },
  ];

  const results = scenarios.map((s) => simulate(s));
  results.forEach(report);

  const base = results[1];
  const table = payoutTable(base.pool.total);
  console.log(`\n── payout curve (base scenario, steepness ${PRIZE.PAYOUT_STEEPNESS}) ──`);
  for (const place of [1, 2, 3, 5, 10, 25, 50]) {
    if (place <= table.length) {
      const share = (table[place - 1] / base.pool.total) * 100;
      console.log(`  ${String(place).padStart(3)}.  ${sol(table[place - 1]).padStart(8)} SOL  (${share.toFixed(2)}%)`);
    }
  }
  console.log(`  top 3 take ${((table.slice(0, 3).reduce((a, b) => a + b, 0) / base.pool.total) * 100).toFixed(1)}% of the pool`);

  collusionCheck(scenarios[1], base.pool.total, [0, 1, 3, 10, 30]);
}

main();
