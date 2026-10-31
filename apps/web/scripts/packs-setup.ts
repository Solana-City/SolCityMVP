/**
 * Sol City — create the pack config and seed a season's drop table on devnet.
 *
 * Everything the pack economy needs that is not in the bytecode:
 *
 *   init_pack_config -> upsert_pack x3 -> init_season_drops -> append_season_drops x4
 *
 * Idempotent by design, because it will be run again. Accounts that already
 * exist are left alone, `upsert_pack` replaces a pack of the same id, and
 * `append_season_drops` deduplicates on chain, so re-running it writes nothing
 * new. What it will NOT do is edit a season that has already opened: the
 * program refuses that, which is what makes a pending pack safe.
 *
 *   npx tsx scripts/packs-setup.ts <path-to-admin-wallet.json>            # dry run
 *   npx tsx scripts/packs-setup.ts <path-to-admin-wallet.json> --send
 *
 * Nothing is sent without `--send`. The dry run prints every price, every
 * weight and every index it would write, which is the point: a season's drop
 * table stops being writable the moment the season opens, and the indices in
 * it name cosmetics that land in wallets.
 *
 * Env:
 *   SOLCITY_RPC         devnet RPC (default: public devnet)
 *   SOLCITY_TREASURY    wallet that receives pack payments (default: admin)
 *   SOLCITY_USDC_MINT   override the currency mint (default: devnet USDC)
 */
import { readFileSync } from "fs";
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { sha256 } from "@noble/hashes/sha256";
import { devnetConnection, sendAndPoll } from "./_rpc";
import { PACKS } from "../src/game/config/packs";
import { seasonDropLists } from "../src/game/config/seasonDrops";
import { CURRENT_SEASON, RARITY_ORDER } from "../src/game/collections/seasons";

// See scripts/_rpc.ts: the Helius key is origin-locked and a script has no
// origin, so without that header this falls through to api.devnet and gets
// rate-banned.
// The COLLECTIBLES program, not the city one: packs, seasons, unlocks and
// the mint moved out on 2026-10-29. Deriving a PackConfig from the city id
// does not fail, it just points at an address nothing lives at.
const PROGRAM = new PublicKey("EptRxVBysFzJEz52r58c2yCkpDGvF55aBPj1eCkWaphz");
const USDC_MINT = new PublicKey(
  process.env.SOLCITY_USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

/**
 * What each pack costs, in US dollars. Set 2026-10-24, to start with.
 *
 * Here rather than taken from `packs.ts` because the number in that table is
 * `priceSol`, which exists for the client-side preview and was never a price
 * anybody agreed to charge.
 *
 * Changing one is a transaction, not a deploy: edit, re-run with `--send`, and
 * `upsert_pack` replaces the pack in place. That is most of the reason the
 * pack table is an account at all.
 */
const PRICE_USD: Record<string, number> = {
  street: 3,
  city: 7,
  prime: 10,
};

/** USDC has six decimals. */
function usdc(dollars: number): bigint {
  return BigInt(Math.round(dollars * 1_000_000));
}

/** Indices per append. 200 u16 is 400 bytes, well inside a transaction. */
const APPEND_CHUNK = 200;

const conn = devnetConnection();
const send = process.argv.includes("--send");

function load(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

function disc(name: string): Buffer {
  return Buffer.from(sha256(new TextEncoder().encode(`global:${name}`)).slice(0, 8));
}

function u8(n: number): Buffer { return Buffer.from([n]); }

function u16(n: number): Buffer {
  const b = Buffer.alloc(2); b.writeUInt16LE(n); return b;
}

function u64(n: bigint): Buffer {
  const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b;
}

/** Borsh Vec<u16>: a 4-byte little-endian length, then the items. */
function vecU16(items: number[]): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32LE(items.length);
  return Buffer.concat([len, ...items.map(u16)]);
}

function configPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("pack_config")], PROGRAM)[0];
}

function dropsPda(season: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("season_drops"), u16(season)], PROGRAM,
  )[0];
}

async function exists(key: PublicKey): Promise<boolean> {
  return (await conn.getAccountInfo(key)) !== null;
}

