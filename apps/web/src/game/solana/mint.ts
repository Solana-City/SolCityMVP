import {
  Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram,
} from "@solana/web3.js";
import {
  SOL_CITY_COLLECTIBLES_PROGRAM_ID, deriveUnlockPDA, decodeUnlockState,
} from "./program";
import { ixDiscriminator } from "./instructions";
import { prepareWalletTx } from "./walletTx";
import { BOOSTER_BLOCK_START } from "@/game/config/catalogIndex";
import { baseConnection } from "./baseRpc";
import { setHeldItems } from "@/game/config/wardrobeUnlocks";

/**
 * Turning an owned cosmetic into a compressed NFT the player holds.
 *
 * Everything here is on BASE. The unlock account is never delegated, and the
 * tree lives on base too.
 *
 * ── Why this is a long account list ─────────────────────────────────────
 *
 * Most of it is Bubblegum's plumbing rather than ours: the tree, the
 * collection's metadata and master edition, the compression program, the log
 * wrapper. Our program passes them through and Bubblegum checks them, which is
 * why passing a wrong one fails inside the CPI rather than silently minting
 * the wrong thing.
 *
 * The three that decide who gets what are checked by us: the unlock account
 * belongs to the payer, and the tree and collection are the ones MintConfig
 * names.
 */

const BUBBLEGUM_PROGRAM_ID = new PublicKey("BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY");
const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const COMPRESSION_PROGRAM_ID = new PublicKey("cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK");
const LOG_WRAPPER_ID = new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");

export interface MintConfigAccount {
  admin: PublicKey;
  merkleTree: PublicKey;
  collectionMint: PublicKey;
  royaltyRecipient: PublicKey;
  sellerFeeBasisPoints: number;
  symbol: string;
  baseUri: string;
}

function derivePda(seed: string, programId = SOL_CITY_COLLECTIBLES_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(seed)], programId)[0];
}

export const deriveMintConfigPDA = () => derivePda("mint_config");
/** Signs every mint, as the tree's delegate and the collection's authority. */
export const deriveMintAuthorityPDA = () => derivePda("mint_authority");

/**
 * Reads what the program will mint into. Null before `init_mint_config` has
 * been run, which is the state until the collection and tree exist.
 */
export async function readMintConfig(conn: Connection): Promise<MintConfigAccount | null> {
  const info = await conn.getAccountInfo(deriveMintConfigPDA());
  if (!info) return null;
  const d = Buffer.from(info.data);
  let o = 8;
  const admin = new PublicKey(d.subarray(o, o + 32)); o += 32;
  const merkleTree = new PublicKey(d.subarray(o, o + 32)); o += 32;
  const collectionMint = new PublicKey(d.subarray(o, o + 32)); o += 32;
  const royaltyRecipient = new PublicKey(d.subarray(o, o + 32)); o += 32;
  const sellerFeeBasisPoints = d.readUInt16LE(o); o += 2;
  const readStr = (): string => {
    const len = d.readUInt32LE(o); o += 4;
    const s = d.subarray(o, o + len).toString("utf8"); o += len;
    return s;
  };
  const symbol = readStr();
  const baseUri = readStr();
  return {
    admin, merkleTree, collectionMint, royaltyRecipient,
    sellerFeeBasisPoints, symbol, baseUri,
  };
}

/**
 * Catalog indices this wallet HOLDS AN ASSET FOR RIGHT NOW, asked of the
 * indexer rather than of our own accounts.
 *
 * This is what makes selling mean something. A compressed NFT moves on
 * Bubblegum and our program is never told, so `UnlockState.owned` cannot be
 * revoked when the asset is sold: it would say the seller still owns a hat
 * that is now in somebody else's wallet. Possession is the only honest
 * answer for an item that can be traded, and only an indexer knows it.
 *
 * The index is read back out of the URI, which is how the chain identifies
 * which cosmetic an asset is in the first place (see `mint_unlock`: the URI
 * is built, not stored). Anything outside our collection is ignored.
 *
 * Throws rather than returning empty on a failure. An empty list and "the
 * indexer is down" must not look the same to the caller: one means the player
 * sold everything, the other means we do not know, and the second must never
 * strip somebody of their wardrobe.
 */
