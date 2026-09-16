/**
 * Numbers for the developer panel's analytics tab.
 *
 * Everything here is derived from accounts that already exist. No tracking is
 * added to the game: the player PDA already carries when a wallet was created,
 * when it last moved, its score and its counts of swaps, transfers and
 * bounties, so activity and retention can be read straight off the chain.
 *
 * Two reads are needed for one roster. A delegated player account changes
 * owner to the delegation program, so `getProgramAccounts` on the base layer
 * returns only the players who are NOT on the rollup; the rollup returns the
 * delegated ones, with fresher data. The union is the real player list, and
 * the rollup copy wins where both exist.
 */
import { Connection, PublicKey } from "@solana/web3.js";

const HELIUS_DEVNET =
  process.env.NEXT_PUBLIC_HELIUS_DEVNET
  ?? "https://devnet.helius-rpc.com/?api-key=92175bf8-4484-4c09-a60a-4d08ee821058";
const ER_ENDPOINT = "https://devnet.magicblock.app";

const CITY_PROGRAM = new PublicKey(
  process.env.NEXT_PUBLIC_SOL_CITY_PROGRAM_ID || "HPvDFVnruSXHwKKP44eUvRh8oYqBaHCeQbK1sKWT1aU2",
);
const MECHS_PROGRAM = process.env.NEXT_PUBLIC_SOLMECHS_PROGRAM || "";

const PLAYER_MIN_LEN = 200;
const DAY = 86_400;
/** RPC is slow and the panel polls; one shared snapshot per minute is plenty. */
const CACHE_MS = 60_000;

export interface PlayerRecord {
  wallet: string;
  displayName: string;
  score: number;
  swaps: number;
  transfers: number;
  bounties: number;
  createdAt: number;
  lastActive: number;
  /** True when the account is delegated to the rollup (the player has played). */
  online: boolean;
}

function decode(data: Uint8Array, online: boolean): PlayerRecord | null {
  try {
    const buf = Buffer.from(data);
    if (buf.length < PLAYER_MIN_LEN) return null;
    let at = 8;
    const wallet = new PublicKey(buf.subarray(at, at + 32)).toBase58();
    at += 32;
    at += 1 + (buf.readUInt8(at) === 1 ? 32 : 0);
    const nameLen = Math.min(buf.readUInt32LE(at), 20);
    at += 4;
    const displayName = buf.subarray(at, at + nameLen).toString("utf8");
    at += nameLen;
    at += 4 + 4 + 1 + 1; // x, y, direction, outfit_id
    const score = buf.readUInt32LE(at); at += 4;
    const swaps = buf.readUInt16LE(at); at += 2;
    const transfers = buf.readUInt16LE(at); at += 2;
    const bounties = buf.readUInt16LE(at); at += 2;
    const lastActive = Number(buf.readBigInt64LE(at)); at += 8;
    const createdAt = Number(buf.readBigInt64LE(at));
    return { wallet, displayName, score, swaps, transfers, bounties, createdAt, lastActive, online };
  } catch {
    return null;
  }
}

export interface Analytics {
  generatedAt: number;
  players: {
    total: number;
    online: number;
    /** Wallets that have delegated at least once, so they really played. */
    played: number;
    activeDay: number;
    activeWeek: number;
    newDay: number;
    newWeek: number;
    /** Of wallets older than a week, how many moved in the last week. */
    returningPct: number | null;
  };
  /** New wallets per day, oldest first, for the last 30 days. */
  signups: { day: string; count: number }[];
  /** Players last active per day, same window. */
  activity: { day: string; count: number }[];
  actions: {
    swaps: number;
    transfers: number;
    bounties: number;
    /** Share of players with at least one on-chain action. */
    convertedPct: number;
    score: number;
  };
  top: { wallet: string; name: string; score: number; actions: number }[];
  mechs: { duelists: number; ladderEntries: number; rankedMatches: number; rooms: number };
  errors: string[];
}

let cache: { at: number; value: Analytics } | null = null;

