import { LayerCategory, LayerVariant, isFreeItem, getBoosterPool } from "./paperDoll";
import { progressionBus } from "@/game/progression/progressionBus";
import { profileManager } from "@/game/config/profileManager";
import { decodeUnlockState, BOOSTER_ONCHAIN } from "@/game/solana/program";
import { itemAtGlobalIndex, globalIndexOf, BOOSTER_BLOCK_START } from "@/game/config/catalogIndex";
import { clusterKey } from "./clusterStorage";

/**
 * Per-wallet unlock registry for paper-doll wardrobe items.
 *
 * A `LayerVariant` marked `locked` isn't equippable until its `category:id`
 * key is in the wallet's unlocked set. Sources that grant unlocks — quests,
 * NPC interactions, and (later) VRF boosters — all call `unlockItem`, so the
 * wardrobe gating is source-agnostic.
 *
 * Storage is localStorage keyed by wallet for now (mirrors QuestManager); the
 * `get*`/`isVariantUnlocked` readers are the seam to swap for an on-chain read
 * once unlocks live on the program.
 */

function storageKey(wallet: string): string {
  // Namespaced by cluster. Without this a devnet tester opening mainnet in the
  // same browser arrived wearing every outfit they had unlocked on devnet,
  // which the mainnet chain never granted them.
  return clusterKey(`solcity:unlocks:${wallet}`);
}

export function unlockKeyOf(category: LayerCategory, id: string): string {
  return `${category}:${id}`;
}

