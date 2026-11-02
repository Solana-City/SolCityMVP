/**
 * Sol City — create the global "Find Someone" hunt, once, after a deploy.
 *
 * `initialize_hunt` takes the program's upgrade authority (audit R-66), so
 * this runs with the deploy key, before the upgrade authority moves to the
 * multisig. Players no longer create it on first login.
 *
 *   npx tsx scripts/hunt-setup.ts <path-to-upgrade-authority.json>          # dry run
 *   npx tsx scripts/hunt-setup.ts <path-to-upgrade-authority.json> --send
 *
 * Env:
 *   SOLCITY_RPC   RPC (default: devnet, see scripts/_rpc.ts)
 */
import { readFileSync } from "fs";
import {
  Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
} from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import { devnetConnection, sendAndPoll } from "./_rpc";

const PROGRAM = new PublicKey("HPvDFVnruSXHwKKP44eUvRh8oYqBaHCeQbK1sKWT1aU2");
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

const conn = devnetConnection();
const send = process.argv.includes("--send");

async function main() {
  const walletPath = process.argv[2];
  if (!walletPath || walletPath.startsWith("--")) {
    throw new Error("Pass the upgrade authority keypair path");
  }
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8"))),
  );
  const hunt = PublicKey.findProgramAddressSync([Buffer.from("hunt_v2")], PROGRAM)[0];
  const programData = PublicKey.findProgramAddressSync([PROGRAM.toBuffer()], LOADER)[0];

  console.log(`rpc      ${conn.rpcEndpoint.replace(/api-key=.*/, "api-key=***")}`);
  console.log(`program  ${PROGRAM.toBase58()}`);
  console.log(`payer    ${payer.publicKey.toBase58()}`);
  console.log(`hunt     ${hunt.toBase58()}`);
  if (await conn.getAccountInfo(hunt)) { console.log("\nhave it already"); return; }
  if (!send) { console.log("\nDRY RUN: would create it. Add --send."); return; }

  const ix = new TransactionInstruction({
    programId: PROGRAM,
    keys: [
      { pubkey: hunt,                    isSigner: false, isWritable: true  },
      { pubkey: payer.publicKey,         isSigner: true,  isWritable: true  },
      { pubkey: PROGRAM,                 isSigner: false, isWritable: false },
      { pubkey: programData,             isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(sha256(new TextEncoder().encode("global:initialize_hunt")).slice(0, 8)),
  });
  const sig = await sendAndPoll(conn, new Transaction().add(ix), [payer]);
  console.log(`\ncreated  ${sig}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
