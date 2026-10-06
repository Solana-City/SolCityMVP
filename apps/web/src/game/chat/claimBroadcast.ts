/**
 * The city's claim map: what Sol City citizens staked on the ORE board this
 * round, built from what they chose to announce.
 *
 * ORE's own board is global and anonymous. This is the one thing it cannot
 * show: the squares the people standing around you are on, right now, while the
 * round is still open.
 *
 * It is built from announcements rather than by reading other players' accounts
 * on mainnet, for two reasons. The opt-out below would otherwise be a lie,
 * since those accounts are public and every client could read them anyway. And
 * a round lasts about a minute, so scraping an account per player per round
 * would be a lot of mainnet traffic for something the player may not want
 * shared at all.
 *
 * Same pipe as the stock trade announcements (see tradeBroadcast): a short
 * tagged line over the existing chat field, which every client decodes.
 */

import { SQUARE_COUNT } from "@/game/solana/ore";

const TAG = "§ore:";

export interface ClaimAnnouncement {
  /** Which ORE round this claim belongs to. */
  roundId: number;
  /** Bitmask of the squares claimed, bit 0 being square 1. */
  squares: number;
  /** Total SOL staked across them, for the headline. */
  sol: number;
}

export function encodeClaim(c: ClaimAnnouncement): string {
  return `${TAG}${c.roundId}:${c.squares}:${c.sol.toFixed(4)}`;
}

/** Parses a chat line; null when it is not a (valid) claim tag. */
export function decodeClaim(text: string): ClaimAnnouncement | null {
  if (!text.startsWith(TAG)) return null;
  const [round, mask, sol] = text.slice(TAG.length).split(":");
  const roundId = Number(round);
  const squares = Number(mask);
  const amount = Number(sol);
  if (!Number.isFinite(roundId) || roundId <= 0) return null;
  if (!Number.isInteger(squares) || squares <= 0 || squares >= 1 << SQUARE_COUNT) return null;
  return { roundId, squares, sol: Number.isFinite(amount) && amount > 0 ? amount : 0 };
}

/** "STAKED 0.05 SOL ON 3 SQUARES" / "STAKED 0.01 SOL ON 1 SQUARE". */
export function claimHeadline(c: ClaimAnnouncement): string {
  const n = countSquares(c.squares);
  return `STAKED ${c.sol.toFixed(3)} SOL ON ${n} ${n === 1 ? "SQUARE" : "SQUARES"}`;
}

/** Chat-log line, e.g. "staked 0.05 SOL on 3 squares". */
export function claimLogLine(c: ClaimAnnouncement): string {
  const n = countSquares(c.squares);
  return `staked ${c.sol.toFixed(3)} SOL on ${n} ${n === 1 ? "square" : "squares"}`;
}

export function countSquares(mask: number): number {
  let n = 0;
  for (let i = 0; i < SQUARE_COUNT; i++) if (mask & (1 << i)) n++;
  return n;
}

// ── The city's claims this round ─────────────────────────────────────────────

/** Latest announcement per wallet. One claim per citizen, the most recent. */
const claims = new Map<string, ClaimAnnouncement>();

export function recordClaim(wallet: string, claim: ClaimAnnouncement): void {
  claims.set(wallet, claim);
}

export interface CitySquare {
  /** How many citizens announced this square. */
  citizens: number;
  /** SOL they staked across it, spread evenly over each citizen's squares. */
  sol: number;
}

/**
 * The city's claims for one round, as 25 squares.
 *
 * A claim carries one total rather than a figure per square, so the amount is
 * spread evenly across the squares it covers. It is a picture of where the city
 * is looking, not an accounting record.
 */
export function cityClaims(roundId: number): { squares: CitySquare[]; citizens: number } {
  const squares: CitySquare[] = Array.from({ length: SQUARE_COUNT }, () => ({ citizens: 0, sol: 0 }));
  let citizens = 0;
  for (const claim of claims.values()) {
    if (claim.roundId !== roundId) continue;
    const n = countSquares(claim.squares);
    if (n === 0) continue;
    citizens++;
    const each = claim.sol / n;
    for (let i = 0; i < SQUARE_COUNT; i++) {
      if (claim.squares & (1 << i)) {
        squares[i].citizens++;
        squares[i].sol += each;
      }
    }
  }
  return { squares, citizens };
}

/** Drops claims from older rounds, so the map never shows a stale crowd. */
export function pruneClaims(currentRound: number): void {
  for (const [wallet, claim] of claims) {
    if (claim.roundId < currentRound) claims.delete(wallet);
  }
}

// ── Share preference (per browser) ───────────────────────────────────────────

const SHARE_KEY = "solcity:ore:share-claims";

/**
 * Whether this player's claims are announced to the city. On by default, the
 * same as stock trades.
 *
 * Turning it off stops the announcement, so the claim never reaches anyone
 * else's map. It does not make the claim secret: deploying is a transaction on
 * Solana mainnet, and that is public to anyone who looks.
 */
export function getShareClaims(): boolean {
  try { return localStorage.getItem(SHARE_KEY) !== "0"; } catch { return true; }
}

export function setShareClaims(share: boolean): void {
  try { localStorage.setItem(SHARE_KEY, share ? "1" : "0"); } catch { /* storage blocked */ }
}
