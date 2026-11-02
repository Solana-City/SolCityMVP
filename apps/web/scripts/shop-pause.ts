/**
 * Sol City — the emergency stop for the collectibles program (audit R-44).
 *
 * Pausing stops buying, opening, minting, claiming and event grants in one
 * write to both configs. Draws already paid for still resolve. Resuming is
 * the admin's alone; pausing is the admin's or the pauser's.
 *
 *   npx tsx scripts/shop-pause.ts status
 *   npx tsx scripts/shop-pause.ts pause  <path-to-keypair.json> [--send]
 *   npx tsx scripts/shop-pause.ts resume <path-to-keypair.json> [--send]
 *   npx tsx scripts/shop-pause.ts pause  --squads <signer-pubkey>
 *
 * Nothing is sent without `--send`. With `--squads` nothing is signed: it
 * prints the instruction for a Squads proposal, for when the admin is the
 * multisig vault (pass the vault address as the signer).
 *
 * Env:
 *   SOLCITY_RPC   RPC (default: devnet, see scripts/_rpc.ts)
 */
import { readFileSync } from "fs";
import { Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import { devnetConnection, sendAndPoll } from "./_rpc";

const PROGRAM = new PublicKey("EptRxVBysFzJEz52r58c2yCkpDGvF55aBPj1eCkWaphz");

const conn = devnetConnection();
const args = process.argv.slice(2);
const send = args.includes("--send");

function disc(name: string): Buffer {
  return Buffer.from(sha256(new TextEncoder().encode(`global:${name}`)).slice(0, 8));
}

function pda(seed: string): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(seed)], PROGRAM)[0];
}

const packConfig = pda("pack_config");
const mintConfig = pda("mint_config");

/** paused, pauser and admin, read straight off the PackConfig bytes. */
async function readState(): Promise<{ admin: PublicKey; paused: boolean; pauser: PublicKey | null }> {
  const info = await conn.getAccountInfo(packConfig);
  if (!info) throw new Error("No pack config on this cluster");
  const d = Buffer.from(info.data);
  const admin = new PublicKey(d.subarray(8, 40));
  // admin, currency, treasury (3 x 32), season (2), 8 packs of 21, count (1).
  const end = 8 + 96 + 2 + 8 * 21 + 1;
  if (d.length < end + 33) return { admin, paused: false, pauser: null };
  return { admin, paused: d[end] === 1, pauser: new PublicKey(d.subarray(end + 1, end + 33)) };
}

async function main() {
  const [command, who] = args;
  const state = await readState();
  console.log(`rpc      ${conn.rpcEndpoint.replace(/api-key=.*/, "api-key=***")}`);
  console.log(`admin    ${state.admin.toBase58()}`);
  console.log(`pauser   ${state.pauser?.toBase58() ?? "(old layout: run packs-setup to migrate)"}`);
  console.log(`paused   ${state.paused}`);
  if (command === "status" || !command) return;
  if (command !== "pause" && command !== "resume") throw new Error(`Unknown command "${command}"`);
  if (!state.pauser) throw new Error("Migrate the pack config first");

  const squads = who === "--squads";
  const signer = squads ? new PublicKey(args[2]) : load(who).publicKey;
  const pausing = command === "pause";
  if (!signer.equals(state.admin) && !(pausing && signer.equals(state.pauser))) {
    throw new Error(`${signer.toBase58()} may not ${command}`);
  }

  const hasMint = (await conn.getAccountInfo(mintConfig)) !== null;
  const ix = new TransactionInstruction({
    programId: PROGRAM,
    keys: [
      { pubkey: packConfig, isSigner: false, isWritable: true },
      // Anchor spells an absent optional account as the program id.
      { pubkey: hasMint ? mintConfig : PROGRAM, isSigner: false, isWritable: hasMint },
      { pubkey: signer, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([disc("set_paused"), Buffer.from([pausing ? 1 : 0])]),
  });

  if (squads) {
    console.log("\nSquads instruction:");
    console.log(`  program  ${ix.programId.toBase58()}`);
    for (const k of ix.keys) {
      console.log(`  account  ${k.pubkey.toBase58()}  ${k.isSigner ? "signer " : ""}${k.isWritable ? "writable" : ""}`);
    }
    console.log(`  data     ${ix.data.toString("hex")}`);
    return;
  }
  if (!send) { console.log(`\nDRY RUN: would ${command}. Add --send.`); return; }
  const sig = await sendAndPoll(conn, new Transaction().add(ix), [load(who)]);
  console.log(`\n${command}d  ${sig}`);
}

function load(path: string): Keypair {
  if (!path) throw new Error("Pass the keypair path");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

main().catch((err) => { console.error(err); process.exit(1); });
