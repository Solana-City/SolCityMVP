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

// Bumped to "player_v3" alongside the program's PLAYER_SEED when the
// PlayerState layout grew (loadout / expression / chat fields). Must match
// programs/sol-city/src/lib.rs.
export const PLAYER_SEED = "player_v3";
export const HUNT_SEED = "hunt_v2";
export const UNLOCKS_SEED = "unlocks";

/** Seed of the one PackConfig account: what the city sells, and on what terms. */
export const PACK_CONFIG_SEED = "pack_config";

/** Seed of a season's drop table: ["season_drops", season as u16 LE]. */
export const SEASON_DROPS_SEED = "season_drops";

/**
 * Devnet USDC. The mint prices are denominated in lives on the config account,
 * not here; this is the one the client funds a test wallet with and the one
 * `init_pack_config` is called with on devnet.
 */
export const USDC_MINT_DEVNET = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

/** Rarities, matching RARITY_ORDER: common, uncommon, rare, legendary. */
export const RARITY_COUNT = 4;

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

/** MagicBlock's ephemeral VRF program, matching VRF_PROGRAM_ID in the Rust. */
export const VRF_PROGRAM_ID = new PublicKey(
  "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
);

/**
 * This program's VRF identity PDA, seeds ["identity"], which signs the
 * randomness request. The program derives the same one in OpenBooster.
 */
export function deriveVrfIdentityPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("identity")],
    SOL_CITY_PROGRAM_ID,
  );
}

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

/** How long one citizen is the target. Mirrors CITIZEN_DURATION_SECS. */
export const CITIZEN_DURATION_SECS = 300;

/**
 * On-chain HuntState — matches the account in programs/sol-city/src/lib.rs.
 * Layout after the 8-byte discriminator:
 *   anchor_round: u32 (4) | anchor_at: i64 (8) | winner: Pubkey (32)
 *
 * It stores an ANCHOR, not a counter. The round being hunted is derived from
 * the clock by the program and by every client with the same arithmetic, so an
 * unfound citizen rotates on time with no transaction at all. The old shape
 * needed a crank, and froze whenever nobody was there to sign one.
 *
 * `round` and `deadline` below are therefore DERIVED, not stored. That is why
 * decoding takes a clock.
 */
export interface HuntState {
  /** The round being hunted at the moment it was decoded. */
  round: number;
  /** Session key that claimed `anchorRound - 1`. See the note on `winner`. */
  winner: PublicKey;
  /** When the current citizen rotates if nobody finds it. Unix seconds. */
  deadline: number;
  /** The stored anchor, for anything that needs to reason about it. */
  anchorRound: number;
  anchorAt: number;
}

/**
 * Decodes the hunt, resolved against `now`.
 *
 * `now` is unix SECONDS on the CHAIN's clock, not the device's. Every client
 * has to land on the same citizen, and a device an hour fast would otherwise
 * hunt a different one and have its claim rejected. Callers inside the city
 * pass `Date.now() - clockSkewMs`; the default is the device clock, which is
 * right only for a device that agrees with the chain.
 */
export function decodeHuntState(
  data: Uint8Array,
  now: number = Math.floor(Date.now() / 1000),
): HuntState | null {
  if (data.length < 8 + 4 + 8 + 32) return null;
  const buf = Buffer.from(data);
  let o = 8; // skip discriminator
  const anchorRound = buf.readUInt32LE(o); o += 4;
  const anchorAt = Number(buf.readBigInt64LE(o)); o += 8;
  const winner = new PublicKey(buf.subarray(o, o + 32)); o += 32;

  // Floored at zero, exactly as the program does it: a clock that steps
  // backwards leaves the hunt where it is rather than winding it back to a
  // citizen somebody has already been found at.
  const elapsed = Math.max(0, now - anchorAt);
  const passed = Math.floor(elapsed / CITIZEN_DURATION_SECS);
  return {
    round: anchorRound + passed,
    winner,
    deadline: anchorAt + (passed + 1) * CITIZEN_DURATION_SECS,
    anchorRound,
    anchorAt,
  };
}

/**
 * Per-wallet booster unlock store — seed ["unlocks", wallet].
 * Matches UnlockState in programs/sol-city/src/lib.rs.
 */
export function derivePackConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PACK_CONFIG_SEED)],
    SOL_CITY_PROGRAM_ID,
  );
}

/**
 * A season's drop table: which catalog indices it can drop, by rarity.
 *
 * One account per season because it has to stop changing when the season
 * opens: the VRF callback reads it after the money is taken, so a table that
 * could still be rewritten would resolve a pack against whatever the admin
 * last wrote. See SeasonDrops in the program.
 */
export function deriveSeasonDropsPDA(season: number): [PublicKey, number] {
  const seed = Buffer.alloc(2);
  seed.writeUInt16LE(season, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEASON_DROPS_SEED), seed],
    SOL_CITY_PROGRAM_ID,
  );
}

export function deriveUnlockPDA(
  wallet: PublicKey,
  programId: PublicKey = SOL_CITY_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(UNLOCKS_SEED), wallet.toBuffer()],
    programId
  );
}