async function submit(
  admin: Keypair, ixs: TransactionInstruction[], label: string,
): Promise<void> {
  if (!send) { console.log(`  skip ${label}  (dry run)`); return; }
  try {
    const sig = await sendAndPoll(conn, new Transaction().add(...ixs), [admin]);
    console.log(`  ok   ${label}  ${sig.slice(0, 12)}...`);
  } catch (err) {
    console.log(`  FAIL ${label}: ${(err as Error).message.split("\n")[0]}`);
    const logs = (err as { logs?: string[] }).logs;
    if (logs) {
      for (const line of logs.filter((l) => /Error|error|failed/.test(l)).slice(0, 4)) {
        console.log(`       ${line}`);
      }
    }
    throw err;
  }
}

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
  const walletPath = process.argv[2];
  if (!walletPath || walletPath.startsWith("--")) {
    throw new Error("Pass the admin wallet keypair path");
  }
  const admin = load(walletPath);
  const treasuryOwner = process.env.SOLCITY_TREASURY
    ? new PublicKey(process.env.SOLCITY_TREASURY)
    : admin.publicKey;
  const treasuryAta = getAssociatedTokenAddressSync(USDC_MINT, treasuryOwner);
  const config = configPda();
  const drops = dropsPda(CURRENT_SEASON);

  console.log(`rpc        ${conn.rpcEndpoint.replace(/api-key=.*/, "api-key=***")}`);
  console.log(`program    ${PROGRAM.toBase58()}`);
  console.log(`admin      ${admin.publicKey.toBase58()}`);
  console.log(`balance    ${(await conn.getBalance(admin.publicKey)) / LAMPORTS_PER_SOL} SOL`);
  console.log(`currency   ${USDC_MINT.toBase58()}`);
  console.log(`treasury   ${treasuryOwner.toBase58()}`);
  console.log(`  its ATA  ${treasuryAta.toBase58()}`);
  console.log(`config     ${config.toBase58()}`);
  console.log(`season     ${CURRENT_SEASON}  table ${drops.toBase58()}`);
  console.log(send ? "\nSENDING\n" : "\nDRY RUN - nothing is sent. Add --send.\n");

  // ── 1. The treasury's token account ─────────────────────────────────────
  //
  // It has to exist before a pack can be bought: open_booster transfers into
  // it, and the Token program will not create it on the way.
  console.log("1. treasury token account");
  if (await exists(treasuryAta)) {
    console.log("  have it already");
  } else {
    await submit(admin, [
      createAssociatedTokenAccountInstruction(
        admin.publicKey, treasuryAta, treasuryOwner, USDC_MINT,
      ),
    ], "create treasury ATA");
  }

  // ── 2. The config ───────────────────────────────────────────────────────
  console.log("\n2. pack config");
  if (await exists(config)) {
    console.log("  have it already (init_pack_config would fail, which is the point)");
  } else {
    await submit(admin, [new TransactionInstruction({
      programId: PROGRAM,
      keys: [
        // The payer must be the program's UPGRADE AUTHORITY now, and the
        // admin it installs is the first argument rather than the signer.
        { pubkey: admin.publicKey,          isSigner: true,  isWritable: true  },
        { pubkey: PROGRAM,                  isSigner: false, isWritable: false },
        { pubkey: programDataPda(PROGRAM),  isSigner: false, isWritable: false },
        { pubkey: config,                   isSigner: false, isWritable: true  },
        { pubkey: SystemProgram.programId,  isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([
        disc("init_pack_config"),
        // Admin, which can and on mainnet should be the multisig rather
        // than the deployer.
        (process.env.SOLCITY_PACK_ADMIN
          ? new PublicKey(process.env.SOLCITY_PACK_ADMIN)
          : admin.publicKey).toBuffer(),
        USDC_MINT.toBuffer(), treasuryAta.toBuffer(),
      ]),
    })], "init_pack_config");
  }

  // ── 3. The packs ────────────────────────────────────────────────────────
  //
  // Weights are basis points and the program requires they add to 10000, so
  // the percentages in `packs.ts` are multiplied by 100 here rather than kept
  // twice.
  console.log("\n3. packs");
  for (const pack of PACKS) {
    const dollars = PRICE_USD[pack.id];
    if (dollars === undefined) throw new Error(`no USD price for pack "${pack.id}"`);
    const weights = RARITY_ORDER.map((r) => Math.round(pack.odds[r] * 100));
    const total = weights.reduce((a, b) => a + b, 0);
    if (total !== 10_000) {
      throw new Error(`pack "${pack.id}" weights add up to ${total}, not 10000`);
    }
    console.log(
      `  ${pack.onChainId} ${pack.id.padEnd(7)} $${dollars.toFixed(2)}  ` +
      `${pack.size} items  ${RARITY_ORDER.map((r, i) => `${r[0]}${weights[i]}`).join(" ")}`,
    );
    await submit(admin, [new TransactionInstruction({
      programId: PROGRAM,
      keys: [
        { pubkey: config,          isSigner: false, isWritable: true },
        { pubkey: admin.publicKey, isSigner: true,  isWritable: false },
      ],
      data: Buffer.concat([
        disc("upsert_pack"),
        u8(pack.onChainId),
        u16(CURRENT_SEASON),
        u64(usdc(dollars)),
        u8(pack.size),
        ...weights.map(u16),
        u8(1), // enabled
      ]),
    })], `upsert_pack ${pack.id}`);
  }

  // ── 4. The season's drop table ──────────────────────────────────────────
  console.log(`\n4. season ${CURRENT_SEASON} drop table`);
  if (await exists(drops)) {
    console.log("  have it already");
  } else {
    await submit(admin, [new TransactionInstruction({
      programId: PROGRAM,
      keys: [
        { pubkey: admin.publicKey,         isSigner: true,  isWritable: true  },
        { pubkey: config,                  isSigner: false, isWritable: false },
        { pubkey: drops,                   isSigner: false, isWritable: true  },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([disc("init_season_drops"), u16(CURRENT_SEASON)]),
    })], `init_season_drops ${CURRENT_SEASON}`);
  }

  // ── 5. What it drops ────────────────────────────────────────────────────
  //
  // From `seasonDrops.ts`, so the lists are not computed twice and the test
  // that pins them is pinning what actually gets written.
  console.log("\n5. drops per rarity");
  const lists = seasonDropLists(CURRENT_SEASON);
  for (let rarity = 0; rarity < RARITY_ORDER.length; rarity++) {
    const name = RARITY_ORDER[rarity];
    const indices = lists[name];
    console.log(`  ${name.padEnd(9)} ${indices.length.toString().padStart(4)}  ` +
                `${indices.slice(0, 12).join(",")}${indices.length > 12 ? ",..." : ""}`);
    if (indices.length === 0) continue;
    for (let at = 0; at < indices.length; at += APPEND_CHUNK) {
      const chunk = indices.slice(at, at + APPEND_CHUNK);
      await submit(admin, [new TransactionInstruction({
        programId: PROGRAM,
        keys: [
          { pubkey: admin.publicKey,         isSigner: true,  isWritable: true  },
          { pubkey: config,                  isSigner: false, isWritable: false },
          { pubkey: drops,                   isSigner: false, isWritable: true  },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([
          disc("append_season_drops"), u8(rarity), vecU16(chunk),
        ]),
      })], `append ${name} +${chunk.length}`);
    }
  }

  // ── 6. Opening the season, only when asked ──────────────────────────────
  //
  // Behind its own flag because it is the point of no return: it freezes the
  // drop table permanently and starts taking money. Check section 5 above
  // before passing it.
  if (process.argv.includes("--open-season")) {
    console.log(`
6. set_current_season(${CURRENT_SEASON})`);
    await submit(admin, [new TransactionInstruction({
      programId: PROGRAM,
      keys: [
        { pubkey: config,          isSigner: false, isWritable: true },
        { pubkey: admin.publicKey, isSigner: true,  isWritable: false },
      ],
      data: Buffer.concat([disc("set_current_season"), u16(CURRENT_SEASON)]),
    })], `set_current_season ${CURRENT_SEASON}`);
    console.log("");
    console.log("The season is open. Its drop table can no longer be edited.");
    return;
  }

  // ── 7. What is left for a human ─────────────────────────────────────────
  //
  // Opening the season is deliberately not here. It freezes the drop table
  // forever and starts taking money, and it is one instruction somebody should
  // run on purpose when the table reads right.
  console.log(`
Not done here, on purpose:

  set_current_season(${CURRENT_SEASON})

A fresh config opens at season 0, meaning nothing is open and nothing sells.
That is deliberate: a drop table can only be edited while its season is still
in the future, so season ${CURRENT_SEASON} has to be fillable before it is open.

set_current_season is what opens it. It freezes the drop table permanently and
starts taking money, so it is not something a setup script should do on its
own. Check the table above, fix anything wrong with append_season_drops or
clear_season_drops while you still can, then run it.
`);
}

main().catch((err) => {
  console.error(`\n${(err as Error).message}`);
  process.exit(1);
});
