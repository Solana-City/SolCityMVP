/**
 * The three things a player can do at the claim office, end to end.
 *
 * Every one of these sends a transaction to Solana MAINNET with the player's
 * real SOL, while the rest of the city runs on devnet. The wallet signs and we
 * send, the same split the game already uses, because the wallet's own
 * connection points at the city's cluster and not at this one.
 *
 * Nothing here decides amounts on the player's behalf and nothing retries on
 * its own: a failed deploy costs a fee, and a silent retry could stake twice.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  fetchBoard,
  fetchMiner,
  needsCheckpoint,
  type OreBoard,
  type OreMiner,
} from "./ore";
import {
  buildCheckpoint,
  buildClaimOre,
  buildClaimSol,
  buildDeploy,
} from "./oreInstructions";

const MAINNET_RPC = "https://api.mainnet-beta.solana.com";

let connection: Connection | null = null;
export function oreConnection(): Connection {
  connection ??= new Connection(MAINNET_RPC, "confirmed");
  return connection;
}

export type SignTransaction = (tx: Transaction) => Promise<Transaction>;

export interface ActionResult {
  signature?: string;
  /** One line a player can read, when it did not work. */
  error?: string;
}

/** A round is joinable only while it is actually running. */
export function roundIsOpen(board: OreBoard, slot: number): boolean {
  const start = Number(board.startSlot);
  const end = Number(board.endSlot);
  // end_slot is u64::MAX between rounds, when the next deploy would be the one
  // to start the round. The office does not do that: it needs entropy accounts
  // there is no reliable way to pick.
  if (!Number.isSafeInteger(end)) return false;
  return slot >= start && slot < end;
}

async function sendSigned(
  instructions: TransactionInstruction[],
  authority: PublicKey,
  signTransaction: SignTransaction,
): Promise<ActionResult> {
  try {
    const connection = oreConnection();
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: authority });
    tx.add(...instructions);

    const signed = await signTransaction(tx);
    const signature = await connection.sendRawTransaction(signed.serialize(), {
      // A deploy is only valid inside its round, so a preflight failure here is
      // worth hearing about rather than skipping past.
      skipPreflight: false,
      maxRetries: 2,
    });
    const confirmation = await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed",
    );
    if (confirmation.value.err) {
      return { signature, error: "The network rejected it. Nothing was staked." };
    }
    return { signature };
  } catch (err) {
    return { error: readable(err) };
  }
}

/** Turns a wallet or RPC error into one line a player can act on. */
function readable(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/User rejected|rejected the request|declined/i.test(message)) return "You cancelled it.";
  if (/insufficient|0x1\b/i.test(message)) return "Not enough SOL in the wallet for this.";
  if (/blockhash not found|block height exceeded/i.test(message)) {
    return "The round moved on before it landed. Try the next one.";
  }
  return "It did not go through. Nothing was staked.";
}

/**
 * Stake a claim on the current round.
 *
 * `lamportsPerSquare` is per square, which is how the program reads it, so the
 * wallet pays that times the number of squares. A round the miner left
 * unsettled is checkpointed in the same transaction, because the program
 * refuses to deploy until that is done.
 */
export async function stakeClaim(params: {
  authority: PublicKey;
  signTransaction: SignTransaction;
  lamportsPerSquare: bigint;
  squaresMask: number;
  board: OreBoard;
  miner: OreMiner | null;
}): Promise<ActionResult> {
  const { authority, signTransaction, lamportsPerSquare, squaresMask, board, miner } = params;
  if (squaresMask === 0) return { error: "Pick at least one square." };
  if (lamportsPerSquare <= BigInt(0)) return { error: "Set an amount first." };

  const instructions: TransactionInstruction[] = [];
  if (needsCheckpoint(miner, board)) {
    instructions.push(buildCheckpoint(authority, miner!.roundId));
  }
  instructions.push(buildDeploy(authority, lamportsPerSquare, squaresMask, board.roundId));
  return sendSigned(instructions, authority, signTransaction);
}

/** Settle a finished round on its own, without staking anything new. */
export async function settleRound(
  authority: PublicKey,
  signTransaction: SignTransaction,
  roundId: bigint,
): Promise<ActionResult> {
  return sendSigned([buildCheckpoint(authority, roundId)], authority, signTransaction);
}

export async function claimOre(
  authority: PublicKey,
  signTransaction: SignTransaction,
): Promise<ActionResult> {
  return sendSigned([buildClaimOre(authority)], authority, signTransaction);
}

export async function claimSol(
  authority: PublicKey,
  signTransaction: SignTransaction,
): Promise<ActionResult> {
  return sendSigned([buildClaimSol(authority)], authority, signTransaction);
}

/** Board and miner together, which is what every screen here needs. */
export async function readState(authority: PublicKey | null): Promise<{
  board: OreBoard | null;
  miner: OreMiner | null;
}> {
  const board = await fetchBoard();
  const miner = authority ? await fetchMiner(authority) : null;
  return { board, miner };
}
