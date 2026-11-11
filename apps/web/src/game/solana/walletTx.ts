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
  type AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  PACKET_DATA_SIZE,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
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

/**
 * prepareWalletTx for a v0 transaction compiled against lookup tables.
 *
 * Same contract: simulated before anything signs, refused in words when the
 * simulation fails, and handed back with compute and loaded-data limits
 * measured from that simulation. Used where a legacy transaction cannot hold
 * the accounts at all (opening a sealed pack, see lookupTable.ts).
 *
 * It also refuses a transaction that will not fit even so, with a sentence
 * instead of the RPC's "VersionedTransaction too large: 2100 bytes".
 */
export async function prepareWalletTxV0(conn: Connection, args: {
  payer: PublicKey;
  blockhash: string;
  instructions: TransactionInstruction[];
  lookupTables: AddressLookupTableAccount[];
}): Promise<VersionedTransaction> {
  const { payer, blockhash, instructions, lookupTables } = args;
  const compile = (ixs: TransactionInstruction[]) => new VersionedTransaction(
    new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs })
      .compileToV0Message(lookupTables),
  );

  // Measured with both limits in it (the real ones are the same size), so the
  // size checked here is the size the wallet will be handed.
  const probe = compile([
    ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_CU }),
    setLoadedAccountsDataSizeLimit(MAX_LOADED_BYTES),
    ...instructions,
  ]);
  const size = serializedSize(probe);
  if (size > PACKET_DATA_SIZE) {
    throw new WalletTxRejected(
      `This transaction is ${Number.isFinite(size) ? `${size} bytes` : "too large"} and the network takes ${PACKET_DATA_SIZE}. `
      + "The lookup table for this cluster is missing or out of date.",
    );
  }

  const { value } = await conn.simulateTransaction(probe, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
  });
  if (value.err) throw new WalletTxRejected(describe(value.err, value.logs));

  const budget: TransactionInstruction[] = [ComputeBudgetProgram.setComputeUnitLimit({
    units: value.unitsConsumed
      ? Math.min(MAX_CU, Math.ceil(value.unitsConsumed * 1.2) + 5_000)
      : MAX_CU,
  })];
  const loaded = Number((value as { loadedAccountsDataSize?: number }).loadedAccountsDataSize ?? 0);
  if (loaded > 0) {
    budget.push(setLoadedAccountsDataSizeLimit(
      Math.min(MAX_LOADED_BYTES, Math.ceil(loaded * 1.2) + 16 * 1024),
    ));
  }
  return compile([...budget, ...instructions]);
}

