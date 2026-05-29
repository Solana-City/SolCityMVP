import { PublicKey } from "@solana/web3.js";

/**
 * Sol City on-chain program - TypeScript client interface.
 *
 * Matches the Anchor program in programs/sol-city/src/lib.rs.
 * The Rust program manages PlayerState PDAs that can be delegated
 * to MagicBlock Ephemeral Rollups for sub-50ms game state updates.
 *
 * Deploy flow:
 *   anchor build
 *   anchor deploy --provider.cluster devnet
 *   # Copy the program ID and replace SOL_CITY_PROGRAM_ID below
 */

// Replace after: anchor deploy
// The deploy script (scripts/deploy-devnet.sh) patches both the literal
// here AND the NEXT_PUBLIC_SOL_CITY_PROGRAM_ID env var. We honour the env
// var first so rebuilds after a deploy pick up the new ID without waiting
// for a code-level patch to propagate.
const ENV_PROGRAM_ID =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_SOL_CITY_PROGRAM_ID
    : undefined;

// Deployed program ID on devnet (from Anchor.toml [programs.devnet]).
// The env var overrides this at build time (e.g., for a different deploy).
const DEPLOYED_PROGRAM_ID = "HPvDFVnruSXHwKKP44eUvRh8oYqBaHCeQbK1sKWT1aU2";

export const SOL_CITY_PROGRAM_ID = new PublicKey(
  ENV_PROGRAM_ID && ENV_PROGRAM_ID.length >= 32
    ? ENV_PROGRAM_ID
    : DEPLOYED_PROGRAM_ID
);

// MagicBlock delegation program (devnet) — matches SDK v0.12 constant
export const DELEGATION_PROGRAM_ID = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
);

export const PLAYER_SEED = "player";

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
 * Matches PlayerState in programs/sol-city/src/lib.rs exactly.
 */
export interface OnChainPlayerState {
  authority: PublicKey;
  displayName: string;
  x: number;           // u32
  y: number;           // u32
  direction: number;   // u8: 0=down, 1=left, 2=right, 3=up
  outfitId: number;    // u8
  score: number;       // u32
  swapCount: number;   // u16
  transferCount: number; // u16
  bountyCount: number; // u16
  lastActive: number;  // i64 unix timestamp
  createdAt: number;   // i64 unix timestamp
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
