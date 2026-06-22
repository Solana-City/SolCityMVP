import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

export const getSolBalance = async (connection: Connection, pubkey: PublicKey): Promise<number> =>
  (await connection.getBalance(pubkey)) / LAMPORTS_PER_SOL;

export const transferSolFromKeypair = async (
  connection: Connection,
  from: import("@solana/web3.js").Keypair,
  to: PublicKey,
  sol: number
): Promise<string> => {
  const { sendAndConfirmTransaction } = await import("@solana/web3.js");
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports: Math.round(sol * LAMPORTS_PER_SOL) })
  );
  tx.feePayer = from.publicKey;
  return sendAndConfirmTransaction(connection, tx, [from], { skipPreflight: true, commitment: "confirmed" });
};

/**
 * Tops up the player's session key from their CONNECTED wallet — the one
 * real wallet popup a staked JoKenPo match needs. Everything after this
 * (create/join/choose/reveal/claim) is signed by the already-funded session
 * key, same popup-free model `sessionKeys.ts` already uses for position sync.
 */
export async function topUpSessionKey(
  connection: Connection,
  walletPublicKey: PublicKey,
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>,
  sessionPublicKey: PublicKey,
  lamports: number
): Promise<string> {
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: walletPublicKey, toPubkey: sessionPublicKey, lamports })
  );
  const sig = await sendTransaction(tx, connection);
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}
