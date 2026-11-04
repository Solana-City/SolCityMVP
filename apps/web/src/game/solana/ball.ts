import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import {
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { SOL_CITY_PROGRAM_ID, DELEGATION_PROGRAM_ID } from "./program";
import { ixDiscriminator, MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID } from "./instructions";

/**
 * The beach football as one account on one rollup (program: BallState).
 *
 * Layout, read by offset (the program pins it with a test):
 *   0  8   discriminator
 *   8  i32 x, 12 i32 y, 16 i32 vx, 20 i32 vy
 *   24 u32 seq (0 = never kicked)
 *   28 u64 kicked_slot
 *   36 32  kicker (the session key that kicked)
 */
export const BALL_SEED = "beach_ball";
export const BALL_LEN = 8 + 4 * 5 + 8 + 32;

export interface BallOnChain {
  x: number; y: number; vx: number; vy: number;
  seq: number; kickedSlot: number; kicker: string;
}

export function deriveBallPDA(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(BALL_SEED)], SOL_CITY_PROGRAM_ID)[0];
}

export function decodeBall(data: Uint8Array): BallOnChain | null {
  if (data.length < BALL_LEN) return null;
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return {
    x: b.readInt32LE(8), y: b.readInt32LE(12), vx: b.readInt32LE(16), vy: b.readInt32LE(20),
    seq: b.readUInt32LE(24),
    kickedSlot: Number(b.readBigUInt64LE(28)),
    kicker: new PublicKey(b.subarray(36, 68)).toBase58(),
  };
}

const DISC = {
  kick: ixDiscriminator("kick_ball_session"),
  init: ixDiscriminator("init_ball"),
  delegate: ixDiscriminator("delegate_ball"),
  undelegate: ixDiscriminator("undelegate_ball"),
};

const i32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32LE(Math.round(n)); return b; };

/** A kick, signed by the session key, sent to the ball's rollup. */
export function buildKickBallIx(
  sessionKey: PublicKey, kick: { x: number; y: number; vx: number; vy: number },
): TransactionInstruction {
  return new TransactionInstruction({
    programId: SOL_CITY_PROGRAM_ID,
    keys: [
      { pubkey: deriveBallPDA(), isSigner: false, isWritable: true },
      { pubkey: sessionKey,      isSigner: true,  isWritable: false },
    ],
    data: Buffer.concat([DISC.kick, i32(kick.x), i32(kick.y), i32(kick.vx), i32(kick.vy)]),
  });
}

const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const programData = () => PublicKey.findProgramAddressSync([SOL_CITY_PROGRAM_ID.toBuffer()], LOADER)[0];

/** Base layer, upgrade authority only (scripts/presence-setup.ts --ball). */
export function buildInitBallIx(payer: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: SOL_CITY_PROGRAM_ID,
    keys: [
      { pubkey: deriveBallPDA(),         isSigner: false, isWritable: true },
      { pubkey: payer,                   isSigner: true,  isWritable: true },
      { pubkey: SOL_CITY_PROGRAM_ID,     isSigner: false, isWritable: false },
      { pubkey: programData(),           isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: DISC.init,
  });
}

/** Base layer, upgrade authority only. */
export function buildDelegateBallIx(payer: PublicKey, validator: PublicKey): TransactionInstruction {
  const ball = deriveBallPDA();
  return new TransactionInstruction({
    programId: SOL_CITY_PROGRAM_ID,
    keys: [
      { pubkey: payer,               isSigner: true,  isWritable: true  },
      { pubkey: SOL_CITY_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: programData(),       isSigner: false, isWritable: false },
      { pubkey: ball,                isSigner: false, isWritable: true  },
      { pubkey: SOL_CITY_PROGRAM_ID, isSigner: false, isWritable: false }, // owner_program
      { pubkey: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(ball, SOL_CITY_PROGRAM_ID), isSigner: false, isWritable: true },
      { pubkey: delegationRecordPdaFromDelegatedAccount(ball),   isSigner: false, isWritable: true },
      { pubkey: delegationMetadataPdaFromDelegatedAccount(ball), isSigner: false, isWritable: true },
      { pubkey: DELEGATION_PROGRAM_ID,   isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: validator,               isSigner: false, isWritable: false },
    ],
    data: DISC.delegate,
  });
}

/** On the ball's rollup. Any signer: it only brings the ball home. */
export function buildUndelegateBallIx(payer: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: SOL_CITY_PROGRAM_ID,
    keys: [
      { pubkey: payer,            isSigner: true,  isWritable: true },
      { pubkey: deriveBallPDA(),  isSigner: false, isWritable: true },
      { pubkey: MAGIC_CONTEXT_ID, isSigner: false, isWritable: true },
      { pubkey: MAGIC_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: DISC.undelegate,
  });
}
