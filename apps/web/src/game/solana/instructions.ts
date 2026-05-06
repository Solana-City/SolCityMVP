/**
 * Sol City program — minimal instruction builders.
 *
 * We avoid pulling in `@coral-xyz/anchor` on the client because the full
 * framework adds ~300KB gzipped, and all we need is to serialize a handful
 * of well-defined instructions. Instead we:
 *
 *   1. Compute Anchor's 8-byte instruction discriminator inline. Anchor
 *      derives it as sha256(`global:<snake_case_name>`)[0..8].
 *   2. Hand-pack argument layouts matching the Rust #[derive(Accounts)] /
 *      fn signatures in programs/sol-city/src/lib.rs.
 *
 * If the program signature changes, update the discriminator name AND the
 * argument packing. Keep this file in lock-step with lib.rs.
 */

import {
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createDelegateInstruction,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { SOL_CITY_PROGRAM_ID, derivePlayerPDA } from "./program";
import { sha256 } from "@noble/hashes/sha256";

// ── Discriminator helper ────────────────────────────────────────────────

/**
 * Mirrors Anchor's `sighash("global", ix_name)`: the first 8 bytes of
 * sha256("global:<snake_case_name>"). Stable across Anchor versions.
 */
function ixDiscriminator(name: string): Buffer {
  const preimage = `global:${name}`;
  const digest = sha256(new TextEncoder().encode(preimage));
  return Buffer.from(digest.slice(0, 8));
}

// Cache. update_position_session is hot-path (10 Hz), pre-hash everything.
const DISC = {
  initializePlayer:      ixDiscriminator("initialize_player"),
  authorizeSession:      ixDiscriminator("authorize_session"),
  revokeSession:         ixDiscriminator("revoke_session"),
  updatePosition:        ixDiscriminator("update_position"),
  updatePositionSession: ixDiscriminator("update_position_session"),
  recordSwap:            ixDiscriminator("record_swap"),
  recordTransfer:        ixDiscriminator("record_transfer"),
  recordBounty:          ixDiscriminator("record_bounty"),
  changeOutfit:          ixDiscriminator("change_outfit"),
} as const;

// ── Argument packers ────────────────────────────────────────────────────

function packU32LE(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value >>> 0, 0);
  return buf;
}

function packU8(value: number): Buffer {
  return Buffer.from([value & 0xff]);
}

/**
 * Anchor's `String` type: 4-byte LE length prefix + UTF-8 bytes. The
 * on-chain struct enforces max_len = 20 via #[max_len(20)], so we cap here.
 */
function packString(value: string, maxLen = 20): Buffer {
  const truncated = value.slice(0, maxLen);
  const bytes = Buffer.from(truncated, "utf-8");
  const out = Buffer.alloc(4 + bytes.length);
  out.writeUInt32LE(bytes.length, 0);
  bytes.copy(out, 4);
  return out;
}

// ── Instruction builders ────────────────────────────────────────────────

/**
 * Builds the `initialize_player` instruction. Call once per wallet, on
 * first connect. Fails harmlessly on retry because the PDA is `init`.
 */
