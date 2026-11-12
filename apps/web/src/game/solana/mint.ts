import {
  Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram,
} from "@solana/web3.js";
import {
  SOL_CITY_COLLECTIBLES_PROGRAM_ID, deriveUnlockPDA, decodeUnlockState,
  deriveMintQueuePDA, decodeMintQueue,
} from "./program";
import { ixDiscriminator } from "./instructions";
import { atStep, prepareWalletTx } from "./walletTx";
import { sendAndConfirmTransfer } from "./sendTokens";
import { BOOSTER_BLOCK_START } from "@/game/config/catalogIndex";
import { baseConnection } from "./baseRpc";
import { setHeldItems, setOnChainUnlocks, setOwedCopies, markHeld } from "@/game/config/wardrobeUnlocks";

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
  /** The emergency stop, set together with the pack config's. */
  paused: boolean;
}

function derivePda(seed: string, programId = SOL_CITY_COLLECTIBLES_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(seed)], programId)[0];
}

export const deriveMintConfigPDA = () => derivePda("mint_config");
/** Signs every mint, as the tree's delegate and the collection's authority. */
export const deriveMintAuthorityPDA = () => derivePda("mint_authority");
/**
 * The marker `set_mint_tree` leaves for a tree it moves away from. Its
 * existence is what lets a sealed pack or a cosmetic in that old tree still be
 * opened or claimed after a rotation.
 */
export const deriveAcceptedTreePDA = (tree: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("accepted_tree"), tree.toBuffer()], SOL_CITY_COLLECTIBLES_PROGRAM_ID,
  )[0];

/**
 * The account to pass in an instruction's `accepted_tree` slot for a leaf
 * that lives in `tree`.
 *
 * Nothing for the current tree, which Anchor spells as the program id in an
 * optional account's place. The marker for any other tree: if it does not
 * exist the program refuses, which is right, since then the tree is not one
 * this program ever minted into.
 */
export function acceptedTreeSlot(tree: PublicKey, config: MintConfigAccount): PublicKey {
  return tree.equals(config.merkleTree) ? SOL_CITY_COLLECTIBLES_PROGRAM_ID : deriveAcceptedTreePDA(tree);
}

/**
 * A wallet's WearLog: which asset each of its wear-rights came from (audit
 * R-21). Written by every mint and claim; read by a buyer's claim to take the
 * right back from whoever held it before.
 */
export const deriveWearLogPDA = (wallet: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("wear_log"), wallet.toBuffer()], SOL_CITY_COLLECTIBLES_PROGRAM_ID,
  )[0];

