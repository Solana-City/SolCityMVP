/**
 * Sol City — creates (or tops up) the address lookup table the pack
 * transactions compile against. See src/game/solana/lookupTable.ts for why:
 * without it, opening a sealed pack does not fit in a transaction at all.
 *
 *   npx tsx scripts/lookup-table-setup.ts <payer-keypair.json> [--table <address>] [--freeze] [--send]
 *
 * A dry run unless --send, like the other setup scripts. Runs against
 * SOLCITY_RPC (devnet by default), and says which network it found.
 *
 * Without --table it creates a new table, with the payer as its authority.
 * With --table it adds whatever the current config needs that the table does
 * not hold yet (a rotated tree, a new season's drops), which only the table's
 * authority can do.
 *
 * --freeze makes the table immutable afterwards and removes its authority.
 * Nobody can then add to it, but nobody can deactivate it out from under the
 * shop either. MAINNET REFUSES TO RUN WITHOUT IT: a lookup table's authority
 * cannot be handed to the multisig (the program has no instruction for it),
 * so the honest choices are "the deploy key keeps it" or "nobody does", and
 * the deploy key is retired on launch day. A frozen table that falls behind
 * is still correct, only larger: a new season adds 32 bytes and a new tree
 * about 70 (its tree and tree config), against ~280 to spare. To catch
 * up, create a new table and point NEXT_PUBLIC_PACK_LOOKUP_TABLE at it.
 *
 * Run after packs-setup and mint-setup: it reads both configs from the chain.
 * Prints the line to put in the site's environment. Costs about 0.004 SOL of
 * rent for ~25 addresses, plus fees.
 */
import { readFileSync } from "fs";
import {
  AddressLookupTableProgram, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction,
} from "@solana/web3.js";
import { devnetConnection, networkOf, sendAndPoll, Stopped } from "./_rpc";
import { readPackConfig } from "../src/game/solana/packs";
import { readMintConfig } from "../src/game/solana/mint";
import { packLookupTableAddresses } from "../src/game/solana/sealedPacks";

/** Addresses per extend: 32 bytes each, well inside one transaction. */
const PER_EXTEND = 20;

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
}

async function main() {
  const payerPath = process.argv[2];
  if (!payerPath || payerPath.startsWith("--")) {
    throw new Stopped(
      "no payer keypair given (it becomes the table's authority until --freeze)",
      "npx tsx scripts/lookup-table-setup.ts <payer-keypair.json> [--table <address>] [--freeze] [--send]",
    );
  }
  const send = process.argv.includes("--send");
  const freeze = process.argv.includes("--freeze");
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(payerPath, "utf8"))));
  const conn = devnetConnection();

  const network = await networkOf(conn);
  console.log(`network     ${network}`);
  console.log(`payer       ${payer.publicKey.toBase58()}, ${(await conn.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL} SOL`);
  if (network !== "devnet" && !freeze) {
    throw new Stopped(
      `this RPC is ${network}, and the table would stay under ${payer.publicKey.toBase58()}`,
      "add --freeze: a lookup table's authority cannot move to the multisig, so on mainnet nobody keeps it",
    );
  }

  const config = await readPackConfig(conn);
  const mintConfig = await readMintConfig(conn);
  if (!config || !mintConfig) {
    throw new Stopped("PackConfig or MintConfig is missing on this network", "run packs-setup and mint-setup first");
  }

  // Every season up to the current one: a sealed pack from a closed season
  // still opens, and names its own season's drops.
  const seasons = Array.from({ length: Math.max(1, config.currentSeason) }, (_, i) => i + 1);
  const wanted = packLookupTableAddresses({ config, mintConfig, seasons });

  const existing = flag("--table");
  const current = existing ? (await conn.getAddressLookupTable(new PublicKey(existing))).value : null;
  if (existing && !current) throw new Stopped(`no lookup table at ${existing}`, "drop --table to create one");
  if (current && !current.state.authority) {
    throw new Stopped(`${existing} is frozen and cannot be added to`, "drop --table to create a new one");
  }
  const held = new Set((current?.state.addresses ?? []).map((k) => k.toBase58()));
  const missing = wanted.filter((k) => !held.has(k.toBase58()));

  console.log(`table       ${existing ?? "new"}`);
  console.log(`wanted      ${wanted.length} addresses (seasons 1..${seasons.length}, tree ${mintConfig.merkleTree.toBase58()})`);
  console.log(`to add      ${missing.length}`);
  console.log(`freeze      ${freeze ? "yes, no authority afterwards" : `no, ${payer.publicKey.toBase58()} stays the authority`}`);
  console.log(send ? "\nSENDING\n" : "\nDRY RUN - nothing is sent. Add --send.\n");
  if (!send) return;

  let table: PublicKey;
  if (existing) {
    table = new PublicKey(existing);
  } else {
    const slot = await conn.getSlot("finalized");
    const [create, address] = AddressLookupTableProgram.createLookupTable({
      authority: payer.publicKey, payer: payer.publicKey, recentSlot: slot,
    });
    await sendAndPoll(conn, new Transaction().add(create), [payer]);
    table = address;
    console.log(`created     ${table.toBase58()}`);
  }

  for (let i = 0; i < missing.length; i += PER_EXTEND) {
    const chunk = missing.slice(i, i + PER_EXTEND);
    await sendAndPoll(conn, new Transaction().add(AddressLookupTableProgram.extendLookupTable({
      lookupTable: table, authority: payer.publicKey, payer: payer.publicKey, addresses: chunk,
    })), [payer]);
    console.log(`added       ${chunk.length} addresses`);
  }
  if (missing.length === 0) console.log("up to date  nothing to add");

  if (freeze) {
    await sendAndPoll(conn, new Transaction().add(AddressLookupTableProgram.freezeLookupTable({
      lookupTable: table, authority: payer.publicKey,
    })), [payer]);
    console.log("frozen      the table can no longer change");
  }

  const final = (await conn.getAddressLookupTable(table)).value;
  console.log(`table       ${table.toBase58()}`);
  console.log(`addresses   ${final?.state.addresses.length ?? 0}`);
  console.log(`authority   ${final?.state.authority?.toBase58() ?? "none (frozen)"}`);
  console.log(`\nSet in the site's environment (Vercel) and redeploy:`);
  console.log(`  NEXT_PUBLIC_PACK_LOOKUP_TABLE=${table.toBase58()}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