export function buildInitializePlayerIx(
  authority: PublicKey,
  displayName: string
): TransactionInstruction {
  const [playerPda] = derivePlayerPDA(authority);
  const data = Buffer.concat([DISC.initializePlayer, packString(displayName)]);

  return new TransactionInstruction({
    programId: SOL_CITY_PROGRAM_ID,
    keys: [
      { pubkey: playerPda, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Builds `authorize_session`. Called once per session — main wallet signs,
 * no further popups for position updates after this.
 *
 * Session key public key is packed as a raw 32-byte Pubkey (Anchor's
 * Borsh encoding for Pubkey is just the raw bytes, no length prefix).
 */
export function buildAuthorizeSessionIx(
  authority: PublicKey,
  sessionKey: PublicKey
): TransactionInstruction {
  const [playerPda] = derivePlayerPDA(authority);
  const data = Buffer.concat([DISC.authorizeSession, Buffer.from(sessionKey.toBytes())]);

  return new TransactionInstruction({
    programId: SOL_CITY_PROGRAM_ID,
    keys: [
      { pubkey: playerPda, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

/**
 * Builds `revoke_session`. Called on disconnect — main wallet signs once.
 */
export function buildRevokeSessionIx(authority: PublicKey): TransactionInstruction {
  const [playerPda] = derivePlayerPDA(authority);
  return new TransactionInstruction({
    programId: SOL_CITY_PROGRAM_ID,
    keys: [
      { pubkey: playerPda, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: DISC.revokeSession,
  });
}

/**
 * Builds `update_position` — main wallet signer (base layer fallback).
 * Used when the program is deployed but no session key is active.
 */
export function buildUpdatePositionIx(
  authority: PublicKey,
  x: number,
  y: number,
  direction: number
): TransactionInstruction {
  const [playerPda] = derivePlayerPDA(authority);
  const data = Buffer.concat([
    DISC.updatePosition,
    packU32LE(Math.max(0, Math.round(x))),
    packU32LE(Math.max(0, Math.round(y))),
    packU8(direction),
  ]);

  return new TransactionInstruction({
    programId: SOL_CITY_PROGRAM_ID,
    keys: [
      { pubkey: playerPda, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

/**
 * Builds `update_position_session` — session key signer (ephemeral rollup path).
 * Hot path: called up to 10 Hz. No wallet popup. The PDA is derived from
 * playerWallet (the main wallet), but the signer is the session key.
 *
 * Requires `authorize_session` to have been called first.
 */
export function buildUpdatePositionSessionIx(
  playerWallet: PublicKey,
  sessionKey: PublicKey,
  x: number,
  y: number,
  direction: number
): TransactionInstruction {
  const [playerPda] = derivePlayerPDA(playerWallet);
  const data = Buffer.concat([
    DISC.updatePositionSession,
    packU32LE(Math.max(0, Math.round(x))),
    packU32LE(Math.max(0, Math.round(y))),
    packU8(direction),
  ]);

  return new TransactionInstruction({
    programId: SOL_CITY_PROGRAM_ID,
    keys: [
      { pubkey: playerPda, isSigner: false, isWritable: true },
      { pubkey: sessionKey, isSigner: true, isWritable: false },
    ],
    data,
  });
}

export function buildRecordSwapIx(authority: PublicKey): TransactionInstruction {
  const [playerPda] = derivePlayerPDA(authority);
  return new TransactionInstruction({
    programId: SOL_CITY_PROGRAM_ID,
    keys: [
      { pubkey: playerPda, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: DISC.recordSwap,
  });
}

export function buildRecordTransferIx(authority: PublicKey): TransactionInstruction {
  const [playerPda] = derivePlayerPDA(authority);
  return new TransactionInstruction({
    programId: SOL_CITY_PROGRAM_ID,
    keys: [
      { pubkey: playerPda, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: DISC.recordTransfer,
  });
}

export function buildRecordBountyIx(authority: PublicKey): TransactionInstruction {
  const [playerPda] = derivePlayerPDA(authority);
  return new TransactionInstruction({
    programId: SOL_CITY_PROGRAM_ID,
    keys: [
      { pubkey: playerPda, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: DISC.recordBounty,
  });
}

export function buildChangeOutfitIx(
  authority: PublicKey,
  outfitId: number
): TransactionInstruction {
  const [playerPda] = derivePlayerPDA(authority);
  return new TransactionInstruction({
    programId: SOL_CITY_PROGRAM_ID,
    keys: [
      { pubkey: playerPda, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([DISC.changeOutfit, packU8(outfitId)]),
  });
}

/**
 * Builds the `delegate` instruction for our sol-city program.
 * Delegates the player PDA to MagicBlock Ephemeral Rollup via direct call to
 * the delegation program. After this call, position updates flow through the
 * Magic Router at sub-50ms with no gas.
 */
export function buildDelegateIx(authority: PublicKey): TransactionInstruction {
  const [playerPda] = derivePlayerPDA(authority);
  return createDelegateInstruction(
    {
      payer: authority,
      delegatedAccount: playerPda,
      ownerProgram: SOL_CITY_PROGRAM_ID,
    },
    { commitFrequencyMs: 3_000 },
  );
}

/**
 * Returns true iff the SOL_CITY_PROGRAM_ID has been replaced from its
 * placeholder. Used to gate real transactions — before deploy we run in
 * simulation mode so the game still works for local dev.
 */
export function isProgramDeployed(): boolean {
  return SOL_CITY_PROGRAM_ID.toBase58() !== "11111111111111111111111111111111";
}
