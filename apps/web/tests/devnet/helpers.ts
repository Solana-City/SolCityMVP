// Shared plumbing for the devnet simulation tests.
//
// These run against the bytecode that is actually deployed, not a local build,
// which is the whole point: they answer "does the program on chain reject what
// it should" rather than "does the source look like it would".
//
// Everything goes through `simulateTransaction` with `sigVerify: false`, so no
// key is needed, no SOL is spent and no account changes. The accounts named in
// an instruction still have to EXIST for the runtime to load them, which is why
// the fee payer below is a real funded devnet account rather than a fresh
// keypair: a random payer fails with AccountNotFound before the program runs.

import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";

export const RPC_URL = process.env.DEVNET_RPC ?? "https://api.devnet.solana.com";

export const SOL_CITY = new PublicKey("HPvDFVnruSXHwKKP44eUvRh8oYqBaHCeQbK1sKWT1aU2");
export const SOL_MECHS = new PublicKey("6sv4G2HuFdrcAFBRA2X4jTSRmZj2MJS5t66zRUqy5vxJ");
export const DELEGATION_PROGRAM = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

/**
 * The game wallet, used only as the fee payer and as a seed for PDA derivation.
 * Its public key is published in MAINNET_READINESS.md; nothing here needs or
 * holds its secret, because `sigVerify: false` skips signature checking.
 */
export const FEE_PAYER = new PublicKey("9592QS34mPUwqA7sPAkug1kcuFddjn59QPQMzzCgKhEp");

/** Anchor's instruction discriminator: the first 8 bytes of sha256("global:<name>"). */
export const discriminator = (name: string): Buffer =>
  createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);

export interface AnchorFailure {
  /** The account the constraint fired on, as Anchor names it in the log. */
  account: string | null;
  /** e.g. "ConstraintAddress". */
  code: string;
  /** e.g. 2012. */
  number: number;
}

export interface SimulationResult {
  /** Null when the instruction ran to completion. */
  err: unknown;
  logs: string[];
  /** Parsed from the logs when Anchor rejected an account, null otherwise. */
  anchor: AnchorFailure | null;
}

// Anchor logs a rejection in one of two shapes, and both have to parse:
//   AnchorError caused by account: owner_program. Error Code: ... (a constraint)
//   AnchorError occurred. Error Code: ...                         (no account)
//
// Indexed groups, not named ones: the tsconfig target predates ES2018, where
// named capture groups were added, and tsc rejects them outright.
// Groups: 1 = account (undefined on the "occurred" form), 2 = code, 3 = number.
const ANCHOR_LOG =
  /AnchorError (?:caused by account: ([a-z_0-9]+)|occurred)\. Error Code: (\w+)\. Error Number: (\d+)/;

let connection: Connection | null = null;
const conn = () => (connection ??= new Connection(RPC_URL, "confirmed"));

/**
 * Runs one instruction through the cluster without signing or sending it.
 *
 * `replaceRecentBlockhash` lets the validator supply the blockhash, so a slow
 * test run cannot fail on an expired one.
 */
export async function simulate(
  instruction: TransactionInstruction,
  payer: PublicKey = FEE_PAYER,
): Promise<SimulationResult> {
  const { blockhash } = await conn().getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [instruction],
  }).compileToV0Message();

  const { value } = await conn().simulateTransaction(new VersionedTransaction(message), {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });

  const logs = value.logs ?? [];
  let anchor: AnchorFailure | null = null;
  for (const line of logs) {
    const m = ANCHOR_LOG.exec(line);
    if (m) {
      anchor = { account: m[1] ?? null, code: m[2], number: Number(m[3]) };
      break;
    }
  }
  return { err: value.err ?? null, logs, anchor };
}

/** The accounts `delegate_duelist` and `delegate_lobby` take, in program order. */
export function delegationKeys(opts: {
  payer: PublicKey;
  pda: PublicKey;
  ownerProgram: PublicKey;
  delegationProgram: PublicKey;
}) {
  const { payer, pda, ownerProgram, delegationProgram } = opts;
  const [buffer] = PublicKey.findProgramAddressSync(
    [Buffer.from("buffer"), pda.toBuffer()],
    SOL_MECHS,
  );
  const [record] = PublicKey.findProgramAddressSync(
    [Buffer.from("delegation"), pda.toBuffer()],
    DELEGATION_PROGRAM,
  );
  const [metadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("delegation-metadata"), pda.toBuffer()],
    DELEGATION_PROGRAM,
  );
  return [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: pda, isSigner: false, isWritable: true },
    { pubkey: ownerProgram, isSigner: false, isWritable: false },
    { pubkey: buffer, isSigner: false, isWritable: true },
    { pubkey: record, isSigner: false, isWritable: true },
    { pubkey: metadata, isSigner: false, isWritable: true },
    { pubkey: delegationProgram, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
}

export const duelistPda = (authority: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("mech_duelist"), authority.toBuffer()], SOL_MECHS)[0];

export const lobbyPda = () =>
  PublicKey.findProgramAddressSync([Buffer.from("mech_lobby")], SOL_MECHS)[0];

/** Anchor's own error numbers, for readable assertions. */
export const ANCHOR_ERROR = {
  InstructionFallbackNotFound: 101,
  ConstraintSeeds: 2006,
  ConstraintAddress: 2012,
  AccountNotSigner: 3010,
} as const;
