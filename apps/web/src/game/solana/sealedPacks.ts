import {
  Connection, PublicKey, SystemProgram, SYSVAR_SLOT_HASHES_PUBKEY,
  Transaction, TransactionInstruction, VersionedTransaction,
} from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  SOL_CITY_COLLECTIBLES_PROGRAM_ID, derivePackConfigPDA, deriveSeasonDropsPDA,
  deriveUnlockPDA, deriveVrfIdentityPDA, decodeUnlockState, VRF_QUEUE_DEVNET, VRF_PROGRAM_ID,
} from "./program";
import { ixDiscriminator, buildInitUnlockStateIx } from "./instructions";
import { atStep, checkWalletKept, prepareWalletTx, prepareWalletTxV0 } from "./walletTx";
import {
  deriveMintConfigPDA, deriveMintAuthorityPDA, pendingMintIndices,
  acceptedTreeSlot,
  type MintConfigAccount, type SignedMints,
} from "./mint";
import { baseConnection, type OnChainPack, type PackConfigAccount } from "./packs";
import { readPackLookupTable } from "./lookupTable";
import { sendAndConfirmTransfer } from "./sendTokens";

/**
 * The sealed pack: bought as an asset, opened later by burning it.
 *
 * The other half of the pack economy. `open_booster` pays and draws in one
 * go; this pays and draws nothing, handing back a cNFT that IS the unopened
 * pack. It can be held, gifted or resold, and the city has no further say
 * over it until somebody burns it to open it.
 *
 * ── Why the metadata is rebuilt rather than fetched ────────────────────
 *
 * Opening needs the exact `MetadataArgs` the asset was minted with, because
 * Bubblegum hashes it to find the leaf. Reading it back from an indexer and
 * reassembling it is a long chain of places to be subtly wrong, and being
 * wrong produces a proof that simply does not burn.
 *
 * We minted it, so we can rebuild it: every field comes from MintConfig and
 * the pack id, through the same shape the program used. Only the PROOF has
 * to come from outside, because only an indexer knows the tree's current
 * shape.
 */

const BUBBLEGUM_PROGRAM_ID = new PublicKey("BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY");
const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const COMPRESSION_PROGRAM_ID = new PublicKey("cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK");
const LOG_WRAPPER_ID = new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

// ── Borsh, by hand, for the one struct that has to match exactly ───────────

function u32le(n: number): Buffer {
  const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b;
}
function borshString(s: string): Buffer {
  const body = Buffer.from(s, "utf8");
  return Buffer.concat([u32le(body.length), body]);
}

/**
 * `MetadataArgs`, serialised the way the program will deserialise it.
 *
 * `collection.verified` is TRUE here and FALSE in the program that minted it,
 * and that is not a mistake in either place. `mint_pack` passes false, and
 * Bubblegum's MintToCollectionV1 sets it to true itself before hashing the
 * leaf, because setting it is the whole point of that instruction. The hash
 * on chain is therefore of the VERIFIED version, so that is what has to be
 * rebuilt to match it.
 */
export function encodeMetadataArgs(args: {
  name: string;
  symbol: string;
  uri: string;
  sellerFeeBasisPoints: number;
  collectionMint: PublicKey;
  creator: PublicKey;
}): Buffer {
  const sfbp = Buffer.alloc(2);
  sfbp.writeUInt16LE(args.sellerFeeBasisPoints, 0);
  return Buffer.concat([
    borshString(args.name),
    borshString(args.symbol),
    borshString(args.uri),
    sfbp,
    Buffer.from([1]),            // primary_sale_happened = true
    Buffer.from([0]),            // is_mutable = false
    Buffer.from([0]),            // edition_nonce: None
    Buffer.from([1, 0]),         // token_standard: Some(NonFungible)
    Buffer.concat([             // collection: Some
      Buffer.from([1, 1]),       //   Some, verified = true (Bubblegum set it)
      args.collectionMint.toBuffer(),
    ]),
    Buffer.from([0]),            // uses: None
    Buffer.from([0]),            // token_program_version: Original
    u32le(1),                    // creators: one
    args.creator.toBuffer(),
    Buffer.from([0]),            //   verified = false
    Buffer.from([100]),          //   share = 100
  ]);
}

