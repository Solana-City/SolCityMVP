import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";

/**
 * Builds a native SOL transfer.
 *
 * The amount arrives already in lamports: the caller converts from what the
 * player typed, so a decimal string never becomes a float on the way here and
 * 0.1 is 100000000 lamports rather than whatever the nearest double rounds to.
 */
export async function buildSolTransfer(
  connection: Connection,
  from: PublicKey,
  to: PublicKey,
  lamports: bigint
): Promise<Transaction> {
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
 * Builds an SPL token transfer, creating the recipient's token account when
 * they do not have one yet (the sender pays that rent, as they must).
 *
 * `amount` is in the mint's smallest unit, for the same reason as above.
 */
export async function buildSplTransfer(
  connection: Connection,
  from: PublicKey,
  to: PublicKey,
  mint: PublicKey,
  amount: bigint
): Promise<Transaction> {
  const fromAta = await getAssociatedTokenAddress(mint, from);
  const toAta = await getAssociatedTokenAddress(mint, to);

  const tx = new Transaction();

  // No account for this mint means no balance either. Saying so here beats
  // letting the chain reject the transfer with an error nobody can read.
  try {
    await getAccount(connection, fromAta);
  } catch {
    throw new Error("You don't hold this token yet.");
  }

  // The recipient's account has to exist before anything can land in it.
  try {
    await getAccount(connection, toAta);
  } catch {
    tx.add(
      createAssociatedTokenAccountInstruction(from, toAta, to, mint)
    );
  }

  tx.add(
    createTransferInstruction(fromAta, toAta, from, amount)
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
