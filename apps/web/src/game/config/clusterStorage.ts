/**
 * Keeping one cluster's progress out of another's.
 *
 * Almost everything a player has done lives in localStorage: the score and
 * streak the Profile shows, every achievement counter, the quests, and - the
 * one that matters most - which outfits the wallet has unlocked. None of those
 * keys named a cluster, so a tester who played devnet and then opened mainnet
 * in the same browser with the same wallet would arrive carrying all of it.
 *
 * On chain that is impossible: a fresh program has no accounts and everyone
 * starts at zero. The browser was the hole. It would have shown a mainnet
 * player a wardrobe full of items the mainnet chain never granted, and the day
 * wardrobe enforcement turns on the game would take them back - which reads as
 * losing something you were told you owned.
 *
 * So progress keys carry the cluster. Mainnet starts empty, which is what it
 * is for.
 *
 * ── Devnet deliberately keeps the bare key ───────────────────────────────
 *
 * Suffixing every cluster would have been tidier and would have wiped every
 * devnet tester the moment it shipped, in the middle of a live Halloween
 * event: the hunt, the streak, the achievements, all of it. The goal is not
 * "reset devnet", it is "mainnet starts clean", so devnet is left exactly
 * where it is and anything else gets its own namespace.
 *
 * ── What is NOT namespaced, on purpose ───────────────────────────────────
 *
 * Device preferences: audio mute and volume, zoom, which how-to-play cards
 * have been seen, whether DMs are off. Those describe the person's machine,
 * not their progress, and making somebody re-mute the music because they
 * switched cluster is just rude.
 */

/**
 * Which chain this build talks to. Set `NEXT_PUBLIC_SOLANA_CLUSTER=mainnet`
 * in the deployment that points at mainnet.
 *
 * An env var rather than sniffing the RPC URL: the RPC is a failover list that
 * can be overridden per environment, so reading the cluster off whichever host
 * answered would make a player's save depend on which endpoint was up.
 */
export const SOLANA_CLUSTER: string =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_SOLANA_CLUSTER) || "devnet";

/**
 * Namespaces a progress key by cluster.
 *
 * Use it for anything a player EARNS. Leave device preferences alone.
 */
export function clusterKey(key: string): string {
  return SOLANA_CLUSTER === "devnet" ? key : `${key}@${SOLANA_CLUSTER}`;
}