/** A WearLog's entries, or null when the bytes are not one. */
export function decodeWearLog(data: Uint8Array): { wallet: PublicKey; entries: { index: number; asset: PublicKey }[] } | null {
  const buf = Buffer.from(data);
  if (buf.length < 8 + 32 + 4) return null;
  const wallet = new PublicKey(buf.subarray(8, 40));
  const n = buf.readUInt32LE(40);
  if (44 + n * 34 > buf.length) return null;
  const entries: { index: number; asset: PublicKey }[] = [];
  for (let i = 0; i < n; i++) {
    const at = 44 + i * 34;
    entries.push({ index: buf.readUInt16LE(at), asset: new PublicKey(buf.subarray(at + 2, at + 34)) });
  }
  return { wallet, entries };
}

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
  const paused = o < d.length && d.readUInt8(o) === 1;
  return {
    admin, merkleTree, collectionMint, royaltyRecipient,
    sellerFeeBasisPoints, symbol, baseUri, paused,
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

/**
 * Catalog indices an asset of which has ever been in this wallet's hands. A
 * record only: it no longer decides what can be minted (the MintQueue does),
 * and an index here can still have copies waiting.
 */
export async function mintedIndices(conn: Connection, wallet: PublicKey): Promise<number[]> {
  const info = await conn.getAccountInfo(deriveUnlockPDA(wallet)[0]);
  if (!info) return [];
  return decodeUnlockState(info.data)?.minted ?? [];
}

/**
 * Every COPY this wallet is owed and has not received as an asset yet, oldest
 * first, REPEATS INCLUDED: two of the same item drawn are two entries.
 *
 * Exactly what `mint_pending` mints on chain, because it reads the same thing:
 * the wallet's MintQueue. This decides HOW MANY transactions to prepare, and
 * preparing too few leaves copies unminted.
 *
 * A wallet whose queue does not exist yet is owed what the old rule owed
 * (owned, mintable, never minted): the program seeds the queue with exactly
 * that the first time it creates it, so the two sides agree before and after.
 */
export async function pendingMintIndices(
  conn: Connection,
  wallet: PublicKey,
): Promise<number[]> {
  const [queueInfo, unlockInfo] = await conn.getMultipleAccountsInfo([
    deriveMintQueuePDA(wallet), deriveUnlockPDA(wallet)[0],
  ]);
  return owedFrom(queueInfo, unlockInfo);
}

type RawAccount = { owner: PublicKey; data: Uint8Array } | null;

/** The copies owed, from a MintQueue and UnlockState already read. */
function owedFrom(queueInfo: RawAccount, unlockInfo: RawAccount): number[] {
  if (queueInfo && queueInfo.owner.equals(SOL_CITY_COLLECTIBLES_PROGRAM_ID)) {
    return decodeMintQueue(queueInfo.data)?.owed ?? [];
  }
  const state = unlockInfo ? decodeUnlockState(unlockInfo.data) : null;
  if (!state) return [];
  const minted = new Set(state.minted);
  return state.owned.filter((i) => i >= BOOSTER_BLOCK_START && !minted.has(i));
}

/**
 * Re-reads what this wallet owns and what it is still owed, in one request,
 * and hands both to the wardrobe: `owned` decides what a pack item may be
 * worn as, and the queue decides which tiles read MINT NOW.
 */
export async function syncUnlocksToWardrobe(conn: Connection, wallet: PublicKey): Promise<void> {
  const [unlockInfo, queueInfo] = await conn.getMultipleAccountsInfo([
    deriveUnlockPDA(wallet)[0], deriveMintQueuePDA(wallet),
  ]);
  const key = wallet.toBase58();
  setOnChainUnlocks(key, unlockInfo ? new Uint8Array(unlockInfo.data) : null);
  setOwedCopies(key, owedFrom(queueInfo, unlockInfo));
}

/**
 * `a` with one occurrence removed for every entry of `b`: a difference that
 * COUNTS. Owed copies repeat (two of the same item drawn are two entries), so
 * a Set would read "A, A owed, then A owed" as nothing minted.
 */
export function withoutCopies(a: number[], b: number[]): number[] {
  const take = new Map<number, number>();
  for (const i of b) take.set(i, (take.get(i) ?? 0) + 1);
  const out: number[] = [];
  for (const i of a) {
    const n = take.get(i) ?? 0;
    if (n > 0) take.set(i, n - 1); else out.push(i);
  }
  return out;
}

/** The copies in both lists, as many times as both hold them. */
export function commonCopies(a: number[], b: number[]): number[] {
  const have = new Map<number, number>();
  for (const i of b) have.set(i, (have.get(i) ?? 0) + 1);
  const out: number[] = [];
  for (const i of a) {
    const n = have.get(i) ?? 0;
    if (n > 0) { have.set(i, n - 1); out.push(i); }
  }
  return out;
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
    // Where each minted wear-right came from (audit R-21). Depends on the
    // wallet alone, which is what keeps a pre-signed mint_pending valid.
    { pubkey: deriveWearLogPDA(payer),   isSigner: false, isWritable: true  },
    // Last: the copies owed, which is what both instructions mint from.
    { pubkey: deriveMintQueuePDA(payer), isSigner: false, isWritable: true  },
  ];
}

/**
 * `mint_pending(limit)`: mint what is owed, whatever that turns out to be.
 *
 * No index in the data, so the work is read from the owner's MintQueue when
 * it runs. And no signature from the owner: `payer` signs and pays, and may
 * be anyone, which is how the site's sponsor mints a pack right after its draw
 * with no second approval (/api/mint). Leave `owner` out and the payer mints
 * their own items, as before.
 *
 * Accounts, in the program's order (MintPending): the payer, the owner, then
 * MintUnlock's list with the owner's UnlockState, WearLog and MintQueue.
 */