export async function heldIndices(
  conn: Connection,
  wallet: PublicKey,
  config: MintConfigAccount,
): Promise<number[]> {
  const res = await fetch(conn.rpcEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "held",
      method: "getAssetsByOwner",
      params: {
        ownerAddress: wallet.toBase58(),
        page: 1,
        limit: 1000,
        displayOptions: { showUnverifiedCollections: true },
      },
    }),
  });
  if (!res.ok) throw new Error(`the indexer answered ${res.status}`);
  const body = await res.json() as {
    result?: { items?: { grouping?: { group_key: string; group_value: string }[];
                         content?: { json_uri?: string } }[] };
    error?: { message?: string };
  };
  if (body.error) throw new Error(body.error.message ?? "the indexer refused");

  const collection = config.collectionMint.toBase58();
  const out: number[] = [];
  for (const item of body.result?.items ?? []) {
    const inOurs = item.grouping?.some(
      (g) => g.group_key === "collection" && g.group_value === collection,
    );
    if (!inOurs) continue;
    const uri = item.content?.json_uri ?? "";
    if (!uri.startsWith(config.baseUri)) continue;
    const n = Number(uri.slice(config.baseUri.length).replace(/\.json$/, ""));
    if (Number.isInteger(n) && n >= 0) out.push(n);
  }
  return out;
}

/** Catalog indices this wallet has ever minted. Minting is once per index. */
export async function mintedIndices(conn: Connection, wallet: PublicKey): Promise<number[]> {
  const info = await conn.getAccountInfo(deriveUnlockPDA(wallet)[0]);
  if (!info) return [];
  return decodeUnlockState(info.data)?.minted ?? [];
}

/**
 * Catalog indices this wallet owns, can mint, and has not minted yet.
 *
 * The same three conditions `mint_pending` applies on chain, and they have to
 * stay the same three: this is what decides HOW MANY transactions to prepare,
 * and preparing too few leaves items unminted behind a popup the whole design
 * exists to avoid.
 *
 * Below BOOSTER_BLOCK_START are the free items and the quest and event block.
 * Those never become assets, so they are not work.
 */
export async function pendingMintIndices(
  conn: Connection,
  wallet: PublicKey,
): Promise<number[]> {
  const info = await conn.getAccountInfo(deriveUnlockPDA(wallet)[0]);
  const state = info ? decodeUnlockState(info.data) : null;
  if (!state) return [];
  const minted = new Set(state.minted);
  return state.owned.filter((i) => i >= BOOSTER_BLOCK_START && !minted.has(i));
}

/**
 * `mint_unlock(index)`.
 *
 * The PDAs that are not ours are derived the way Bubblegum and Token Metadata
 * derive them, because those programs check them: the tree config from the
 * tree, the collection's metadata and edition from its mint, and Bubblegum's
 * own signing PDA.
 */
export function buildMintUnlockIx(params: {
  payer: PublicKey;
  index: number;
  config: MintConfigAccount;
}): TransactionInstruction {
  const data = Buffer.alloc(10);
  ixDiscriminator("mint_unlock").copy(data, 0);
  data.writeUInt16LE(params.index, 8);

  return new TransactionInstruction({
    programId: SOL_CITY_COLLECTIBLES_PROGRAM_ID,
    keys: mintAccountMetas(params.payer, params.config),
    data,
  });
}

/**
 * The accounts both mint instructions take, in the order the program declares
 * them.
 *
 * Written once because the two instructions share one Accounts struct on
 * chain. Two copies here that drifted by one entry would fail inside a CPI,
 * where the error names Bubblegum rather than us.
 */
function mintAccountMetas(payer: PublicKey, config: MintConfigAccount) {
  const [unlockPda] = deriveUnlockPDA(payer);
  const mintAuthority = deriveMintAuthorityPDA();

  const [treeConfig] = PublicKey.findProgramAddressSync(
    [config.merkleTree.toBuffer()], BUBBLEGUM_PROGRAM_ID,
  );
  const [collectionMetadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), config.collectionMint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID,
  );
  const [collectionEdition] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(),
     config.collectionMint.toBuffer(), Buffer.from("edition")],
    TOKEN_METADATA_PROGRAM_ID,
  );
  const [bubblegumSigner] = PublicKey.findProgramAddressSync(
    [Buffer.from("collection_cpi")], BUBBLEGUM_PROGRAM_ID,
  );

  return [
    { pubkey: payer,                     isSigner: true,  isWritable: true  },
    { pubkey: unlockPda,                 isSigner: false, isWritable: true  },
    { pubkey: deriveMintConfigPDA(),     isSigner: false, isWritable: false },
    { pubkey: mintAuthority,             isSigner: false, isWritable: false },
    { pubkey: treeConfig,                isSigner: false, isWritable: true  },
    { pubkey: config.merkleTree,         isSigner: false, isWritable: true  },
    { pubkey: config.collectionMint,     isSigner: false, isWritable: false },
    { pubkey: collectionMetadata,        isSigner: false, isWritable: true  },
    { pubkey: collectionEdition,         isSigner: false, isWritable: false },
    { pubkey: bubblegumSigner,           isSigner: false, isWritable: false },
    { pubkey: LOG_WRAPPER_ID,            isSigner: false, isWritable: false },
    { pubkey: COMPRESSION_PROGRAM_ID,    isSigner: false, isWritable: false },
    { pubkey: TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: BUBBLEGUM_PROGRAM_ID,      isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId,   isSigner: false, isWritable: false },
  ];
}

