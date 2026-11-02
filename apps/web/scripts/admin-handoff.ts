/**
 * Sol City — who holds what, and handing it to the multisig.
 *
 * Every key that can change the programs or the shop, read off the chain:
 * both upgrade authorities, the pack and mint admins, the pauser and the
 * owner of the treasury token account. With `--expect` each one is checked
 * against the vault that should hold it, which is the last step of a launch.
 *
 *   npx tsx scripts/admin-handoff.ts status [--expect <vault>]
 *   npx tsx scripts/admin-handoff.ts handoff <admin-keypair.json> <vault> [--send]
 *
 * `handoff` moves the pack admin and the mint admin (the pauser follows the
 * pack admin while they are the same key). It does NOT move the upgrade
 * authorities: that is the step with no way back, so it prints the commands
 * and leaves them to a person. Nothing is sent without `--send`.
 *
 * The vault, not the multisig: Squads shows two addresses, and only the vault
 * can sign. Authority given to the multisig account is lost, so `handoff`
 * refuses an address the Squads program owns.
 *
 * Env:
 *   SOLCITY_RPC   RPC (default: devnet, see scripts/_rpc.ts)
 */
import { readFileSync } from "fs";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import { devnetConnection, sendAndPoll } from "./_rpc";

const CITY = new PublicKey("HPvDFVnruSXHwKKP44eUvRh8oYqBaHCeQbK1sKWT1aU2");
const COLLECTIBLES = new PublicKey("EptRxVBysFzJEz52r58c2yCkpDGvF55aBPj1eCkWaphz");
const SQUADS = new PublicKey("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");
const DELEGATION = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

const conn = devnetConnection();
const args = process.argv.slice(2);
const send = args.includes("--send");

function disc(name: string): Buffer {
  return Buffer.from(sha256(new TextEncoder().encode(`global:${name}`)).slice(0, 8));
}

function pda(seed: string, program: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(seed)], program)[0];
}

const packConfig = pda("pack_config", COLLECTIBLES);
const mintConfig = pda("mint_config", COLLECTIBLES);
const hunt = pda("hunt_v2", CITY);

/** The upgrade authority, from the program's ProgramData; null if immutable. */
async function upgradeAuthority(program: PublicKey): Promise<PublicKey | null> {
  const info = await conn.getAccountInfo(program);
  if (!info) throw new Error(`${program.toBase58()} is not deployed on this cluster`);
  // UpgradeableLoaderState::Program: u32 tag, then the ProgramData address.
  const programData = new PublicKey(info.data.subarray(4, 36));
  const pd = await conn.getAccountInfo(programData);
  if (!pd) throw new Error(`No ProgramData for ${program.toBase58()}`);
  // ::ProgramData: u32 tag, u64 slot, Option<Pubkey>.
  return pd.data[12] === 1 ? new PublicKey(pd.data.subarray(13, 45)) : null;
}

type Roles = {
  cityUpgrade: PublicKey | null;
  collectiblesUpgrade: PublicKey | null;
  packAdmin: PublicKey | null;
  pauser: PublicKey | null;
  paused: boolean | null;
  treasuryAta: PublicKey | null;
  treasuryOwner: PublicKey | null;
  mintAdmin: PublicKey | null;
  hunt: string;
};

async function readRoles(): Promise<Roles> {
  const [cityUpgrade, collectiblesUpgrade, pack, mint, huntInfo] = await Promise.all([
    upgradeAuthority(CITY),
    upgradeAuthority(COLLECTIBLES),
    conn.getAccountInfo(packConfig),
    conn.getAccountInfo(mintConfig),
    conn.getAccountInfo(hunt),
  ]);

  let packAdmin = null, pauser = null, paused = null, treasuryAta = null, treasuryOwner = null;
  if (pack) {
    const d = Buffer.from(pack.data);
    packAdmin = new PublicKey(d.subarray(8, 40));
    treasuryAta = new PublicKey(d.subarray(72, 104));
    // Same offsets as shop-pause.ts: admin, currency, treasury, season,
    // 8 packs of 21, count, then paused and pauser.
    const end = 8 + 96 + 2 + 8 * 21 + 1;
    if (d.length >= end + 33) {
      paused = d[end] === 1;
      pauser = new PublicKey(d.subarray(end + 1, end + 33));
    }
    const ata = await conn.getAccountInfo(treasuryAta);
    // SPL token account: mint, then owner.
    if (ata) treasuryOwner = new PublicKey(ata.data.subarray(32, 64));
  }
  const mintAdmin = mint ? new PublicKey(mint.data.subarray(8, 40)) : null;

  const huntState = !huntInfo
    ? "missing (run scripts/hunt-setup.ts)"
    : huntInfo.owner.equals(DELEGATION) ? "delegated to the rollup" : "on the base layer, not delegated";

  return {
    cityUpgrade, collectiblesUpgrade, packAdmin, pauser, paused,
    treasuryAta, treasuryOwner, mintAdmin, hunt: huntState,
  };
}

function show(label: string, key: PublicKey | null, expect: PublicKey | null, missing: string) {
  const value = key?.toBase58() ?? missing;
  const mark = !expect ? "" : key?.equals(expect) ? "  OK" : "  <-- not the vault";
  console.log(`${label.padEnd(22)} ${value}${mark}`);
}