export function buildMintPendingIx(params: {
  payer: PublicKey;
  /** Whose items, and who receives the assets. Defaults to the payer. */
  owner?: PublicKey;
  limit: number;
  config: MintConfigAccount;
}): TransactionInstruction {
  const owner = params.owner ?? params.payer;
  const data = Buffer.alloc(9);
  ixDiscriminator("mint_pending").copy(data, 0);
  data.writeUInt8(params.limit, 8);
  // mintAccountMetas(owner) names the owner's UnlockState and WearLog; its
  // first entry, the owner as signer, becomes the payer, then the owner as a
  // plain account.
  const [, ...rest] = mintAccountMetas(owner, params.config);
  const keys = [
    { pubkey: params.payer, isSigner: true, isWritable: true },
    { pubkey: owner, isSigner: false, isWritable: false },
    ...rest,
  ];
  return new TransactionInstruction({ programId: SOL_CITY_COLLECTIBLES_PROGRAM_ID, keys, data });
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

/**
 * What every mint path runs once its copies have landed, so the wardrobe
 * shows them as held and wearable at once.
 *
 * Two reads had gone stale (devnet, 2026-11-11): the unlock account and queue
 * were read BEFORE the mint, so delivered items still said MINT NOW; and the
 * indexer, asked a moment after the mint, did not list the new assets yet,
 * so they could not be worn. This re-reads the account and queue, gives the
 * indexer a few seconds to list what was minted, and counts the copies this
 * wallet was just minted as held either way, since the mint landing is the
 * proof.
 */
export async function syncAfterMint(
  conn: Connection,
  wallet: PublicKey,
  minted: number[],
): Promise<void> {
  const key = wallet.toBase58();
  try { await syncUnlocksToWardrobe(conn, wallet); } catch { /* the next read catches up */ }
  if (minted.length === 0) { await syncHeldToWardrobe(conn, wallet); return; }
  const want = new Set(minted);
  try {
    const config = await readMintConfig(conn);
    if (!config) { setHeldItems(key, null); return; }
    let held: number[] = [];
    for (let i = 0; i < 6; i++) {
      held = await heldIndices(conn, wallet, config);
      const has = new Set(held);
      if ([...want].every((x) => has.has(x))) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    setHeldItems(key, held);
    markHeld(key, minted);
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
 * Lower this the moment a pack fails with an exceeded compute budget, and
 * the on-chain MINT_PENDING_CAP with it.
 */
export const MINTS_PER_TX = 5;

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
  // Read from the queue, not from `minted`: an index minted before is already
  // in `minted`, so a repeat would look delivered before anything landed.
  const before = await pendingMintIndices(conn, wallet);
  await Promise.all(signed.map((tx) =>
    conn.sendRawTransaction(tx.serialize(), { skipPreflight: false }).catch(() => null),
  ));

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const gone = withoutCopies(before, await pendingMintIndices(conn, wallet));
    const landed = commonCopies(expected, gone);
    if (landed.length === expected.length || i === 29) {
      await syncAfterMint(conn, wallet, landed);
      return { minted: landed, failed: withoutCopies(expected, landed) };
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

  const left = withoutCopies(expected, minted);
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
 * Mints the given items, one transaction per wallet approval.
 *
 * Minting is not optional: possession is what decides whether a pack item can
 * be worn, so an item left unminted is an item the player cannot use. This is
 * the step that follows a reveal, not a button they may ignore.
 *
 * Up to MINTS_PER_TX items ride in one transaction (five Bubblegum mints are
 * ~410k compute units and ~830 bytes), so one pack is one approval. More than
 * that is one approval per transaction, asked one after another, because a
 * batch is what Phantom would not take: it refused a multi-transaction
 * signAllTransactions with 4100, or signed one that never landed, every time
 * on devnet (2026-11-05), while a single transaction always went through.
 * Each one is simulated first (prepareWalletTx) and sent and confirmed like a
 * payment, and a failure is reported rather than swallowed: the batch's send
 * errors used to be dropped, so "mint" looked done and nothing had landed.
 *
 * Returns the indices that landed. A failure before anything landed is
 * thrown, so the caller can say why; after a partial mint, the rest is
 * returned as failed and stays in the MintQueue for the wardrobe's mint button.
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

  // Only copies the queue still owes, as many times as it owes them: each
  // mint_unlock consumes one, so a repeat is two instructions, and a copy
  // already delivered would only fail the transaction.
  const todo = commonCopies(args.indices, await pendingMintIndices(conn, args.wallet));
  if (todo.length === 0) return { minted: [], failed: [] };

  const per = Math.max(1, Math.min(MINTS_PER_TX, args.perTx ?? MINTS_PER_TX));
  const minted: number[] = [];
  for (let at = 0; at < todo.length; at += per) {
    const chunk = todo.slice(at, at + per);
    try {
      const { blockhash } = await conn.getLatestBlockhash();
      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: args.wallet });
      for (const index of chunk) tx.add(buildMintUnlockIx({ payer: args.wallet, index, config }));
      const ready = await prepareWalletTx(conn, tx);
      // Again right before the wallet opens: the simulation took some of it.
      const fresh = await conn.getLatestBlockhash();
      ready.recentBlockhash = fresh.blockhash;
      const [signed] = await atStep("wallet", args.signAllTransactions([ready]));
      await atStep("network", sendAndConfirmTransfer({
        connection: conn, signed, lastValidBlockHeight: fresh.lastValidBlockHeight,
      }));
      minted.push(...chunk);
    } catch (err) {
      if (minted.length === 0) throw err;
      break;
    }
  }
  await syncAfterMint(conn, args.wallet, minted);
  return { minted, failed: withoutCopies(todo, minted) };
}

/**
 * Mints one cosmetic and waits for it to land.
 *
 * Confirmed by the signature reaching `confirmed` without an error. Reading
 * `minted` back used to stand in for that, and it cannot any more: an index
 * minted before is already there, so a repeat would read as delivered before
 * this transaction landed.
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
    const st = (await conn.getSignatureStatuses([signature])).value[0];
    if (st?.err) throw new Error(`The mint failed on chain: ${JSON.stringify(st.err)}`);
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") {
      // The item just became a held asset, and from here possession is what
      // decides whether it can be worn. Asking again now is what keeps it
      // wearable across that handover.
      await syncAfterMint(conn, args.wallet, [args.index]);
      return { signature };
    }
  }
  throw new Error("Sent, but the asset has not appeared yet. It may still land.");
}

/**
 * Asks the site to mint what this wallet is owed, paid by the site's sponsor
 * wallet (/api/mint, lib/mint/sponsor.ts), so the player approves nothing.
 *
 * Keeps asking for as long as the sponsor makes progress, and judges progress
 * by the wallet's MintQueue on chain, not by the answers. A bundle of 10
 * packs stopped at 35 of 50 (devnet, 2026-11-11): one request minted three
 * transactions and its answer never arrived, and this used to give up on the
 * first lost answer, so the wallet was asked to approve the rest five at a
 * time. Now a lost or failed answer is only a stall; three stalls in a row,
 * the sponsor being unavailable, or the deadline end it.
 *
 * Never throws. `minted` is what left the queue while this ran.
 */
export async function requestSponsoredMint(
  wallet: PublicKey,
  opts: { conn?: Connection; deadlineMs?: number } = {},
): Promise<{ minted: number[]; left: number }> {
  const conn = opts.conn ?? baseConnection();
  const until = Date.now() + (opts.deadlineMs ?? 120_000);
  const owed = async () => { try { return await pendingMintIndices(conn, wallet); } catch { return null; } };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const before = await owed();
  let last = before;
  const reported: number[] = [];
  let stalls = 0;
  while (Date.now() < until && stalls < 3) {
    let body: { status?: string; minted?: number[]; left?: number } | null = null;
    try {
      const res = await fetch("/api/mint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: wallet.toBase58() }),
      });
      body = await res.json();
    } catch {
      body = null; // lost: the chain says what happened
    }
    if (body?.status === "pending") { await sleep(1500); continue; }
    if (body?.status === "unavailable" || body?.status === "nothing") break;
    reported.push(...(body?.minted ?? []));

    const now = await owed();
    const progressed = now && last ? now.length < last.length : (body?.minted?.length ?? 0) > 0;
    if (now) last = now;
    if (now && now.length === 0) break;
    if (progressed) stalls = 0;
    else { stalls++; await sleep(1500 * stalls); }
  }

  const left = last?.length ?? 0;
  const minted = before && last ? withoutCopies(before, last) : reported;
  return { minted, left };
}
