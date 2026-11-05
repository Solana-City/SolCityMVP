/**
 * Sol City — a sealed pack on devnet, end to end, with real money.
 *
 * Buys one sealed pack, waits for the indexer to see it, opens it, waits for
 * the VRF draw, and mints what was drawn: the same library
 * calls BoosterOverlay makes ("KEEP SEALED", then "OPEN" under YOUR PACKS),
 * with a keypair standing in for the wallet's two approvals (open, then mint).
 *
 *   npx tsx scripts/sealed-pack-e2e.ts <buyer-keypair.json> [packId] [--sponsored]
 *
 * --sponsored mints the way the site does once SOLCITY_MINT_SPONSOR_KEY is
 * set: lib/mint/sponsor.ts sends mint_pending with the keypair given as the
 * sponsor, and the buyer approves only the opening. Needs the collectibles
 * program with the sponsored mint_pending (payer and owner apart).
 *
 * The keypair needs devnet SOL and the pack price in devnet USDC. When it is
 * the treasury wallet, which cannot buy from itself, it funds a throwaway
 * buyer instead. Spends one pack's price and a few fees.
 *
 * Passed on devnet 2026-11-05: sealed in 3 s, opened in 6 s (v0, lookup
 * table), 5 drawn, 5 minted, 15 s in all.
 */
import { readFileSync } from "fs";
import {
  Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, VersionedTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction, createTransferInstruction, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { devnetConnection, sendAndPoll } from "./_rpc";
import { readMintConfig, settleMints } from "../src/game/solana/mint";
import { sponsorMint } from "../src/lib/mint/sponsor";
import { readPackConfig, awaitDraw, buyerIsTreasury } from "../src/game/solana/packs";
import { buySealedPacks, heldSealedPacks, openSealedPack } from "../src/game/solana/sealedPacks";
import { itemAtGlobalIndex } from "../src/game/config/catalogIndex";

// The library posts to the indexer with the global fetch, and the Helius key
// is origin-locked (_rpc.ts), so the script's fetch carries the origin too.
const ORIGIN = process.env.SOLCITY_RPC_ORIGIN ?? "https://solanacity.io";
const plainFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => plainFetch(input, {
  ...init, headers: { ...(init?.headers as Record<string, string>), origin: ORIGIN },
})) as typeof fetch;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("Pass the buyer keypair path.");
  let kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
  const sponsored = process.argv.includes("--sponsored");
  const packId = Number(process.argv.slice(3).find((a) => !a.startsWith("--")) ?? 1);
  const sponsor = kp;
  let wallet = kp.publicKey;
  const conn = devnetConnection();

  // The wallet's approval, for a batch of either kind.
  const approvals: number[] = [];
  const signAll = async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> =>
    (approvals.push(txs.length), txs).map((t) => {
      if (t instanceof VersionedTransaction) t.sign([kp]); else t.partialSign(kp);
      return t;
    });

  const [config, mintConfig] = await Promise.all([readPackConfig(conn), readMintConfig(conn)]);
  if (!config || !mintConfig) throw new Error("PackConfig or MintConfig missing");
  const pack = config.packs.find((p) => p.id === packId);
  if (!pack) throw new Error(`no pack ${packId}`);

  // The treasury cannot buy from itself (audit R-41), and on devnet the test
  // wallet IS the treasury. It funds a throwaway buyer instead, as
  // pack-smoke.ts does, and the throwaway is left behind with its items.
  if (buyerIsTreasury(config, kp.publicKey)) {
    const funder = kp;
    kp = Keypair.generate();
    wallet = kp.publicKey;
    const from = getAssociatedTokenAddressSync(config.currencyMint, funder.publicKey);
    const to = getAssociatedTokenAddressSync(config.currencyMint, wallet);
    await sendAndPoll(conn, new Transaction()
      .add(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: wallet, lamports: 0.1 * LAMPORTS_PER_SOL }))
      .add(createAssociatedTokenAccountInstruction(funder.publicKey, to, wallet, config.currencyMint))
      .add(createTransferInstruction(from, to, funder.publicKey, pack.price * BigInt(2))), [funder]);
    console.log(`funder      ${funder.publicKey.toBase58()} (the treasury, so it buys through a throwaway)`);
  }
  console.log(`buyer       ${wallet.toBase58()}`);
  console.log(`pack        ${packId}, ${pack.size} items, ${Number(pack.price) / 1e6} USDC`);

  // 1. KEEP SEALED
  const had = new Set((await heldSealedPacks(conn, wallet, mintConfig)).map((p) => p.assetId.toBase58()));
  const t0 = Date.now();
  const { sent } = await buySealedPacks({ wallet, pack, config, mintConfig, count: 1, signAllTransactions: signAll, conn });
  if (sent !== 1) throw new Error("the sealed purchase did not send");
  let fresh: Awaited<ReturnType<typeof heldSealedPacks>>[number] | undefined;
  for (let i = 0; i < 40 && !fresh; i++) {
    await sleep(2000);
    fresh = (await heldSealedPacks(conn, wallet, mintConfig))
      .find((p) => !had.has(p.assetId.toBase58()) && p.packId === packId);
  }
  if (!fresh) throw new Error("bought, but the indexer never showed the new pack");
  console.log(`sealed      ${fresh.assetId.toBase58()} (leaf ${fresh.nonce}) after ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  // 2. OPEN
  const t1 = Date.now();
  const { signature, presignedMints, leftover, before } = await openSealedPack({
    wallet, assetId: fresh.assetId, nonce: fresh.nonce, pack, mintConfig,
    signAllTransactions: signAll, conn,
  });
  console.log(`opened      ${signature} after ${((Date.now() - t1) / 1000).toFixed(1)} s`);

  const { granted, timedOut } = await awaitDraw(conn, wallet, before);
  if (timedOut) throw new Error("opened, but the draw did not land in 45 s");
  console.log(`drawn       ${granted.length} new: ${granted.map((i) => itemAtGlobalIndex(i)?.variant.id ?? i).join(", ") || "(all duplicates)"}`);

  // 3. MINT: by the sponsor with no approval (--sponsored), or by a second
  // approval now that the draw has landed.
  const owed = [...leftover, ...granted.filter((i) => !leftover.includes(i))].sort((a, b) => a - b);
  const t2 = Date.now();
  let minted: number[];
  let failed: number[];
  if (sponsored) {
    const out = await sponsorMint(wallet, { conn, sponsor });
    if (out.message) console.log(`sponsor     ${out.status}: ${out.message}`);
    minted = out.minted;
    failed = owed.filter((i) => !minted.includes(i));
  } else {
    ({ minted, failed } = await settleMints({
      conn, wallet, presigned: presignedMints, expected: owed, signAllTransactions: signAll,
    }));
  }
  console.log(`minted      ${minted.length} of ${owed.length}${sponsored ? " by the sponsor" : ""} in ${((Date.now() - t2) / 1000).toFixed(1)} s${failed.length ? `, failed ${failed.join(", ")}` : ""}`);

  // The indexer lags the burn by a few seconds, as it lags the mint.
  let still = true;
  for (let i = 0; i < 15 && still; i++) {
    still = (await heldSealedPacks(conn, wallet, mintConfig)).some((p) => p.assetId.equals(fresh!.assetId));
    if (still) await sleep(2000);
  }
  console.log(`pack burnt  ${still ? "NO, the indexer still lists it" : "yes"}`);
  console.log(`approvals   ${approvals.length} (transactions in each: ${approvals.join(", ")})`);
  console.log(`total       ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (failed.length || still) process.exit(1);
  console.log("PASS");
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
