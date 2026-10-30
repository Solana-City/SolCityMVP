/**
 * Sol City - can a ROLLUP transaction read a BASE account that is not delegated?
 *
 *   npx tsx scripts/er-reads-base-smoke.ts <path-to-admin-wallet.json>
 *
 * ── Why this decides a redeploy ────────────────────────────────────────
 *
 * `update_look_session` enforces nothing today. One of the two reasons is
 * that it runs on the rollup and has no way to see what a wallet owns:
 * `UnlockState` belongs to the collectibles program, lives on base, and is
 * never delegated. The workaround is a SNAPSHOT copied into PlayerState by
 * `sync_unlocks`, and `sync_unlocks` has to run on base, where both accounts
 * are writable at once. That is only true before the player is delegated, so
 * a pack bought mid-session is unwearable until the next undelegate.
 *
 * If a rollup transaction CAN read a non-delegated base account, all of that
 * disappears: `sync_unlocks` runs on the rollup the moment a draw lands, and
 * the item is wearable at once. MagicBlock's own documentation does not say
 * either way, so this asks the validator.
 *
 * ── Why `sync_unlocks` is the right probe ──────────────────────────────
 *
 * It is already deployed, and it is the exact shape in question: it READS
 * `UnlockState` (base, another program's, never delegated) and WRITES
 * PlayerState (delegated, on the rollup). It is session-signed, so no wallet
 * is needed to send it.
 *
 * ── The control matters ────────────────────────────────────────────────
 *
 * A success could mean the validator never looked at the account. So this
 * runs the SAME instruction first with no UnlockState in existence. Anchor
 * deserialises that account, so a missing one must fail. Failure then success
 * is the only pair that proves the read is real.
 *
 * Spends ~0.06 devnet SOL and leaves a throwaway wallet behind.
 */
import { readFileSync } from "fs";
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  buildInitializePlayerIx, buildAuthorizeSessionIx, buildDelegateIx,
  buildInitUnlockStateIx, buildSyncUnlocksIx,
} from "../src/game/solana/instructions";
import { derivePlayerPDA, deriveUnlockPDA } from "../src/game/solana/program";
import { ER_VALIDATORS } from "../src/game/multiplayer/erValidators";

const BASE = process.env.SOLCITY_RPC ?? "https://api.devnet.solana.com";
const ER = ER_VALIDATORS.find((v) => v.id === "as") ?? ER_VALIDATORS[0];

const base = new Connection(BASE, "confirmed");
const er = new Connection(ER.rpc, "confirmed");

function load(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

/** Sends to the rollup and reports what came back, without throwing. */
async function trySync(player: PublicKey, session: Keypair): Promise<string | null> {
  const tx = new Transaction({
    recentBlockhash: (await er.getLatestBlockhash()).blockhash,
    feePayer: session.publicKey,
  }).add(buildSyncUnlocksIx(player, session.publicKey));
  tx.sign(session);
  try {
    // NOT skipPreflight: simulation is what reports the account error, and
    // the error is the whole point of the run.
    const sig = await er.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await new Promise((r) => setTimeout(r, 2000));
    return sig;
  } catch (err) {
    const e = err as { message?: string; logs?: string[] };
    console.log(`  rejected: ${e.message?.split("\n")[0]}`);
    for (const line of (e.logs ?? []).slice(-4)) console.log(`    ${line}`);
    return null;
  }
}

async function main() {
  const adminPath = process.argv[2];
  if (!adminPath) throw new Error("Pass the admin wallet keypair path (it funds the test)");
  const admin = load(adminPath);
  const player = Keypair.generate();
  const session = Keypair.generate();
  const [pda] = derivePlayerPDA(player.publicKey);
  const [unlockPda] = deriveUnlockPDA(player.publicKey);

  console.log(`base      ${BASE}`);
  console.log(`rollup    ${ER.label}  ${ER.rpc}`);
  console.log(`player    ${player.publicKey.toBase58()}  (throwaway)`);
  console.log(`player pda ${pda.toBase58()}`);
  console.log(`unlock pda ${unlockPda.toBase58()}  (collectibles program, never delegated)\n`);

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

  console.log("2. initialize_player + authorize_session (base)");
  await sendAndConfirmTransaction(base, new Transaction()
    .add(buildInitializePlayerIx(player.publicKey, "ErReadTest"))
    .add(buildAuthorizeSessionIx(player.publicKey, session.publicKey)),
    [player], { commitment: "confirmed" });
  console.log("  ok\n");

  console.log(`3. delegate -> ${ER.label}`);
  await sendAndConfirmTransaction(base, new Transaction()
    .add(buildDelegateIx(player.publicKey, new PublicKey(ER.identity))),
    [player], { commitment: "confirmed" });
  for (let i = 0; i < 20; i++) {
    if (await er.getAccountInfo(pda)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!await er.getAccountInfo(pda)) throw new Error("the PDA never appeared on the rollup");
  console.log("  ok, the player is on the rollup\n");

  console.log("4. CONTROL: sync_unlocks on the rollup with NO UnlockState");
  console.log("   (must fail: Anchor deserialises that account)");
  const control = await trySync(player.publicKey, session);
  console.log(control ? `  !! it was ACCEPTED: ${control.slice(0, 16)}\n` : "  failed, as it should\n");

  console.log("5. init_unlock_state (base)");
  await sendAndConfirmTransaction(base, new Transaction()
    .add(buildInitUnlockStateIx(player.publicKey)),
    [player], { commitment: "confirmed" });
  const onBase = await base.getAccountInfo(unlockPda);
  console.log(`  ok, ${onBase?.data.length} bytes on BASE`);
  console.log(`  on the rollup: ${(await er.getAccountInfo(unlockPda)) ? "cloned" : "absent"}\n`);

  console.log("6. THE TEST: the same sync_unlocks, now that UnlockState exists");
  const sig = await trySync(player.publicKey, session);

  console.log("\n── verdict ──");
  if (control && sig) {
    console.log("INCONCLUSIVE: the control was accepted too, so the account is not");
    console.log("being read and this probe proves nothing.");
  } else if (sig) {
    console.log("YES: a rollup transaction CAN read a non-delegated base account.");
    console.log("sync_unlocks runs on the rollup, so a pack item becomes wearable");
    console.log("the moment the draw lands and no undelegate is needed.");
    console.log(`  signature ${sig}`);
  } else {
    console.log("NO: the rollup refused the base account.");
    console.log("Enforcement cannot read UnlockState from the rollup, so it has to");
    console.log("move to the base side of the seam, validating what commits.");
  }
}

void main().catch((e) => { console.error(e); process.exit(1); });
