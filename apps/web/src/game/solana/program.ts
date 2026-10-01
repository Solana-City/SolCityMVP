import { PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";

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

// Bumped to "player_v2" alongside the program's PLAYER_SEED when the
// PlayerState layout grew (loadout / expression / chat fields). Must match
// programs/sol-city/src/lib.rs.
export const PLAYER_SEED = "player_v2";
export const HUNT_SEED = "hunt";
export const UNLOCKS_SEED = "unlocks";

/**
 * Master switch for the on-chain (VRF) booster. OFF until the program with
 * open_booster/UnlockState is deployed AND the client ix accounts are filled
 * from the new IDL. While false the booster runs the client-side preview
 * (Math.random + localStorage). Flip via NEXT_PUBLIC_BOOSTER_ONCHAIN=1.
 */
export const BOOSTER_ONCHAIN =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_BOOSTER_ONCHAIN === "1") || false;

/**
 * MagicBlock ephemeral-VRF oracle queue — base devnet (`DEFAULT_QUEUE`).
 * Matches ephemeral_vrf_sdk::consts::DEFAULT_QUEUE used in open_booster.
 */
export const VRF_QUEUE_DEVNET = new PublicKey(
  "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh"
);

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
 * Derives the single global "Find Someone" hunt PDA (seed = ["hunt"]).
 * Shared source of truth for the city-wide hide-and-seek.
 */
export function deriveHuntPDA(
  programId: PublicKey = SOL_CITY_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from(HUNT_SEED)], programId);
}

/**
 * On-chain HuntState — matches the account in programs/sol-city/src/lib.rs.
 * Layout after the 8-byte discriminator:
 *   round: u32 (4) | winner: Pubkey (32) | found_at: i64 (8) | deadline: i64 (8)
 */
export interface HuntState {
  round: number;
  winner: PublicKey;
  foundAt: number;   // unix seconds
  deadline: number;  // unix seconds
}

export function decodeHuntState(data: Uint8Array): HuntState | null {
  if (data.length < 8 + 4 + 32 + 8 + 8) return null;
  const buf = Buffer.from(data);
  let o = 8; // skip discriminator
  const round = buf.readUInt32LE(o); o += 4;
  const winner = new PublicKey(buf.subarray(o, o + 32)); o += 32;
  const foundAt = Number(buf.readBigInt64LE(o)); o += 8;
  const deadline = Number(buf.readBigInt64LE(o)); o += 8;
  return { round, winner, foundAt, deadline };
}

/**
 * Per-wallet booster unlock store — seed ["unlocks", wallet].
 * Matches UnlockState in programs/sol-city/src/lib.rs.
 */
export function deriveUnlockPDA(
  wallet: PublicKey,
  programId: PublicKey = SOL_CITY_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(UNLOCKS_SEED), wallet.toBuffer()],
    programId
  );
}

export const UNLOCK_BITS = 32; // bytes → 256 possible item indices

export interface UnlockState {
  authority: PublicKey;
  bits: Uint8Array;      // UNLOCK_BITS bytes
  pending: boolean;      // a pack is awaiting its VRF callback
  poolCount: number;     // u16 — index space of the pending draw
}

/**
 * Decodes an UnlockState account. Layout after the 8-byte discriminator:
 *   authority: Pubkey(32) | bits: [u8;32] | pending: bool(1) | poolCount: u16(2)
 */
export function decodeUnlockState(data: Uint8Array): UnlockState | null {
  const need = 8 + 32 + UNLOCK_BITS + 1 + 2;
  if (data.length < need) return null;
  const buf = Buffer.from(data);
  let o = 8;
  const authority = new PublicKey(buf.subarray(o, o + 32)); o += 32;
  const bits = new Uint8Array(buf.subarray(o, o + UNLOCK_BITS)); o += UNLOCK_BITS;
  const pending = buf.readUInt8(o) === 1; o += 1;
  const poolCount = buf.readUInt16LE(o); o += 2;
  return { authority, bits, pending, poolCount };
}

