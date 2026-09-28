/**
 * Timed buffs the player picks up around the city.
 *
 * One is live today, the Vietnamese Barista's coffee, but the shape is a
 * registry so the next one has somewhere to go without another store.
 *
 * A plain module singleton with a subscriber list: Phaser asks for the speed
 * multiplier every frame, React redraws the HUD timer, and neither has to know
 * the other exists. Expiries go to localStorage so a reload mid-buff does not
 * quietly take the time back.
 *
 * Local to this player. Other people in the city do not see the buff yet: that
 * would need a bit in the on-chain direction byte, which is a separate change.
 */
import { COFFEE_ICON_URL, COFFEE_TEXTURE_KEY } from "./coffeeIcon";

export type BuffId = "vietnamese-coffee";

export interface BuffDefinition {
  id: BuffId;
  /** Shown in the HUD chip next to the time left. Keep it to one word. */
  label: string;
  durationMs: number;
  /** Multiplies the player's walking speed for as long as the buff is up. */
  speedMultiplier: number;
  /** HUD icon. A data URL today, a file path once the art lands. */
  iconUrl: string;
  /** Phaser texture key for the badge over the player's head. */
  textureKey: string;
}

export const BUFFS: Record<BuffId, BuffDefinition> = {
  "vietnamese-coffee": {
    id: "vietnamese-coffee",
    label: "COFFEE",
    durationMs: 3 * 60_000,
    speedMultiplier: 1.4,
    iconUrl: COFFEE_ICON_URL,
    textureKey: COFFEE_TEXTURE_KEY,
  },
};

export interface ActiveBuff {
  def: BuffDefinition;
  remainingMs: number;
}

const STORAGE_KEY = "solcity.buffs.v1";
/** How often an expiry is swept, which is also how often the HUD can redraw. */
const SWEEP_MS = 250;

/** Buff id -> the epoch ms it runs out. Expired entries are dropped. */
const expiries = new Map<BuffId, number>();
const listeners = new Set<() => void>();
let sweep: number | null = null;
let loaded = false;

function isBuffId(id: string): id is BuffId {
  return id in BUFFS;
}

function load(): void {
  if (loaded) return;
  loaded = true;
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw) as Record<string, unknown>;
    for (const [id, until] of Object.entries(stored)) {
      if (isBuffId(id) && typeof until === "number") expiries.set(id, until);
    }
  } catch {
    // Unreadable or blocked storage reads as "no buffs", which is the safe
    // default: the worst case is a player losing time they already drank.
  }
  prune();
}

function save(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(expiries)));
  } catch {
    // Private mode. The buff still runs for the rest of this session.
  }
}

/** Drops anything that has run out. Returns true if something went. */
function prune(): boolean {
  const now = Date.now();
  let dropped = false;
  for (const [id, until] of expiries) {
    if (until <= now) { expiries.delete(id); dropped = true; }
  }
  if (dropped) save();
  return dropped;
}

function emit(): void {
  for (const fn of listeners) fn();
}

function startSweep(): void {
  if (sweep !== null || typeof window === "undefined") return;
  sweep = window.setInterval(() => {
    if (prune()) emit();
    if (expiries.size === 0 && sweep !== null) {
      window.clearInterval(sweep);
      sweep = null;
    }
  }, SWEEP_MS);
}

/**
 * Starts the buff, or restarts it if it was already running. Drinking a second
 * coffee resets the three minutes rather than stacking to six.
 */
export function grantBuff(id: BuffId): void {
  load();
  expiries.set(id, Date.now() + BUFFS[id].durationMs);
  save();
  emit();
  startSweep();
}

export function isBuffActive(id: BuffId): boolean {
  load();
  return (expiries.get(id) ?? 0) > Date.now();
}

export function buffRemainingMs(id: BuffId): number {
  load();
  return Math.max(0, (expiries.get(id) ?? 0) - Date.now());
}

export function activeBuffs(): ActiveBuff[] {
  load();
  const now = Date.now();
  const out: ActiveBuff[] = [];
  for (const [id, until] of expiries) {
    if (until > now) out.push({ def: BUFFS[id], remainingMs: until - now });
  }
  return out;
}

/**
 * What to multiply the player's walking speed by right now. Called every
 * frame, so it stays a map walk over at most a handful of entries.
 */
export function speedMultiplier(): number {
  load();
  const now = Date.now();
  let multiplier = 1;
  for (const [id, until] of expiries) {
    if (until > now) multiplier *= BUFFS[id].speedMultiplier;
  }
  return multiplier;
}

/** Fires when a buff starts, restarts or runs out. Returns the unsubscribe. */
export function onBuffsChanged(fn: () => void): () => void {
  load();
  listeners.add(fn);
  if (expiries.size > 0) startSweep();
  return () => { listeners.delete(fn); };
}

/**
 * "3m", "2m", then "60s", "59s" and down. The last minute counts in seconds,
 * because that is the minute the player starts watching it.
 */
export function formatBuffTime(remainingMs: number): string {
  if (remainingMs > 60_000) return `${Math.ceil(remainingMs / 60_000)}m`;
  return `${Math.max(0, Math.ceil(remainingMs / 1000))}s`;
}
