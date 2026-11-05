/**
 * Sol City — creates (or tops up) the address lookup table the pack
 * transactions compile against. See src/game/solana/lookupTable.ts for why.
 *
 *   npx tsx scripts/lookup-table-setup.ts <payer-keypair.json> [--table <address>] [--freeze]
 *
 * Without --table it creates a new table, with the payer as its authority.
 * With --table it adds whatever the current config needs that the table does
 * not hold yet (a rotated tree, a new season's drops), which only the table's
 * authority can do.
 *
 * --freeze makes the table immutable afterwards. Nobody can then add to it,
 * but nobody can deactivate it out from under the shop either. A table that
 * falls behind is still correct, only larger (lookupTable.ts): to catch up a
 * frozen one, create a new one and point the client at it.
 *
 * Prints the address to put in lookupTable.ts (or NEXT_PUBLIC_PACK_LOOKUP_TABLE).
 * Costs about 0.004 SOL of rent for ~25 addresses, plus fees.
 */
import { readFileSync } from "fs";
import {
  AddressLookupTableProgram, Keypair, PublicKey, Transaction,
} from "@solana/web3.js";
import { devnetConnection, sendAndPoll } from "./_rpc";
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
    throw new Error("Pass the payer keypair path first (it becomes the table's authority).");
  }
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(payerPath, "utf8"))));
  const conn = devnetConnection();

  const config = await readPackConfig(conn);
  const mintConfig = await readMintConfig(conn);
  if (!config || !mintConfig) throw new Error("PackConfig or MintConfig missing: run packs-setup and mint-setup first.");

  // Every season up to the current one: a sealed pack from a closed season
  // still opens, and names its own season's drops.
  const seasons = Array.from({ length: Math.max(1, config.currentSeason) }, (_, i) => i + 1);
  const wanted = packLookupTableAddresses({ config, mintConfig, seasons });

  let table: PublicKey;
  const existing = flag("--table");
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

  const current = (await conn.getAddressLookupTable(table)).value;
  const held = new Set((current?.state.addresses ?? []).map((k) => k.toBase58()));
  const missing = wanted.filter((k) => !held.has(k.toBase58()));
  for (let i = 0; i < missing.length; i += PER_EXTEND) {
    const chunk = missing.slice(i, i + PER_EXTEND);
    await sendAndPoll(conn, new Transaction().add(AddressLookupTableProgram.extendLookupTable({
      lookupTable: table, authority: payer.publicKey, payer: payer.publicKey, addresses: chunk,
    })), [payer]);
    console.log(`added       ${chunk.length} addresses`);
  }
  if (missing.length === 0) console.log("up to date  nothing to add");

  if (process.argv.includes("--freeze")) {
    await sendAndPoll(conn, new Transaction().add(AddressLookupTableProgram.freezeLookupTable({
      lookupTable: table, authority: payer.publicKey,
    })), [payer]);
    console.log("frozen      the table can no longer change");
  }

  const final = (await conn.getAddressLookupTable(table)).value;
  console.log(`table       ${table.toBase58()}`);
  console.log(`addresses   ${final?.state.addresses.length ?? 0}`);
  console.log(`authority   ${final?.state.authority?.toBase58() ?? "none (frozen)"}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