/** The metadata `mint_pack` wrote for a sealed pack of this id. */
export function sealedPackMetadata(config: MintConfigAccount, packId: number): Buffer {
  return encodeMetadataArgs({
    name: `SolanaCity Pack #${packId}`,
    symbol: config.symbol,
    uri: `${config.baseUri}pack-${packId}.json`,
    sellerFeeBasisPoints: config.sellerFeeBasisPoints,
    collectionMint: config.collectionMint,
    creator: config.royaltyRecipient,
  });
}

// ── Buying one sealed ──────────────────────────────────────────────────────

function treeAccounts(mintConfig: MintConfigAccount) {
  const [treeConfig] = PublicKey.findProgramAddressSync(
    [mintConfig.merkleTree.toBuffer()], BUBBLEGUM_PROGRAM_ID,
  );
  const [collectionMetadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(),
     mintConfig.collectionMint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID,
  );
  const [collectionEdition] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(),
     mintConfig.collectionMint.toBuffer(), Buffer.from("edition")],
    TOKEN_METADATA_PROGRAM_ID,
  );
  const [bubblegumSigner] = PublicKey.findProgramAddressSync(
    [Buffer.from("collection_cpi")], BUBBLEGUM_PROGRAM_ID,
  );
  return { treeConfig, collectionMetadata, collectionEdition, bubblegumSigner };
}

export function buildMintPackIx(params: {
  payer: PublicKey;
  pack: OnChainPack;
  config: PackConfigAccount;
  mintConfig: MintConfigAccount;
}): TransactionInstruction {
  const { payer, pack, config, mintConfig } = params;
  const t = treeAccounts(mintConfig);
  // The pack id, then the price shown as a cap (audit R-40).
  const price = Buffer.alloc(8);
  price.writeBigUInt64LE(pack.price);
  const data = Buffer.concat([ixDiscriminator("mint_pack"), Buffer.from([pack.id]), price]);

  return new TransactionInstruction({
    programId: SOL_CITY_COLLECTIBLES_PROGRAM_ID,
    keys: [
      { pubkey: payer,                           isSigner: true,  isWritable: true  },
      { pubkey: derivePackConfigPDA()[0],        isSigner: false, isWritable: false },
      { pubkey: deriveSeasonDropsPDA(pack.season)[0], isSigner: false, isWritable: false },
      { pubkey: deriveMintConfigPDA(),           isSigner: false, isWritable: false },
      { pubkey: deriveMintAuthorityPDA(),        isSigner: false, isWritable: false },
      { pubkey: getAssociatedTokenAddressSync(config.currencyMint, payer),
                                                 isSigner: false, isWritable: true  },
      { pubkey: config.treasuryTokenAccount,     isSigner: false, isWritable: true  },
      { pubkey: TOKEN_PROGRAM_ID,                isSigner: false, isWritable: false },
      { pubkey: t.treeConfig,                    isSigner: false, isWritable: true  },
      { pubkey: mintConfig.merkleTree,           isSigner: false, isWritable: true  },
      { pubkey: mintConfig.collectionMint,       isSigner: false, isWritable: false },
      { pubkey: t.collectionMetadata,            isSigner: false, isWritable: true  },
      { pubkey: t.collectionEdition,             isSigner: false, isWritable: false },
      { pubkey: t.bubblegumSigner,               isSigner: false, isWritable: false },
      { pubkey: LOG_WRAPPER_ID,                  isSigner: false, isWritable: false },
      { pubkey: COMPRESSION_PROGRAM_ID,          isSigner: false, isWritable: false },
      { pubkey: TOKEN_METADATA_PROGRAM_ID,       isSigner: false, isWritable: false },
      { pubkey: BUBBLEGUM_PROGRAM_ID,            isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,         isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Buys `count` sealed packs, asking the wallet ONCE.
 *
 * Unlike opening, this has no ceiling in the program: nothing is drawn, so
 * there is no callback to fit in one transaction and no single draw slot to
 * compete for. What limits it is compute, the same as minting items, so the
 * order is chunked and the wallet signs the batch together.
 */
export async function buySealedPacks(args: {
  wallet: PublicKey;
  pack: OnChainPack;
  config: PackConfigAccount;
  mintConfig: MintConfigAccount;
  count: number;
  signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>;
  conn?: Connection;
  perTx?: number;
}): Promise<{ sent: number }> {
  const conn = args.conn ?? baseConnection();
  const per = Math.max(1, args.perTx ?? 3);
  const total = Math.max(1, Math.round(args.count));

  const { blockhash } = await conn.getLatestBlockhash();
  const txs: Transaction[] = [];
  for (let done = 0; done < total; done += per) {
    const inThis = Math.min(per, total - done);
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: args.wallet });
    for (let i = 0; i < inThis; i++) {
      tx.add(buildMintPackIx({
        payer: args.wallet, pack: args.pack,
        config: args.config, mintConfig: args.mintConfig,
      }));
    }
    txs.push(tx);
  }

  const ready = await Promise.all(txs.map((t) => prepareWalletTx(conn, t)));
  const signed = await args.signAllTransactions(ready);
  let sent = 0;
  for (const tx of signed) {
    try {
      await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      sent++;
    } catch {
      // Reported by count rather than thrown: some of the order landing is a
      // better outcome than all of it being rolled back in the client's head.
    }
  }
  return { sent };
}

// ── Opening one ────────────────────────────────────────────────────────────

export interface AssetProof {
  root: PublicKey;
  proof: PublicKey[];
  nodeIndex: number;
  /**
   * The tree the asset actually lives in, as the indexer reports it.
   *
   * Not assumed to be the config's tree: after `set_mint_tree` a pack bought
   * earlier still lives in the tree it was minted into, and it has to be
   * burned THERE. Using the current tree would produce a proof that does not
   * burn, and the pack would look unopenable.
   */
  tree: PublicKey;
}

/**
 * The tree's proof for one asset, from the indexer.
 *
 * The only part of opening that cannot be derived locally: the tree's shape
 * changes with every mint anybody makes, so only something watching it knows
 * the current path.
 *
 * Only the root and the path come from here. The LEAF INDEX deliberately
 * does not: `node_index` counts every node in the tree, and converting it
 * needs the tree's depth, which cannot be read off the proof's length once
 * the tree has a canopy, because a canopy is exactly what makes the proof
 * shorter than the depth. The asset's own `leaf_id` is the index, and it is
 * read where the asset is, not here.
 */
export async function getAssetProof(conn: Connection, assetId: PublicKey): Promise<AssetProof> {
  const res = await fetch(conn.rpcEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: "proof", method: "getAssetProof",
      params: { id: assetId.toBase58() },
    }),
  });
  if (!res.ok) throw new Error(`the indexer answered ${res.status}`);
  const body = await res.json() as {
    result?: { root: string; proof: string[]; node_index: number; leaf: string; tree_id: string };
    error?: { message?: string };
  };
  if (body.error || !body.result) {
    throw new Error(body.error?.message ?? "no proof for that asset");
  }
  const tree = new PublicKey(body.result.tree_id);
  const full = body.result.proof.map((p) => new PublicKey(p));
  return {
    root: new PublicKey(body.result.root),
    proof: trimProof(full, await treeShape(conn, tree)),
    nodeIndex: body.result.node_index,
    tree,
  };
}

