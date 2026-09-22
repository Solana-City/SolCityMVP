/**
 * Server side of direct messages.
 *
 * DMs never touch the chain: the on-chain chat field is public and holds one
 * message per player. They go through the same Redis as the nicknames, as
 * short-lived inboxes that the recipient drains.
 *
 * Auth without wallet popups: every request is signed with the player's
 * session key (see lib/auth/sessionAuth.ts). The poll and send scripts read
 * the same `auth:sk:<sessionKey>` cache that module fills.
 *
 * Presence is the poll itself: each poll refreshes `dm:seen:<wallet>` for a
 * few seconds, so "online" means "has the city open right now".
 *
 * Keys:
 *   dm:seen:<wallet>    -> "1" while the player is polling (SEEN_SECS)
 *   dm:inbox:<wallet>   -> list of JSON messages waiting (INBOX_SECS)
 *   dm:off:<wallet>     -> "1" when the player turned DMs off
 *   dm:rate:<wallet>    -> sends in the current RATE_WINDOW
 */
import { evalScript, get, set, del, storeMode } from "@/lib/kv";
import { verifyEd25519, verifySessionOwner } from "@/lib/auth/sessionAuth";

export { storeMode, verifyEd25519, verifySessionOwner };

/** Presence window: comfortably longer than the client's 10s poll. */
const SEEN_SECS = 25;
const INBOX_SECS = 180;
const INBOX_CAP = 50;
const RATE_WINDOW = 10;
const RATE_MAX = 6;
export const MAX_AGE_MS = 60_000;
export const DM_MAX_LEN = 140;

export interface DM {
  from: string;
  text: string;
  at: number;
}

// ── Poll: presence + drain the inbox, one command ───────────────────────────

const POLL_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return {-1} end
redis.call('SET', KEYS[2], '1', 'EX', tonumber(ARGV[2]))
local m = redis.call('LRANGE', KEYS[3], 0, -1)
if #m > 0 then redis.call('DEL', KEYS[3]) end
local off = redis.call('GET', KEYS[4])
if off then return {1, m} end
return {0, m}`;

export type PollResult = { ok: true; off: boolean; messages: DM[] } | { ok: false };

export async function poll(wallet: string, sessionKey: string): Promise<PollResult> {
  const keys = [`auth:sk:${sessionKey}`, `dm:seen:${wallet}`, `dm:inbox:${wallet}`, `dm:off:${wallet}`];
  const run = () => evalScript<[number, string[]?]>(POLL_SCRIPT, keys, [wallet, SEEN_SECS], (mem) => {
    if (mem.get(keys[0]) !== wallet) return [-1];
    mem.set(keys[1], String(Date.now() + SEEN_SECS * 1000));
    const m = (mem.get(keys[2]) as string[] | undefined) ?? [];
    mem.delete(keys[2]);
    return [mem.get(keys[3]) ? 1 : 0, m];
  });
  let res = await run();
  if (res[0] === -1) {
    if (!(await verifySessionOwner(wallet, sessionKey))) return { ok: false };
    res = await run();
    if (res[0] === -1) return { ok: false };
  }
  const messages: DM[] = [];
  for (const raw of res[1] ?? []) {
    try { messages.push(JSON.parse(raw)); } catch { /* skip */ }
  }
  return { ok: true, off: res[0] === 1, messages };
}

// ── Send: auth, DMs off, online, rate limit, deliver; one command ───────────

const SEND_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return -1 end
if redis.call('GET', KEYS[2]) then return -2 end
if not redis.call('GET', KEYS[3]) then return -3 end
local n = redis.call('INCR', KEYS[5])
if n == 1 then redis.call('EXPIRE', KEYS[5], tonumber(ARGV[3])) end
if n > tonumber(ARGV[4]) then return -4 end
redis.call('RPUSH', KEYS[4], ARGV[2])
redis.call('LTRIM', KEYS[4], -tonumber(ARGV[5]), -1)
redis.call('EXPIRE', KEYS[4], tonumber(ARGV[6]))
return 1`;

export type SendOutcome = "sent" | "unauthorized" | "off" | "offline" | "rate";

export async function send(from: string, sessionKey: string, to: string, text: string): Promise<SendOutcome> {
  const keys = [`auth:sk:${sessionKey}`, `dm:off:${to}`, `dm:seen:${to}`, `dm:inbox:${to}`, `dm:rate:${from}`];
  const payload = JSON.stringify({ from, text, at: Date.now() } satisfies DM);
  const run = () => evalScript<number>(
    SEND_SCRIPT, keys, [from, payload, RATE_WINDOW, RATE_MAX, INBOX_CAP, INBOX_SECS],
    (mem) => {
      if (mem.get(keys[0]) !== from) return -1;
      if (mem.get(keys[1])) return -2;
      if (Number(mem.get(keys[2]) ?? 0) < Date.now()) return -3;
      const inbox = (mem.get(keys[3]) as string[] | undefined) ?? [];
      inbox.push(payload);
      mem.set(keys[3], inbox.slice(-INBOX_CAP));
      return 1;
    },
  );
  let code = await run();
  if (code === -1) {
    if (!(await verifySessionOwner(from, sessionKey))) return "unauthorized";
    code = await run();
  }
  return code === 1 ? "sent" : code === -2 ? "off" : code === -3 ? "offline" : code === -4 ? "rate" : "unauthorized";
}

export async function setDmsOff(wallet: string, off: boolean): Promise<void> {
  if (off) await set(`dm:off:${wallet}`, "1");
  else await del(`dm:off:${wallet}`);
}

/** Nickname -> wallet, through the name registry. */
export async function walletForName(name: string): Promise<string | null> {
  return get(`names:byName:${name.trim().toLowerCase()}`);
}
