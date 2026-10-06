import { NPC_REGISTRY } from "@/game/config/npcRegistry";
import { profileManager } from "@/game/config/profileManager";
import { progressionBus } from "@/game/progression/progressionBus";
import { unlockItem } from "@/game/config/wardrobeUnlocks";
import { getVariant } from "@/game/config/paperDoll";
import { holdsSkr } from "@/game/solana/seekerDetection";

/**
 * Earned outfits: items a player unlocks by doing something, never by rolling
 * a booster.
 *
 * The Superteam Brasil set, all earned in the ST Brasil zone:
 *   cap            win a round of Kite Clash against Kite Pro
 *   shirt          talk to Kuka
 *   Brazil shirt   meet the whole ST Brasil crew: Kuka, Kite Pro, the Caramel
 *                  Dog, and every builder standing at a stand
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
  // Seeker Lover's gift, for holding SKR. The art is not in yet: until the
  // variant exists in paperDoll.ts this grant is a no-op, so nothing can be
  // equipped that has no sprite. When the art lands, add the variant and this
  // starts working with no change here. If the spriter makes something other
  // than a cap, these two fields are the only edit.
  skrHolder: { category: "hat", id: "Seeker_cap", name: "Seeker Cap" },
  // Same arrangement as the Seeker gift: the art is not in yet, so grant()
  // skips this until the variant exists in paperDoll.ts. One line changes when
  // the spriter delivers, and if it turns out to be something other than a
  // helmet, these two fields are the whole edit.
  oreMiner: { category: "hat", id: "Miner_helmet", name: "Miner Helmet" },
} as const;

/** NPC who checks SKR and hands over the gift. */
const SEEKER_LOVER_ID = "seeker-lover";

/** Best check-in streak that earns the Solana cap. */
const STREAK_FOR_CAP = 7;

/** NPC whose first conversation grants the ST Brasil shirt. */
const KUKA_ID = "kuka";

/** Mini-game whose win grants the cap. */
const KITE_CLASH_ID = "kite-clash";

/**
 * The ST Brasil crew, met for the Brazil shirt: the three who were always on
 * the beach, plus every builder standing at a stand. The dog only wanders
 * about seven tiles of the ST Brasil beach, so finding it is part of the fun
 * rather than a chase. Filtered against the registry so a disabled NPC can
 * never make the reward unreachable.
 *
 * The builders used to stay out of this list until all 8-10 of them were in
 * the city, so nobody was sent hunting for stands that did not exist. Guarana
 * now stands in the middle of the boardwalk telling players the stands around
 * him pay a gift, so the four that ARE in have to count (2026-09-30). Add each
 * new builder here as it lands, and keep the Brazilian_shirt unlockHint in
 * paperDoll.ts saying the same thing this list does.
 */
const STBR_CREW = [
  "kuka", "kite-pro", "caramel-dog",
  "pegana-raffx", "solsentry-crash", "dungeons-moles", "cloak-vitin",
];

function requiredNpcIds(): string[] {
  const enabled = new Set(NPC_REGISTRY.filter((npc) => npc.enabled !== false).map((npc) => npc.id));
  return STBR_CREW.filter((id) => enabled.has(id));
}

function grant(reward: { category: string; id: string; name: string }): void {
  const wallet = profileManager.get().wallet;
  if (!wallet) return;
  // A reward whose art has not shipped yet is skipped rather than granted: an
  // unlock key for a variant that does not exist would show an empty slot in
  // the wardrobe.
  if (!getVariant(reward.category as never, reward.id)) return;
  unlockItem(wallet, reward.category as never, reward.id, reward.name);
}

/**
 * Seeker Lover's gift. Talking to him reads the wallet's SKR balance on
 * mainnet, and any amount earns the collectible. The phone itself is never
 * checked, which is the point: holding SKR is enough.
 *
 * Granting is idempotent, so re-checking on every conversation costs one RPC
 * read and nothing else.
 */
async function grantSkrGift(): Promise<void> {
  const wallet = profileManager.get().wallet;
  if (!wallet) return;
  if (await holdsSkr(wallet)) grant(REWARDS.skrHolder);
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
 * A claim staked on the ORE board. Called by the claim office once a deploy
 * confirms, so the counter behind the achievement track moves and the first
 * claim earns the miner's cosmetic.
 *
 * Deliberately counts claims rather than SOL: the track is about turning up,
 * not about how much a player put at risk on mainnet.
 */
export function onOreClaim(): void {
  profileManager.bump("ore-claims");
  grant(REWARDS.oreMiner);
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
    // Fire and forget: the dialog should never wait on a mainnet round trip.
    if (e.npcId === SEEKER_LOVER_ID) void grantSkrGift();
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
