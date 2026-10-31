/**
 * Sol City — create the cNFT collection and tree, and point the program at them.
 *
 *   npx tsx scripts/mint-setup.ts <admin-wallet.json>            # dry run
 *   npx tsx scripts/mint-setup.ts <admin-wallet.json> --send
 *
 * Four things, in this order, because each needs the one before it:
 *
 *   1. The collection NFT, a plain Token Metadata NFT with a master edition.
 *      Its UPDATE AUTHORITY is set to our program's PDA at creation, which is
 *      what lets the program verify items into it later. The admin pays and
 *      holds the token, but cannot change the collection afterwards.
 *   2. The merkle tree account, allocated at exactly the right size and handed
 *      to the account compression program.
 *   3. create_tree_config, which makes the tree a Bubblegum tree.
 *   4. set_tree_delegate, to our PDA. THIS is what makes minting trustless:
 *      Bubblegum will not mint without that signature, and the only thing that
 *      can produce it is mint_unlock, which checks the caller owns the index.
 *
 * Then init_mint_config on our own program, so it knows the tree, the
 * collection, the royalty recipient and the metadata base.
 *
 * NOT idempotent. Running it twice creates a second collection and a second
 * tree and leaves the first pair paid for. Check MintConfig before running.
 */
import { readFileSync } from "fs";
import {
  Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createInitializeMint2Instruction, createAssociatedTokenAccountInstruction,
  createMintToInstruction, getAssociatedTokenAddressSync,
  MINT_SIZE, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  createCreateMetadataAccountV3Instruction, createCreateMasterEditionV3Instruction,
  PROGRAM_ID as TOKEN_METADATA_PROGRAM_ID,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  createCreateTreeInstruction, createSetTreeDelegateInstruction,
  PROGRAM_ID as BUBBLEGUM_PROGRAM_ID,
} from "@metaplex-foundation/mpl-bubblegum";
import { sha256 } from "@noble/hashes/sha256";
import { devnetConnection, sendAndPoll } from "./_rpc";

// The COLLECTIBLES program, not the city one: packs, seasons, unlocks and
// the mint moved out on 2026-10-29. Deriving a PackConfig from the city id
// does not fail, it just points at an address nothing lives at.
const PROGRAM = new PublicKey("EptRxVBysFzJEz52r58c2yCkpDGvF55aBPj1eCkWaphz");
const COMPRESSION_PROGRAM = new PublicKey("cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK");
const LOG_WRAPPER = new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");

// ── The decisions, all changeable later ─────────────────────────────────────
//
// The tree can be replaced with set_mint_tree when it fills; the rest of these
// live in MintConfig and a future instruction can edit them. What CANNOT
// change is BASE_URI for anything already minted: a metadata URI is immutable,
// which is why it must not point at a host this project controls.
const COLLECTION_NAME = "SolanaCity Cosmetics";
const SYMBOL = "SOLCITY";
/** 500 = 5%. Marketplaces choose whether to honour it; the chain does not. */
const SELLER_FEE_BASIS_POINTS = 500;
/** Devnet: the donations wallet. Mainnet needs its own, see the checklist. */
const ROYALTY_RECIPIENT = new PublicKey("FSej8rHNsJhDBqJ7Ugi5uqmzFcw4fyXGBAvPW97vUExm");
const COLLECTION_URI = process.env.SOLCITY_COLLECTION_URI
  ?? "https://arweave.net/PLACEHOLDER-collection.json";
const BASE_URI = process.env.SOLCITY_BASE_URI ?? "https://arweave.net/PLACEHOLDER/";

/**
 * Tree shape. Depth 20 holds 1,048,576 assets and needs a 12-node proof,
 * which is what claim_owned_from_asset passes as remaining accounts.
 *
 * Sizes computed from spl-account-compression's own
 * getConcurrentMerkleTreeAccountSize, not from a remembered formula:
 *
 *   depth 20 canopy  8 ->  60,600 bytes, 12 proof nodes
 *   depth 20 canopy 10 -> 109,752 bytes, 10 proof nodes
 *   depth 17 canopy  8 ->  54,360 bytes,  9 proof nodes
 *   depth 14 canopy  8 ->  48,120 bytes,  6 proof nodes
 *
 * A deeper canopy stores more of the tree on chain so proofs get shorter, and
 * costs rent for it. 20/8 was the decision; at 5080 lamports a byte it is
 * about 0.31 SOL once, for a million cosmetics.
 */
const MAX_DEPTH = 20;
const MAX_BUFFER_SIZE = 64;
const CANOPY_DEPTH = 8;
const TREE_ACCOUNT_SIZE = 60_600;