/**
 * `mint_pending(limit)`: mint what is owed, whatever that turns out to be.
 *
 * The same accounts as `mint_unlock`, deliberately: on chain the two share
 * one Accounts struct, because they do the same thing and differ only in
 * where the indices come from.
 *
 * What matters here is what is NOT in the data. There is no index, so these
 * bytes can be built, and signed, before the draw that decides them exists.
 * That is the whole reason this instruction is here.
 */
export function buildMintPendingIx(params: {
  payer: PublicKey;
  limit: number;
  config: MintConfigAccount;
}): TransactionInstruction {
  const data = Buffer.alloc(9);
  ixDiscriminator("mint_pending").copy(data, 0);
  data.writeUInt8(params.limit, 8);
  return new TransactionInstruction({
    programId: SOL_CITY_COLLECTIBLES_PROGRAM_ID,
    keys: mintAccountMetas(params.payer, params.config),
    data,
  });
}

/**
 * Tells the wardrobe what this wallet holds, so a sold item stops being
 * wearable by the seller.
 *
 * Three outcomes, and the difference between the last two is the whole point:
 * a list when the indexer answered, and UNKNOWN both when minting is not set
 * up yet and when the lookup failed. Unknown falls back to the grant list, so
 * an indexer outage never takes a hat off anybody.
 */
export async function syncHeldToWardrobe(
  conn: Connection,
  wallet: PublicKey,
): Promise<void> {
  const key = wallet.toBase58();
  try {
    const config = await readMintConfig(conn);
    // No MintConfig means nothing can have been minted, so nothing can have
    // been sold, and possession has no opinion to offer yet.
    if (!config) { setHeldItems(key, null); return; }
    setHeldItems(key, await heldIndices(conn, wallet, config));
  } catch {
    setHeldItems(key, null);
  }
}

export type SignTx = (tx: Transaction) => Promise<Transaction>;
export type SignAllTx = (txs: Transaction[]) => Promise<Transaction[]>;

/**
 * How many mints go in one transaction.
 *
 * Five, which is a pack, because a pack arriving in one transaction is the
 * point. What decides it is the compute limit and not the 1232-byte
 * transaction size: the fifteen accounts are shared, and `mint_pending` adds
 * no data per item at all.
 *
 * Budgeted at UNITS_PER_MINT below, which leaves five inside the 1.4M a
 * transaction may ask for. Lower this the moment a pack fails with an
 * exceeded compute budget, and the on-chain MINT_PENDING_CAP with it.
 */
export const MINTS_PER_TX = 5;

/**
 * Compute units asked for per item.
 *
 * Deliberately generous. A Bubblegum mint that CPIs into Token Metadata and
 * the compression program costs well under this, and asking for more than you
 * use is nearly free, while asking for less is a transaction that dies after
 * minting three of five. Five of these still fit the 1.4M ceiling.
 */
const UNITS_PER_MINT = 260_000;

/** What ComputeBudget will accept, and what five mints have to live inside. */
const MAX_COMPUTE_UNITS = 1_400_000;

/** ComputeBudget's SetComputeUnitLimit, which the default 200k will not cover. */
function computeLimitIx(units: number): TransactionInstruction {
  const data = Buffer.alloc(5);
  data.writeUInt8(2, 0);
  data.writeUInt32LE(units, 1);
  return new TransactionInstruction({
    programId: new PublicKey("ComputeBudget111111111111111111111111111111"),
    keys: [],
    data,
  });
}

/**
 * Transactions that will mint `items` cosmetics, built BEFORE anyone knows
 * which cosmetics those are.
 *
 * This is the piece that removes the second wallet popup. Every byte here is
 * decided by the wallet and the config, never by the draw, so these can be
 * handed to `signAllTransactions` alongside the purchase itself and held
 * until the oracle answers.
 *
 * ── Why the compute limits count upwards ────────────────────────────────
 *
 * Two transactions with the same instructions, the same signer and the same
 * blockhash are not two transactions: they hash to one signature, and the
 * network keeps the first and drops the rest. Chunks after the first ask for
 * one more compute unit than the chunk before, which costs nothing and makes
 * each one a distinct transaction. A single pack is one chunk and never
 * reaches this.
 */