// ── The canopy ─────────────────────────────────────────────────────────────

/** What a tree account says about its own proofs. */
export interface TreeShape { maxDepth: number; canopyDepth: number }

/**
 * Depth and canopy, read from a ConcurrentMerkleTree account's bytes.
 *
 * spl-account-compression's layout: a 56-byte header (account type, header
 * version, max_buffer_size u32 at 2, max_depth u32 at 6, authority, creation
 * slot, padding), then the tree itself (three u64 counters, `buffer` change
 * logs of root + path + index, and the rightmost proof), then the canopy,
 * which is every node of its top levels: 2^(c+1) - 2 of them for depth c.
 * The same arithmetic as the library's getCanopyDepth, without shipping it.
 */
export function treeShapeOf(data: Uint8Array): TreeShape {
  const buf = Buffer.from(data);
  const maxBuffer = buf.readUInt32LE(2);
  const maxDepth = buf.readUInt32LE(6);
  const header = 56;
  const changeLog = 32 + 32 * maxDepth + 8;
  const rightmost = 32 * maxDepth + 40;
  const treeBytes = 24 + maxBuffer * changeLog + rightmost;
  const canopyBytes = buf.length - header - treeBytes;
  const canopyDepth = canopyBytes > 0 ? Math.max(0, Math.log2(canopyBytes / 32 + 2) - 1) : 0;
  return { maxDepth, canopyDepth: Number.isInteger(canopyDepth) ? canopyDepth : 0 };
}