/** The set of unlocked booster-pool indices encoded in a bitset. */
export function unlockedIndices(bits: Uint8Array): Set<number> {
  const out = new Set<number>();
  for (let byte = 0; byte < bits.length; byte++) {
    for (let bit = 0; bit < 8; bit++) {
      if (bits[byte] & (1 << bit)) out.add(byte * 8 + bit);
    }
  }
  return out;
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

// -- Social: achievements + friends -----------------------------------------

/** Achievement bitset size, mirroring ACHIEVEMENT_BITS in the program. */
export const ACHIEVEMENT_BITS = 32; // bytes -> 256 achievements

/** One account per friendship; the seeds are the pair SORTED. */
export const FRIENDSHIP_SEED = "friendship";
/** One account per pending invite, from -> to. */
export const FRIEND_REQUEST_SEED = "friend_req";

/**
 * Anchor's account discriminator: sha256("account:<StructName>")[0..8].
 *
 * Needed because FriendRequest and Friendship are the same size, so a
 * getProgramAccounts dataSize filter alone returns both kinds mixed together.
 * Every friend query matches this at offset 0 as well.
 */
export function accountDiscriminator(name: string): Buffer {
  return Buffer.from(sha256(new TextEncoder().encode(`account:${name}`)).slice(0, 8));
}

/**
 * The pair in the order the program expects, which is the order Rust's `Ord`
 * on Pubkey gives: a plain lexicographic compare of the 32 raw bytes.
 *
 * NOT base58 order. The two disagree, so sorting by the string would derive a
 * PDA the program then rejects as unsorted.
 */
export function sortPair(x: PublicKey, y: PublicKey): [PublicKey, PublicKey] {
  return Buffer.compare(Buffer.from(x.toBytes()), Buffer.from(y.toBytes())) <= 0 ? [x, y] : [y, x];
}

/** The friendship PDA for two wallets, in either argument order. */
export function deriveFriendshipPDA(
  x: PublicKey,
  y: PublicKey,
  programId: PublicKey = SOL_CITY_PROGRAM_ID,
): [PublicKey, number] {
  const [a, b] = sortPair(x, y);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(FRIENDSHIP_SEED), a.toBuffer(), b.toBuffer()],
    programId,
  );
}

/** The invite PDA for a direction. Order matters here: from, then to. */
export function deriveFriendRequestPDA(
  from: PublicKey,
  to: PublicKey,
  programId: PublicKey = SOL_CITY_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(FRIEND_REQUEST_SEED), from.toBuffer(), to.toBuffer()],
    programId,
  );
}

export interface Friendship {
  a: PublicKey;
  b: PublicKey;
  since: number;
}

export interface FriendRequest {
  from: PublicKey;
  to: PublicKey;
  createdAt: number;
}

/** Field offsets, for both decoding and getProgramAccounts memcmp filters. */
export const FRIEND_OFFSET = {
  /** Friendship.a / FriendRequest.from */
  first: 8,
  /** Friendship.b / FriendRequest.to */
  second: 8 + 32,
} as const;

/** Both accounts are {Pubkey, Pubkey, i64}: 8 + 32 + 32 + 8. */
export const FRIEND_ACCOUNT_SIZE = 80;

function decodePair(data: Uint8Array): { a: PublicKey; b: PublicKey; ts: number } | null {
  if (data.length < FRIEND_ACCOUNT_SIZE) return null;
  const buf = Buffer.from(data);
  return {
    a: new PublicKey(buf.subarray(FRIEND_OFFSET.first, FRIEND_OFFSET.first + 32)),
    b: new PublicKey(buf.subarray(FRIEND_OFFSET.second, FRIEND_OFFSET.second + 32)),
    ts: Number(buf.readBigInt64LE(FRIEND_OFFSET.second + 32)),
  };
}

export function decodeFriendship(data: Uint8Array): Friendship | null {
  const p = decodePair(data);
  return p && { a: p.a, b: p.b, since: p.ts };
}

export function decodeFriendRequest(data: Uint8Array): FriendRequest | null {
  const p = decodePair(data);
  return p && { from: p.a, to: p.b, createdAt: p.ts };
}

/** The other half of a friendship, given one side. */
export function friendCounterpart(f: Friendship, me: PublicKey): PublicKey {
  return f.a.equals(me) ? f.b : f.a;
}

/** Achievement registry indices set in a published bitmask. */
export function achievementIndices(bits: Uint8Array): Set<number> {
  const out = new Set<number>();
  for (let byte = 0; byte < Math.min(bits.length, ACHIEVEMENT_BITS); byte++) {
    for (let bit = 0; bit < 8; bit++) {
      if ((bits[byte] & (1 << bit)) !== 0) out.add(byte * 8 + bit);
    }
  }
  return out;
}

/** Registry indices -> the 32-byte mask that publishes them. */
export function achievementMask(indices: Iterable<number>): Uint8Array {
  const bits = new Uint8Array(ACHIEVEMENT_BITS);
  for (const i of indices) {
    if (i < 0 || i >= ACHIEVEMENT_BITS * 8) continue;
    bits[Math.floor(i / 8)] |= 1 << (i % 8);
  }
  return bits;
}