export function buildMintPendingTxs(args: {
  wallet: PublicKey;
  config: MintConfigAccount;
  items: number;
  blockhash: string;
}): Transaction[] {
  const chunks: number[] = [];
  for (let left = args.items; left > 0; left -= MINTS_PER_TX) {
    chunks.push(Math.min(MINTS_PER_TX, left));
  }
  return chunks.map((size, i) => {
    const tx = new Transaction({ recentBlockhash: args.blockhash, feePayer: args.wallet });
    tx.add(computeLimitIx(Math.min(MAX_COMPUTE_UNITS, UNITS_PER_MINT * size + i)));
    tx.add(buildMintPendingIx({ payer: args.wallet, limit: size, config: args.config }));
    return tx;
  });
}

/**
 * Sends transactions the wallet signed earlier, and reports what landed.
 *
 * Sent together rather than one after another. They all write the same unlock
 * account, so the runtime runs them one at a time whatever we do, and each
 * one reads the list fresh: a chunk that finds the first five already minted
 * takes the next five. Order does not have to be arranged, only allowed.
 *
 * Failures are swallowed here on purpose. What the player is about to be told
 * is "these are yours now", and the account saying so is the thing that makes
 * it true, so the answer is read back from the account rather than inferred
 * from a signature.
 */
export async function sendMintPending(args: {
  conn: Connection;
  wallet: PublicKey;
  signed: Transaction[];
  expected: number[];
}): Promise<{ minted: number[]; failed: number[] }> {
  const { conn, wallet, signed, expected } = args;
  await Promise.all(signed.map((tx) =>
    conn.sendRawTransaction(tx.serialize(), { skipPreflight: false }).catch(() => null),
  ));

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const now = new Set(await mintedIndices(conn, wallet));
    const landed = expected.filter((x) => now.has(x));
    if (landed.length === expected.length || i === 29) {
      await syncHeldToWardrobe(conn, wallet);
      return { minted: landed, failed: expected.filter((x) => !now.has(x)) };
    }
  }
  return { minted: [], failed: expected };
}

/**
 * Mint transactions the wallet has already signed, and the height past which
 * the network will no longer take them.
 *
 * Handed from the purchase to whoever shows the reveal, so the player sees
 * what they got while these are still in flight.
 */
export interface SignedMints {
  txs: Transaction[];
  lastValidBlockHeight: number;
}

/**
 * Turns everything the wallet owes into assets, with no further approval if
 * it can be helped.
 *
 * The happy path sends what was signed during the purchase, which is the
 * whole point of the exercise. Two things can take it away: minting may not
 * be configured yet, and a draw may have taken longer than a blockhash lives.
 * Both land on `mintMany`, which works but asks, and asking is the thing this
 * was built to avoid rather than something it is allowed to fail over.
 */
export async function settleMints(args: {
  conn: Connection;
  wallet: PublicKey;
  presigned: SignedMints | null;
  /** Indices that must end up as assets. */
  expected: number[];
  /** The fallback, used only when the pre-signed route is gone. */
  signAllTransactions?: SignAllTx;
}): Promise<{ minted: number[]; failed: number[] }> {
  const { conn, wallet, presigned, expected } = args;
  if (expected.length === 0) return { minted: [], failed: [] };

  let minted: number[] = [];
  if (presigned && await stillSendable(conn, presigned.lastValidBlockHeight)) {
    // Only as many chunks as there is work for. A draw that repeated an item
    // the wallet already owned grants less than it was sold, and a chunk with
    // nothing to do is a transaction that fails and still pays its fee.
    const need = Math.ceil(expected.length / MINTS_PER_TX);
    const out = await sendMintPending({
      conn, wallet, signed: presigned.txs.slice(0, need), expected,
    });
    if (out.failed.length === 0) return out;
    minted = out.minted;
  }

  const left = expected.filter((i) => !minted.includes(i));
  if (!args.signAllTransactions) return { minted, failed: left };
  const out = await mintMany({
    wallet, indices: left, signAllTransactions: args.signAllTransactions, conn,
  });
  return { minted: [...minted, ...out.minted], failed: out.failed };
}

/**
 * Whether transactions signed against `blockhash` can still be sent.
 *
 * A pre-signed mint carries a blockhash chosen before the purchase, and the
 * network stops accepting it about a minute later. The oracle is normally
 * seconds, so this is the unlikely path, but when it happens the items are
 * safe in the account and the only cost is the popup this was avoiding.
 */
