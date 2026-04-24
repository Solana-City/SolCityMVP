/**
 * progressionBus — central event dispatcher for player-progress signals.
 *
 * Every discrete player action (swap, transfer, bounty, NPC conversation,
 * score gain, achievement unlock, outfit unlock) emits through this bus.
 * Any UI surface — HUD, toast stack, achievement engine, profile panel —
 * subscribes to exactly the events it cares about.
 *
 * This decouples the action site (ActionPanel, NPCDialog) from the
 * feedback site (toast, HUD, achievement). Adding a new feedback widget
 * is a subscribe-only operation; it never touches the call site.
 */

import type { PlayerProfile } from "@/game/config/profileManager";

// ── Event catalog ──────────────────────────────────────────────────────

/**
 * Canonical events. Extend here when new actions need feedback surfaces.
 * The `type` tag discriminates the union so listeners get typed payloads.
 */
export type ProgressionEvent =
  | { type: "swap"; inputToken: string; outputToken: string; amount: string; scoreGained: number }
  | { type: "transfer"; recipient: string; amount: string; scoreGained: number }
  | { type: "bounty"; title?: string; scoreGained: number }
  | { type: "npc-visited"; npcId: string; npcName: string; firstTime: boolean }
  | { type: "score-gained"; amount: number; reason: string }
  | { type: "achievement-unlocked"; id: string; title: string; description: string; icon: string }
  | { type: "outfit-unlocked"; outfitId: string; outfitName: string }
  | { type: "profile-updated"; profile: PlayerProfile };

export type ProgressionEventType = ProgressionEvent["type"];

type Listener<T extends ProgressionEventType = ProgressionEventType> = (
  event: Extract<ProgressionEvent, { type: T }>
) => void;

class ProgressionBus {
  private listeners: Map<ProgressionEventType | "*", Set<Listener<any>>> = new Map();

  /**
   * Subscribe to a specific event type. Returns an unsubscribe function.
   * Use "*" to subscribe to every event (useful for logging/debugging).
   */
  on<T extends ProgressionEventType>(type: T, listener: Listener<T>): () => void;
  on(type: "*", listener: (event: ProgressionEvent) => void): () => void;
  on(type: ProgressionEventType | "*", listener: Listener<any>): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
    return () => {
      this.listeners.get(type)?.delete(listener);
    };
  }

  /**
   * Broadcast an event. All type-specific listeners fire, then the "*"
   * wildcard listeners. Errors in one listener do not cascade.
   */
  emit(event: ProgressionEvent): void {
    const typed = this.listeners.get(event.type);
    if (typed) {
      for (const l of typed) {
        try { l(event); } catch (err) { console.error("[progressionBus]", err); }
      }
    }
    const wildcard = this.listeners.get("*");
    if (wildcard) {
      for (const l of wildcard) {
        try { l(event); } catch (err) { console.error("[progressionBus]", err); }
      }
    }
  }
}

// One bus per client. Singleton.
export const progressionBus = new ProgressionBus();
