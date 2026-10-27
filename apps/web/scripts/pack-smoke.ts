/**
 * Sol City — devnet smoke test for buying a pack, end to end.
 *
 * The whole path a real player takes, with real money moving: fund a
 * throwaway wallet with SOL and USDC, create its unlock account, pay for a
 * pack, and wait for MagicBlock's VRF oracle to grant the items.
 *
 * A throwaway BUYER rather than the admin wallet, because the treasury token
 * account is the admin's own: paying yourself makes source and destination the
 * same account and the balance check proves nothing.
 *
 *   npx tsx scripts/pack-smoke.ts <path-to-admin-wallet.json> [packId]
 *
 * It spends real devnet USDC (the pack price) and ~0.03 devnet SOL, and
 * leaves the throwaway behind.
 */
import { readFileSync } from "fs";
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from "@solana/spl-token";
import { buildInitUnlockStateIx, buildOpenBoosterIx } from "../src/game/solana/instructions";
import { deriveUnlockPDA, decodeUnlockState } from "../src/game/solana/program";
import { readPackConfig, ownedIndices } from "../src/game/solana/packs";
import { itemAtGlobalIndex } from "../src/game/config/catalogIndex";
import { rarityOf } from "../src/game/config/packs";

const RPC = process.env.SOLCITY_RPC ?? "https://api.devnet.solana.com";
// No websocket. web3.js opens one for `sendAndConfirmTransaction`, and
// api.devnet counts CONNECTIONS, not requests: it answers "Connection rate
// limits exceeded" and bans the address for a while. The rest of this
// codebase sends and then polls for the same reason.
const conn = new Connection(RPC, { commitment: "confirmed", disableRetryOnRateLimit: false });

/** Sends, then polls for the signature. Never subscribes. */
async function send(tx: Transaction, signers: Keypair[]): Promise<string> {
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.feePayer = signers[0].publicKey;
  tx.sign(...signers);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const st = (await conn.getSignatureStatuses([sig])).value[0];
    if (st?.err) throw new Error(`${sig} failed: ${JSON.stringify(st.err)}`);
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return sig;
  }
  throw new Error(`${sig} never confirmed`);
}

function load(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

async function usdc(ata: PublicKey): Promise<bigint> {
  const info = await conn.getAccountInfo(ata);
  return info ? Buffer.from(info.data).readBigUInt64LE(64) : BigInt(0);
}

async function main() {
  const adminPath = process.argv[2];
  if (!adminPath) throw new Error("Pass the admin wallet keypair path (it funds the buyer)");
  const packId = Number(process.argv[3] ?? 1);
  const admin = load(adminPath);
  const buyer = Keypair.generate();

  const config = await readPackConfig(conn);
  if (!config) throw new Error("no PackConfig on chain: run packs-setup.ts first");
  const pack = config.packs.find((p) => p.id === packId);
  if (!pack) throw new Error(`no pack with id ${packId}`);

  const adminAta = getAssociatedTokenAddressSync(config.currencyMint, admin.publicKey);
  const buyerAta = getAssociatedTokenAddressSync(config.currencyMint, buyer.publicKey);

  console.log(`rpc        ${RPC}`);
  console.log(`admin      ${admin.publicKey.toBase58()}`);
  console.log(`  USDC     ${Number(await usdc(adminAta)) / 1e6}`);
  console.log(`buyer      ${buyer.publicKey.toBase58()}  (throwaway)`);
  console.log(`pack       ${pack.id}, season ${pack.season}, ${pack.size} items, `
    + `${Number(pack.price) / 1e6} USDC`);
  console.log(`treasury   ${config.treasuryTokenAccount.toBase58()}`);
  console.log(`season     open = ${config.currentSeason}\n`);

  if (pack.season !== config.currentSeason) {
    throw new Error(`pack is season ${pack.season} but season ${config.currentSeason} is open`);
  }

  // ── 1. Fund the buyer, in SOL and in the currency ───────────────────────
  console.log("1. funding the buyer");
  const need = pack.price + pack.price / BigInt(10); // the price plus a little slack
  if ((await usdc(adminAta)) < need) {
    throw new Error(`the admin holds less than ${Number(need) / 1e6} USDC`);
  }
  await send(new Transaction()
    .add(SystemProgram.transfer({
      fromPubkey: admin.publicKey, toPubkey: buyer.publicKey,
      lamports: 0.05 * LAMPORTS_PER_SOL,
    }))
    .add(createAssociatedTokenAccountInstruction(
      admin.publicKey, buyerAta, buyer.publicKey, config.currencyMint,
    ))
    .add(createTransferInstruction(adminAta, buyerAta, admin.publicKey, need)), [admin]);
  console.log(`  ok, buyer holds ${Number(await usdc(buyerAta)) / 1e6} USDC\n`);

  // ── 2. Buy ──────────────────────────────────────────────────────────────
  console.log("2. init_unlock_state + open_booster");
  const before = await usdc(config.treasuryTokenAccount);
  const clientSeed = new Uint8Array(32);
  crypto.getRandomValues(clientSeed);
  const sig = await send(new Transaction()
    .add(buildInitUnlockStateIx(buyer.publicKey))
    .add(buildOpenBoosterIx({
      payer: buyer.publicKey,
      packId: pack.id,
      season: pack.season,
      clientSeed,
      treasuryTokenAccount: config.treasuryTokenAccount,
      buyerTokenAccount: buyerAta,
    })), [buyer]);
  console.log(`  ok ${sig.slice(0, 16)}`);

  const paid = (await usdc(config.treasuryTokenAccount)) - before;
  console.log(`  treasury received ${Number(paid) / 1e6} USDC`
    + `  (expected ${Number(pack.price) / 1e6})`);
  console.log(`  buyer left with   ${Number(await usdc(buyerAta)) / 1e6} USDC\n`);

  // ── 3. The draw is asynchronous: wait for the oracle ────────────────────
  console.log("3. waiting for the VRF callback");
  const unlockPda = deriveUnlockPDA(buyer.publicKey)[0];
  let granted: number[] = [];
  let pending = true;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const info = await conn.getAccountInfo(unlockPda);
    const st = info ? decodeUnlockState(info.data) : null;
    if (!st) continue;
    if (!st.pending) { granted = st.owned; pending = false; break; }
    if (i % 4 === 3) process.stdout.write(".");
  }
  console.log();

  if (pending) {
    console.log("  TIMEOUT: paid, but the oracle has not answered in 60s");
    console.log(`  watch ${unlockPda.toBase58()}`);
    process.exit(1);
  }

  console.log(`  granted ${granted.length} item(s):`);
  for (const index of granted) {
    const entry = itemAtGlobalIndex(index);
    const label = entry
      ? `${entry.category}:${entry.variant.id} (${rarityOf(entry.category, entry.variant.id)})`
      : "UNKNOWN to this build";
    console.log(`    ${String(index).padStart(6)}  ${label}`);
  }

  const ok = paid === pack.price && granted.length > 0
    && granted.every((i) => itemAtGlobalIndex(i) !== undefined);
  console.log(`\n${ok ? "PASS" : "FAIL"}: payment ${paid === pack.price ? "matched" : "did NOT match"}`
    + ` and the draw granted ${granted.length} of ${pack.size}`);
  console.log(`(fewer than ${pack.size} means duplicates, which a small season makes likely)`);
  console.log(`\nowned on chain: ${(await ownedIndices(conn, buyer.publicKey)).join(", ")}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n${(err as Error).message}`);
  const logs = (err as { logs?: string[] }).logs;
  if (logs) for (const l of logs.slice(-14)) console.error(`  ${l}`);
  process.exit(1);
});