/** Bytes on the wire, or Infinity when web3.js cannot even encode it. */
export function serializedSize(tx: VersionedTransaction): number {
  try { return tx.serialize().length; } catch { return Number.POSITIVE_INFINITY; }
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

/**
 * Where a pack flow failed: in the wallet (it refused, or could not sign), or
 * on the network (sending or confirming what it signed). An error with no
 * step failed before the wallet opened.
 *
 * Shown after the message (txErrorText), because "the transaction expired"
 * reads the same from the wallet and from the network, and the fix is not.
 */
export type WalletStep = "wallet" | "network";

export async function atStep<T>(step: WalletStep, work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (err) {
    if (err && typeof err === "object" && !("walletStep" in err)) {
      try { (err as { walletStep?: WalletStep }).walletStep = step; } catch { /* frozen: left untagged */ }
    }
    throw err;
  }
}

/** The blockhash a transaction of either kind was built on. */
export function blockhashOf(tx: Transaction | VersionedTransaction): string | null {
  return tx instanceof Transaction ? tx.recentBlockhash ?? null : tx.message.recentBlockhash;
}

function messageBytes(tx: Transaction | VersionedTransaction): Uint8Array {
  return tx instanceof Transaction ? tx.serializeMessage() : tx.message.serialize();
}

/**
 * Compares what the wallet signed with what it was handed.
 *
 * A wallet may change a transaction before signing it (Phantom adds priority
 * fees to some, and re-picks the blockhash when it does). That is allowed, but
 * a blockhash this network does not know can never land, and sending it only
 * runs the clock out to "dropped" a minute later. So that case stops here, in
 * words; any other change is returned as a note for the diagnosis.
 *
 * Call it with the unsigned transaction's message bytes taken BEFORE signing:
 * the adapter may hand back the same object, signed.
 */
export async function checkWalletKept(
  conn: Connection, asked: { blockhash: string; message: Uint8Array }, signed: Transaction | VersionedTransaction,
): Promise<string> {
  const got = blockhashOf(signed);
  const same = Buffer.from(messageBytes(signed)).equals(Buffer.from(asked.message));
  if (same) return "wallet kept the transaction";
  if (got && got !== asked.blockhash) {
    const valid = await conn.isBlockhashValid(got, { commitment: "processed" })
      .then((r) => r.value).catch(() => true);
    if (!valid) {
      throw new WalletTxRejected(
        "Your wallet signed this against a blockhash this network does not know, so it cannot go through. "
        + "Check that the wallet is on the same network as the city (Phantom: Settings, Developer Settings, Testnet Mode). Nothing was charged.",
      );
    }
    return `wallet changed the transaction and its blockhash (${got.slice(0, 6)})`;
  }
  return "wallet changed the transaction, same blockhash";
}

// ── Signing that survives Phantom's 4100 ────────────────────────────────────

type AnyTx = Transaction | VersionedTransaction;
type SignOne = <T extends AnyTx>(tx: T) => Promise<T>;
type SignMany = <T extends AnyTx>(txs: T[]) => Promise<T[]>;

/** The wallet said the method or the account is not authorized (4100). */
export function isWalletUnauthorized(err: unknown): boolean {
  const e = err as { code?: number; error?: { code?: number }; message?: string } | null;
  return e?.code === 4100 || e?.error?.code === 4100
    || /not been authorized by the user/i.test(e?.message ?? "");
}

/** Phantom's own injected provider, when the page has one. */
interface InjectedSolana {
  isConnected?: boolean;
  publicKey?: { toBase58(): string } | null;
  connect?: () => Promise<unknown>;
  signTransaction?: SignOne;
}
function injectedPhantom(): InjectedSolana | null {
  const g = globalThis as { phantom?: { solana?: InjectedSolana } };
  return g.phantom?.solana ?? null;
}

/**
 * The shop's signer: every approval is ONE transaction, signed through the
 * plainest method there is, with a way past Phantom's 4100.
 *
 * Devnet, 2026-11-11: `signAllTransactions` through the wallet adapter came
 * back at once with 4100, "the requested method and/or account has not been
 * authorized", and no popup, on both purchase paths, while Phantom's own
 * provider reported itself connected as that very account. Ten minutes
 * earlier the same flows had signed. Disconnecting and reconnecting the site
 * did not clear it.
 *
 * So a single transaction goes through `signTransaction` (Phantom calls
 * signAllTransactions "not recommended" for new integrations), and when the
 * adapter still answers 4100 the transaction is handed to Phantom's injected
 * provider directly, after making sure it is connected as `expected`. Nothing
 * here changes WHAT is signed, only which door it goes through.
 */
export function resilientSigner(args: {
  signAll?: SignMany;
  signOne?: SignOne;
  /** The account every transaction here is built for. */
  expected: string | null;
}): SignMany | undefined {
  const { signAll, signOne, expected } = args;
  if (!signAll && !signOne) return undefined;

  const viaAdapter = async <T extends AnyTx>(txs: T[]): Promise<T[]> => {
    if (signOne && (txs.length === 1 || !signAll)) {
      const out: T[] = [];
      for (const tx of txs) out.push(await signOne(tx));
      return out;
    }
    return signAll!(txs);
  };

  const viaInjected = async <T extends AnyTx>(txs: T[]): Promise<T[] | null> => {
    const p = injectedPhantom();
    if (!p?.signTransaction || !expected) return null;
    if (!p.isConnected || p.publicKey?.toBase58() !== expected) {
      try { await p.connect?.(); } catch { return null; }
    }
    if (p.publicKey?.toBase58() !== expected) return null;
    const out: T[] = [];
    for (const tx of txs) out.push(await p.signTransaction(tx));
    return out;
  };

  return async <T extends AnyTx>(txs: T[]): Promise<T[]> => {
    try {
      return await viaAdapter(txs);
    } catch (err) {
      if (!isWalletUnauthorized(err)) throw err;
      console.warn("[wallet] the adapter answered 4100; signing through Phantom directly", err);
      const out = await viaInjected(txs);
      if (!out) throw err;
      return out;
    }
  };
}
