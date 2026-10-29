/**
 * Getting a transaction ready for the player's wallet, the way Phantom asks.
 *
 * Phantom simulates every transaction before showing it. One it cannot
 * simulate is shown with "This dApp could be malicious", and enough of those
 * put the whole domain on its blocklist, which is how solanacity.io ended up
 * with "Request blocked". Phantom's page on domain and transaction warnings
 * asks dApps to:
 *
 *   - set the compute unit limit and the loaded account data limit explicitly
 *   - simulate with sigVerify false BEFORE asking for a signature
 *   - sign with signTransaction and submit through their own RPC with
 *     preflight enabled
 *   - keep to one signer
 *
 * prepareWalletTx does the first two. sendWalletSigned does the third. Every
 * transaction we build for the wallet already has one signer.
 *
 * A side benefit: a transaction that would fail is now stopped here, with the
 * chain's reason, before the wallet opens. It used to open in red, get
 * approved anyway, and then fail.
 */
import {
  ComputeBudgetProgram,
  Connection,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";

const MAX_CU = 1_400_000;
const MAX_LOADED_BYTES = 64 * 1024 * 1024;

/** ComputeBudget instruction tags, the first byte of the data. */
const SET_CU_LIMIT = 2;
const SET_LOADED_DATA_LIMIT = 4;

/**
 * `SetLoadedAccountsDataSizeLimit`. web3.js 1.x has no builder for it, so it
 * is written by hand: the tag, then the byte limit as a little-endian u32.
 */
function setLoadedAccountsDataSizeLimit(bytes: number): TransactionInstruction {
  const data = Buffer.alloc(5);
  data.writeUInt8(SET_LOADED_DATA_LIMIT, 0);
  data.writeUInt32LE(bytes, 1);
  return new TransactionInstruction({ programId: ComputeBudgetProgram.programId, keys: [], data });
}

function hasBudget(tx: Transaction, tag: number): boolean {
  return tx.instructions.some(
    (ix) => ix.programId.equals(ComputeBudgetProgram.programId) && ix.data[0] === tag,
  );
}

/** A simulation failure in words a player can act on. */
export class WalletTxRejected extends Error {}

function describe(err: unknown, logs: string[] | null): string {
  const text = `${JSON.stringify(err)} ${(logs ?? []).join(" ")}`;
  if (/AccountNotFound|no record of a prior credit|insufficient (funds|lamports)/i.test(text)) {
    return "Your wallet needs more SOL for this. On devnet, get some at faucet.solana.com.";
  }
  const anchor = (logs ?? []).find((l) => l.includes("Error Message:"));
  if (anchor) return anchor.slice(anchor.indexOf("Error Message:") + 14).trim();
  return `This transaction would fail: ${JSON.stringify(err)}`;
}

/**
 * Simulates `tx` as it stands and returns it with explicit compute and loaded
 * data limits, measured from that simulation with a margin. Throws
 * WalletTxRejected when the simulation fails, so the wallet never opens on a
 * transaction that cannot land.
 *
 * Call it after the fee payer and blockhash are set and before anything signs:
 * adding instructions changes the message, which would void a signature made
 * earlier. A transaction that already carries a signature is only simulated.
 * Limits the caller set itself are kept.
 */
export async function prepareWalletTx(conn: Connection, tx: Transaction): Promise<Transaction> {
  if (!tx.feePayer || !tx.recentBlockhash) throw new Error("prepareWalletTx: fee payer and blockhash first");
  const signed = tx.signatures.some((s) => s.signature !== null);
  const needCu = !signed && !hasBudget(tx, SET_CU_LIMIT);
  const needLoaded = !signed && !hasBudget(tx, SET_LOADED_DATA_LIMIT);

  // Measured with the ceiling, so the simulation is not cut short by the
  // default per-instruction limit and under-reports.
  const probe = new Transaction({ feePayer: tx.feePayer, recentBlockhash: tx.recentBlockhash });
  if (needCu) probe.add(ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_CU }));
  probe.add(...tx.instructions);

  const { value } = await conn.simulateTransaction(new VersionedTransaction(probe.compileMessage()), {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
  });
  if (value.err) throw new WalletTxRejected(describe(value.err, value.logs));
  if (!needCu && !needLoaded) return tx;

  const out = new Transaction({ feePayer: tx.feePayer, recentBlockhash: tx.recentBlockhash });
  if (needCu && value.unitsConsumed) {
    out.add(ComputeBudgetProgram.setComputeUnitLimit({
      units: Math.min(MAX_CU, Math.ceil(value.unitsConsumed * 1.2) + 5_000),
    }));
  }
  // Not in web3.js's types, but every current RPC returns it. Without a
  // reading there is nothing to base a limit on, and a guessed one that is
  // too low fails the transaction outright, so it is left off.
  const loaded = Number((value as { loadedAccountsDataSize?: number }).loadedAccountsDataSize ?? 0);
  if (needLoaded && loaded > 0) {
    out.add(setLoadedAccountsDataSizeLimit(
      Math.min(MAX_LOADED_BYTES, Math.ceil(loaded * 1.2) + 16 * 1024),
    ));
  }
  out.add(...tx.instructions);
  return out;
}

/** Sends a wallet-signed transaction over our RPC, with preflight on. */
export function sendWalletSigned(
  conn: Connection, signed: Transaction | VersionedTransaction,
): Promise<string> {
  return conn.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
}
