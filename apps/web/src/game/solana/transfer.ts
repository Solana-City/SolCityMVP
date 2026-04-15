import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";

/**
 * Builds a SOL transfer transaction.
 * Returns a Transaction ready to be signed by the wallet adapter.
 */
export async function buildSolTransfer(
  connection: Connection,
  from: PublicKey,
  to: PublicKey,
  amountSol: number
): Promise<Transaction> {
  const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: to,
      lamports,
    })
  );

  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = from;

  return tx;
}

/**
 * Builds an SPL token transfer transaction.
 * Automatically creates the recipient's ATA if it doesn't exist.
 */
export async function buildSplTransfer(
  connection: Connection,
  from: PublicKey,
  to: PublicKey,
  mint: PublicKey,
  amount: number,
  decimals: number
): Promise<Transaction> {
  const fromAta = await getAssociatedTokenAddress(mint, from);
  const toAta = await getAssociatedTokenAddress(mint, to);

  const tx = new Transaction();

  // Check if recipient ATA exists, create if not
  try {
    await getAccount(connection, toAta);
  } catch {
    tx.add(
      createAssociatedTokenAccountInstruction(from, toAta, to, mint)
    );
  }

  const rawAmount = BigInt(Math.round(amount * 10 ** decimals));

  tx.add(
    createTransferInstruction(fromAta, toAta, from, rawAmount)
  );

  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = from;

  return tx;
}

/**
 * Validates a Solana address string.
 */
export function isValidAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return address.length >= 32 && address.length <= 44;
  } catch {
    return false;
  }
}