export function getUnlockedSet(wallet: string | null): Set<string> {
  if (!wallet || typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(storageKey(wallet));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/**
 * True if the variant is free (starter/identity — see `isFreeItem`) or the
 * wallet has already unlocked it. A guest (no wallet) can equip only free items.
 */
export function isVariantUnlocked(
  wallet: string | null,
  category: LayerCategory,
  variant: LayerVariant,
): boolean {
  if (isFreeItem(category, variant.id)) return true;
  if (!wallet) return false;
  const key = unlockKeyOf(category, variant.id);
  const chain = onchainUnlocks.get(wallet);

  // A PACK item that can be HELD: possession decides, and nothing else does.
  //
  // Once an item has been minted it is tradeable, and the seller must stop
  // being able to wear what they sold. Our own `owned` list cannot answer
  // that: a compressed NFT moves on Bubblegum and the program is never told,
  // so `owned` would still name the seller forever. Only the indexer knows
  // who holds it now.
  //
  // `held` is undefined, not empty, whenever we do not know: minting is not
  // live yet, or the indexer did not answer. That is the difference between
  // "they sold it" and "we cannot see", and it falls through to the chain
  // list below rather than stripping somebody's wardrobe over an RPC blip.
  const held = heldItems.get(wallet);
  if (BOOSTER_ONCHAIN && held && isBoosterItem(category, variant.id)) {
    return held.has(key);
  }

  // A PACK item: the chain decides, and localStorage does not get a vote.
  //
  // This mirrors the program exactly, which is the point. `update_look_session`
  // enforces only indices at or above the booster block and skips everything
  // below it, so the client has to draw the line in the same place. If it
  // drew it anywhere else, a player could put on something the program then
  // refuses, and the refusal takes down the WHOLE outfit write: they would
  // freeze in their last synced look for everyone else, with no clue why.
  //
  // `chain &&` so this only bites once the account has actually been read.
  // Before that we are not entitled to call anything locked, and saying so
  // would briefly strip a player of items they own while the RPC answers.
  if (BOOSTER_ONCHAIN && chain && isBoosterItem(category, variant.id)) {
    return chain.has(key);
  }

  // Everything else: quests, NPC gifts, event items. localStorage is the
  // record because nothing on chain grants these yet, and the program skips
  // their whole index block for the same reason.
  if (getUnlockedSet(wallet).has(key)) return true;
  if (BOOSTER_ONCHAIN && chain?.has(key)) return true;
  return false;
}

/** In the booster block of the catalog, which is the range the program checks. */
function isBoosterItem(category: LayerCategory, id: string): boolean {
  const index = globalIndexOf(category, id);
  return index >= BOOSTER_BLOCK_START;
}

// ── On-chain booster unlocks (read from the UnlockState PDA) ─────────────────
//
// The caller (which has the base RPC connection) fetches the UnlockState PDA and
// feeds its raw data here; we decode the bitset → keys once so isVariantUnlocked
// stays synchronous. RPC-free by design. Populated only when BOOSTER_ONCHAIN.
const onchainUnlocks = new Map<string, Set<string>>();

/** Decode + cache a wallet's on-chain unlock bitset. Pass the UnlockState
 *  account data, or null if the account doesn't exist yet. */
export function setOnChainUnlocks(wallet: string, data: Uint8Array | null): void {
  if (!data) { onchainUnlocks.set(wallet, new Set()); return; }
  const st = decodeUnlockState(data);
  if (!st) return;
  const keys = new Set<string>();
  // The account now carries CATALOG indices, so this is a straight lookup.
  // It used to carry raw bit positions, which meant subtracting the reserved
  // quest block to get a pool index, and getting that subtraction wrong mapped
  // every pack item to the one sixteen places earlier in the wardrobe.
  for (const index of st.owned) {
    const entry = itemAtGlobalIndex(index);
    if (entry) keys.add(unlockKeyOf(entry.category, entry.variant.id));
  }
  onchainUnlocks.set(wallet, keys);
}

// ── What a wallet HOLDS right now, from the indexer ─────────────────────────
//
// Separate from `onchainUnlocks` because they answer different questions.
// That one is "was this ever granted to you", which survives a sale; this is
// "is it in your wallet today", which does not. For a tradeable item only the
// second one is the truth.

const heldItems = new Map<string, Set<string>>();

/**
 * Hands over the catalog indices a wallet holds an asset for.
 *
 * `null` means UNKNOWN and clears any previous answer, so the wardrobe falls
 * back to the grant list rather than hiding items. Never call it with an
 * empty array to mean "the lookup failed": empty means they hold nothing.
 */
export function setHeldItems(wallet: string, indices: number[] | null): void {
  if (!indices) { heldItems.delete(wallet); return; }
  const keys = new Set<string>();
  for (const index of indices) {
    const entry = itemAtGlobalIndex(index);
    if (entry) keys.add(unlockKeyOf(entry.category, entry.variant.id));
  }
  heldItems.set(wallet, keys);
}

export function getOnChainUnlocks(wallet: string | null): Set<string> {
  return (wallet ? onchainUnlocks.get(wallet) : undefined) ?? new Set();
}

/**
 * Grant a locked item to a wallet. Returns true if it was NEWLY unlocked (so
 * callers can reward once). Fires a `progressionBus` "outfit-unlocked" event —
 * the ToastStack shows "Outfit unlocked" and the WardrobePanel re-renders —
 * unless `silent` is set (the booster grants 5 at once and shows its own reveal,
 * then emits a single summary event).
 */
export function unlockItem(
  wallet: string | null,
  category: LayerCategory,
  id: string,
  name?: string,
  silent = false,
): boolean {
  if (!wallet) return false;
  const set = getUnlockedSet(wallet);
  const key = unlockKeyOf(category, id);
  if (set.has(key)) return false;
  set.add(key);
  try {
    localStorage.setItem(storageKey(wallet), JSON.stringify([...set]));
  } catch { /* ignore quota / private-mode */ }
  // The Wardrobe achievement track. Bumped here rather than off the bus event,
  // so the five a booster grants silently still count: the player owns them
  // either way, and the reveal is only about how they were told.
  profileManager.bump("wardrobe-items");
  if (!silent) {
    progressionBus.emit({ type: "outfit-unlocked", outfitId: key, outfitName: name ?? id });
  }
  return true;
}