const conn = devnetConnection();
const send = process.argv.includes("--send");

function load(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

function disc(name: string): Buffer {
  return Buffer.from(sha256(new TextEncoder().encode(`global:${name}`)).slice(0, 8));
}

function borshString(s: string): Buffer {
  const body = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(body.length);
  return Buffer.concat([len, body]);
}

const metadataPda = (mint: PublicKey) => PublicKey.findProgramAddressSync(
  [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
  TOKEN_METADATA_PROGRAM_ID,
)[0];

const editionPda = (mint: PublicKey) => PublicKey.findProgramAddressSync(
  [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer(), Buffer.from("edition")],
  TOKEN_METADATA_PROGRAM_ID,
)[0];

/**
 * The ProgramData account, which holds the upgrade authority.
 *
 * `init_pack_config` and `init_mint_config` now check that the signer IS
 * that authority: whoever calls first used to become admin, and on mainnet
 * that is a front-run worth taking, because the treasury account is set
 * there and nothing rotated it.
 */
function programDataPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
  )[0];
}

async function main() {
  const adminPath = process.argv[2];
  if (!adminPath || adminPath.startsWith("--")) throw new Error("Pass the admin wallet keypair path");
  const admin = load(adminPath);

  const [mintAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_authority")], PROGRAM,
  );
  const [mintConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_config")], PROGRAM,
  );
  const collectionMint = Keypair.generate();
  const tree = Keypair.generate();
  const [treeConfig] = PublicKey.findProgramAddressSync(
    [tree.publicKey.toBuffer()], BUBBLEGUM_PROGRAM_ID,
  );

  const treeRent = await conn.getMinimumBalanceForRentExemption(TREE_ACCOUNT_SIZE);
  console.log(`admin            ${admin.publicKey.toBase58()}`);
  console.log(`  balance        ${(await conn.getBalance(admin.publicKey)) / LAMPORTS_PER_SOL} SOL`);
  console.log(`mint authority   ${mintAuthority.toBase58()}  (PDA, signs every mint)`);
  console.log(`mint config      ${mintConfig.toBase58()}`);
  console.log(`collection       ${collectionMint.publicKey.toBase58()}  "${COLLECTION_NAME}" [${SYMBOL}]`);
  console.log(`tree             ${tree.publicKey.toBase58()}`);
  console.log(`  shape          depth ${MAX_DEPTH}, buffer ${MAX_BUFFER_SIZE}, canopy ${CANOPY_DEPTH}`);
  console.log(`  capacity       ${(2 ** MAX_DEPTH).toLocaleString()} assets, ${MAX_DEPTH - CANOPY_DEPTH}-node proofs`);
  console.log(`  rent           ${treeRent / LAMPORTS_PER_SOL} SOL for ${TREE_ACCOUNT_SIZE.toLocaleString()} bytes`);
  console.log(`royalties        ${SELLER_FEE_BASIS_POINTS / 100}% to ${ROYALTY_RECIPIENT.toBase58()}`);
  console.log(`base uri         ${BASE_URI}`);
  if (BASE_URI.includes("PLACEHOLDER")) {
    console.log(`  ^ PLACEHOLDER. A minted URI can never change, so set`);
    console.log(`    SOLCITY_BASE_URI to the real Arweave folder before --send.`);
  }

  const existing = await conn.getAccountInfo(mintConfig);
  if (existing) {
    console.log(`\nMintConfig already exists (${existing.data.length} bytes).`);
    console.log("init_mint_config would fail. Use set_mint_tree to move trees.");
    if (send) process.exit(1);
  }
  console.log(send ? "\nSENDING\n" : "\nDRY RUN - nothing is sent. Add --send.\n");
  if (!send) return;
  if (BASE_URI.includes("PLACEHOLDER")) {
    throw new Error("refusing to mint against a placeholder base URI");
  }

  // ── 1. The collection NFT ───────────────────────────────────────────────
  console.log("1. collection NFT");
  const ata = getAssociatedTokenAddressSync(collectionMint.publicKey, admin.publicKey);
  await sendAndPoll(conn, new Transaction()
    .add(SystemProgram.createAccount({
      fromPubkey: admin.publicKey,
      newAccountPubkey: collectionMint.publicKey,
      lamports: await conn.getMinimumBalanceForRentExemption(MINT_SIZE),
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }))
    .add(createInitializeMint2Instruction(collectionMint.publicKey, 0, admin.publicKey, admin.publicKey))
    .add(createAssociatedTokenAccountInstruction(admin.publicKey, ata, admin.publicKey, collectionMint.publicKey))
    .add(createMintToInstruction(collectionMint.publicKey, ata, admin.publicKey, 1)),
    [admin, collectionMint]);
  console.log("  mint ok");

  await sendAndPoll(conn, new Transaction()
    .add(createCreateMetadataAccountV3Instruction({
      metadata: metadataPda(collectionMint.publicKey),
      mint: collectionMint.publicKey,
      mintAuthority: admin.publicKey,
      payer: admin.publicKey,
      // The PDA, from the start. Nobody holds a key that can change this
      // collection afterwards, and it is what the program signs as.
      updateAuthority: mintAuthority,
    }, {
      createMetadataAccountArgsV3: {
        data: {
          name: COLLECTION_NAME,
          symbol: SYMBOL,
          uri: COLLECTION_URI,
          sellerFeeBasisPoints: SELLER_FEE_BASIS_POINTS,
          creators: [{ address: ROYALTY_RECIPIENT, verified: false, share: 100 }],
          collection: null,
          uses: null,
        },
        isMutable: true,
        collectionDetails: { __kind: "V1", size: 0 },
      },
    }))
    .add(createCreateMasterEditionV3Instruction({
      edition: editionPda(collectionMint.publicKey),
      mint: collectionMint.publicKey,
      updateAuthority: mintAuthority,
      mintAuthority: admin.publicKey,
      payer: admin.publicKey,
      metadata: metadataPda(collectionMint.publicKey),
    }, { createMasterEditionArgs: { maxSupply: 0 } })),
    [admin]);
  console.log("  metadata + master edition ok\n");

  // ── 2 and 3. The tree ───────────────────────────────────────────────────
  console.log("2. merkle tree");
  await sendAndPoll(conn, new Transaction()
    .add(SystemProgram.createAccount({
      fromPubkey: admin.publicKey,
      newAccountPubkey: tree.publicKey,
      lamports: treeRent,
      space: TREE_ACCOUNT_SIZE,
      programId: COMPRESSION_PROGRAM,
    }))
    .add(createCreateTreeInstruction({
      treeAuthority: treeConfig,
      merkleTree: tree.publicKey,
      payer: admin.publicKey,
      treeCreator: admin.publicKey,
      logWrapper: LOG_WRAPPER,
      compressionProgram: COMPRESSION_PROGRAM,
    }, { maxDepth: MAX_DEPTH, maxBufferSize: MAX_BUFFER_SIZE, public: false })),
    [admin, tree]);
  console.log("  allocated and configured\n");

  // ── 4. The delegate, which is the whole point ───────────────────────────
  console.log("3. tree delegate -> the program's PDA");
  await sendAndPoll(conn, new Transaction()
    .add(createSetTreeDelegateInstruction({
      treeAuthority: treeConfig,
      treeCreator: admin.publicKey,
      newTreeDelegate: mintAuthority,
      merkleTree: tree.publicKey,
    })),
    [admin]);
  console.log("  ok: only sol-city can mint into this tree now\n");

  // ── 5. Tell the program ─────────────────────────────────────────────────
  console.log("4. init_mint_config");
  const data = Buffer.concat([
    disc("init_mint_config"),
    // Admin first, and it need not be the signer: the signer only has to be
    // the upgrade authority.
    (process.env.SOLCITY_MINT_ADMIN
      ? new PublicKey(process.env.SOLCITY_MINT_ADMIN)
      : admin.publicKey).toBuffer(),
    tree.publicKey.toBuffer(),
    collectionMint.publicKey.toBuffer(),
    ROYALTY_RECIPIENT.toBuffer(),
    Buffer.from(new Uint16Array([SELLER_FEE_BASIS_POINTS]).buffer),
    borshString(SYMBOL),
    borshString(BASE_URI),
  ]);
  await sendAndPoll(conn, new Transaction().add(new TransactionInstruction({
    programId: PROGRAM,
    keys: [
      { pubkey: admin.publicKey,         isSigner: true,  isWritable: true  },
      { pubkey: PROGRAM,                 isSigner: false, isWritable: false },
      { pubkey: programDataPda(PROGRAM), isSigner: false, isWritable: false },
      { pubkey: mintConfig,              isSigner: false, isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  })), [admin]);
  console.log("  ok\n");

  console.log("Keep these:");
  console.log(`  collection  ${collectionMint.publicKey.toBase58()}`);
  console.log(`  tree        ${tree.publicKey.toBase58()}`);
}

main().catch((err) => {
  console.error(`\n${(err as Error).message}`);
  const logs = (err as { logs?: string[] }).logs;
  if (logs) for (const l of logs.slice(-14)) console.error(`  ${l}`);
  process.exit(1);
});
