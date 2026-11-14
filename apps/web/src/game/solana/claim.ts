import {
  Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { SOL_CITY_COLLECTIBLES_PROGRAM_ID, deriveUnlockPDA } from "./program";
import { ixDiscriminator, buildInitUnlockStateIx } from "./instructions";
import { prepareWalletTx } from "./walletTx";
import {
  deriveMintConfigPDA, deriveWearLogPDA, decodeWearLog, acceptedTreeSlot,
  type MintConfigAccount,
} from "./mint";
import { encodeMetadataArgs, getAssetProof, type AssetProof } from "./sealedPacks";
import { awaitTransfer } from "./sendTokens";

/**
 * Claiming a cosmetic bought from somebody else, so it can be worn.
 *
 * A cNFT bought on a marketplace is in the buyer's wallet and nowhere in our
 * program, and since outfits fail closed (audit R-10) an item the program
 * does not know is an item nobody else sees on you. The claim proves the
 * asset is held, adds the index to the claimer's unlocks, and (audit R-21)
 * takes it away from whoever held it before, with no signature from them:
 * one asset, one wearer.
 */

const COMPRESSION_PROGRAM_ID = new PublicKey("cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK");

/** A cosmetic asset the wallet holds, as the indexer reports it. */
export interface HeldCosmetic {
  index: number;
  assetId: PublicKey;
  /** Bubblegum's nonce for the leaf, which is also its leaf index. */
  leafId: number;
}

/**
 * Cosmetic assets of our collection this wallet holds right now.
 *
 * Throws on a failure rather than returning empty: "the indexer is down" and
 * "they hold nothing" must not look alike.
 */
export async function heldCosmetics(
  conn: Connection, wallet: PublicKey, config: MintConfigAccount,
): Promise<HeldCosmetic[]> {
  const res = await fetch(conn.rpcEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: "held-cosmetics", method: "getAssetsByOwner",
      params: {
        ownerAddress: wallet.toBase58(), page: 1, limit: 1000,
        displayOptions: { showUnverifiedCollections: true },
      },
    }),
  });
  if (!res.ok) throw new Error(`the indexer answered ${res.status}`);
  const body = await res.json() as {
    result?: { items?: {
      id: string;
      compression?: { leaf_id?: number };
      grouping?: { group_key: string; group_value: string }[];
      content?: { json_uri?: string };
    }[] };
    error?: { message?: string };
  };
  if (body.error) throw new Error(body.error.message ?? "the indexer refused");
  const collection = config.collectionMint.toBase58();
  const out: HeldCosmetic[] = [];
  for (const item of body.result?.items ?? []) {
    if (!item.grouping?.some((g) => g.group_key === "collection" && g.group_value === collection)) continue;
    const uri = item.content?.json_uri ?? "";
    if (!uri.startsWith(config.baseUri)) continue;
    // A pack is `<base>pack-<id>.json`; a cosmetic is `<base><index>.json`.
    const index = Number(uri.slice(config.baseUri.length).replace(/\.json$/, ""));
    if (!Number.isInteger(index) || index < 0) continue;
    out.push({ index, assetId: new PublicKey(item.id), leafId: item.compression?.leaf_id ?? 0 });
  }
  return out;
}

/**
 * Whose wear-right this asset backs today, if anybody's.
 *
 * Every wallet named in the asset's history is a candidate (every account of
 * every transaction that touched it, not only the signers: a sponsored mint
 * is signed by the sponsor, and the owner is only an account in it), and the
 * one whose WearLog names this asset is the answer. There is exactly one: the
 * mint writes the minter's log and a claim moves the entry from the old log
 * to the new.
 *
 * Null when it cannot be found (history unreadable, or an asset minted before
 * logs existed). The program now requires the previous holder (audit r2,
 * R2-06), so a null here means the claim cannot be sent yet.
 */
