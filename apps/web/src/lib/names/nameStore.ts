/**
 * Server-side nickname registry.
 *
 * One store for every player, so names are unique city-wide and the team can
 * lock them. Backed by Redis over REST (Upstash / Vercel KV): set
 * KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL +
 * UPSTASH_REDIS_REST_TOKEN). Without them it falls back to process memory in
 * development only; production reports the service as unavailable rather
 * than handing out names it cannot keep unique.
 *
 * Keys:
 *   names:byName:<lower>        -> wallet that owns the name
 *   names:byWallet:<wallet>     -> the name as the player typed it
 *   names:locked:<lower>        -> JSON { reason, at }  (nobody may take it)
 *   names:lockedWallet:<wallet> -> JSON { reason, at }  (wallet may not rename)
 *   names:blockedWords          -> set of extra banned words (admin managed)
 */

import { del, get, mget, sadd, scard, set, setnx, smembers, srem, storeMode } from "@/lib/kv";

export { storeMode };

// ── Rules ────────────────────────────────────────────────────────────────────

export const NAME_MIN = 3;
export const NAME_MAX = 16;

/** Words no name may contain, after leetspeak is undone. English + Portuguese. */
const BANNED = [
  // Substring matches, so each word is chosen not to hit ordinary names
  // ("anal" would ban "Analyst", "puta" would ban "Computador").
  "fuck", "shit", "bitch", "cunt", "pussy", "whore", "slut", "nigg", "faggot", "retard",
  "rapist", "nazi", "hitler", "porn", "penis", "vagina",
  "porra", "caralho", "buceta", "putinha", "putaria", "merda", "viado", "cuzao", "arrombad", "piroca",
  "xoxota", "boquete", "estupr",
];

/** Names only the team may use, so nobody can pose as staff. */
const RESERVED = [
  "admin", "administrator", "moderator", "mod", "staff", "dev", "developer", "support", "official",
  "solana", "solanacity", "solcity", "system", "superteam", "magicblock", "jupiter", "citizen", "null", "undefined",
];

function normalize(s: string): string {
  return s.toLowerCase()
    .replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a")
    .replace(/5/g, "s").replace(/7/g, "t").replace(/8/g, "b").replace(/9/g, "g")
    .replace(/[_\W]/g, "");
}

export type NameProblem = "length" | "chars" | "offensive" | "reserved" | "taken" | "locked" | "wallet-locked";

export async function validate(name: string, wallet?: string): Promise<NameProblem | null> {
  if (name.length < NAME_MIN || name.length > NAME_MAX) return "length";
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) return "chars";
  const flat = normalize(name);
  const extra = await smembers("names:blockedWords").catch(() => [] as string[]);
  if ([...BANNED, ...extra].some((w) => flat.includes(normalize(w)))) return "offensive";
  if (RESERVED.includes(flat)) return "reserved";
  const lower = name.toLowerCase();
  if (await get(`names:locked:${lower}`)) return "locked";
  if (wallet && await get(`names:lockedWallet:${wallet}`)) return "wallet-locked";
  const owner = await get(`names:byName:${lower}`);
  if (owner && owner !== wallet) return "taken";
  return null;
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * Wallet -> name, cached in the server's memory.
 *
 * A name changes once in a while and is read constantly (every nameplate in
 * the city), so reading Redis for each one is both slow and expensive. The
 * cache is also what keeps names working when Redis is down or out of quota:
 * a stale name is served rather than a wallet address, because a nameplate
 * turning back into "7NXk...uqbA" mid-session is the worst outcome.
 */
const FRESH_MS = 5 * 60_000;
const nameCache = new Map<string, { name: string | null; at: number }>();

/** Called after a write, so the next read does not serve the old name. */
export function cacheName(wallet: string, name: string | null): void {
  nameCache.set(wallet, { name, at: Date.now() });
}

export async function namesFor(wallets: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(wallets)].slice(0, 100);
  const now = Date.now();
  const out: Record<string, string> = {};
  const stale: string[] = [];
  for (const w of unique) {
    const hit = nameCache.get(w);
    if (hit && now - hit.at < FRESH_MS) {
      if (hit.name) out[w] = hit.name;
    } else {
      stale.push(w);
    }
  }
  if (stale.length === 0) return out;

  try {
    const values = await mget(stale.map((w) => `names:byWallet:${w}`));
    stale.forEach((w, i) => {
      const name = values[i] ?? null;
      nameCache.set(w, { name, at: now });
      if (name) out[w] = name;
    });
  } catch (err) {
    // Redis unreachable or over quota: serve whatever was known, at any age.
    console.error("[names] read failed, serving cache", err);
    for (const w of stale) {
      const hit = nameCache.get(w);
      if (hit?.name) out[w] = hit.name;
    }
  }
  return out;
}

export async function walletLock(wallet: string): Promise<{ reason: string; at: number } | null> {
  const raw = await get(`names:lockedWallet:${wallet}`);
  return raw ? JSON.parse(raw) : null;
}

// ── Writes ───────────────────────────────────────────────────────────────────

export async function claim(wallet: string, name: string): Promise<NameProblem | null> {
  const problem = await validate(name, wallet);
  if (problem) return problem;
  const lower = name.toLowerCase();
  const previous = await get(`names:byWallet:${wallet}`);
  // Atomic reservation: two players racing for one name, only one SET NX wins.
  if (!(await setnx(`names:byName:${lower}`, wallet))) {
    const owner = await get(`names:byName:${lower}`);
    if (owner !== wallet) return "taken";
  }
  await set(`names:byWallet:${wallet}`, name);
  cacheName(wallet, name);
  await sadd("names:all", name);
  if (previous && previous.toLowerCase() !== lower) {
    await del(`names:byName:${previous.toLowerCase()}`);
    await srem("names:all", previous);
  }
  return null;
}

/** Admin: take a name away. It stays unavailable; the wallet can't rename until unlocked. */
export async function lock(target: { name?: string; wallet?: string }, reason: string): Promise<{ name: string | null; wallet: string | null }> {
  let wallet = target.wallet ?? null;
  let name = target.name ?? null;
  if (!wallet && name) wallet = await get(`names:byName:${name.toLowerCase()}`);
  if (!name && wallet) name = await get(`names:byWallet:${wallet}`);
  const entry = JSON.stringify({ reason, at: Date.now() });
  if (name) {
    await set(`names:locked:${name.toLowerCase()}`, entry);
    await srem("names:all", name);
  }
  if (wallet) {
    await set(`names:lockedWallet:${wallet}`, entry);
    await del(`names:byWallet:${wallet}`);
    // A locked name must disappear everywhere at once, cache included.
    cacheName(wallet, null);
  }
  if (name) await del(`names:byName:${name.toLowerCase()}`);
  return { name, wallet };
}

export async function unlock(target: { name?: string; wallet?: string }): Promise<void> {
  if (target.name) await del(`names:locked:${target.name.toLowerCase()}`);
  if (target.wallet) await del(`names:lockedWallet:${target.wallet}`);
}

/** Every claimed name, for the developer panel. */
export async function allNames(): Promise<string[]> {
  return (await smembers("names:all")).sort((a, b) => a.localeCompare(b));
}

export async function nameCount(): Promise<number> {
  return scard("names:all");
}

export async function blockWord(word: string, on: boolean): Promise<string[]> {
  if (on) await sadd("names:blockedWords", word.toLowerCase());
  else await srem("names:blockedWords", word.toLowerCase());
  return smembers("names:blockedWords");
}