async function status(expect: PublicKey | null) {
  const r = await readRoles();
  console.log(`rpc                    ${conn.rpcEndpoint.replace(/api-key=.*/, "api-key=***")}`);
  if (expect) console.log(`expected vault         ${expect.toBase58()}`);
  console.log("");
  show("sol-city upgrade", r.cityUpgrade, expect, "(immutable)");
  show("collectibles upgrade", r.collectiblesUpgrade, expect, "(immutable)");
  show("pack admin", r.packAdmin, expect, "(no pack config)");
  show("pauser", r.pauser, expect, "(old layout: run packs-setup)");
  show("mint admin", r.mintAdmin, expect, "(no mint config)");
  show("treasury owner", r.treasuryOwner, expect, "(no treasury account)");
  console.log(`${"treasury account".padEnd(22)} ${r.treasuryAta?.toBase58() ?? "-"}`);
  console.log(`${"shop paused".padEnd(22)} ${r.paused ?? "-"}`);
  console.log(`${"hunt".padEnd(22)} ${r.hunt}`);
}

/**
 * Refuses anything that cannot be a Squads vault. A vault is a PDA with no
 * data: the system program owns it once it holds lamports, and nothing owns
 * it before. The multisig account is the Squads program's.
 */
async function checkVault(vault: PublicKey) {
  const info = await conn.getAccountInfo(vault);
  if (info?.owner.equals(SQUADS)) {
    const derived = PublicKey.findProgramAddressSync(
      [Buffer.from("multisig"), vault.toBuffer(), Buffer.from("vault"), Buffer.from([0])],
      SQUADS,
    )[0];
    throw new Error(
      `${vault.toBase58()} is the multisig account, not its vault. Its vault 0 is `
      + `${derived.toBase58()}: check that it matches the vault the Squads app shows.`,
    );
  }
  if (info && !info.owner.equals(SystemProgram.programId)) {
    throw new Error(`${vault.toBase58()} is owned by ${info.owner.toBase58()}: not a vault`);
  }
  if (!info) console.log("note: the vault holds no SOL yet. That is normal for a new Squads vault.");
}

function setAdminIx(name: "set_pack_admin" | "set_mint_admin", config: PublicKey, admin: PublicKey, vault: PublicKey) {
  return new TransactionInstruction({
    programId: COLLECTIBLES,
    keys: [
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([disc(name), vault.toBuffer()]),
  });
}

async function handoff(admin: Keypair, vault: PublicKey) {
  await checkVault(vault);
  const r = await readRoles();
  await status(null);
  console.log("");

  const ixs: TransactionInstruction[] = [];
  for (const [name, config, current] of [
    ["set_pack_admin", packConfig, r.packAdmin],
    ["set_mint_admin", mintConfig, r.mintAdmin],
  ] as const) {
    if (!current) { console.log(`${name}: no config on this cluster, skipped`); continue; }
    if (current.equals(vault)) { console.log(`${name}: already the vault`); continue; }
    if (!current.equals(admin.publicKey)) {
      throw new Error(`${name}: the admin is ${current.toBase58()}, not this keypair`);
    }
    ixs.push(setAdminIx(name, config, admin.publicKey, vault));
    console.log(`${name}: ${current.toBase58()} -> ${vault.toBase58()}`);
  }
  if (r.pauser && r.packAdmin && !r.pauser.equals(r.packAdmin)) {
    console.log(`note: the pauser ${r.pauser.toBase58()} is not the admin, so it stays where it is`);
  }

  if (ixs.length && !send) console.log("\nDRY RUN: nothing sent. Add --send.");
  if (ixs.length && send) {
    const sig = await sendAndPoll(conn, new Transaction().add(...ixs), [admin]);
    console.log(`\nadmins moved  ${sig}`);
  }

  // Not done here on purpose: a wrong address cannot be taken back.
  console.log("\nUpgrade authorities, by hand, after checking the vault address twice:");
  for (const [program, current] of [[CITY, r.cityUpgrade], [COLLECTIBLES, r.collectiblesUpgrade]] as const) {
    if (current?.equals(vault)) { console.log(`  ${program.toBase58()}: already the vault`); continue; }
    console.log(
      `  solana program set-upgrade-authority ${program.toBase58()} `
      + `--new-upgrade-authority ${vault.toBase58()} --skip-new-upgrade-authority-signer-check `
      + `--upgrade-authority <deploy-keypair.json> --url <rpc>`,
    );
  }
  console.log("\nThen: npx tsx scripts/admin-handoff.ts status --expect " + vault.toBase58());
}

async function main() {
  const [command] = args;
  if (!command || command === "status") {
    const i = args.indexOf("--expect");
    return status(i >= 0 ? new PublicKey(args[i + 1]) : null);
  }
  if (command === "handoff") {
    const [, keypairPath, vault] = args;
    if (!vault) throw new Error("Pass the admin keypair path and the vault address");
    return handoff(load(keypairPath), new PublicKey(vault));
  }
  throw new Error(`Unknown command "${command}"`);
}

function load(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

main().catch((err) => { console.error(err); process.exit(1); });
