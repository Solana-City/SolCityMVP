import { PublicKey } from "@solana/web3.js";

/**
 * Sol City on-chain program configuration.
 *
 * The program manages player state accounts as PDAs.
 * These PDAs can be delegated to MagicBlock Ephemeral Rollups
 * for real-time position updates and game actions.
 *
 * Program lifecycle:
 *   1. Player connects wallet
 *   2. Initialize player PDA on Solana (once)
 *   3. Delegate PDA to ephemeral rollup (on session start)
 *   4. All game transactions route through Magic Router
 *   5. Undelegate PDA on session end (commits state to Solana)
 *
 * NOTE: The actual Anchor program is in a separate Rust crate.
 * This file defines the TypeScript interface for the client.
 * Until the program is deployed, the game runs in "hybrid mode"
 * where Colyseus handles multiplayer and on-chain state is optional.
 */

// Replace with your deployed program ID
export const SOL_CITY_PROGRAM_ID = new PublicKey(
  "11111111111111111111111111111111" // placeholder until program is deployed
);

// MagicBlock delegation program (devnet)
export const DELEGATION_PROGRAM_ID = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSS"
);

// PDA seeds
export const PLAYER_SEED = "player";
export const CITY_SEED = "city";

/**
 * Derives the player state PDA for a given wallet.
 */
export function derivePlayerPDA(
  wallet: PublicKey,
  programId: PublicKey = SOL_CITY_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PLAYER_SEED), wallet.toBuffer()],
    programId
  );
}

/**
 * On-chain player state structure.
 * This matches the Anchor account layout in the Rust program.
 */
export interface OnChainPlayerState {
  authority: PublicKey;
  x: number;
  y: number;
  direction: number; // 0=down, 1=left, 2=right, 3=up
  outfitId: string;
  score: number;
  swapCount: number;
  transferCount: number;
  bountyCount: number;
  lastActive: number; // unix timestamp
}

/**
 * Maps on-chain activity to outfit unlocks.
 * Used by the client to determine which outfits the player has earned.
 */
export function getUnlockedOutfits(state: OnChainPlayerState): string[] {
  const unlocked = ["default"];

  if (state.swapCount >= 10) unlocked.push("trader-cloak");
  if (state.bountyCount >= 3) unlocked.push("builder-jacket");
  // NFT-based unlocks are checked via Helius DAS API, not on-chain state

  return unlocked;
}

/**
 * Ephemeral rollup session configuration for Sol City.
 *
 * delegationDuration: 0 = no time limit (session ends on explicit undelegate)
 * commitFrequency: how often state is committed to base layer (ms)
 *   - 3000ms for player position (frequent enough for reconnect recovery)
 *   - Immediate commit for high-value actions (swaps, outfit mints)
 */
export const EPHEMERAL_CONFIG = {
  delegationDuration: 0,
  commitFrequencyMs: 3000,
  maxPlayersPerSession: 50,
} as const;
