/**
 * Sol City — devnet smoke test for commit-and-undelegate.
 *
 * The one path that has never worked and never been exercised. The client
 * used to call the SDK's top-level `createCommitAndUndelegateInstruction`,
 * which the magic program refuses: it wants the account's OWNER to have
 * invoked it by CPI, and a top-level instruction has no parent. It failed into
 * a catch from the beginning, which is why PDAs pile up delegated forever and
 * why the base copy of a player is frozen at spawn.
 *
 * `commit_and_undelegate_player_session` is our own instruction for it. This
 * runs the whole round trip on a throwaway wallet, funded from the admin key,
 * and checks the thing that actually matters: that the position written on the
 * ROLLUP is on the BASE account afterwards, and that the account came home.
 *
 *   npx tsx scripts/undelegate-smoke.ts <path-to-admin-wallet.json>
 *
 * It spends ~0.02 devnet SOL and leaves the throwaway wallet behind.
 */
import { readFileSync } from "fs";
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  buildInitializePlayerIx, buildAuthorizeSessionIx, buildDelegateIx,
  buildUpdatePositionSessionIx, buildCommitAndUndelegatePlayerSessionIx,
} from "../src/game/solana/instructions";
import { derivePlayerPDA, SOL_CITY_PROGRAM_ID } from "../src/game/solana/program";
import { ER_VALIDATORS } from "../src/game/multiplayer/erValidators";

const BASE = process.env.SOLCITY_RPC ?? "https://api.devnet.solana.com";
/** Delegate where the sweep would send a new player from here. */
const ER = ER_VALIDATORS.find((v) => v.id === "as") ?? ER_VALIDATORS[0];

const base = new Connection(BASE, "confirmed");
const er = new Connection(ER.rpc, "confirmed");

function load(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

const TEST_X = 1234;
const TEST_Y = 5678;

async function main() {
  const adminPath = process.argv[2];
  if (!adminPath) throw new Error("Pass the admin wallet keypair path (it funds the test)");
  const admin = load(adminPath);
  const player = Keypair.generate();
  const session = Keypair.generate();
  const [pda] = derivePlayerPDA(player.publicKey);

  console.log(`base      ${BASE}`);
  console.log(`rollup    ${ER.label}  ${ER.rpc}`);
  console.log(`admin     ${admin.publicKey.toBase58()}  ${(await base.getBalance(admin.publicKey)) / LAMPORTS_PER_SOL} SOL`);
  console.log(`player    ${player.publicKey.toBase58()}  (throwaway)`);
  console.log(`pda       ${pda.toBase58()}\n`);

  // ── 1. Fund the throwaway from the admin ────────────────────────────────
  console.log("1. funding the throwaway");
  await sendAndConfirmTransaction(base, new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: admin.publicKey, toPubkey: player.publicKey,
      lamports: 0.05 * LAMPORTS_PER_SOL,
    }),
    SystemProgram.transfer({
      fromPubkey: admin.publicKey, toPubkey: session.publicKey,
      lamports: 0.01 * LAMPORTS_PER_SOL,
    }),
  ), [admin], { commitment: "confirmed" });
  console.log("  ok\n");

  // ── 2. Create the player and authorise the session key ──────────────────
  console.log("2. initialize_player + authorize_session (base)");
  await sendAndConfirmTransaction(base, new Transaction()
    .add(buildInitializePlayerIx(player.publicKey, "SmokeTest"))
    .add(buildAuthorizeSessionIx(player.publicKey, session.publicKey)),
    [player], { commitment: "confirmed" });
  console.log("  ok\n");

  // ── 3. Delegate to the rollup ───────────────────────────────────────────
  console.log(`3. delegate -> ${ER.label}`);
  await sendAndConfirmTransaction(base, new Transaction()
    .add(buildDelegateIx(player.publicKey, new PublicKey(ER.identity))),
    [player], { commitment: "confirmed" });
  for (let i = 0; i < 20; i++) {
    const info = await er.getAccountInfo(pda);
    if (info) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const onEr = await er.getAccountInfo(pda);
  if (!onEr) throw new Error("the PDA never appeared on the rollup");
  console.log(`  ok, ${onEr.data.length} bytes on the rollup\n`);

  // ── 4. Move, on the rollup only ─────────────────────────────────────────
  console.log(`4. update_position_session(${TEST_X}, ${TEST_Y}) on the rollup`);
  const erTx = new Transaction({
    recentBlockhash: (await er.getLatestBlockhash()).blockhash,
    feePayer: session.publicKey,
  }).add(buildUpdatePositionSessionIx(player.publicKey, session.publicKey, TEST_X, TEST_Y, 1));
  erTx.sign(session);
  const moveSig = await er.sendRawTransaction(erTx.serialize(), { skipPreflight: true });
  await new Promise((r) => setTimeout(r, 2000));
  console.log(`  sent ${moveSig.slice(0, 16)}`);

  // The base copy must NOT have it yet. That is the whole premise: a delegated
  // account's base copy is frozen until something commits it.
  const baseBefore = await base.getAccountInfo(pda);
  console.log(`  base copy owner: ${baseBefore?.owner.toBase58().slice(0, 12)}  (delegated)\n`);

  // ── 5. The thing being tested ───────────────────────────────────────────
  console.log("5. commit_and_undelegate_player_session (rollup)");
  const undTx = new Transaction({
    recentBlockhash: (await er.getLatestBlockhash()).blockhash,
    feePayer: session.publicKey,
  }).add(buildCommitAndUndelegatePlayerSessionIx(player.publicKey, session.publicKey));
  undTx.sign(session);
  let undSig: string;
  try {
    undSig = await er.sendRawTransaction(undTx.serialize(), { skipPreflight: false });
    console.log(`  sent ${undSig.slice(0, 16)}`);
  } catch (err) {
    console.log(`  FAILED: ${(err as Error).message.split("\n")[0]}`);
    const logs = (err as { logs?: string[] }).logs;
    if (logs) for (const l of logs.slice(-12)) console.log(`    ${l}`);
    process.exit(1);
  }

  // ── 6. Did it come home, and did the position come with it ──────────────
  console.log("\n6. verifying on base");
  let came = false;
  for (let i = 0; i < 30; i++) {
    const info = await base.getAccountInfo(pda);
    if (info && info.owner.equals(SOL_CITY_PROGRAM_ID)) { came = true; break; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const after = await base.getAccountInfo(pda);
  if (!after) throw new Error("the base account vanished");

  // x and y sit after authority, the session Option, and the name String.
  const d = Buffer.from(after.data);
  let o = 8 + 32;
  o += 1 + (d[o] ? 32 : 0);
  const nameLen = d.readUInt32LE(o); o += 4 + nameLen;
  const x = d.readUInt32LE(o);
  const y = d.readUInt32LE(o + 4);

  console.log(`  owner      ${after.owner.toBase58()}`);
  console.log(`  came home  ${came ? "YES" : "NO - still owned by the delegation program"}`);
  console.log(`  position   (${x}, ${y})  expected (${TEST_X}, ${TEST_Y})`);

  const ok = came && x === TEST_X && y === TEST_Y;
  console.log(`\n${ok ? "PASS" : "FAIL"}: the rollup state ${ok ? "reached" : "did NOT reach"} base and the account ${came ? "is free" : "is still delegated"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n${(err as Error).message}`);
  process.exit(1);
});
