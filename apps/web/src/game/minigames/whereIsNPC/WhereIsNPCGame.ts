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
