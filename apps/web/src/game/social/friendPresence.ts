import { PublicKey } from "@solana/web3.js";
import type { OnChainMultiplayer } from "@/game/multiplayer/OnChainMultiplayer";
import { progressionBus } from "@/game/progression/progressionBus";
import { listFriends } from "./friends";

/**
 * Telling you when a friend walks into the city.
 *
 * This costs nothing to run, which is the only reason it is worth having: the
 * city is already being told about every citizen who arrives, so noticing that
 * one of them is a friend is a set lookup. No poll of its own, no server, no
 * key-value command.
 *
 * Announced once per wallet per session. A friend who steps out of range and
 * back, or whose account is re-read by the roster refresh, is the same arrival
 * as far as the player is concerned, and a toast each time would be worse than
 * no toast at all.
 */
export function startFriendPresence(
  network: OnChainMultiplayer,
  me: PublicKey,
): () => void {
  let friends = new Set<string>();
  const announced = new Set<string>();
  let stopped = false;

  // The list is read once. A friendship made during the session comes with its
  // own confirmation in the panel, so it does not need to be watched for here.
  listFriends(me)
    .then((list) => { if (!stopped) friends = new Set(list); })
    .catch(() => { /* no list, no toasts: nothing else breaks */ });

  network.onPlayerAdd((wallet, player) => {
    if (stopped) return;
    if (!friends.has(wallet) || announced.has(wallet)) return;
    announced.add(wallet);
    progressionBus.emit({
      type: "friend-online",
      wallet,
      name: player.displayName || `${wallet.slice(0, 4)}...${wallet.slice(-4)}`,
    });
  });

  return () => { stopped = true; };
}
