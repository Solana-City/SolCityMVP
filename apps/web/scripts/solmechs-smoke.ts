/**
 * Sol Mechs — devnet smoke test for the season ladder.
 *
 * Runs the whole base-layer path against the deployed program with two
 * throwaway wallets funded from the game wallet:
 *
 *   init_season -> init_prize_pool -> init_ladder_entry x2 -> join_queue x2
 *   -> pair_from_queue -> report_result x2 -> ratings moved
 *
 * It is a test, not a migration: `init_season` and `init_prize_pool` are
 * skipped when they already exist, so re-running it is safe.
 *
 *   npx tsx scripts/solmechs-smoke.ts <path-to-game-wallet.json>
 */
import { readFileSync } from "fs";
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import * as P from "../src/game/solmechs/pvp/chain/mechProgram";

const RPC = process.env.SOLMECHS_RPC
  ?? "https://devnet.helius-rpc.com/?api-key=92175bf8-4484-4c09-a60a-4d08ee821058";
const PROGRAM = new PublicKey("6sv4G2HuFdrcAFBRA2X4jTSRmZj2MJS5t66zRUqy5vxJ");
const SEASON = 1;

const conn = new Connection(RPC, "confirmed");

function load(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

function disc(name: string): Buffer {
  return Buffer.from(sha256(new TextEncoder().encode(`global:${name}`)).slice(0, 8));
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}

function i64(n: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(n));
  return b;
}

async function send(payer: Keypair, ixs: TransactionInstruction[], label: string): Promise<boolean> {
  try {
    const sig = await sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [payer], {
      commitment: "confirmed",
    });
    console.log(`  ok   ${label}  ${sig.slice(0, 12)}...`);
    return true;
  } catch (err) {
    console.log(`  FAIL ${label}: ${(err as Error).message.split("\n")[0]}`);
    const logs = (err as { logs?: string[] }).logs;
    if (logs) for (const line of logs.filter((l) => /Error|error|failed/.test(l)).slice(0, 4)) {
      console.log(`       ${line}`);
    }
    return false;
  }
}

function seasonPda() { return P.seasonPda(PROGRAM, SEASON); }
function queuePda() { return P.queuePda(PROGRAM, SEASON); }
function poolPda() { return P.poolPda(PROGRAM, SEASON); }
function entryPda(w: PublicKey) { return P.entryPda(PROGRAM, SEASON, w); }

