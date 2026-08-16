/**
 * Sol Mechs — match clock.
 *
 * A chess clock with Fischer increment, the model competitive turn games use
 * (Pokémon Showdown, Monster Tamers): each side has a bank, thinking spends
 * it, and submitting a round hands some back. Run out and you lose.
 *
 * Why a bank rather than a per-round timer: a per-round timer punishes the one
 * hard decision as much as the nine obvious ones. A bank lets a player spend
 * thirty seconds on the round that decides the match and two seconds on the
 * rest — which is the skill the format is actually about.
 *
 * ## What the clock must NOT count
 *
 * Time only runs while a side is **deciding**. It stops during resolution and
 * animation, otherwise a long knockout sequence would charge both players for
 * watching it, and a slow client would lose matches to its own frame rate.
 *
 * ## On-chain
 *
 * These constants are part of the match rules, so the settlement program has
 * to agree with them — a client and a verifier disagreeing about the bank is
 * a disagreement about who won. Timeouts are settled from the round timestamps
 * the ER already records; see ONCHAIN.md.
 */

export interface ClockConfig {
  /** Starting bank per side, ms. */
  bankMs: number;
  /** Handed back on every submitted round, ms. */
  incrementMs: number;
  /** The bank never grows past this, so a fast player can't hoard, ms. */
  maxBankMs: number;
  /** Below this the UI warns; purely presentational, ms. */
  warnAtMs: number;
}

export const DEFAULT_CLOCK: ClockConfig = {
  // Three minutes plus 8s a round settles a 6-10 round duel comfortably while
  // still punishing someone who stalls every single choice.
  bankMs: 180_000,
  incrementMs: 8_000,
  maxBankMs: 240_000,
  warnAtMs: 30_000,
};

/** Squad battles run 20-30 rounds, so they get a bigger bank. */
export const SQUAD_CLOCK: ClockConfig = {
  bankMs: 300_000,
  incrementMs: 8_000,
  maxBankMs: 420_000,
  warnAtMs: 45_000,
};

/** Apply the increment for a submitted round, respecting the cap. */
export function addIncrement(remainingMs: number, cfg: ClockConfig): number {
  return Math.min(cfg.maxBankMs, remainingMs + cfg.incrementMs);
}

/** m:ss, or 0:0x under ten seconds so the last moments read as urgent. */
export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const total = Math.ceil(clamped / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (clamped < 10_000) return `0:0${Math.floor(clamped / 1000)}.${Math.floor((clamped % 1000) / 100)}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
