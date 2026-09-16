/**
 * The small key-value store behind the nickname registry and the feature flags.
 *
 * Redis over REST (Upstash / Vercel KV): set KV_REST_API_URL +
 * KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN).
 * Without them it falls back to process memory in development only; production
 * reports "off" rather than pretending to persist.
 *
 * Extracted from nameStore so the developer panel can keep its flags in the
 * same place without a second copy of this plumbing.
 */

const URL_ = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? "";
const TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

type Cmd = (string | number)[];

const memory = ((globalThis as { __solCityKv?: Map<string, unknown> }).__solCityKv ??= new Map());

export function storeMode(): "redis" | "memory" | "off" {
  if (URL_ && TOKEN) return "redis";
  return process.env.NODE_ENV === "production" ? "off" : "memory";
}

async function redis<T = unknown>(cmd: Cmd): Promise<T> {
  const res = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`redis: ${body.error ?? res.status}`);
  return body.result as T;
}

export async function get(key: string): Promise<string | null> {
  if (storeMode() === "redis") return redis<string | null>(["GET", key]);
  return (memory.get(key) as string | undefined) ?? null;
}

export async function mget(keys: string[]): Promise<(string | null)[]> {
  if (keys.length === 0) return [];
  if (storeMode() === "redis") return redis<(string | null)[]>(["MGET", ...keys]);
  return keys.map((k) => (memory.get(k) as string | undefined) ?? null);
}

export async function set(key: string, value: string): Promise<void> {
  if (storeMode() === "redis") { await redis(["SET", key, value]); return; }
  memory.set(key, value);
}

/** SET NX: true when this call created the key. */
export async function setnx(key: string, value: string): Promise<boolean> {
  if (storeMode() === "redis") return (await redis<string | null>(["SET", key, value, "NX"])) === "OK";
  if (memory.has(key)) return false;
  memory.set(key, value);
  return true;
}

export async function del(key: string): Promise<void> {
  if (storeMode() === "redis") { await redis(["DEL", key]); return; }
  memory.delete(key);
}

export async function smembers(key: string): Promise<string[]> {
  if (storeMode() === "redis") return redis<string[]>(["SMEMBERS", key]);
  return [...((memory.get(key) as Set<string> | undefined) ?? [])];
}

export async function sadd(key: string, value: string): Promise<void> {
  if (storeMode() === "redis") { await redis(["SADD", key, value]); return; }
  const s = (memory.get(key) as Set<string> | undefined) ?? new Set<string>();
  s.add(value);
  memory.set(key, s);
}

export async function srem(key: string, value: string): Promise<void> {
  if (storeMode() === "redis") { await redis(["SREM", key, value]); return; }
  (memory.get(key) as Set<string> | undefined)?.delete(value);
}

export async function scard(key: string): Promise<number> {
  if (storeMode() === "redis") return redis<number>(["SCARD", key]);
  return ((memory.get(key) as Set<string> | undefined) ?? new Set()).size;
}

/** Whole hash as an object. Used by the feature flags. */
export async function hgetall(key: string): Promise<Record<string, string>> {
  if (storeMode() === "redis") {
    const flat = await redis<string[] | Record<string, string> | null>(["HGETALL", key]);
    if (!flat) return {};
    if (!Array.isArray(flat)) return flat;
    const out: Record<string, string> = {};
    for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = flat[i + 1];
    return out;
  }
  return { ...((memory.get(key) as Record<string, string> | undefined) ?? {}) };
}

export async function hset(key: string, field: string, value: string): Promise<void> {
  if (storeMode() === "redis") { await redis(["HSET", key, field, value]); return; }
  const h = (memory.get(key) as Record<string, string> | undefined) ?? {};
  h[field] = value;
  memory.set(key, h);
}

export async function hdel(key: string, field: string): Promise<void> {
  if (storeMode() === "redis") { await redis(["HDEL", key, field]); return; }
  const h = memory.get(key) as Record<string, string> | undefined;
  if (h) delete h[field];
}

// ── Counters, sorted sets and lists (the analytics events use these) ────────

export async function incr(key: string, by = 1): Promise<number> {
  if (storeMode() === "redis") return redis<number>(["INCRBY", key, by]);
  const n = Number((memory.get(key) as string | undefined) ?? 0) + by;
  memory.set(key, String(n));
  return n;
}

/** Adds to a member's score in a sorted set, creating it when missing. */
export async function zincrby(key: string, member: string, by = 1): Promise<void> {
  if (storeMode() === "redis") { await redis(["ZINCRBY", key, by, member]); return; }
  const z = (memory.get(key) as Map<string, number> | undefined) ?? new Map<string, number>();
  z.set(member, (z.get(member) ?? 0) + by);
  memory.set(key, z);
}

/** Keeps the highest score seen for a member. */
export async function zmax(key: string, member: string, score: number): Promise<void> {
  if (storeMode() === "redis") { await redis(["ZADD", key, "GT", score, member]); return; }
  const z = (memory.get(key) as Map<string, number> | undefined) ?? new Map<string, number>();
  if (score > (z.get(member) ?? -Infinity)) z.set(member, score);
  memory.set(key, z);
}

/** Highest scores first. */
export async function ztop(key: string, limit = 10): Promise<{ member: string; score: number }[]> {
  if (storeMode() === "redis") {
    const flat = await redis<string[]>(["ZRANGE", key, 0, limit - 1, "REV", "WITHSCORES"]);
    const out: { member: string; score: number }[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) out.push({ member: flat[i], score: Number(flat[i + 1]) });
    return out;
  }
  const z = (memory.get(key) as Map<string, number> | undefined) ?? new Map<string, number>();
  return [...z.entries()]
    .map(([member, score]) => ({ member, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Pushes onto the head of a capped list (a recent-activity feed). */
export async function lpushCapped(key: string, value: string, cap: number): Promise<void> {
  if (storeMode() === "redis") {
    await redis(["LPUSH", key, value]);
    await redis(["LTRIM", key, 0, cap - 1]);
    return;
  }
  const l = (memory.get(key) as string[] | undefined) ?? [];
  l.unshift(value);
  memory.set(key, l.slice(0, cap));
}

export async function lrange(key: string, limit: number): Promise<string[]> {
  if (storeMode() === "redis") return redis<string[]>(["LRANGE", key, 0, limit - 1]);
  return ((memory.get(key) as string[] | undefined) ?? []).slice(0, limit);
}
