/**
 * Who is really in the city, as seen by everybody else.
 *
 * A player now stays delegated between visits (delegationBudget.ts), and a
 * tab left open keeps writing a heartbeat, so "has a fresh account on the
 * rollup" no longer means "is here". What does is ACTIVITY: their position,
 * facing, expression, chat or outfit changing. A heartbeat rewrites the same
 * position and changes none of those, so it keeps a player in the city without
 * making them look awake.
 *
 *   active  - something changed in the last AFK_AFTER_MS
 *   afk     - nothing for AFK_AFTER_MS: drawn faded, with a marker
 *   hidden  - nothing for HIDE_AFTER_MS: removed for everyone else
 *
 * A hidden player, or one who logged out (DIR_LEFT), goes DORMANT: their
 * account keeps turning up in every sweep, unchanged, and is ignored until it
 * does change. The first real move, chat, expression or outfit wakes them.
 *
 * Everything here is pure, so it can be tested without a scene or a chain.
 */

export const AFK_AFTER_MS = 3 * 60_000;
export const HIDE_AFTER_MS = 15 * 60_000;

/**
 * Set in the direction byte of the last write before an explicit logout, so
 * the city drops that player at once instead of waiting out the freshness
 * window. The top bit: the ones below it are facing, walking, and the buff
 * (OnChainMultiplayer's DIR_* constants), and the next free one is kept for
 * a third buff kind. The program stores the byte without reading it.
 */
export const DIR_LEFT = 0b1000_0000;

export type Presence = "active" | "afk" | "hidden";

export function presenceFor(idleMs: number): Presence {
  if (idleMs >= HIDE_AFTER_MS) return "hidden";
  if (idleMs >= AFK_AFTER_MS) return "afk";
  return "active";
}

/** The fields whose change counts as the player doing something. */
export interface Activity {
  x: number;
  y: number;
  /** Facing only. The buff bits are left out: a buff running out is not the
   *  player coming back. */
  facing: number;
  left: boolean;
  expressionAt: number;
  messageAt: number;
  loadout: string;
}

export function activityKey(a: Activity): string {
  return `${a.x},${a.y},${a.facing},${a.left ? 1 : 0},${a.expressionAt},${a.messageAt},${a.loadout}`;
}

interface Seen { key: string; activeAt: number; state: Presence }
interface Dormant { key: string; ts: number }

export class PresenceTracker {
  private seen = new Map<string, Seen>();
  private dormant = new Map<string, Dormant>();

  /**
   * A sighting of `wallet` whose account says `key`, last written at chain
   * second `ts`. Returns "ignore" while the player is dormant and nothing has
   * changed, so the caller does not put them back in the city.
   */
  sight(wallet: string, key: string, ts: number, now: number): "ignore" | "ok" {
    const d = this.dormant.get(wallet);
    if (d) {
      // Unchanged, or an older copy arriving late: still asleep.
      if (key === d.key || ts < d.ts) return "ignore";
      this.dormant.delete(wallet);
      this.seen.set(wallet, { key, activeAt: now, state: "active" });
      return "ok";
    }
    const s = this.seen.get(wallet);
    if (!s) {
      // First sight: there is no telling how long they have been idle, so
      // they count as active until proven otherwise.
      this.seen.set(wallet, { key, activeAt: now, state: "active" });
    } else if (s.key !== key) {
      s.key = key;
      s.activeAt = now;
    }
    return "ok";
  }

  /** Out of the city until their account changes: an explicit logout, or AFK for too long. */
  sleep(wallet: string, key?: string, ts = 0): void {
    const k = key ?? this.seen.get(wallet)?.key;
    if (k !== undefined) this.dormant.set(wallet, { key: k, ts });
    this.seen.delete(wallet);
  }

  /** Whether this player is out of the city until their account changes. */
  isDormant(wallet: string): boolean {
    return this.dormant.has(wallet);
  }

  /** Each player whose presence changed since the last tick, with the new one. */
  tick(now: number): { wallet: string; state: Presence }[] {
    const out: { wallet: string; state: Presence }[] = [];
    for (const [wallet, s] of this.seen) {
      const state = presenceFor(now - s.activeAt);
      if (state !== s.state) {
        s.state = state;
        out.push({ wallet, state });
      }
    }
    return out;
  }

  /** The player left for another reason (stale, pruned). Dormancy is kept. */
  forget(wallet: string): void {
    this.seen.delete(wallet);
  }

  /** Our own reconnect: the city is rebuilt, but who is asleep stays known. */
  clearSeen(): void {
    this.seen.clear();
  }
}