/**
 * The proof with the nodes the canopy already holds taken off.
 *
 * The indexer returns the WHOLE path, leaf to root, one node per level: 20 on
 * our depth-20 tree. Bubblegum only needs the levels below the canopy (12 at
 * canopy 8) and fills the rest from the account. The 8 extra accounts were
 * what pushed opening a sealed pack past the transaction size limit
 * (devnet, 2026-11-05: 1575 bytes against 1232).
 */
export function trimProof(proof: PublicKey[], shape: TreeShape | null): PublicKey[] {
  if (!shape) return proof;
  return proof.slice(0, Math.max(0, shape.maxDepth - shape.canopyDepth));
}

const shapes = new Map<string, TreeShape>();

/** A tree's shape never changes after creation, so it is read once. */
async function treeShape(conn: Connection, tree: PublicKey): Promise<TreeShape | null> {
  const key = tree.toBase58();
  const known = shapes.get(key);
  if (known) return known;
  // Only the header and the sizes matter, but the canopy is measured from the
  // account's length, so the account is read whole (60 KB, once).
  const info = await conn.getAccountInfo(tree);
  if (!info) return null;
  const shape = treeShapeOf(info.data);
  shapes.set(key, shape);
  return shape;
}

/**
 * Every account the pack instructions name that is the same for every
 * player: what scripts/lookup-table-setup.ts puts in the lookup table.
 *
 * The program ids that are INVOKED at the top level (ours, ComputeBudget)
 * are left out, because a transaction has to name those itself.
 */
export function packLookupTableAddresses(args: {
  config: PackConfigAccount;
  mintConfig: MintConfigAccount;
  seasons: number[];
}): PublicKey[] {
  const { config, mintConfig, seasons } = args;
  const t = treeAccounts(mintConfig);
  const all = [
    derivePackConfigPDA()[0],
    deriveMintConfigPDA(),
    deriveMintAuthorityPDA(),
    deriveVrfIdentityPDA()[0],
    ...seasons.map((s) => deriveSeasonDropsPDA(s)[0]),
    config.treasuryTokenAccount,
    config.currencyMint,
    mintConfig.merkleTree,
    t.treeConfig,
    mintConfig.collectionMint,
    t.collectionMetadata,
    t.collectionEdition,
    t.bubblegumSigner,
    LOG_WRAPPER_ID,
    COMPRESSION_PROGRAM_ID,
    BUBBLEGUM_PROGRAM_ID,
    TOKEN_METADATA_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    SystemProgram.programId,
    VRF_QUEUE_DEVNET,
    VRF_PROGRAM_ID,
    SYSVAR_SLOT_HASHES_PUBKEY,
  ];
  const seen = new Set<string>();
  return all.filter((k) => !seen.has(k.toBase58()) && !!seen.add(k.toBase58()));
}

