import {
  Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram,
} from "@solana/web3.js";
import {
  SOL_CITY_COLLECTIBLES_PROGRAM_ID, deriveUnlockPDA, decodeUnlockState,
} from "./program";
import { ixDiscriminator } from "./instructions";
import { baseConnection } from "./packs";

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

/** Catalog indices this wallet holds an asset for. Minting is once per index. */
export async function mintedIndices(conn: Connection, wallet: PublicKey): Promise<number[]> {
  const info = await conn.getAccountInfo(deriveUnlockPDA(wallet)[0]);
  if (!info) return [];
  return decodeUnlockState(info.data)?.minted ?? [];
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
  const { payer, index, config } = params;
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

  const data = Buffer.alloc(10);
  ixDiscriminator("mint_unlock").copy(data, 0);
  data.writeUInt16LE(index, 8);

  return new TransactionInstruction({
    programId: SOL_CITY_COLLECTIBLES_PROGRAM_ID,
    keys: [
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
    ],
    data,
  });
}

export type SignTx = (tx: Transaction) => Promise<Transaction>;

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
  const signed = await args.signTransaction(tx);
  const signature = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false });

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if ((await mintedIndices(conn, args.wallet)).includes(args.index)) return { signature };
    const st = (await conn.getSignatureStatuses([signature])).value[0];
    if (st?.err) throw new Error(`The mint failed on chain: ${JSON.stringify(st.err)}`);
  }
  throw new Error("Sent, but the asset has not appeared yet. It may still land.");
}
