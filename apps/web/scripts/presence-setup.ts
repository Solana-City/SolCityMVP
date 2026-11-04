/**
 * Sol City: the presence boards (one per rollup) and the hunt's rollup, once,
 * after a deploy.
 *
 *   npx tsx scripts/presence-setup.ts status                       # no key needed
 *   npx tsx scripts/presence-setup.ts <upgrade-authority.json>     # dry run
 *   npx tsx scripts/presence-setup.ts <upgrade-authority.json> --send
 *   npx tsx scripts/presence-setup.ts <upgrade-authority.json> --hunt us --send
 *   npx tsx scripts/presence-setup.ts <upgrade-authority.json> --ball us --send
 *
 * Per board: create it if missing, then delegate it to its own rollup if it is
 * not delegated yet. Both take the upgrade authority and run on BASE, so on
 * mainnet they are Squads proposals, like the other setup scripts.
 *
 * `--hunt <us|as|eu>` also delegates the hunt to that rollup, which makes a
 * find free (claim_find on the rollup) and is what lets a session key hold no
 * SOL at all. The clients follow the hunt's delegation record, so it can be
 * done at any time; `undelegate_hunt` on that rollup brings it back.
 *
 * `--ball <us|as|eu>` creates the beach football's account if missing and
 * delegates it to that rollup. Kicks then go there, and the client stops
 * carrying them on the kicker's chat field. `undelegate_ball` on that rollup
 * brings it back (any signer).
 *
 * Env:
 *   SOLCITY_RPC   RPC (default: devnet, see scripts/_rpc.ts)
 */