export function buildOpenPackFromAssetIx(params: {
  opener: PublicKey;
  pack: OnChainPack;
  mintConfig: MintConfigAccount;
  clientSeed: Uint8Array;
  proof: AssetProof;
  nonce: number;
  metadata: Buffer;
}): TransactionInstruction {
  const { opener, pack, mintConfig, clientSeed, proof, nonce, metadata } = params;
  // The tree the pack lives in, which after a rotation is not the config's.
  const tree = proof.tree;
  const [treeConfig] = PublicKey.findProgramAddressSync(
    [tree.toBuffer()], BUBBLEGUM_PROGRAM_ID,
  );

  const seed = Buffer.alloc(32);
  Buffer.from(clientSeed).copy(seed, 0, 0, 32);
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(BigInt(nonce), 0);
  // Bubblegum's `index` is the leaf's position, and its `nonce` is the
  // tree's mint counter. For a tree that is only ever appended to, which is
  // every tree this program mints into, they are the same number, and it is
  // the one the indexer reports as leaf_id.
  const leafBuf = Buffer.alloc(4);
  leafBuf.writeUInt32LE(nonce, 0);

  const data = Buffer.concat([
    ixDiscriminator("open_pack_from_asset"),
    Buffer.from([pack.id]),
    seed,
    proof.root.toBuffer(),
    nonceBuf,
    leafBuf,
    metadata,
  ]);

  return new TransactionInstruction({
    programId: SOL_CITY_COLLECTIBLES_PROGRAM_ID,
    keys: [
      { pubkey: opener,                          isSigner: true,  isWritable: true  },
      { pubkey: deriveUnlockPDA(opener)[0],      isSigner: false, isWritable: true  },
      { pubkey: derivePackConfigPDA()[0],        isSigner: false, isWritable: false },
      { pubkey: deriveSeasonDropsPDA(pack.season)[0], isSigner: false, isWritable: false },
      { pubkey: deriveMintConfigPDA(),           isSigner: false, isWritable: false },
      { pubkey: treeConfig,                      isSigner: false, isWritable: true  },
      { pubkey: tree,                            isSigner: false, isWritable: true  },
      { pubkey: LOG_WRAPPER_ID,                  isSigner: false, isWritable: false },
      { pubkey: COMPRESSION_PROGRAM_ID,          isSigner: false, isWritable: false },
      { pubkey: BUBBLEGUM_PROGRAM_ID,            isSigner: false, isWritable: false },
      { pubkey: VRF_QUEUE_DEVNET,                isSigner: false, isWritable: true  },
      { pubkey: deriveVrfIdentityPDA()[0],       isSigner: false, isWritable: true  },
      { pubkey: VRF_PROGRAM_ID,                  isSigner: false, isWritable: false },
      { pubkey: SYSVAR_SLOT_HASHES_PUBKEY,       isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,         isSigner: false, isWritable: false },
      // `accepted_tree`: the program id when the pack is in the current tree,
      // the old tree's marker when it was minted before a rotation.
      { pubkey: acceptedTreeSlot(tree, mintConfig), isSigner: false, isWritable: false },
      // The proof: one node per tree level the canopy does not already hold.
      ...proof.proof.map((node) => ({
        pubkey: node, isSigner: false, isWritable: false,
      })),
    ],
    data,
  });
}

/**
 * Burns a sealed pack and asks for its draw, in one approval.
 *
 * The same shape as buying one to open now, because from the opener's side it
 * is the same thing: something is spent, the oracle decides, and the items
 * are minted once the draw lands (a second approval, through settleMints).
 *
 * The UnlockState is created first if the opener has never had one, which is
 * the normal case for somebody who was GIFTED a pack: they may never have
 * bought anything in the city at all.
 *
 * The opening is a v0 transaction against the pack lookup table: written out
 * in full it does not fit (lookupTable.ts). It is signed alone, not in a batch
 * with the mints: see buyPack for why that batch was refused.
 */
export async function openSealedPack(args: {
  wallet: PublicKey;
  assetId: PublicKey;
  nonce: number;
  pack: OnChainPack;
  mintConfig: MintConfigAccount;
  signAllTransactions: SignAnyTx;
  conn?: Connection;
}): Promise<{
  signature: string;
  /** Always null now; kept so callers hand it to settleMints unchanged. */
  presignedMints: SignedMints | null;
  leftover: number[];
  /** What the opener owned before the burn, for awaitDraw. Read here,
   *  BEFORE sending: an oracle that answers quickly would otherwise land
   *  first, and the reveal would show nothing new. */
  before: Set<number>;
}> {
  const conn = args.conn ?? baseConnection();
  const { tx: open, before } = await buildOpenSealedPackTx({ ...args, conn });

  // Anything an earlier mint left behind comes first on chain, so it has to
  // be counted here or this pack's last items are left out of the mint.
  const leftover = await pendingMintIndices(conn, args.wallet);

  // The blockhash is taken again right before the wallet opens, as buyPack
  // does: the reads and the simulation above take time it does not have to
  // spare. Nothing is signed yet, so this is free.
  const fresh = await conn.getLatestBlockhash();
  open.message.recentBlockhash = fresh.blockhash;
  const asked = { blockhash: fresh.blockhash, message: open.message.serialize() };
  const [signedTx] = await atStep("wallet", args.signAllTransactions([open]));
  const kept = await atStep("wallet", checkWalletKept(conn, asked, signedTx));

  // Rebroadcast and confirmed by polling, the same as a pack bought to open
  // now: one send through a lagging RPC was refused as "Blockhash not found"
  // (sendAndConfirmTransfer, devnet 2026-11-05).
  const signature = await atStep("network", sendAndConfirmTransfer({
    connection: conn, signed: signedTx, lastValidBlockHeight: fresh.lastValidBlockHeight, context: kept,
  }));
  return { signature, presignedMints: null, leftover, before };
}

