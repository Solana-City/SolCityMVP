/**
 * "Where Is the NPC?" — global hide-and-seek mini-game.
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

// ── Global on-chain hunt state ──────────────────────────────────────────────
// When the on-chain HuntState is live, its `round` is the shared slot every
// client derives the target from, and its `deadline` drives the countdown — so
// all players hunt the SAME citizen and a find/expiry advances the round for
// everyone. OnChainMultiplayer polls the hunt and pushes it here. When absent
// (offline / pre-init) we fall back to the local time-based slot below.

let onChainRound: number | null = null;
let onChainDeadlineMs: number | null = null;

/** Called by the hunt poll. `deadlineSecs` is the on-chain unix deadline. */
export function setHuntFromChain(round: number, deadlineSecs: number): void {
  onChainRound = round >>> 0;
  onChainDeadlineMs = deadlineSecs * 1000;
}

/** Drop back to the local slot (e.g. on disconnect). */
export function clearHuntFromChain(): void {
  onChainRound = null;
  onChainDeadlineMs = null;
}

/** Whether the shared on-chain hunt is driving the round. */
export function isHuntOnChain(): boolean {
  return onChainRound !== null;
}

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
  return onChainRound ?? Math.floor(Date.now() / ROUND_MS);
}

/** Target pedestrian for a given citizen sequence number. Selection is
 *  driven ONLY by the monotonic citizenSeq (see below), so the target
 *  changes exactly when a citizen is found or expires — never on a
 *  wall-clock boundary that wouldn't reset the countdown. */
export function getTargetPedIndex(seq: number, pedCount: number): number {
  return Math.floor(rng((seq * 0x9e3779b9) ^ 0xc0ffee) * pedCount);
}

export function getMsRemaining(): number {
  return ROUND_MS - (Date.now() % ROUND_MS);
}

// ── Per-citizen countdown ─────────────────────────────────────────────────
// The "next citizen" timer is per-citizen: it resets to a full CITIZEN_MS
// every time the current target is found OR expires unfound, rather than
// counting down to a shared wall-clock boundary (which left the next citizen
// with only the leftover time). Client-local — finds aren't networked anyway.

export const CITIZEN_MS = ROUND_MS; // each citizen sticks around up to this long

let citizenDeadline = Date.now() + CITIZEN_MS;

/** Time left before the current citizen rotates if not found. Driven by the
 *  on-chain deadline when the shared hunt is live, else the local timer.
 *  Capped at CITIZEN_MS (5 min): the round IS 300 on-chain seconds, but the
 *  devnet validator clock can drift ahead of real time, which would otherwise
 *  make `deadline − now` read as MORE than 5:00. Clamping keeps the display a
 *  clean 0–5:00 and still shows the true remaining for anyone who joined
 *  mid-round (that value is already ≤ 5:00). */
export function getCitizenMsRemaining(): number {
  if (onChainDeadlineMs !== null) {
    return Math.min(CITIZEN_MS, Math.max(0, onChainDeadlineMs - Date.now()));
  }
  return Math.max(0, citizenDeadline - Date.now());
}

/** Start a fresh full countdown — call whenever a new citizen becomes active.
 *  No-op under the on-chain hunt (the deadline comes from the chain). */
export function resetCitizenTimer(): void {
  if (onChainDeadlineMs !== null) return;
  citizenDeadline = Date.now() + CITIZEN_MS;
}

/** True once the current citizen's countdown has run out. */
export function isCitizenExpired(): boolean {
  if (onChainDeadlineMs !== null) return Date.now() >= onChainDeadlineMs;
  return Date.now() >= citizenDeadline;
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

// ── Citizen sequence + "already found this NPC" guard ─────────────────────
//
// A single monotonic counter identifies the active citizen. It's the sole
// seed for target selection (getTargetPedIndex) AND the key for the
// per-wallet found-log, so the target changes exactly when this bumps — and
// every bump (on find or on expiry) is paired with a citizen-timer reset.
//
// Seeded from epoch seconds at load so the found-log keys are unique per
// session and don't collide with a prior session's after a reload.

const FIND_LOG_KEY = "solcity:whereIsNPC:findLog"; // { wallet: { seqStr: 1 } }

function loadFindLog(): Record<string, Record<string, number>> {
  try { return JSON.parse(localStorage.getItem(FIND_LOG_KEY) ?? "{}"); } catch { return {}; }
}
function saveFindLog(log: Record<string, Record<string, number>>) {
  try { localStorage.setItem(FIND_LOG_KEY, JSON.stringify(log)); } catch {}
}

let citizenSeq = Math.floor(Date.now() / 1000);

/** The active citizen's sequence number — the seed for target selection. Under
 *  the shared on-chain hunt this IS the on-chain round, so every client targets
 *  the same citizen; offline it's the local monotonic counter. */
export function getCurrentSlot(): number {
  return onChainRound ?? citizenSeq;
}

/** True if this wallet already claimed the CURRENT citizen. */
export function hasAlreadyFoundCurrent(wallet: string): boolean {
  const log = loadFindLog();
  return (log[wallet]?.[String(getCurrentSlot())] ?? 0) > 0;
}

/** Record that this wallet found the current citizen (call before advanceFindSlot). */
export function markCurrentFound(wallet: string): void {
  const log = loadFindLog();
  const w = log[wallet] ?? (log[wallet] = {});
  w[String(getCurrentSlot())] = 1;
  // Bound growth over long sessions — keep only the most recent claims.
  const keys = Object.keys(w);
  if (keys.length > 100) {
    for (const k of keys.sort((a, b) => Number(a) - Number(b)).slice(0, keys.length - 100)) {
      delete w[k];
    }
  }
  saveFindLog(log);
}

/** Advance to the next citizen (called on a find or an expiry). No-op under the
 *  on-chain hunt — there the round only advances when the chain says so (via a
 *  claim/expire landing), which the poll then reflects. */
export function advanceFindSlot(): void {
  if (onChainRound !== null) return;
  citizenSeq += 1;
}
