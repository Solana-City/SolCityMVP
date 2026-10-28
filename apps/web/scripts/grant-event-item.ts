/**
 * Sol City — hand a frozen list of winners the cosmetic they earned.
 *
 * The second half of the Halloween claim. `freeze-winners.ts` takes the cut;
 * this walks it and sends one `admin_grant_event_item` per wallet, which
 * writes the catalog index into that wallet's `UnlockState.owned`. From then
 * on the wardrobe lets them wear it and `mint_unlock` lets them turn it into
 * a compressed NFT at their own expense, if they want one.
 *
 *   npx tsx scripts/grant-event-item.ts <admin.json> --file <snapshot.json>
 *   npx tsx scripts/grant-event-item.ts <admin.json> --file <snapshot.json> --send
 *
 * Dry run unless `--send`, and the dry run is the point: it reports who would
 * be granted, who already has it, and who cannot be granted at all, before
 * anything is spent.
 *
 * ── The item is named, not guessed ───────────────────────────────────────
 *
 * `--item hat:Pumpkin_head` is turned into a catalog index here rather than
 * taken as a number, because a number in an operator's shell history is the
 * easiest way to hand out the wrong hat forever. The index is printed so it
 * can be checked against the catalog before `--send`.
 *
 * ── Who gets skipped, and why that is not a bug ──────────────────────────
 *
 * A wallet with no `UnlockState` account cannot be granted anything: the
 * account is created by `init_unlock_state`, which the PLAYER signs, so the
 * admin cannot make one for them. A winner who has never connected on this
 * cluster is listed as skipped and granted on a later pass, after they have.
 * That is why this is safe to run more than once.
 *
 * A wallet that already owns the index fails on chain with AlreadyOwned
 * (6034), deliberately rather than quietly: "already had it" and "just got
 * it" are different facts when handing out collectibles. Caught here and
 * counted separately, so a second pass over the same snapshot reads cleanly.
 */
import { readFileSync } from "fs";
import {
  Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
} from "@solana/web3.js";
import { devnetConnection, sendAndPoll } from "./_rpc";
import { SOL_CITY_COLLECTIBLES_PROGRAM_ID, deriveUnlockPDA } from "../src/game/solana/program";
import { ixDiscriminator } from "../src/game/solana/instructions";
import { globalIndexOf } from "../src/game/config/catalogIndex";
import type { LayerCategory } from "../src/game/config/paperDoll";

const PACK_CONFIG_SEED = "pack_config";

/** CollectiblesError::AlreadyOwned. Anchor numbers by position from 6000. */
const ALREADY_OWNED_HEX = "0x" + (6000 + 21).toString(16);

/** The program's own guard, mirrored so the dry run can explain a refusal. */
const FREE_ITEM_COUNT = 512;
const ENFORCED_FROM = 1536;

interface Snapshot {
  kind: string;
  id: string;
  takenAt: string;
  count: number;
  wallets: string[];
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function load(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

function buildGrantIx(admin: PublicKey, unlockPda: PublicKey, index: number): TransactionInstruction {
  const [config] = PublicKey.findProgramAddressSync(
    [Buffer.from(PACK_CONFIG_SEED)], SOL_CITY_COLLECTIBLES_PROGRAM_ID,
  );
  const data = Buffer.alloc(10);
  ixDiscriminator("admin_grant_event_item").copy(data, 0);
  data.writeUInt16LE(index, 8);
  return new TransactionInstruction({
    programId: SOL_CITY_COLLECTIBLES_PROGRAM_ID,
    keys: [
      { pubkey: admin,                   isSigner: true,  isWritable: true  },
      { pubkey: config,                  isSigner: false, isWritable: false },
      { pubkey: unlockPda,               isSigner: false, isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

async function main(): Promise<void> {
  const keyPath = process.argv[2];
  const file = arg("file");
  const item = arg("item", "hat:Pumpkin_head")!;
  const send = process.argv.includes("--send");

  if (!keyPath || !file) {
    console.error("usage: grant-event-item.ts <admin.json> --file <snapshot.json> [--item cat:id] [--send]");
    process.exit(1);
  }

  const [category, variantId] = item.split(":");
  const index = globalIndexOf(category as LayerCategory, variantId);
  if (index < 0) {
    console.error(`"${item}" is not in the catalog. Nothing sent.`);
    process.exit(1);
  }
  if (index < FREE_ITEM_COUNT || index >= ENFORCED_FROM) {
    // Said here as well as on chain, because the on-chain refusal arrives one
    // failed transaction at a time and this arrives before any are sent.
    console.error(
      `${item} is index ${index}, outside the quest and event block ` +
      `[${FREE_ITEM_COUNT}, ${ENFORCED_FROM}). The program will refuse it: ` +
      `a pack item cannot be granted, only drawn.`,
    );
    process.exit(1);
  }

  const snapshot = JSON.parse(readFileSync(file, "utf8")) as Snapshot;
  const admin = load(keyPath);
  const conn = devnetConnection();

  console.log(`snapshot  ${snapshot.kind}:${snapshot.id}  taken ${snapshot.takenAt}`);
  console.log(`wallets   ${snapshot.wallets.length}`);
  console.log(`item      ${item}  ->  catalog index ${index}`);
  console.log(`admin     ${admin.publicKey.toBase58()}`);
  console.log(send ? "\nSENDING\n" : "\nDRY RUN - nothing is sent. Add --send.\n");

  let granted = 0, already = 0, noAccount = 0, failed = 0;

  for (const [i, walletStr] of snapshot.wallets.entries()) {
    const n = `${i + 1}/${snapshot.wallets.length}`;
    let wallet: PublicKey;
    try {
      wallet = new PublicKey(walletStr);
    } catch {
      console.log(`  ${n} ${walletStr}  NOT A WALLET, skipped`);
      failed++;
      continue;
    }

    const [unlockPda] = deriveUnlockPDA(wallet);
    const info = await conn.getAccountInfo(unlockPda);
    if (!info) {
      console.log(`  ${n} ${walletStr.slice(0, 8)}…  no UnlockState yet, skipped`);
      noAccount++;
      continue;
    }

    if (!send) {
      console.log(`  ${n} ${walletStr.slice(0, 8)}…  would grant`);
      granted++;
      continue;
    }

    try {
      const sig = await sendAndPoll(
        conn, new Transaction().add(buildGrantIx(admin.publicKey, unlockPda, index)), [admin],
      );
      console.log(`  ${n} ${walletStr.slice(0, 8)}…  granted  ${sig.slice(0, 12)}`);
      granted++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 0x1792 is AlreadyOwned. Expected on a second pass, not a failure.
      // The enum split when the programs did, so this code is the one in
      // CollectiblesError, not the old SolCityError position.
      if (msg.includes(ALREADY_OWNED_HEX) || msg.includes("AlreadyOwned")) {
        console.log(`  ${n} ${walletStr.slice(0, 8)}…  already had it`);
        already++;
      } else {
        console.log(`  ${n} ${walletStr.slice(0, 8)}…  FAILED  ${msg.split("\n")[0]}`);
        failed++;
      }
    }
  }

  console.log(`\n${send ? "granted" : "would grant"}  ${granted}`);
  if (already) console.log(`already had it  ${already}`);
  if (noAccount) {
    console.log(`no UnlockState  ${noAccount}  (they have never connected here)`);
    console.log("Run this again after they do. Nothing is lost.");
  }
  if (failed) console.log(`failed          ${failed}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
