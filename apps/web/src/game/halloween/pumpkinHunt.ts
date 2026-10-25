/**
 * Jack O' Lantern's pumpkin hunt: the first half of the Halloween quest.
 *
 * Five pumpkins sit around the city. Walking into one picks it up, and every
 * pumpkin picked up buys one attempt at the carving (see minigames/
 * pumpkin-carving). A botched carve costs that pumpkin, so the hunt is what
 * makes the knife worth slowing down for.
 *
 * ── Where the pumpkins are ────────────────────────────────────────────────
 *
 * Five spots drawn from a fixed pool, picked by the WALLET AND THE DAY rather
 * than at random: the same player finds them in the same places all day and
 * across a reload, two players do not find them in the same places as each
 * other, and tomorrow everyone's five are somewhere else. Random per session
 * would move them under a player who went to fetch a friend, and one fixed
 * set per wallet would be posted somewhere within a day.
 *
 * Five a day, not five ever. A carve that slips costs a pumpkin, and running
 * out should mean coming back tomorrow, not missing the event. Unspent ones
 * carry over, because a pumpkin is a thing the player picked up and nothing
 * takes it back out of their hands overnight.
 *
 * Nothing about this is shared, which is deliberate. A pumpkin you take is not
 * taken from the person standing next to you: the hat is meant to be earnable
 * by everyone who hunts for it, not raced for.
 *
 * ── Where the state lives ─────────────────────────────────────────────────
 *
 * Two stores, one module, so they cannot drift:
 *   • WHICH spots are already picked up, in localStorage against the wallet
 *     and the day, the way the wardrobe keeps unlocks. Yesterday's key is
 *     simply never read again.
 *   • HOW MANY were found and spent, as profile counters, because that is
 *     what the quest registry and the achievements can read.
 *
 * A guest has nowhere to keep either, so the hunt does not run for them and
 * the carving stays free practice. See `attemptsLeft`.
 */
import { profileManager } from "@/game/config/profileManager";
import { todayKey } from "@/game/quests/QuestManager";
import { clusterKey } from "@/game/config/clusterStorage";

/** How many are out there at once, and so how many a day is worth. */
export const PUMPKINS_PER_HUNT = 5;

/**
 * The hiding places, as map tiles.
 *
 * Generated from city.json and then kept as data: every one is a walkable
 * tile whose eight neighbours are walkable too, so a pumpkin can always be
 * reached from any side and never lands inside a wall or under a building.
 * One per region of a 5x4 grid over the city, which is what spreads them
 * from the north plaza to the ST Brasil beach instead of clustering them
 * where the map happens to be most open.
 *
 * Append-only: `spotsFor` indexes into this, and reordering it would move
 * every player's pumpkins mid-day to somewhere they have already searched.
 */
export const SPAWN_POOL: readonly (readonly [number, number])[] = [
  [20, 14], [38, 14], [67, 14], [94, 14], [121, 14],
  [20, 42], [43, 41], [74, 42], [97, 42], [126, 40],
  [20, 71], [40, 67], [67, 71], [89, 71], [121, 60],
  [13, 92], [36, 92], [67, 100], [89, 100],
];

/** Found in total, ever. The quest reads this one. */
export const FOUND_COUNTER = "pumpkins-found";
/** Spent on a carve, ever. Attempts left is the difference. */
export const SPENT_COUNTER = "pumpkins-carved";

const takenKey = (wallet: string, day: string) =>
  clusterKey(`solcity:halloween:pumpkins:${day}:${wallet}`);

/** FNV-1a over the wallet: a stable number to seed the pick with. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32, same generator the crowd is built with. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * This wallet's five spots for a given day, as indices into SPAWN_POOL. A
 * partial Fisher-Yates over a copy of the pool's indices, so the five never
 * repeat within a day.
 */
export function spotsFor(wallet: string, day: string = todayKey()): number[] {
  const next = rng(hash(`${wallet}:${day}`));
  const idx = SPAWN_POOL.map((_, i) => i);
  for (let i = 0; i < PUMPKINS_PER_HUNT; i++) {
    const j = i + Math.floor(next() * (idx.length - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, PUMPKINS_PER_HUNT);
}

function takenSet(wallet: string, day: string): Set<number> {
  try {
    const raw = localStorage.getItem(takenKey(wallet, day));
    return new Set<number>(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

/** Today's spots this wallet has not picked up yet, with their tiles. */
export function remainingSpots(
  wallet: string,
  day: string = todayKey(),
): { spot: number; tileX: number; tileY: number }[] {
  const taken = takenSet(wallet, day);
  return spotsFor(wallet, day)
    .filter((spot) => !taken.has(spot))
    .map((spot) => ({ spot, tileX: SPAWN_POOL[spot][0], tileY: SPAWN_POOL[spot][1] }));
}

/**
 * Pick one up. Returns false when this spot was already taken, so a double
 * call (two frames of overlap, a reload mid-pickup) cannot pay twice.
 */
export function takeSpot(wallet: string, spot: number, day: string = todayKey()): boolean {
  const taken = takenSet(wallet, day);
  if (taken.has(spot)) return false;
  taken.add(spot);
  try {
    localStorage.setItem(takenKey(wallet, day), JSON.stringify([...taken]));
  } catch {
    // Storage blocked: the counter below still moves, so the carve is paid
    // for. Only which spot it came from is forgotten, and the pumpkin is
    // back on the next reload. Better than swallowing the pickup.
  }
  profileManager.bump(FOUND_COUNTER);
  return true;
}

/**
 * How many of today's five this wallet has picked up, which is what the city
 * and the carving show. The lifetime tally behind FOUND_COUNTER is what the
 * quest reads, and it would say 12/5 by the weekend.
 */
export function foundToday(): number {
  const wallet = profileManager.get().wallet;
  if (!wallet) return 0;
  return takenSet(wallet, todayKey()).size;
}

/**
 * Attempts the player has left, or null when the hunt does not apply and the
 * carving should run unlocked: a guest, who has no wallet to keep pumpkins
 * against and would otherwise be shut out of the game entirely.
 */
export function attemptsLeft(): number | null {
  if (!profileManager.get().wallet) return null;
  return Math.max(0, profileManager.counter(FOUND_COUNTER) - profileManager.counter(SPENT_COUNTER));
}

/**
 * Spend one, when a carve starts. A guest spends nothing: `attemptsLeft`
 * already said the hunt does not apply to them.
 */
export function spendAttempt(): void {
  if (!profileManager.get().wallet) return;
  profileManager.bump(SPENT_COUNTER);
}