export async function stillSendable(
  conn: Connection,
  lastValidBlockHeight: number,
): Promise<boolean> {
  try {
    return (await conn.getBlockHeight()) <= lastValidBlockHeight;
  } catch {
    return false;
  }
}

/**
 * Mints every drawn item, asking the wallet ONCE.
 *
 * Minting is not optional: possession is what decides whether a pack item can
 * be worn, so an item left unminted is an item the player cannot use. This is
 * the step that follows a reveal, not a button they may ignore.
 *
 * Chunked because a Bubblegum mint is expensive in compute and a pack of five
 * will not fit one transaction. `signAllTransactions` is what keeps that from
 * costing a prompt per chunk: most wallets show one approval for the batch.
 *
 * Returns the indices that landed. Anything missing stays in UnlockState and
 * the wardrobe's own mint button finishes it later, which is the recovery
 * path and never the main one.
 */
export async function mintMany(args: {
  wallet: PublicKey;
  indices: number[];
  signAllTransactions: SignAllTx;
  conn?: Connection;
  perTx?: number;
}): Promise<{ minted: number[]; failed: number[] }> {
  const conn = args.conn ?? baseConnection();
  const config = await readMintConfig(conn);
  if (!config) return { minted: [], failed: args.indices };

  const already = new Set(await mintedIndices(conn, args.wallet));
  const todo = args.indices.filter((i) => !already.has(i));
  if (todo.length === 0) return { minted: [], failed: [] };

  const per = Math.max(1, args.perTx ?? MINTS_PER_TX);
  const chunks: number[][] = [];
  for (let i = 0; i < todo.length; i += per) chunks.push(todo.slice(i, i + per));

  const { blockhash } = await conn.getLatestBlockhash();
  const txs = chunks.map((chunk) => {
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: args.wallet });
    // Asked for per chunk rather than globally: the limit is per transaction.
    tx.add(computeLimitIx(Math.min(MAX_COMPUTE_UNITS, UNITS_PER_MINT * chunk.length)));
    for (const index of chunk) {
      tx.add(buildMintUnlockIx({ payer: args.wallet, index, config }));
    }
    return tx;
  });

  const signed = await args.signAllTransactions(txs);
  await Promise.all(signed.map((tx) =>
    conn.sendRawTransaction(tx.serialize(), { skipPreflight: false }).catch(() => null),
  ));

  // Confirmed by reading `minted` back rather than by watching signatures:
  // what the player is about to be told is "these are yours now", and the
  // account saying so is the thing that makes it true.
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const now = new Set(await mintedIndices(conn, args.wallet));
    const landed = todo.filter((x) => now.has(x));
    if (landed.length === todo.length) {
      await syncHeldToWardrobe(conn, args.wallet);
      return { minted: landed, failed: [] };
    }
    if (i === 29) {
      await syncHeldToWardrobe(conn, args.wallet);
      return { minted: landed, failed: todo.filter((x) => !now.has(x)) };
    }
  }
  return { minted: [], failed: todo };
}

/**
 * Mints one cosmetic and waits for it to land.
 *
 * Confirmed by reading `minted` back rather than by watching the signature:
 * what the player is about to be told is "it is yours now", and the account
 * saying so is the thing that makes that true.
 */
export async function mintCosmetic(args: {
  wallet: PublicKey;
  index: number;
  signTransaction: SignTx;
  conn?: Connection;
}): Promise<{ signature: string }> {
  const conn = args.conn ?? baseConnection();
  const config = await readMintConfig(conn);
  if (!config) throw new Error("Minting is not set up yet.");

  const { blockhash } = await conn.getLatestBlockhash();
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: args.wallet })
    .add(buildMintUnlockIx({ payer: args.wallet, index: args.index, config }));
  const signed = await args.signTransaction(await prepareWalletTx(conn, tx));
  const signature = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false });

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if ((await mintedIndices(conn, args.wallet)).includes(args.index)) {
      // The item just became a held asset, and from here possession is what
      // decides whether it can be worn. Asking again now is what keeps it
      // wearable across that handover.
      await syncHeldToWardrobe(conn, args.wallet);
      return { signature };
    }
    const st = (await conn.getSignatureStatuses([signature])).value[0];
    if (st?.err) throw new Error(`The mint failed on chain: ${JSON.stringify(st.err)}`);
  }
  throw new Error("Sent, but the asset has not appeared yet. It may still land.");
}
