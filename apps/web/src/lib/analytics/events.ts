/**
 * Gameplay events: what the chain cannot tell us.
 *
 * The player PDA knows totals (score, swaps, transfers), but not WHICH
 * protocol a player opened, how a mini-game round went, or who found the
 * hidden citizen. Those are the numbers the partner projects actually ask for,
 * so the client reports them here and they are aggregated in the same
 * key-value store the nicknames use.
 *
 * Shape of what is kept, per event `kind` and `id`:
 *   ev:<kind>:<id>:count          how many times
 *   ev:<kind>:<id>:users          set of wallets (so "unique users" is exact)
 *   ev:<kind>:<id>:d:<YYYY-MM-DD> per-day count, last 30 days are read back
 *   ev:<kind>:<id>:by             sorted set wallet -> times (top users)
 *   ev:<kind>:<id>:best           sorted set wallet -> best score (mini-games)
 *   ev:ids:<kind>                 set of ids seen, so the panel needs no list
 *   ev:feed                       last 100 events, newest first
 *
 * Only counters and wallets are stored. No addresses beyond the wallet the
 * player already broadcasts in the city, and nothing a third party sends.
 */
import { incr, lpushCapped, lrange, sadd, scard, smembers, storeMode, zincrby, zmax, ztop } from "@/lib/kv";

/** What can be reported. Anything else is rejected. */
export const EVENT_KINDS = ["protocol", "protocol-open", "minigame", "hunt", "duel"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface GameEvent {
  kind: EventKind;
  /** Protocol/NPC id, mini-game id, or "found" for the hunt. */
  id: string;
  wallet: string;
  /** Mini-game score, or 1. */
  value?: number;
  /** Did the round end well. Only meaningful for mini-games. */
  success?: boolean;
  /** Short human label for the feed ("Swap 0.1 SOL"). */
  label?: string;
}

const FEED_CAP = 100;
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function dayKey(ms = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Validates and stores one event. Returns false when it was rejected. */
export async function recordEvent(ev: GameEvent): Promise<boolean> {
  if (storeMode() === "off") return false;
  if (!EVENT_KINDS.includes(ev.kind)) return false;
  if (!ID_RE.test(ev.id) || !WALLET_RE.test(ev.wallet)) return false;

  const base = `ev:${ev.kind}:${ev.id}`;
  const score = Number.isFinite(ev.value) ? Math.max(0, Math.min(1_000_000, Math.round(ev.value!))) : 0;

  await Promise.all([
    incr(`${base}:count`),
    sadd(`${base}:users`, ev.wallet),
    incr(`${base}:d:${dayKey()}`),
    zincrby(`${base}:by`, ev.wallet),
    sadd(`ev:ids:${ev.kind}`, ev.id),
    score > 0 ? zmax(`${base}:best`, ev.wallet, score) : Promise.resolve(),
    lpushCapped("ev:feed", JSON.stringify({
      k: ev.kind, i: ev.id, w: ev.wallet, v: score,
      s: ev.success === undefined ? null : ev.success,
      l: (ev.label ?? "").slice(0, 60),
      t: Date.now(),
    }), FEED_CAP),
  ]);
  return true;
}

export interface KindSummary {
  id: string;
  count: number;
  users: number;
  last7: number;
  top: { wallet: string; count: number }[];
  best: { wallet: string; score: number }[];
}

async function summarise(kind: EventKind, id: string): Promise<KindSummary> {
  const base = `ev:${kind}:${id}`;
  const days = Array.from({ length: 7 }, (_, i) => dayKey(Date.now() - i * 86_400_000));
  const [count, users, top, best, ...daily] = await Promise.all([
    incr(`${base}:count`, 0),
    scard(`${base}:users`),
    ztop(`${base}:by`, 5),
    ztop(`${base}:best`, 5),
    ...days.map((d) => incr(`${base}:d:${d}`, 0)),
  ]);
  return {
    id,
    count,
    users,
    last7: daily.reduce((n, d) => n + d, 0),
    top: top.map((t) => ({ wallet: t.member, count: t.score })),
    best: best.map((t) => ({ wallet: t.member, score: t.score })),
  };
}

export interface FeedItem {
  kind: string;
  id: string;
  wallet: string;
  value: number;
  success: boolean | null;
  label: string;
  at: number;
}

export interface EventReport {
  protocols: KindSummary[];
  opens: KindSummary[];
  minigames: KindSummary[];
  hunt: KindSummary | null;
  duels: KindSummary[];
  feed: FeedItem[];
  enabled: boolean;
}

/** Everything the panel shows about gameplay events. */
export async function eventReport(): Promise<EventReport> {
  if (storeMode() === "off") {
    return { protocols: [], opens: [], minigames: [], hunt: null, duels: [], feed: [], enabled: false };
  }
  const forKind = async (kind: EventKind) => {
    const ids = await smembers(`ev:ids:${kind}`);
    const rows = await Promise.all(ids.map((id) => summarise(kind, id)));
    return rows.sort((a, b) => b.count - a.count);
  };

  const [protocols, opens, minigames, hunt, duels, rawFeed] = await Promise.all([
    forKind("protocol"),
    forKind("protocol-open"),
    forKind("minigame"),
    forKind("hunt").then((r) => r[0] ?? null),
    forKind("duel"),
    lrange("ev:feed", FEED_CAP),
  ]);

  const feed: FeedItem[] = rawFeed.flatMap((line) => {
    try {
      const j = JSON.parse(line);
      return [{ kind: j.k, id: j.i, wallet: j.w, value: j.v, success: j.s, label: j.l, at: j.t }];
    } catch {
      return [];
    }
  });

  return { protocols, opens, minigames, hunt, duels, feed, enabled: true };
}