/** A wallet's signAllTransactions, for a batch that mixes v0 and legacy. */
export type SignAnyTx = (
  txs: (Transaction | VersionedTransaction)[],
) => Promise<(Transaction | VersionedTransaction)[]>;

/**
 * The opening transaction, built, sized and simulated, but not signed.
 *
 * Separate from openSealedPack so scripts/sealed-open-smoke.ts can check the
 * exact transaction a player would be asked to sign against a real pack on
 * chain, without anyone's key.
 */
export async function buildOpenSealedPackTx(args: {
  wallet: PublicKey;
  assetId: PublicKey;
  nonce: number;
  pack: OnChainPack;
  mintConfig: MintConfigAccount;
  conn: Connection;
  clientSeed?: Uint8Array;
}): Promise<{ tx: VersionedTransaction; before: Set<number>; proofNodes: number }> {
  const { conn } = args;
  const unlockPda = deriveUnlockPDA(args.wallet)[0];
  const [proof, table, unlock] = await Promise.all([
    getAssetProof(conn, args.assetId),
    readPackLookupTable(conn),
    conn.getAccountInfo(unlockPda),
  ]);

  const clientSeed = args.clientSeed ?? new Uint8Array(32);
  if (!args.clientSeed) (globalThis.crypto ?? ({} as Crypto)).getRandomValues?.(clientSeed);

  const ixs: TransactionInstruction[] = [];
  if (!unlock) ixs.push(buildInitUnlockStateIx(args.wallet));
  ixs.push(buildOpenPackFromAssetIx({
    opener: args.wallet,
    pack: args.pack,
    mintConfig: args.mintConfig,
    clientSeed,
    proof,
    nonce: args.nonce,
    metadata: sealedPackMetadata(args.mintConfig, args.pack.id),
  }));

  const { blockhash } = await conn.getLatestBlockhash();
  const tx = await prepareWalletTxV0(conn, {
    payer: args.wallet, blockhash, instructions: ixs, lookupTables: table ? [table] : [],
  });
  const before = new Set(unlock ? decodeUnlockState(unlock.data)?.owned ?? [] : []);
  return { tx, before, proofNodes: proof.proof.length };
}

/**
 * The sealed packs this wallet holds, read from the indexer.
 *
 * Told apart from cosmetics by their URI, which is the only thing that
 * distinguishes the two on chain: `<base>pack-<id>.json` against
 * `<base><index>.json`.
 */
export async function heldSealedPacks(
  conn: Connection,
  wallet: PublicKey,
  mintConfig: MintConfigAccount,
): Promise<{ assetId: PublicKey; packId: number; nonce: number }[]> {
  const res = await fetch(conn.rpcEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: "packs", method: "getAssetsByOwner",
      params: { ownerAddress: wallet.toBase58(), page: 1, limit: 1000 },
    }),
  });
  if (!res.ok) throw new Error(`the indexer answered ${res.status}`);
  const body = await res.json() as {
    result?: { items?: {
      id: string;
      burnt?: boolean;
      compression?: { leaf_id?: number };
      content?: { json_uri?: string };
    }[] };
  };

  const prefix = `${mintConfig.baseUri}pack-`;
  const out: { assetId: PublicKey; packId: number; nonce: number }[] = [];
  for (const item of body.result?.items ?? []) {
    // The owner listing keeps an opened pack for a minute or more after its
    // burn, marked burnt (devnet, 2026-11-05). Listed, it looked unopened, and
    // opening it again could only fail.
    if (item.burnt) continue;
    const uri = item.content?.json_uri ?? "";
    if (!uri.startsWith(prefix)) continue;
    const packId = Number(uri.slice(prefix.length).replace(/\.json$/, ""));
    if (!Number.isInteger(packId)) continue;
    out.push({
      assetId: new PublicKey(item.id),
      packId,
      // The nonce Bubblegum hashed into the leaf id. The indexer calls it
      // leaf_id, and it is NOT the proof's node index.
      nonce: item.compression?.leaf_id ?? 0,
    });
  }
  return out;
}
