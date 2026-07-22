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
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { SOL_CITY_PROGRAM_ID, DELEGATION_PROGRAM_ID, derivePlayerPDA, deriveHuntPDA } from "./program";
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
  recordSwap:              ixDiscriminator("record_swap"),
  recordTransfer:          ixDiscriminator("record_transfer"),
  recordBounty:            ixDiscriminator("record_bounty"),
  recordMiniGameSession:   ixDiscriminator("record_mini_game_session"),
  changeOutfit:            ixDiscriminator("change_outfit"),
  delegate:                ixDiscriminator("delegate"),
  initializeHunt:          ixDiscriminator("initialize_hunt"),
  claimFind:               ixDiscriminator("claim_find"),
  expireRound:             ixDiscriminator("expire_round"),
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

/**
 * Builds `record_mini_game_session` — signed by session key, zero wallet popups.
 * Routes to the ephemeral rollup via Magic Router when the PDA is delegated.
 *
 * success=true  → score += scoreDelta, bounty_count += 1 (mini-game wins tracked here)
 * success=false → only last_active is updated
 */
export function buildRecordMiniGameSessionIx(
  playerWallet: PublicKey,
  sessionKey: PublicKey,
  success: boolean,
  scoreDelta: number,
): TransactionInstruction {
  const [playerPda] = derivePlayerPDA(playerWallet);
  const data = Buffer.concat([
    DISC.recordMiniGameSession,
    Buffer.from([success ? 1 : 0]),  // bool as u8
    packU32LE(Math.max(0, scoreDelta)),
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
 *
 * Calls OUR program's `delegate` instruction (not the delegation program
 * directly). Our program uses invoke_signed with the PDA seeds, so only the
 * wallet needs to sign as fee payer — the PDA signing happens inside the
 * program via CPI. This is the correct approach for PDAs that cannot sign
 * a browser wallet transaction directly.
 */
export function buildDelegateIx(authority: PublicKey): TransactionInstruction {
  const [playerPda] = derivePlayerPDA(authority);

  const delegateBuffer = delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
    playerPda, SOL_CITY_PROGRAM_ID
  );
  const delegationRecord   = delegationRecordPdaFromDelegatedAccount(playerPda);
  const delegationMetadata = delegationMetadataPdaFromDelegatedAccount(playerPda);

  return new TransactionInstruction({
    programId: SOL_CITY_PROGRAM_ID,
    keys: [
      { pubkey: authority,            isSigner: true,  isWritable: true  }, // authority (payer)
      { pubkey: playerPda,            isSigner: false, isWritable: true  }, // player PDA
      { pubkey: SOL_CITY_PROGRAM_ID,  isSigner: false, isWritable: false }, // owner_program
      { pubkey: delegateBuffer,       isSigner: false, isWritable: true  }, // delegate_buffer
      { pubkey: delegationRecord,     isSigner: false, isWritable: true  }, // delegation_record
      { pubkey: delegationMetadata,   isSigner: false, isWritable: true  }, // delegation_metadata
      { pubkey: DELEGATION_PROGRAM_ID, isSigner: false, isWritable: false }, // delegation_program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    ],
    data: DISC.delegate,
  });
}

// ── "Find Someone" global hunt ──────────────────────────────────────────

/**
 * Builds `initialize_hunt` — creates the single global HuntState account.
 * Call ONCE ever, after deploy (any funded signer as payer). `init` makes
 * a second call fail harmlessly.
 */
export function buildInitializeHuntIx(payer: PublicKey): TransactionInstruction {
  const [huntPda] = deriveHuntPDA();
  return new TransactionInstruction({
    programId: SOL_CITY_PROGRAM_ID,
    keys: [
      { pubkey: huntPda,                 isSigner: false, isWritable: true },
      { pubkey: payer,                   isSigner: true,  isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: DISC.initializeHunt,
  });
}

/**
 * Builds `claim_find(round)` — the finder (session key) claims the current
 * round and advances the hunt. Signed by the session key = seamless. Fails
 * on-chain if `round` is stale (someone else claimed first).
 */
export function buildClaimFindIx(finder: PublicKey, round: number): TransactionInstruction {
  const [huntPda] = deriveHuntPDA();
  return new TransactionInstruction({
    programId: SOL_CITY_PROGRAM_ID,
    keys: [
      { pubkey: huntPda, isSigner: false, isWritable: true },
      { pubkey: finder,  isSigner: true,  isWritable: false },
    ],
    data: Buffer.concat([DISC.claimFind, packU32LE(round)]),
  });
}

/**
 * Builds `expire_round(round)` — cranks a citizen nobody found forward once
 * its deadline has passed. Signed by any session key.
 */
export function buildExpireRoundIx(cranker: PublicKey, round: number): TransactionInstruction {
  const [huntPda] = deriveHuntPDA();
  return new TransactionInstruction({
    programId: SOL_CITY_PROGRAM_ID,
    keys: [
      { pubkey: huntPda,  isSigner: false, isWritable: true },
      { pubkey: cranker,  isSigner: true,  isWritable: false },
    ],
    data: Buffer.concat([DISC.expireRound, packU32LE(round)]),
  });
}

/**
 * Returns true iff the SOL_CITY_PROGRAM_ID has been replaced from its
 * placeholder. Used to gate real transactions — before deploy we run in
 * simulation mode so the game still works for local dev.
 */
export function isProgramDeployed(): boolean {
  return SOL_CITY_PROGRAM_ID.toBase58() !== "11111111111111111111111111111111";
}
