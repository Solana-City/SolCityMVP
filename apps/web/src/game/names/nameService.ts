/**
 * Client side of the nickname registry (/api/names).
 *
 * Names are cached per wallet; the scene asks for the wallets it has on
 * screen and gets told when any of them resolve or change, so labels update
 * without polling per sprite.
 */
import { claimMessage } from "@/lib/names/claimMessage";

/**
 * Names seen before, kept on the device.
 *
 * The registry is off-chain, so it can be unreachable (network, an outage, a
 * quota). A nameplate turning back into a wallet address mid-session is the
 * one outcome to avoid, so every name resolved is remembered here and shown
 * again next time, whatever the server does.
 */
const STORE_KEY = "solcity:names";
const STORE_MAX = 500;

function loadStored(): Map<string, string | null> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return new Map();
    return new Map(Object.entries(JSON.parse(raw) as Record<string, string>));
  } catch {
    return new Map();
  }
}

const cache: Map<string, string | null> = typeof window === "undefined" ? new Map() : loadStored();

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveStored(): void {
  if (saveTimer || typeof window === "undefined") return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const named = [...cache.entries()].filter(([, n]) => n).slice(-STORE_MAX);
      localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(named)));
    } catch { /* storage blocked or full */ }
  }, 1_000);
}
const listeners = new Set<(names: Record<string, string>) => void>();
let pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

export const NAME_CHANGED_EVENT = "solcity:name-changed";

export function cachedName(wallet: string): string | null {
  return cache.get(wallet) ?? null;
}

export function onNames(cb: (names: Record<string, string>) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function emit(names: Record<string, string>) {
  if (Object.keys(names).length === 0) return;
  for (const cb of listeners) cb(names);
}

/** Queue wallets to resolve; batched into one request. `force` re-fetches known ones. */
export function requestNames(wallets: string[], force = false): void {
  for (const w of wallets) if (force || !cache.has(w)) pending.add(w);
  if (pending.size === 0 || timer) return;
  timer = setTimeout(async () => {
    const batch = [...pending];
    pending = new Set();
    timer = null;
    try {
      const res = await fetch(`/api/names?wallets=${encodeURIComponent(batch.join(","))}`);
      const body = await res.json();
      const found: Record<string, string> = body.names ?? {};
      const changed: Record<string, string> = {};
      for (const w of batch) {
        const next = found[w] ?? null;
        // Never overwrite a known name with nothing: the registry being
        // unavailable reads as "no name", and the nameplate would flip back
        // to the wallet address.
        if (!next && cache.get(w)) continue;
        if (cache.get(w) !== next && next) changed[w] = next;
        cache.set(w, next);
      }
      saveStored();
      emit(changed);
    } catch { /* offline: try again next time */ }
  }, 150);
}

export interface NameStatus {
  enabled: boolean;
  name: string | null;
  locked: { reason: string; at: number } | null;
}

export async function fetchStatus(wallet: string): Promise<NameStatus> {
  try {
    const res = await fetch(`/api/names?status=1&wallet=${encodeURIComponent(wallet)}`);
    const body = await res.json();
    if (body.name && cache.get(wallet) !== body.name) {
      cache.set(wallet, body.name);
      saveStored();
      emit({ [wallet]: body.name });
    }
    return { enabled: !!body.enabled, name: body.name ?? null, locked: body.locked ?? null };
  } catch {
    return { enabled: false, name: null, locked: null };
  }
}

export async function checkName(name: string, wallet: string): Promise<{ available: boolean; message: string | null }> {
  const res = await fetch(`/api/names?check=${encodeURIComponent(name)}&wallet=${encodeURIComponent(wallet)}`);
  const body = await res.json();
  if (body.enabled === false) return { available: false, message: "Nicknames are offline right now. Try again later." };
  return { available: !!body.available, message: body.message ?? null };
}

export async function claimName(
  wallet: string,
  name: string,
  signMessage: (msg: Uint8Array) => Promise<Uint8Array>,
): Promise<{ ok: boolean; message?: string }> {
  const ts = Date.now();
  const sig = await signMessage(new TextEncoder().encode(claimMessage(wallet, name, ts)));
  const signature = btoa(String.fromCharCode(...sig));
  const res = await fetch("/api/names", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet, name, ts, signature }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.ok) {
    cache.set(wallet, name);
    saveStored();
    emit({ [wallet]: name });
    window.dispatchEvent(new CustomEvent(NAME_CHANGED_EVENT, { detail: { wallet, name } }));
  }
  return { ok: !!body.ok, message: body.message };
}
