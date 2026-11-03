import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import {
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { SOL_CITY_PROGRAM_ID, DELEGATION_PROGRAM_ID, derivePlayerPDA, deriveHuntPDA } from "./program";
import { ixDiscriminator, MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID } from "./instructions";

/**
 * The presence boards (program: PresenceBoard): one small account per rollup
 * listing who is in the city right now, so a client reads three boards
 * instead of every PlayerState that was ever delegated.
 *
 * Layout, FIXED, read by offset (the program pins it with a test):
 *   0   8 bytes  discriminator
 *   8   32       validator the board is for
 *   40  240 x 40 slots: 32 wallet, then i64 `seen` (unix seconds)
 * A wallet of all zeros is an empty slot. A slot older than PRESENCE_TTL_SECS
 * is someone who left without saying so (a closed tab).
 */
export const PRESENCE_SEED = "presence";
export const PRESENCE_SLOTS = 240;
export const PRESENCE_TTL_SECS = 120;
const HEADER = 8 + 32;
const SLOT = 40;
export const PRESENCE_BOARD_LEN = HEADER + PRESENCE_SLOTS * SLOT;

const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const DEFAULT = new PublicKey(new Uint8Array(32)).toBase58();

export function derivePresenceBoardPDA(validator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PRESENCE_SEED), validator.toBuffer()], SOL_CITY_PROGRAM_ID,
  )[0];
}

/** The wallets a board says are here, as of chain second `nowSecs`. */
export function decodePresenceBoard(data: Uint8Array, nowSecs: number): string[] {
  if (data.length < PRESENCE_BOARD_LEN) return [];
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const out: string[] = [];
  for (let i = 0; i < PRESENCE_SLOTS; i++) {
    const at = HEADER + i * SLOT;
    const seen = Number(buf.readBigInt64LE(at + 32));
    if (nowSecs - seen > PRESENCE_TTL_SECS) continue;
    const wallet = new PublicKey(buf.subarray(at, at + 32)).toBase58();
    if (wallet !== DEFAULT) out.push(wallet);
  }
  return out;
}

const DISC = {
  mark: ixDiscriminator("mark_present_session"),
  init: ixDiscriminator("init_presence_board"),
  delegate: ixDiscriminator("delegate_presence_board"),
  undelegate: ixDiscriminator("undelegate_presence_board"),
  undelegateHunt: ixDiscriminator("undelegate_hunt"),
  closePlayer: ixDiscriminator("close_player"),
};

/** Present (true) or gone (false) on `validator`'s board. Session-signed, on that rollup. */
export function buildMarkPresentSessionIx(
  wallet: PublicKey, sessionKey: PublicKey, validator: PublicKey, present: boolean,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: SOL_CITY_PROGRAM_ID,
    keys: [
      { pubkey: derivePresenceBoardPDA(validator), isSigner: false, isWritable: true },
      { pubkey: derivePlayerPDA(wallet)[0],        isSigner: false, isWritable: false },
      { pubkey: sessionKey,                        isSigner: true,  isWritable: false },
    ],
    data: Buffer.concat([DISC.mark, validator.toBuffer(), Buffer.from([present ? 1 : 0])]),
  });
}

function programData(): PublicKey {
  return PublicKey.findProgramAddressSync([SOL_CITY_PROGRAM_ID.toBuffer()], LOADER)[0];
}

/** Base layer, upgrade authority only (scripts/presence-setup.ts). */
export function buildInitPresenceBoardIx(payer: PublicKey, validator: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: SOL_CITY_PROGRAM_ID,
    keys: [
      { pubkey: derivePresenceBoardPDA(validator), isSigner: false, isWritable: true },
      { pubkey: payer,                             isSigner: true,  isWritable: true },
      { pubkey: SOL_CITY_PROGRAM_ID,               isSigner: false, isWritable: false },
      { pubkey: programData(),                     isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,           isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([DISC.init, validator.toBuffer()]),
  });
}

/** Base layer, upgrade authority only. The board goes to its own rollup only. */
export function buildDelegatePresenceBoardIx(payer: PublicKey, validator: PublicKey): TransactionInstruction {
  const board = derivePresenceBoardPDA(validator);
  return new TransactionInstruction({
    programId: SOL_CITY_PROGRAM_ID,
    keys: [
      { pubkey: payer,               isSigner: true,  isWritable: true  },
      { pubkey: SOL_CITY_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: programData(),       isSigner: false, isWritable: false },
      { pubkey: board,               isSigner: false, isWritable: true  },
      { pubkey: SOL_CITY_PROGRAM_ID, isSigner: false, isWritable: false }, // owner_program
      { pubkey: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(board, SOL_CITY_PROGRAM_ID), isSigner: false, isWritable: true },
      { pubkey: delegationRecordPdaFromDelegatedAccount(board),   isSigner: false, isWritable: true },
      { pubkey: delegationMetadataPdaFromDelegatedAccount(board), isSigner: false, isWritable: true },
      { pubkey: DELEGATION_PROGRAM_ID,   isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      // The one remaining account: the rollup, which must be the board's own.
      { pubkey: validator,               isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([DISC.delegate, validator.toBuffer()]),
  });
}

/** On the board's rollup. Any signer. */
export function buildUndelegatePresenceBoardIx(payer: PublicKey, validator: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: SOL_CITY_PROGRAM_ID,
    keys: [
      { pubkey: payer,                             isSigner: true,  isWritable: true },
      { pubkey: derivePresenceBoardPDA(validator), isSigner: false, isWritable: true },
      { pubkey: MAGIC_CONTEXT_ID,                  isSigner: false, isWritable: true },
      { pubkey: MAGIC_PROGRAM_ID,                  isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([DISC.undelegate, validator.toBuffer()]),
  });
}

/** On the hunt's rollup. Any signer: it only brings the hunt home. */
export function buildUndelegateHuntIx(payer: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: SOL_CITY_PROGRAM_ID,
    keys: [
      { pubkey: payer,              isSigner: true,  isWritable: true },
      { pubkey: deriveHuntPDA()[0], isSigner: false, isWritable: true },
      { pubkey: MAGIC_CONTEXT_ID,   isSigner: false, isWritable: true },
      { pubkey: MAGIC_PROGRAM_ID,   isSigner: false, isWritable: false },
    ],
    data: DISC.undelegateHunt,
  });
}

/** Base layer, wallet-signed, account not delegated: its rent goes back to the wallet. */
export function buildClosePlayerIx(wallet: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: SOL_CITY_PROGRAM_ID,
    keys: [
      { pubkey: derivePlayerPDA(wallet)[0], isSigner: false, isWritable: true },
      { pubkey: wallet,                     isSigner: true,  isWritable: true },
    ],
    data: DISC.closePlayer,
  });
}