export async function findPreviousHolder(
  conn: Connection, assetId: PublicKey, claimer: PublicKey,
): Promise<PublicKey | null> {
  try {
    const res = await fetch(conn.rpcEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: "asset-history", method: "getSignaturesForAsset",
        params: { id: assetId.toBase58(), page: 1, limit: 100 },
      }),
    });
    const body = await res.json() as { result?: { items?: [string, string][] } };
    const sigs = (body.result?.items ?? []).map(([sig]) => sig);
    const candidates = new Map<string, PublicKey>();
    for (const sig of sigs) {
      const tx: VersionedTransactionResponse | null = await conn.getTransaction(sig, {
        maxSupportedTransactionVersion: 0,
      });
      if (!tx) continue;
      for (const key of tx.transaction.message.staticAccountKeys) {
        if (!key.equals(claimer)) candidates.set(key.toBase58(), key);
      }
    }
    const wallets = [...candidates.values()];
    // getMultipleAccounts takes 100 at a time.
    for (let start = 0; start < wallets.length; start += 100) {
      const chunk = wallets.slice(start, start + 100);
      const logs = await conn.getMultipleAccountsInfo(chunk.map(deriveWearLogPDA));
      for (let i = 0; i < chunk.length; i++) {
        const info = logs[i];
        if (!info || !info.owner.equals(SOL_CITY_COLLECTIBLES_PROGRAM_ID)) continue;
        const log = decodeWearLog(info.data);
        if (log?.entries.some((e) => e.asset.equals(assetId))) return chunk[i];
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** `claim_owned_from_asset`, in the order the program declares its accounts. */
export function buildClaimOwnedIx(params: {
  claimer: PublicKey;
  item: HeldCosmetic;
  proof: AssetProof;
  config: MintConfigAccount;
  /** The wallet whose right this asset backs today. Required (R2-06). */
  previousHolder: PublicKey;
}): TransactionInstruction {
  const { claimer, item, proof, config, previousHolder } = params;
  const nonce = Buffer.alloc(8);
  nonce.writeBigUInt64LE(BigInt(item.leafId), 0);
  const leafIndex = Buffer.alloc(4);
  leafIndex.writeUInt32LE(item.leafId, 0);
  const index = Buffer.alloc(2);
  index.writeUInt16LE(item.index, 0);
  // The cosmetic's metadata exactly as mint_unlock wrote it, which is what the
  // leaf hashes and what the program rebuilds the URI from.
  const metadata = encodeMetadataArgs({
    name: `SolanaCity #${item.index}`,
    symbol: config.symbol,
    uri: `${config.baseUri}${item.index}.json`,
    sellerFeeBasisPoints: config.sellerFeeBasisPoints,
    collectionMint: config.collectionMint,
    creator: config.royaltyRecipient,
  });

  const prevLog = deriveWearLogPDA(previousHolder);
  const prevUnlocks = deriveUnlockPDA(previousHolder)[0];

  return new TransactionInstruction({
    programId: SOL_CITY_COLLECTIBLES_PROGRAM_ID,
    keys: [
      { pubkey: claimer,                          isSigner: true,  isWritable: true  },
      { pubkey: deriveUnlockPDA(claimer)[0],      isSigner: false, isWritable: true  },
      { pubkey: deriveMintConfigPDA(),            isSigner: false, isWritable: false },
      { pubkey: proof.tree,                       isSigner: false, isWritable: false },
      { pubkey: COMPRESSION_PROGRAM_ID,           isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,          isSigner: false, isWritable: false },
      { pubkey: acceptedTreeSlot(proof.tree, config), isSigner: false, isWritable: false },
      { pubkey: deriveWearLogPDA(claimer),        isSigner: false, isWritable: true  },
      { pubkey: prevLog,                          isSigner: false, isWritable: true  },
      { pubkey: prevUnlocks,                      isSigner: false, isWritable: true  },
      ...proof.proof.map((node) => ({ pubkey: node, isSigner: false, isWritable: false })),
    ],
    data: Buffer.concat([
      ixDiscriminator("claim_owned_from_asset"), index, proof.root.toBuffer(), nonce, leafIndex, metadata,
    ]),
  });
}

/**
 * Claims one held cosmetic: one wallet approval, the one the player gives to
 * be able to wear what they bought. Returns who lost the right, if anybody,
 * so the caller can bring that player's outfit snapshot up to date.
 */
export async function claimCosmetic(args: {
  conn: Connection;
  wallet: PublicKey;
  item: HeldCosmetic;
  config: MintConfigAccount;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
}): Promise<{ signature: string; previousHolder: PublicKey }> {
  const { conn, wallet, item, config } = args;
  const [proof, previousHolder] = await Promise.all([
    getAssetProof(conn, item.assetId),
    findPreviousHolder(conn, item.assetId, wallet),
  ]);
  // The program will not take a claim without it (R2-06), so say so before
  // asking the wallet to sign something that cannot land.
  if (!previousHolder) {
    throw new Error("Could not find who held this item before. Try again in a minute.");
  }
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet });
  // A buyer who never opened a pack has no unlock account yet. It goes in
  // the same approval rather than costing a second one.
  if (!(await conn.getAccountInfo(deriveUnlockPDA(wallet)[0]))) {
    tx.add(buildInitUnlockStateIx(wallet));
  }
  tx.add(buildClaimOwnedIx({ claimer: wallet, item, proof, config, previousHolder }));
  const signed = await args.signTransaction(await prepareWalletTx(conn, tx));
  const signature = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  await awaitTransfer(conn, signature, lastValidBlockHeight);
  return { signature, previousHolder };
}
