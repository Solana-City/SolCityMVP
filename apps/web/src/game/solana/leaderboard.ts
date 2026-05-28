/**
 * Persistent leaderboard — fetches all PlayerState PDAs from base devnet.
 *
 * Uses getProgramAccounts on the base Solana devnet connection to pull ALL
 * players who have ever connected (not just the ones currently online).
 * Results are cached for 5 minutes to avoid hammering the RPC.
 *
 * Binary layout decoded here matches OnChainMultiplayer.decodeAndUpdatePlayer
 * but also extracts score, swapCount, transferCount, bountyCount, lastActive.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import { SOL_CITY_PROGRAM_ID } from "./program";
import { isProgramDeployed } from "./instructions";

const BASE_RPC = "https://api.devnet.solana.com";

export interface LeaderboardEntry {
  wallet: string;
  displayName: string;
  score: number;
  swapCount: number;
  transferCount: number;
  bountyCount: number;
  /** Unix timestamp in milliseconds */
  lastActive: number;
}

// ── Anchor account discriminator ─────────────────────────────────────────────
// Anchor derives it as sha256("account:<AccountName>")[0..8]
function accountDiscriminator(name: string): Buffer {
  const digest = sha256(new TextEncoder().encode(`account:${name}`));
  return Buffer.from(digest.slice(0, 8));
}

const PLAYER_STATE_DISC = accountDiscriminator("PlayerState");

// ── Decoder ──────────────────────────────────────────────────────────────────
/**
 * Decodes a raw PlayerState account buffer.
 *
 * Layout (little-endian) after the 8-byte discriminator:
 *   [32]  authority         Pubkey
 *   [1+?] session_authority Option<Pubkey> (1 tag + 32 if Some)
 *   [4+n] display_name      String (4-byte len + n UTF-8 bytes, max 20)
 *   [4]   x                 u32
 *   [4]   y                 u32
 *   [1]   direction         u8
 *   [1]   outfit_id         u8
 *   [4]   score             u32
 *   [2]   swap_count        u16
 *   [2]   transfer_count    u16
 *   [2]   bounty_count      u16
 *   [8]   last_active       i64
 *   [8]   created_at        i64
 */
function decodePlayerState(raw: Buffer | Uint8Array): LeaderboardEntry | null {
  try {
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    if (buf.length < 83) return null;

    // Verify Anchor discriminator
    for (let i = 0; i < 8; i++) {
      if (buf[i] !== PLAYER_STATE_DISC[i]) return null;
    }

    let offset = 8;

    // authority (32 bytes)
    const wallet = new PublicKey(buf.slice(offset, offset + 32)).toBase58();
    offset += 32;

    // session_authority: Option<Pubkey>
    const hasSession = buf.readUInt8(offset) === 1;
    offset += 1 + (hasSession ? 32 : 0);

    // display_name: 4-byte length + UTF-8 string (max 20)
    const nameLen = Math.min(buf.readUInt32LE(offset), 20);
    offset += 4;
    const displayName = buf.slice(offset, offset + nameLen).toString("utf-8");
    offset += nameLen;

    // x, y — skip
    offset += 4 + 4;

    // direction — skip
    offset += 1;

    // outfit_id — skip
    offset += 1;

    // score (u32)
    const score = buf.readUInt32LE(offset);
    offset += 4;

    // swap_count (u16)
    const swapCount = buf.readUInt16LE(offset);
    offset += 2;

    // transfer_count (u16)
    const transferCount = buf.readUInt16LE(offset);
    offset += 2;

    // bounty_count (u16)
    const bountyCount = buf.readUInt16LE(offset);
    offset += 2;

    // last_active: i64 LE — seconds since epoch
    // Read as two u32 halves (lo + hi * 2^32) to avoid JS integer overflow
    const lo = buf.readUInt32LE(offset);
    const hi = buf.readUInt32LE(offset + 4);
    const lastActive = (lo + hi * 0x100000000) * 1000; // → ms

    return { wallet, displayName, score, swapCount, transferCount, bountyCount, lastActive };
  } catch {
    return null;
  }
}

// ── Cache ─────────────────────────────────────────────────────────────────────
let _cache: LeaderboardEntry[] | null = null;
let _cacheAt = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let _inflight: Promise<LeaderboardEntry[]> | null = null;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the full all-time leaderboard sorted by score (desc).
 *
 * Results are cached for 5 minutes. Pass forceRefresh=true to bust the cache.
 * If the program is not deployed, returns an empty array immediately.
 */
export async function fetchLeaderboard(forceRefresh = false): Promise<LeaderboardEntry[]> {
  if (!forceRefresh && _cache && Date.now() - _cacheAt < CACHE_TTL) {
    return _cache;
  }

  if (!isProgramDeployed()) return [];

  // Deduplicate concurrent callers
  if (_inflight) return _inflight;

  _inflight = _fetch().finally(() => { _inflight = null; });
  return _inflight;
}

async function _fetch(): Promise<LeaderboardEntry[]> {
  const connection = new Connection(BASE_RPC, "confirmed");

  // Filter: only accounts whose first 8 bytes match the PlayerState discriminator.
  // bs58-encode the discriminator bytes for the memcmp filter.
  const discBase58 = toBase58(PLAYER_STATE_DISC);

  const accounts = await connection.getProgramAccounts(SOL_CITY_PROGRAM_ID, {
    commitment: "confirmed",
    encoding: "base64",
    filters: [
      { memcmp: { offset: 0, bytes: discBase58 } },
    ],
  });

  const entries: LeaderboardEntry[] = [];

  for (const { account } of accounts) {
    // web3.js decodes base64 → Buffer internally; handle both Buffer and tuple
    const raw: Buffer =
      Buffer.isBuffer(account.data)
        ? account.data
        : Buffer.from(
            Array.isArray(account.data) ? account.data[0] : (account.data as string),
            "base64"
          );

    const entry = decodePlayerState(raw);
    if (entry) entries.push(entry);
  }

  entries.sort((a, b) => b.score - a.score);

  _cache = entries;
  _cacheAt = Date.now();

  return entries;
}

// ── Minimal base58 encoder (no BigInt literals — ES2019 safe) ────────────────
// Encodes an arbitrary byte array to a base58 string.
// Sufficient for encoding the 8-byte discriminator for RPC memcmp filters.
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function toBase58(bytes: Buffer | Uint8Array): string {
  const input = Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

  // Count leading zeros
  let leadingZeros = 0;
  for (const b of input) {
    if (b !== 0) break;
    leadingZeros++;
  }

  // Simple base-256 → base-58 conversion using a carry array
  const digits = [0];
  for (const byte of input) {
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

  const ones = "1".repeat(leadingZeros);
  return ones + digits.reverse().map((d) => BASE58_ALPHABET[d]).join("");
}
