/**
 * City-wide boards and daily quests.
 *
 * Both used to live in `localStorage`, which meant every browser had its own
 * private leaderboard: a player's finds vanished when they switched device,
 * and nobody could ever see anybody else's score. The numbers now live in the
 * same key-value store as the nicknames.
 *
 * The scores themselves are the ones the gameplay events already record, so
 * there is one source and no second write path to keep honest:
 *   ev:hunt:found:by         finds per wallet          -> the Find Someone board
 *   ev:minigame:<id>:best    best score per wallet     -> per-game boards
 *   lb:quest                 quest points per wallet   -> the quest board
 *   lb:streak                best check-in streak      -> the streak board (lib/streak.ts)
 *
 * Quest progress is per wallet per UTC day:
 *   quests:<YYYY-MM-DD>:<wallet>   hash questId -> JSON progress
 *
 * Trust: these are public writes, exactly as trustworthy as the localStorage
 * they replace, which is to say a determined player can inflate their own
 * number. Anything that must be true (score on the city program, ranked
 * rating) is on-chain and unaffected. Values are clamped so a forged report
 * cannot produce an absurd board.
 */
import { hgetall, hset, storeMode, zincrby, ztop } from "@/lib/kv";
import { namesFor } from "@/lib/names/nameStore";

export const QUEST_POINTS_KEY = "lb:quest";
/** A single quest can never be worth more than this. */
export const MAX_QUEST_POINTS = 100;

export interface BoardRow {
  wallet: string;
  /** Nickname when the wallet has one. */
  name: string | null;
  value: number;
}

function huntKey(): string {
  return "ev:hunt:found:by";
}

function gameKey(id: string): string {
  return `ev:minigame:${id}:best`;
}

/**
 * `hunt`, `quests`, `streak`, or `game:<id>`. Unknown boards return empty rather than
 * throwing: the caller is a public endpoint.
 */
export async function readBoard(board: string, limit = 10): Promise<BoardRow[]> {
  if (storeMode() === "off") return [];
  let key: string | null = null;
  if (board === "hunt") key = huntKey();
  else if (board === "quests") key = QUEST_POINTS_KEY;
  else if (board === "streak") key = "lb:streak";
  else if (board.startsWith("game:")) {
    const id = board.slice(5);
    if (/^[a-z0-9][a-z0-9_-]{0,39}$/i.test(id)) key = gameKey(id);
  }
  if (!key) return [];

  const rows = await ztop(key, Math.min(50, Math.max(1, limit)));
  const names = await namesFor(rows.map((r) => r.member)).catch(() => ({} as Record<string, string>));
  return rows.map((r) => ({ wallet: r.member, name: names[r.member] ?? null, value: r.score }));
}

/** One wallet's place and value on a board, without fetching the whole thing. */
export async function readMine(board: string, wallet: string): Promise<{ value: number; rank: number | null }> {
  const rows = await readBoard(board, 50);
  const index = rows.findIndex((r) => r.wallet === wallet);
  return {
    value: index >= 0 ? rows[index].value : 0,
    rank: index >= 0 ? index + 1 : null,
  };
}

// ── Daily quests ───────────────────────────────────────────────────────────

export interface QuestRow {
  questId: string;
  current: number;
  completed: boolean;
  claimedAt?: number;
}

function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function questsKey(wallet: string): string {
  return `quests:${dayKey()}:${wallet}`;
}

export async function readQuests(wallet: string): Promise<Record<string, QuestRow>> {
  if (storeMode() === "off") return {};
  const raw = await hgetall(questsKey(wallet)).catch(() => ({} as Record<string, string>));
  const out: Record<string, QuestRow> = {};
  for (const [questId, value] of Object.entries(raw)) {
    try {
      out[questId] = JSON.parse(value) as QuestRow;
    } catch {
      /* skip a corrupt entry rather than losing the whole day */
    }
  }
  return out;
}

/**
 * Advances a quest by one, capped at its target. `target` comes from the
 * client because the quest table is client-side content; it is clamped so a
 * bogus target cannot create an unreachable or instantly complete quest.
 */
export async function advanceQuest(
  wallet: string,
  questId: string,
  target: number,
): Promise<QuestRow> {
  const capped = Math.max(1, Math.min(50, Math.round(target)));
  const all = await readQuests(wallet);
  const prev = all[questId] ?? { questId, current: 0, completed: false };
  if (prev.completed || prev.claimedAt) return prev;

  const current = Math.min(prev.current + 1, capped);
  const next: QuestRow = { questId, current, completed: current >= capped };
  await hset(questsKey(wallet), questId, JSON.stringify(next));
  return next;
}

/** Claims a completed quest once, and banks its points. Returns the points. */
export async function claimQuestPoints(
  wallet: string,
  questId: string,
  points: number,
): Promise<number> {
  const all = await readQuests(wallet);
  const row = all[questId];
  if (!row?.completed || row.claimedAt) return 0;

  const banked = Math.max(0, Math.min(MAX_QUEST_POINTS, Math.round(points)));
  await hset(questsKey(wallet), questId, JSON.stringify({ ...row, claimedAt: Date.now() }));
  if (banked > 0) await zincrby(QUEST_POINTS_KEY, wallet, banked);
  return banked;
}
