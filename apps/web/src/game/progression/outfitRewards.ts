import { NPC_REGISTRY } from "@/game/config/npcRegistry";
import { profileManager } from "@/game/config/profileManager";
import { progressionBus } from "@/game/progression/progressionBus";
import { unlockItem } from "@/game/config/wardrobeUnlocks";

/**
 * The Superteam Brasil outfit set — three items the player earns around the
 * ST Brasil zone rather than rolling from a booster.
 *
 *   cap            win a round of Kite Clash against Kite Pro
 *   shirt          talk to Kuka
 *   Brazil shirt   talk to every citizen in the city
 *
 * "Only one of each per wallet" needs no bookkeeping here: `unlockItem` returns
 * true only the first time a wallet is granted a key, and is a no-op after that.
 * A guest with no wallet simply can't earn them — the grants are keyed to the
 * wallet, so there is nowhere to put the reward until they connect.
 */

const REWARDS = {
  kiteClash: { category: "hat", id: "STB_cap", name: "Superteam Brasil Cap" },
  kuka:      { category: "tshirt", id: "STB_shirt", name: "Superteam Brasil Shirt" },
  allNpcs:   { category: "tshirt", id: "Brazilian_shirt", name: "Brazil Shirt" },
} as const;

/** NPC whose first conversation grants the ST Brasil shirt. */
const KUKA_ID = "kuka";

/** Mini-game whose win grants the cap. */
const KITE_CLASH_ID = "kite-clash";

/**
 * Citizens that must be met for the "talk to everyone" shirt.
 *
 * Derived from the registry rather than hard-coded so the requirement tracks
 * whatever is actually in the city — a disabled NPC can't be found and would
 * otherwise make the reward unreachable. Caramel Dog is deliberately excluded:
 * it wanders the beach and is a mascot, so gating a citywide reward behind
 * cornering a roaming dog would be unfair.
 */
const EXCLUDED_FROM_ROLL_CALL = new Set(["caramel-dog"]);

function requiredNpcIds(): string[] {
  return NPC_REGISTRY
    .filter((npc) => npc.enabled !== false && !EXCLUDED_FROM_ROLL_CALL.has(npc.id))
    .map((npc) => npc.id);
}

function grant(reward: { category: string; id: string; name: string }): void {
  const wallet = profileManager.get().wallet;
  if (!wallet) return;
  unlockItem(wallet, reward.category as never, reward.id, reward.name);
}

/** True once the wallet has met every citizen on the roll call. */
export function hasMetEveryone(): boolean {
  const visited = new Set(profileManager.get().visitedNPCs);
  return requiredNpcIds().every((id) => visited.has(id));
}

/**
 * Grant the mini-game reward. Called by CityScene when a run ends, since that
 * is where the result and the wallet both are.
 */
export function onMiniGameFinished(miniGameId: string, success: boolean): void {
  if (miniGameId !== KITE_CLASH_ID || !success) return;
  grant(REWARDS.kiteClash);
}

/**
 * Subscribe to NPC conversations. Safe to call more than once — a second call
 * replaces the first subscription rather than stacking a duplicate.
 */
let unsubscribe: (() => void) | null = null;

export function watchNpcConversations(): void {
  unsubscribe?.();
  unsubscribe = progressionBus.on("npc-visited", (e) => {
    if (e.npcId === KUKA_ID) grant(REWARDS.kuka);
    // Checked on every visit, not just the last one: a wallet that had already
    // met everyone before this reward existed still earns the shirt on its next
    // conversation, instead of being locked out by having finished too early.
    if (hasMetEveryone()) grant(REWARDS.allNpcs);
  });
}

export function stopWatchingNpcConversations(): void {
  unsubscribe?.();
  unsubscribe = null;
}
