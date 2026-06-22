import { Keypair } from "@solana/web3.js";
import { BOT_STORAGE_KEY } from "./config";

/**
 * The JoKenPo Master NPC's "hands" — a real local Solana keypair that plays
 * player 2 for solo matches, persisted across sessions exactly like
 * sessionKeys.ts persists the human player's session key. It's a genuine
 * second on-chain identity (not a special-cased solo code path): the player
 * funds it before a match and the program treats it as an ordinary player2.
 */
export function loadOrCreateBotKeypair(): Keypair {
  try {
    const stored = localStorage.getItem(BOT_STORAGE_KEY);
    if (stored) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(stored)));
  } catch {
    // fall through to generate a fresh one
  }
  const generated = Keypair.generate();
  try {
    localStorage.setItem(BOT_STORAGE_KEY, JSON.stringify(Array.from(generated.secretKey)));
  } catch {}
  return generated;
}