/**
 * Reserved catalog indices for quest, NPC and event rewards: the block
 * [FREE_ITEM_COUNT, ENFORCED_FROM), which `update_look_session` never checks.
 *
 * Event items live here on purpose. A time-limited cosmetic whose real
 * authority is an NFT cannot be proven by a grant record, because the asset
 * may have moved twice since, so the chain stays out of it rather than
 * pretending otherwise. See TIMELIMITED_ITEM_CLAIM.md section 3, option 1.
 */
export const QUEST_FREE_SLOTS = 1024;

/**
 * How many owned indices the rollup snapshot on PlayerState carries, matching
 * PLAYER_UNLOCK_CAP in the program. Fixed, because that account is delegated
 * and a delegated account cannot be realloc'd.
 */
export const PLAYER_UNLOCK_CAP = 64;

export interface UnlockState {
  authority: PublicKey;
  /** Catalog indices this wallet may wear, sorted ascending. */
  owned: number[];
  /** Indices already turned into a tradable asset. Usually empty. */
  minted: number[];
  pending: boolean;      // a pack is awaiting its VRF callback
  /** The paid-for pack, frozen at payment. Meaningless unless `pending`. */
  draw: PendingDraw;
}

/**
 * What the program's VRF callback will resolve the pending pack with, copied
 * out of PackConfig when the pack was paid for.
 *
 * A snapshot rather than a pack id, on the program's side, because the
 * callback must not be able to fail: the money is gone by then. For the client
 * it means the reveal can show the odds the player actually bought, even if an
 * admin has since changed that pack.
 *
 * The index lists are NOT snapshotted, only the season that names them. They
 * live in a SeasonDrops account that stops being writable when its season
 * opens, so there is nothing to protect them from.
 */
export interface PendingDraw {
  packId: number;
  size: number;
  /** Basis points per rarity, in RARITY_ORDER. Adds up to 10000. */
  weights: number[];
  /** The season whose drop table resolves this pack. */
  season: number;
}

/**
 * Decodes an UnlockState account. Layout after the 8-byte discriminator:
 *   authority Pubkey(32) | owned Vec<u16> | minted Vec<u16> | pending bool(1)
 *   | draw PendingDraw(12)
 *
 * PendingDraw is packId u8 | size u8 | weights [u16;4] | season u16. A fixed
 * array carries no length prefix.
 *
 * A Vec is Anchor-serialised as a 4-byte little-endian length then the items,
 * so the account's size follows what the wallet owns rather than how big the
 * catalog grew. It used to be two fixed bitsets over the whole catalog.
 */
export const PENDING_DRAW_BYTES = 1 + 1 + RARITY_COUNT * 2 + 2;

export function decodeUnlockState(data: Uint8Array): UnlockState | null {
  if (data.length < 8 + 32 + 4 + 4 + 1 + PENDING_DRAW_BYTES) return null;
  const buf = Buffer.from(data);
  let o = 8;
  const authority = new PublicKey(buf.subarray(o, o + 32)); o += 32;

  const readVec = (): number[] | null => {
    if (o + 4 > buf.length) return null;
    const len = buf.readUInt32LE(o); o += 4;
    // A length that cannot fit means the account is not what we think it is,
    // which is worth reporting as null rather than reading past the end.
    if (len > 65_535 || o + len * 2 > buf.length) return null;
    const out: number[] = [];
    for (let i = 0; i < len; i++) { out.push(buf.readUInt16LE(o)); o += 2; }
    return out;
  };

  const owned = readVec();  if (!owned) return null;
  const minted = readVec(); if (!minted) return null;
  if (o + 1 + PENDING_DRAW_BYTES > buf.length) return null;
  const pending = buf.readUInt8(o) === 1; o += 1;

  const packId = buf.readUInt8(o); o += 1;
  const size = buf.readUInt8(o); o += 1;
  const weights: number[] = [];
  for (let i = 0; i < RARITY_COUNT; i++) { weights.push(buf.readUInt16LE(o)); o += 2; }
  const season = buf.readUInt16LE(o); o += 2;

  return {
    authority, owned, minted, pending,
    draw: { packId, size, weights, season },
  };
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
 * Base58 for an arbitrary byte array (no BigInt literals - ES2019 safe).
 *
 * Exists for getProgramAccounts memcmp filters, which take their comparand as
 * base58. The length matters: a filter compares exactly as many bytes as the
 * string decodes to, so an 8-byte discriminator must encode as 8 bytes. Padding
 * it out to 32 would silently widen the comparison to cover the field after it
 * and match nothing.
 */
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function toBase58(bytes: Buffer | Uint8Array): string {
  const input = Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

  // Leading zero bytes are carried as literal "1"s, so they are stripped
  // BEFORE the conversion and the digit array starts empty. Converting them
  // too would emit one spurious "1" for an all-zero input - [0x00] encoding as
  // "11" instead of "1", and the all-zero pubkey as 33 characters instead of
  // its 32. (That was the behaviour of the copy this replaces.)
  let leadingZeros = 0;
  while (leadingZeros < input.length && input[leadingZeros] === 0) leadingZeros++;

  const digits: number[] = [];
  for (const byte of input.slice(leadingZeros)) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] * 256;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  return "1".repeat(leadingZeros) + digits.reverse().map((d) => BASE58_ALPHABET[d]).join("");
}

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