import { readFileSync } from "fs";
import {
  Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
} from "@solana/web3.js";
import {
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { devnetConnection, sendAndPoll } from "./_rpc";
import {
  derivePresenceBoardPDA, buildInitPresenceBoardIx, buildDelegatePresenceBoardIx, PRESENCE_BOARD_LEN,
} from "../src/game/solana/presenceBoard";
import { ixDiscriminator } from "../src/game/solana/instructions";
import { ER_VALIDATORS } from "../src/game/multiplayer/erValidators";
import { deriveBallPDA, buildInitBallIx, buildDelegateBallIx } from "../src/game/solana/ball";

const PROGRAM = new PublicKey("HPvDFVnruSXHwKKP44eUvRh8oYqBaHCeQbK1sKWT1aU2");
const DELEGATION = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

const conn = devnetConnection();
const args = process.argv.slice(2);
const send = args.includes("--send");
const huntAt = args.includes("--hunt") ? args[args.indexOf("--hunt") + 1] : null;
const ballAt = args.includes("--ball") ? args[args.indexOf("--ball") + 1] : null;

/** Where an account lives: missing, on base, or delegated to a validator. */
async function whereIs(account: PublicKey): Promise<string> {
  const info = await conn.getAccountInfo(account);
  if (!info) return "missing";
  if (!info.owner.equals(DELEGATION)) return "on the base layer";
  const record = await conn.getAccountInfo(delegationRecordPdaFromDelegatedAccount(account));
  if (!record) return "delegated (no record?)";
  const v = new PublicKey(record.data.subarray(8, 40)).toBase58();
  const label = ER_VALIDATORS.find((x) => x.identity === v)?.label ?? v;
  return `delegated to ${label}`;
}

function delegateHuntIx(payer: PublicKey, validator: PublicKey): TransactionInstruction {
  const hunt = PublicKey.findProgramAddressSync([Buffer.from("hunt_v2")], PROGRAM)[0];
  const programData = PublicKey.findProgramAddressSync([PROGRAM.toBuffer()], LOADER)[0];
  return new TransactionInstruction({
    programId: PROGRAM,
    keys: [
      { pubkey: payer,         isSigner: true,  isWritable: true  },
      { pubkey: PROGRAM,       isSigner: false, isWritable: false },
      { pubkey: programData,   isSigner: false, isWritable: false },
      { pubkey: hunt,          isSigner: false, isWritable: true  },
      { pubkey: PROGRAM,       isSigner: false, isWritable: false }, // owner_program
      { pubkey: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(hunt, PROGRAM), isSigner: false, isWritable: true },
      { pubkey: delegationRecordPdaFromDelegatedAccount(hunt),   isSigner: false, isWritable: true },
      { pubkey: delegationMetadataPdaFromDelegatedAccount(hunt), isSigner: false, isWritable: true },
      { pubkey: DELEGATION,              isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: validator,               isSigner: false, isWritable: false },
    ],
    data: ixDiscriminator("delegate_hunt"),
  });
}

async function main() {
  console.log(`rpc      ${conn.rpcEndpoint.replace(/api-key=.*/, "api-key=***")}`);
  console.log(`program  ${PROGRAM.toBase58()}`);
  const hunt = PublicKey.findProgramAddressSync([Buffer.from("hunt_v2")], PROGRAM)[0];

  const status = async () => {
    for (const v of ER_VALIDATORS) {
      const board = derivePresenceBoardPDA(new PublicKey(v.identity));
      console.log(`board ${v.label.padEnd(7)} ${board.toBase58()}  ${await whereIs(board)}`);
    }
    console.log(`hunt          ${hunt.toBase58()}  ${await whereIs(hunt)}`);
    console.log(`ball          ${deriveBallPDA().toBase58()}  ${await whereIs(deriveBallPDA())}`);
  };

  if (args[0] === "status") { await status(); return; }

  const walletPath = args[0];
  if (!walletPath || walletPath.startsWith("--")) throw new Error("Pass the upgrade authority keypair path, or `status`");
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8"))));
  console.log(`payer    ${payer.publicKey.toBase58()}`);
  const rent = await conn.getMinimumBalanceForRentExemption(PRESENCE_BOARD_LEN);
  console.log(`rent     ${(rent / 1e9).toFixed(4)} SOL per board (refunded only if a board is closed)`);
  await status();

  const plan: { label: string; ix: TransactionInstruction }[] = [];
  for (const v of ER_VALIDATORS) {
    const validator = new PublicKey(v.identity);
    const where = await whereIs(derivePresenceBoardPDA(validator));
    if (where === "missing") plan.push({ label: `create board ${v.label}`, ix: buildInitPresenceBoardIx(payer.publicKey, validator) });
    if (where === "missing" || where === "on the base layer") {
      plan.push({ label: `delegate board ${v.label} to ${v.label}`, ix: buildDelegatePresenceBoardIx(payer.publicKey, validator) });
    }
  }
  if (huntAt) {
    const v = ER_VALIDATORS.find((x) => x.id === huntAt);
    if (!v) throw new Error(`--hunt takes one of: ${ER_VALIDATORS.map((x) => x.id).join(", ")}`);
    const where = await whereIs(hunt);
    if (where === "on the base layer") plan.push({ label: `delegate hunt to ${v.label}`, ix: delegateHuntIx(payer.publicKey, new PublicKey(v.identity)) });
    else console.log(`\nhunt is ${where}: nothing to do for --hunt`);
  }

  if (ballAt) {
    const v = ER_VALIDATORS.find((x) => x.id === ballAt);
    if (!v) throw new Error(`--ball takes one of: ${ER_VALIDATORS.map((x) => x.id).join(", ")}`);
    const where = await whereIs(deriveBallPDA());
    if (where === "missing") plan.push({ label: "create ball", ix: buildInitBallIx(payer.publicKey) });
    if (where === "missing" || where === "on the base layer") {
      plan.push({ label: `delegate ball to ${v.label}`, ix: buildDelegateBallIx(payer.publicKey, new PublicKey(v.identity)) });
    } else console.log(`\nball is ${where}: nothing to do for --ball`);
  }

  if (plan.length === 0) { console.log("\nnothing to do"); return; }
  console.log("\nplan:");
  for (const p of plan) console.log(`  - ${p.label}`);
  if (!send) { console.log("\nDRY RUN. Add --send."); return; }

  // One transaction per step, so a failure says which step it was, and a
  // re-run picks up from wherever the last one stopped.
  for (const p of plan) {
    const sig = await sendAndPoll(conn, new Transaction().add(p.ix), [payer]);
    console.log(`  ${p.label}: ${sig}`);
  }
  console.log("");
  await status();
}

main().catch((err) => { console.error(err); process.exit(1); });
