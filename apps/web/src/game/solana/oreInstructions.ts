/**
 * The four ORE instructions the claim office needs, hand-rolled.
 *
 * There is no TypeScript SDK for ORE v3, so every byte here was checked against
 * the Rust at github.com/regolith-labs/ore AND against real mainnet
 * transactions before being written:
 *
 *   - The instruction discriminator is ONE byte, unlike the eight-byte account
 *     discriminators. A Deploy is 13 bytes: [6][amount u64][squares u32].
 *   - The account order and the writable flags below come from decoding live
 *     Deploy and Checkpoint transactions, not from reading the source alone.
 *
 * On the entropy accounts, which the Rust takes after the fixed ten: they are
 * required only when `board.end_slot == u64::MAX`, that is, when the round has
 * not started and this deploy would be the one to start it. The office only
 * ever joins a round that is already running, which the program's own timing
 * check demands anyway, so those accounts are never needed here. Deploying into
 * the gap between rounds is refused in the UI instead.
 *
 * Everything in this file targets Solana MAINNET and moves real SOL.
 */

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  ORE_BOARD,
  ORE_CONFIG,
  ORE_MINT,
  ORE_PROGRAM,
  ORE_TREASURY,
  SQUARE_COUNT,
  automationPda,
  minerPda,
  roundPda,
} from "./ore";

/** OreInstruction, from the Rust enum. */
const IX = { checkpoint: 2, claimSol: 3, claimOre: 4, deploy: 6 } as const;

/** Claim the whole reward: basis points out of 10,000. */
const ALL_BPS = 10_000;

function u64le(value: bigint | number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(value));
  return b;
}

/** Turns a list of square numbers (1 to 25) into the bitmask the program takes. */
export function squaresToMask(squares: number[]): number {
  let mask = 0;
  for (const s of squares) {
    if (s >= 1 && s <= SQUARE_COUNT) mask |= 1 << (s - 1);
  }
  return mask;
}

export function maskToSquares(mask: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < SQUARE_COUNT; i++) if (mask & (1 << i)) out.push(i + 1);
  return out;
}

/**
 * Stake a claim: `lamportsPerSquare` on each square in the mask, so the wallet
 * pays that amount multiplied by the number of squares.
 */
export function buildDeploy(
  authority: PublicKey,
  lamportsPerSquare: bigint,
  squaresMask: number,
  roundId: bigint,
): TransactionInstruction {
  const data = Buffer.alloc(13);
  data.writeUInt8(IX.deploy, 0);
  u64le(lamportsPerSquare).copy(data, 1);
  data.writeUInt32LE(squaresMask, 9);

  return new TransactionInstruction({
    programId: ORE_PROGRAM,
    data,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: automationPda(authority), isSigner: false, isWritable: true },
      { pubkey: ORE_BOARD, isSigner: false, isWritable: true },
      { pubkey: ORE_CONFIG, isSigner: false, isWritable: true },
      { pubkey: minerPda(authority), isSigner: false, isWritable: true },
      { pubkey: roundPda(roundId), isSigner: false, isWritable: true },
      { pubkey: ORE_TREASURY, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      // The program is passed as an account too. Unusual, and required.
      { pubkey: ORE_PROGRAM, isSigner: false, isWritable: false },
    ],
  });
}

/**
 * Settle a finished round, which the program demands before the same miner can
 * deploy again. `roundId` is the round the miner last deployed in, not the
 * current one.
 */
export function buildCheckpoint(authority: PublicKey, roundId: bigint): TransactionInstruction {
  return new TransactionInstruction({
    programId: ORE_PROGRAM,
    data: Buffer.from([IX.checkpoint]),
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: automationPda(authority), isSigner: false, isWritable: true },
      { pubkey: ORE_BOARD, isSigner: false, isWritable: true },
      { pubkey: minerPda(authority), isSigner: false, isWritable: true },
      { pubkey: roundPda(roundId), isSigner: false, isWritable: true },
      { pubkey: ORE_TREASURY, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

/** Take the SOL rewards sitting on the miner account. */
export function buildClaimSol(authority: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ORE_PROGRAM,
    data: Buffer.from([IX.claimSol]),
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: ORE_BOARD, isSigner: false, isWritable: false },
      { pubkey: minerPda(authority), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: ORE_PROGRAM, isSigner: false, isWritable: false },
    ],
  });
}

/**
 * Take the ORE rewards. The token account is created by the program if the
 * wallet does not have one yet, which is why the associated token program is in
 * the list.
 */
export function buildClaimOre(authority: PublicKey): TransactionInstruction {
  const data = Buffer.alloc(9);
  data.writeUInt8(IX.claimOre, 0);
  u64le(ALL_BPS).copy(data, 1);

  const recipient = getAssociatedTokenAddressSync(ORE_MINT, authority);
  // The treasury is a PDA, so its token account is off-curve.
  const treasuryTokens = getAssociatedTokenAddressSync(ORE_MINT, ORE_TREASURY, true);

  return new TransactionInstruction({
    programId: ORE_PROGRAM,
    data,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: ORE_BOARD, isSigner: false, isWritable: false },
      { pubkey: minerPda(authority), isSigner: false, isWritable: true },
      { pubkey: ORE_MINT, isSigner: false, isWritable: false },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: ORE_TREASURY, isSigner: false, isWritable: true },
      { pubkey: treasuryTokens, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ORE_PROGRAM, isSigner: false, isWritable: false },
    ],
  });
}