export async function analytics(force = false): Promise<Analytics> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const errors: string[] = [];
  const base = new Connection(HELIUS_DEVNET, "confirmed");
  const er = new Connection(ER_ENDPOINT, "confirmed");

  const byWallet = new Map<string, PlayerRecord>();
  const collect = async (conn: Connection, online: boolean, label: string) => {
    try {
      const accounts = await conn.getProgramAccounts(CITY_PROGRAM, { commitment: "confirmed" });
      for (const { account } of accounts) {
        const rec = decode(new Uint8Array(account.data), online);
        if (!rec) continue;
        // The rollup copy is the live one, so it replaces a base copy.
        const existing = byWallet.get(rec.wallet);
        if (!existing || online) byWallet.set(rec.wallet, rec);
      }
    } catch (err) {
      errors.push(`${label}: ${(err as Error).message}`);
    }
  };
  await Promise.all([collect(base, false, "base roster"), collect(er, true, "rollup roster")]);

  const players = [...byWallet.values()];
  const now = Math.floor(Date.now() / 1000);
  const since = (days: number) => now - days * DAY;

  const activeDay = players.filter((p) => p.lastActive >= since(1)).length;
  const activeWeek = players.filter((p) => p.lastActive >= since(7)).length;
  const newDay = players.filter((p) => p.createdAt >= since(1)).length;
  const newWeek = players.filter((p) => p.createdAt >= since(7)).length;

  const older = players.filter((p) => p.createdAt < since(7));
  const returning = older.filter((p) => p.lastActive >= since(7)).length;

  const bucket = (pick: (p: PlayerRecord) => number) => {
    const counts = new Map<string, number>();
    for (let d = 29; d >= 0; d--) counts.set(dayKey(now - d * DAY), 0);
    for (const p of players) {
      const key = dayKey(pick(p));
      if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].map(([day, count]) => ({ day, count }));
  };

  const sum = (pick: (p: PlayerRecord) => number) => players.reduce((n, p) => n + pick(p), 0);
  const actionsOf = (p: PlayerRecord) => p.swaps + p.transfers + p.bounties;

  const mechs = { duelists: 0, ladderEntries: 0, rankedMatches: 0, rooms: 0 };
  if (MECHS_PROGRAM) {
    const program = new PublicKey(MECHS_PROGRAM);
    try {
      const rollup = await er.getProgramAccounts(program, { commitment: "confirmed" });
      mechs.duelists = rollup.filter(({ account }) => account.data.length >= 239).length;
    } catch (err) {
      errors.push(`rollup duelists: ${(err as Error).message}`);
    }
    try {
      const onBase = await base.getProgramAccounts(program, { commitment: "confirmed" });
      for (const { account } of onBase) {
        if (account.data.length === 620) {
          mechs.ladderEntries++;
          // wins + losses, at offsets 46 and 48.
          const buf = Buffer.from(account.data);
          mechs.rankedMatches += buf.readUInt16LE(46) + buf.readUInt16LE(48);
        } else if (account.data.length === 125) {
          mechs.rooms++;
        }
      }
      // Each match is counted once per player.
      mechs.rankedMatches = Math.floor(mechs.rankedMatches / 2);
    } catch (err) {
      errors.push(`sol mechs accounts: ${(err as Error).message}`);
    }
  }

  const value: Analytics = {
    generatedAt: Date.now(),
    players: {
      total: players.length,
      online: players.filter((p) => p.online).length,
      played: players.filter((p) => p.online || actionsOf(p) > 0 || p.score > 0).length,
      activeDay,
      activeWeek,
      newDay,
      newWeek,
      returningPct: older.length ? Math.round((returning / older.length) * 100) : null,
    },
    signups: bucket((p) => p.createdAt),
    activity: bucket((p) => p.lastActive),
    actions: {
      swaps: sum((p) => p.swaps),
      transfers: sum((p) => p.transfers),
      bounties: sum((p) => p.bounties),
      convertedPct: players.length
        ? Math.round((players.filter((p) => actionsOf(p) > 0).length / players.length) * 100)
        : 0,
      score: sum((p) => p.score),
    },
    top: [...players]
      .sort((a, b) => b.score - a.score || actionsOf(b) - actionsOf(a))
      .slice(0, 10)
      .map((p) => ({ wallet: p.wallet, name: p.displayName, score: p.score, actions: actionsOf(p) })),
    mechs,
    errors,
  };

  cache = { at: Date.now(), value };
  return value;
}

function dayKey(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}