async function main() {
  const walletPath = process.argv[2];
  if (!walletPath) throw new Error("Pass the game wallet keypair path");
  const game = load(walletPath);
  console.log(`game wallet ${game.publicKey.toBase58()}`);
  console.log(`balance     ${(await conn.getBalance(game.publicKey)) / LAMPORTS_PER_SOL} SOL\n`);

  // ── 1. Season ───────────────────────────────────────────────────────────
  console.log("1. season");
  const existingSeason = await conn.getAccountInfo(seasonPda());
  if (existingSeason) {
    console.log("  ok   season already open");
  } else {
    const now = Math.floor(Date.now() / 1000);
    const data = Buffer.concat([
      disc("init_season"),
      u16(SEASON),
      i64(now - 60),
      i64(now + 30 * 86_400),
      PublicKey.default.toBuffer(), // pass collection: unused while require_pass is false
      Buffer.from([0]),             // require_pass = false
    ]);
    await send(game, [new TransactionInstruction({
      programId: PROGRAM,
      keys: [
        { pubkey: seasonPda(), isSigner: false, isWritable: true },
        { pubkey: game.publicKey, isSigner: true, isWritable: true },
        { pubkey: game.publicKey, isSigner: false, isWritable: false }, // treasury
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    })], "init_season");
  }

  if (!(await conn.getAccountInfo(queuePda()))) {
    await send(game, [P.initQueueIx(PROGRAM, SEASON, game.publicKey)], "init_queue");
  } else {
    console.log("  ok   queue already open");
  }

  if (!(await conn.getAccountInfo(poolPda()))) {
    await send(game, [new TransactionInstruction({
      programId: PROGRAM,
      keys: [
        { pubkey: seasonPda(), isSigner: false, isWritable: false },
        { pubkey: poolPda(), isSigner: false, isWritable: true },
        { pubkey: game.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: disc("init_prize_pool"),
    })], "init_prize_pool");
  } else {
    console.log("  ok   prize pool already open");
  }

  const season = P.decodeSeason(new Uint8Array((await conn.getAccountInfo(seasonPda()))!.data));
  console.log(`  season ${season?.id}  ends ${new Date((season?.endsAt ?? 0) * 1000).toISOString().slice(0, 10)}  requirePass=${season?.requirePass}  nextRoom=${season?.nextRoomId}\n`);

  // ── 2. Two pilots ───────────────────────────────────────────────────────
  console.log("2. pilots");
  const a = Keypair.generate();
  const b = Keypair.generate();
  for (const [name, kp] of [["A", a], ["B", b]] as const) {
    await send(game, [SystemProgram.transfer({
      fromPubkey: game.publicKey,
      toPubkey: kp.publicKey,
      lamports: 0.03 * LAMPORTS_PER_SOL,
    })], `fund ${name} ${kp.publicKey.toBase58().slice(0, 6)}`);
  }

  for (const [name, kp] of [["A", a], ["B", b]] as const) {
    await send(kp, [P.initLadderEntryIx(PROGRAM, SEASON, kp.publicKey)], `init_ladder_entry ${name}`);
  }

  // ── 3. Queue and pairing ────────────────────────────────────────────────
  console.log("\n3. queue");
  await send(a, [P.joinQueueIx(PROGRAM, SEASON, a.publicKey)], "join_queue A");
  await send(b, [P.joinQueueIx(PROGRAM, SEASON, b.publicKey)], "join_queue B");

  const queue = P.decodeMatchQueue(new Uint8Array((await conn.getAccountInfo(queuePda()))!.data));
  console.log(`  queue holds ${queue?.tickets.length} ticket(s)`);

  const fresh = P.decodeSeason(new Uint8Array((await conn.getAccountInfo(seasonPda()))!.data))!;
  const roomId = fresh.nextRoomId;
  const paired = await send(
    b,
    [P.pairFromQueueIx(PROGRAM, SEASON, b.publicKey, a.publicKey, roomId)],
    `pair_from_queue (room ${roomId})`,
  );
  if (!paired) return;

  const room = P.decodeMatchRoom(new Uint8Array((await conn.getAccountInfo(P.roomPda(PROGRAM, SEASON, roomId)))!.data));
  console.log(`  room ${room?.id}  p1=${room?.p1.toBase58().slice(0, 6)}  p2=${room?.p2.toBase58().slice(0, 6)}  status=${room?.status}`);

  // ── 4. Result ───────────────────────────────────────────────────────────
  console.log("\n4. result (A wins)");
  await send(a, [P.reportResultIx(PROGRAM, SEASON, a.publicKey, b.publicKey, roomId, true)], "report_result A: win");
  await send(b, [P.reportResultIx(PROGRAM, SEASON, b.publicKey, a.publicKey, roomId, false)], "report_result B: loss");

  const [ea, eb] = await Promise.all([
    conn.getAccountInfo(entryPda(a.publicKey)),
    conn.getAccountInfo(entryPda(b.publicKey)),
  ]);
  const entryA = P.decodeLadderEntry(new Uint8Array(ea!.data))!;
  const entryB = P.decodeLadderEntry(new Uint8Array(eb!.data))!;
  const settled = P.decodeMatchRoom(new Uint8Array((await conn.getAccountInfo(P.roomPda(PROGRAM, SEASON, roomId)))!.data))!;

  console.log(`  A rating ${entryA.rating} (${entryA.wins}W/${entryA.losses}L) energy ${entryA.energy} rivals ${entryA.distinctOpponents}`);
  console.log(`  B rating ${entryB.rating} (${entryB.wins}W/${entryB.losses}L) energy ${entryB.energy} rivals ${entryB.distinctOpponents}`);
  console.log(`  room status ${settled.status} winner ${settled.winner?.toBase58().slice(0, 6)}`);

  const pass =
    entryA.rating > 1000 && entryB.rating < 1000 &&
    entryA.wins === 1 && entryB.losses === 1 &&
    settled.status === 1 && !!settled.winner?.equals(a.publicKey);
  console.log(`\n${pass ? "PASS" : "FAIL"}: ranked settlement`);

  // Leave the rent where it is: these accounts are the test's evidence.
  console.log(`\ngame wallet now ${(await conn.getBalance(game.publicKey)) / LAMPORTS_PER_SOL} SOL`);
}

main().catch((err) => { console.error(err); process.exit(1); });
