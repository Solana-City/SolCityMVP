/**
 * "Onde Está o NPC?" — global hide-and-seek mini-game.
 *
 * Deterministic round system: every ROUND_MS all clients independently
 * compute the same target pedestrian index from the Unix timestamp.
 * No server required for target selection.
 *
 * Scoring is stored per wallet in localStorage and also broadcast via
 * Phaser game events so the React UI can react.
 */

export const ROUND_MS = 5 * 60 * 1000;      // 5-minute rounds
export const ROTATION_BATCH_MS = 90 * 1000; // pedestrians rotate every 90s in batches

const STORAGE_KEY = "solcity:whereIsNPC:scores";

export interface RoundState {
  round: number;
  targetIndex: number;   // index into pedestrian array
  msRemaining: number;
  foundBy: string | null; // wallet address of finder this round
}

export interface ScoreEntry {
  wallet: string;
  display: string;       // shortened address
  count: number;
}

// ── Deterministic target selection ──────────────────────────────────────────

/** Mulberry32 seeded PRNG */
function rng(seed: number) {
  let s = seed >>> 0;
  s += 0x6D2B79F5;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function getRoundIndex(): number {
  return Math.floor(Date.now() / ROUND_MS);
}

export function getTargetPedIndex(round: number, pedCount: number): number {
  return Math.floor(rng(round ^ 0xc0ffee) * pedCount);
}

export function getMsRemaining(): number {
  return ROUND_MS - (Date.now() % ROUND_MS);
}

// ── Score storage ────────────────────────────────────────────────────────────

function loadScores(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveScores(scores: Record<string, number>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(scores)); } catch {}
}

export function recordFind(wallet: string): number {
  const scores = loadScores();
  scores[wallet] = (scores[wallet] ?? 0) + 1;
  saveScores(scores);
  return scores[wallet];
}

export function getMyScore(wallet: string): number {
  return loadScores()[wallet] ?? 0;
}

export function getLeaderboard(limit = 10): ScoreEntry[] {
  const scores = loadScores();
  return Object.entries(scores)
    .map(([wallet, count]) => ({
      wallet,
      display: `${wallet.slice(0, 4)}…${wallet.slice(-4)}`,
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// ── Round winner cache (session-only, resets on reload) ───────────────────

const roundWinners = new Map<number, string>(); // round → wallet

export function recordRoundWinner(round: number, wallet: string) {
  roundWinners.set(round, wallet);
}

export function getRoundWinner(round: number): string | null {
  return roundWinners.get(round) ?? null;
}

// ── Per-wallet "already found this NPC" guard ─────────────────────────────
// Tracks which (round, findIndex) combos each wallet has claimed.
// Within a single round the target can change multiple times (each find
// spawns a new target), so we track a monotonic find counter per round.

const FIND_LOG_KEY = "solcity:whereIsNPC:findLog"; // { wallet: { roundStr: count } }

function loadFindLog(): Record<string, Record<string, number>> {
  try { return JSON.parse(localStorage.getItem(FIND_LOG_KEY) ?? "{}"); } catch { return {}; }
}
function saveFindLog(log: Record<string, Record<string, number>>) {
  try { localStorage.setItem(FIND_LOG_KEY, JSON.stringify(log)); } catch {}
}

// Internal find counter per round (how many targets have been found this round globally)
const roundFindCounts = new Map<number, number>();

/**
 * Returns true if this wallet has already found the CURRENT target in the
 * current round (i.e. the same find-sequence slot).
 */
export function hasAlreadyFoundCurrent(wallet: string): boolean {
  const round = getRoundIndex();
  const slot = roundFindCounts.get(round) ?? 0;
  const log = loadFindLog();
  return (log[wallet]?.[`${round}:${slot}`] ?? 0) > 0;
}

/**
 * Record that this wallet found the current target. Must be called BEFORE
 * advanceFindSlot() so the slot number matches hasAlreadyFoundCurrent().
 */
export function markCurrentFound(wallet: string): void {
  const round = getRoundIndex();
  const slot = roundFindCounts.get(round) ?? 0;
  const log = loadFindLog();
  if (!log[wallet]) log[wallet] = {};
  log[wallet][`${round}:${slot}`] = 1;
  saveFindLog(log);
}

/** Advance the find slot when a new target is selected after a find. */
export function advanceFindSlot(): void {
  const round = getRoundIndex();
  roundFindCounts.set(round, (roundFindCounts.get(round) ?? 0) + 1);
}
