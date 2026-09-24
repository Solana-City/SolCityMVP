import { NPC_REGISTRY } from "@/game/config/npcRegistry";
import { profileManager } from "@/game/config/profileManager";
import { progressionBus } from "@/game/progression/progressionBus";
import { unlockItem } from "@/game/config/wardrobeUnlocks";

/**
 * Earned outfits: items a player unlocks by doing something, never by rolling
 * a booster.
 *
 * The Superteam Brasil set, all earned in the ST Brasil zone:
 *   cap            win a round of Kite Clash against Kite Pro
 *   shirt          talk to Kuka
 *   Brazil shirt   meet the whole ST Brasil crew: Kuka, Kite Pro, Caramel Dog
 *
 * And the Solana cap, for coming back 7 days in a row, plus the Trader
 * Shades for buying or selling a first stock at Stocklana.
 *
 * "Only one of each per wallet" needs no bookkeeping here: `unlockItem` returns
 * true only the first time a wallet is granted a key, and is a no-op after that.
 * A guest with no wallet simply can't earn them — the grants are keyed to the
 * wallet, so there is nowhere to put the reward until they connect.
 */

const REWARDS = {
  kiteClash: { category: "hat", id: "STB_cap", name: "Superteam Brasil Cap" },
  kuka:      { category: "tshirt", id: "STB_shirt", name: "Superteam Brasil Shirt" },
  stbrCrew:  { category: "tshirt", id: "Brazilian_shirt", name: "Brazil Shirt" },
  streak7:   { category: "hat", id: "Cap_Sol", name: "Cap Sol" },
  firstTrade: { category: "accessory", id: "Trader_shades", name: "Trader Shades" },
} as const;

/** Best check-in streak that earns the Solana cap. */
const STREAK_FOR_CAP = 7;

/** NPC whose first conversation grants the ST Brasil shirt. */
const KUKA_ID = "kuka";

/** Mini-game whose win grants the cap. */
const KITE_CLASH_ID = "kite-clash";

/**
 * The ST Brasil crew, met for the Brazil shirt. The dog only wanders about
 * seven tiles of the ST Brasil beach, so finding it is part of the fun rather
 * than a chase. Filtered against the registry so a disabled NPC can never make
 * the reward unreachable.
 */
// Planned: 8-10 builder NPCs in the ST Brasil area. The first three are in
// (pegana-raffx, solsentry-crash, dungeons-moles) but stay OUT of this list on
// purpose: the shirt only becomes "talk to every builder" once ALL of them are
// in the city, so nobody is sent hunting for stands that do not exist yet.
// When the last one lands: add every builder id here and update the
// Brazilian_shirt unlockHint in paperDoll.ts.
const STBR_CREW = ["kuka", "kite-pro", "caramel-dog"];

function requiredNpcIds(): string[] {
  const enabled = new Set(NPC_REGISTRY.filter((npc) => npc.enabled !== false).map((npc) => npc.id));
  return STBR_CREW.filter((id) => enabled.has(id));
}

function grant(reward: { category: string; id: string; name: string }): void {
  const wallet = profileManager.get().wallet;
  if (!wallet) return;
  unlockItem(wallet, reward.category as never, reward.id, reward.name);
}

/** True once the wallet has met the whole ST Brasil crew. */
export function hasMetStbrCrew(): boolean {
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
 * Grant the Stocklana reward. Called by CityScene when a trade lands, for a
 * buy or a sell, single stock or basket. Granting is idempotent, so a player
 * who traded before this reward existed earns it on their next trade.
 */
export function onStockTraded(): void {
  grant(REWARDS.firstTrade);
}

/**
 * Subscribe to NPC conversations. Safe to call more than once — a second call
 * replaces the first subscription rather than stacking a duplicate.
 */
let unsubscribe: (() => void) | null = null;

export function watchNpcConversations(): void {
  unsubscribe?.();
  const offVisits = progressionBus.on("npc-visited", (e) => {
    if (e.npcId === KUKA_ID) grant(REWARDS.kuka);
    // Checked on every visit, not just the last one: a wallet that had already
    // met the crew before this reward existed still earns the shirt on its next
    // conversation, instead of being locked out by having finished too early.
    if (hasMetStbrCrew()) grant(REWARDS.stbrCrew);
  });
  // The best streak arrives with each check-in (profile-updated); granting is
  // idempotent, so re-checking on every update is safe.
  const offProfile = progressionBus.on("profile-updated", (e) => {
    if ((e.profile.streakBest ?? 0) >= STREAK_FOR_CAP) grant(REWARDS.streak7);
  });
  unsubscribe = () => { offVisits(); offProfile(); };
}

export function stopWatchingNpcConversations(): void {
  unsubscribe?.();
  unsubscribe = null;
}
