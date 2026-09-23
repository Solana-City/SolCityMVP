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
 * An inbox, not a live wire: a message waits a day for its recipient, so
 * nobody has to be online when it is sent. The client used to poll every few
 * seconds to keep a presence flag alive; it now polls while the player has
 * the DM tab open and rarely otherwise, which is what the store is billed for.
 *
 * Keys:
 *   dm:inbox:<wallet>   -> list of JSON messages waiting (INBOX_SECS)
 *   dm:off:<wallet>     -> "1" when the player turned DMs off
 *   dm:rate:<wallet>    -> sends in the current RATE_WINDOW
 */
import { evalScript, get, set, del, storeMode } from "@/lib/kv";
import { verifyEd25519, verifySessionOwner } from "@/lib/auth/sessionAuth";

export { storeMode, verifyEd25519, verifySessionOwner };

/** How long an undelivered message waits for its recipient. */
const INBOX_SECS = 86_400;
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
local m = redis.call('LRANGE', KEYS[2], 0, -1)
if #m > 0 then redis.call('DEL', KEYS[2]) end
local off = redis.call('GET', KEYS[3])
if off then return {1, m} end
return {0, m}`;

export type PollResult = { ok: true; off: boolean; messages: DM[] } | { ok: false };

export async function poll(wallet: string, sessionKey: string): Promise<PollResult> {
  const keys = [`auth:sk:${sessionKey}`, `dm:inbox:${wallet}`, `dm:off:${wallet}`];
  const run = () => evalScript<[number, string[]?]>(POLL_SCRIPT, keys, [wallet], (mem) => {
    if (mem.get(keys[0]) !== wallet) return [-1];
    const m = (mem.get(keys[1]) as string[] | undefined) ?? [];
    mem.delete(keys[1]);
    return [mem.get(keys[2]) ? 1 : 0, m];
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

// ── Send: auth, DMs off, rate limit, deliver; one command ──────────────────

const SEND_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return -1 end
if redis.call('GET', KEYS[2]) then return -2 end
local n = redis.call('INCR', KEYS[4])
if n == 1 then redis.call('EXPIRE', KEYS[4], tonumber(ARGV[3])) end
if n > tonumber(ARGV[4]) then return -4 end
redis.call('RPUSH', KEYS[3], ARGV[2])
redis.call('LTRIM', KEYS[3], -tonumber(ARGV[5]), -1)
redis.call('EXPIRE', KEYS[3], tonumber(ARGV[6]))
return 1`;

export type SendOutcome = "sent" | "unauthorized" | "off" | "rate";

export async function send(from: string, sessionKey: string, to: string, text: string): Promise<SendOutcome> {
  const keys = [`auth:sk:${sessionKey}`, `dm:off:${to}`, `dm:inbox:${to}`, `dm:rate:${from}`];
  const payload = JSON.stringify({ from, text, at: Date.now() } satisfies DM);
  const run = () => evalScript<number>(
    SEND_SCRIPT, keys, [from, payload, RATE_WINDOW, RATE_MAX, INBOX_CAP, INBOX_SECS],
    (mem) => {
      if (mem.get(keys[0]) !== from) return -1;
      if (mem.get(keys[1])) return -2;
      const inbox = (mem.get(keys[2]) as string[] | undefined) ?? [];
      inbox.push(payload);
      mem.set(keys[2], inbox.slice(-INBOX_CAP));
      return 1;
    },
  );
  let code = await run();
  if (code === -1) {
    if (!(await verifySessionOwner(from, sessionKey))) return "unauthorized";
    code = await run();
  }
  return code === 1 ? "sent" : code === -2 ? "off" : code === -4 ? "rate" : "unauthorized";
}

export async function setDmsOff(wallet: string, off: boolean): Promise<void> {
  if (off) await set(`dm:off:${wallet}`, "1");
  else await del(`dm:off:${wallet}`);
}

/** Nickname -> wallet, through the name registry. */
export async function walletForName(name: string): Promise<string | null> {
  return get(`names:byName:${name.trim().toLowerCase()}`);
}
