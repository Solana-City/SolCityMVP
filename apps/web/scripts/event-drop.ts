/**
 * Sol City — turn a frozen winners list into an event reward players claim.
 *
 * Two steps, and only the second touches the chain:
 *
 *   npx tsx scripts/event-drop.ts build --file <snapshot.json> --id 1 [--item hat:Pumpkin_head]
 *   npx tsx scripts/event-drop.ts publish <admin.json> --drop public/events/pumpkin-carving.json [--send]
 *   npx tsx scripts/event-drop.ts publish --squads <vault> --drop public/events/pumpkin-carving.json
 *
 * `build` reads a snapshot from `freeze-winners.ts` and writes
 * public/events/<snapshot id>.json: the item, the root, and the leaf hashes.
 * Hashes, not addresses, so the file can live in this public repo; see
 * src/game/solana/eventDrops.ts. Commit it and deploy the site.
 *
 * `publish` puts the root on chain: `init_event_drop` the first time,
 * `set_event_root` when the list changed (a winner added later). One small
 * account per event, paid by the admin, however many winners there are.
 * Dry run unless `--send`. With `--squads` nothing is signed: it prints the
 * instruction for a proposal, for when the admin is the multisig vault.
 *
 * Players then claim from the wardrobe, and pay for their own claim. The id
 * must match the entry in EVENT_DROPS (eventDrops.ts) that names this file.
 *
 * Env:
 *   SOLCITY_RPC   RPC (default: devnet, see scripts/_rpc.ts)
 */
import { readFileSync, writeFileSync } from "fs";
import { basename } from "path";
import {
  Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
} from "@solana/web3.js";
import { devnetConnection, sendAndPoll } from "./_rpc";
import { SOL_CITY_COLLECTIBLES_PROGRAM_ID, derivePackConfigPDA } from "../src/game/solana/program";
import { ixDiscriminator } from "../src/game/solana/instructions";
import {
  EVENT_DROPS, eventLeaf, eventRoot, sortLeaves, toHex, fromHex,
  deriveEventDropPDA, decodeEventDrop, type EventDropFile,
} from "../src/game/solana/eventDrops";
import { globalIndexOf, EVENT_BLOCK_START, EVENT_BLOCK_END } from "../src/game/config/catalogIndex";
import type { LayerCategory } from "../src/game/config/paperDoll";

interface Snapshot {
  kind: string;
  id: string;
  takenAt: string;
  wallets: string[];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}

function build(): void {
  const file = arg("file");
  const id = Number(arg("id"));
  const item = arg("item") ?? "hat:Pumpkin_head";
  if (!file || !Number.isInteger(id) || id < 0 || id > 0xffff) {
    throw new Error("usage: event-drop.ts build --file <snapshot.json> --id <0..65535> [--item cat:Variant] [--out path]");
  }
  const [category, variant] = item.split(":");
  const index = globalIndexOf(category as LayerCategory, variant);
  if (index < EVENT_BLOCK_START || index >= EVENT_BLOCK_END) {
    throw new Error(`${item} is index ${index}, outside the event block [${EVENT_BLOCK_START}, ${EVENT_BLOCK_END})`);
  }

  const snapshot = JSON.parse(readFileSync(file, "utf8")) as Snapshot;
  const wallets: PublicKey[] = [];
  for (const w of snapshot.wallets) {
    try { wallets.push(new PublicKey(w)); } catch { console.warn(`skipped, not an address: ${w}`); }
  }
  const leaves = sortLeaves(wallets.map((w) => eventLeaf(id, w)));
  const drop: EventDropFile = {
    id, item, index,
    root: toHex(eventRoot(leaves)),
    leaves: leaves.map(toHex),
  };
  const out = arg("out") ?? `public/events/${snapshot.id}.json`;
  writeFileSync(out, JSON.stringify(drop, null, 1) + "\n");

  console.log(`snapshot  ${snapshot.kind}:${snapshot.id}  taken ${snapshot.takenAt}`);
  console.log(`winners   ${leaves.length}`);
  console.log(`item      ${item}  ->  catalog index ${index}`);
  console.log(`root      ${drop.root}`);
  console.log(`wrote     ${out}`);
  const listed = EVENT_DROPS.find((d) => d.file === `/events/${basename(out)}`);
  if (!listed) console.warn(`\nNOTE: no EVENT_DROPS entry names /events/${basename(out)}; the wardrobe will not offer it.`);
  else if (listed.id !== id) console.warn(`\nNOTE: EVENT_DROPS has this file as id ${listed.id}, not ${id}.`);
}

async function publish(): Promise<void> {
  const who = process.argv[3];
  const squads = who === "--squads";
  const path = arg("drop");
  if (!who || !path) {
    throw new Error("usage: event-drop.ts publish <admin.json>|--squads <vault> --drop <file> [--send]");
  }
  const admin = squads ? new PublicKey(process.argv[4]) : null;
  const signer = squads ? null : Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(who, "utf8"))));
  const authority = admin ?? signer!.publicKey;

  const drop = JSON.parse(readFileSync(path, "utf8")) as EventDropFile;
  // The file is checked against itself before anything is sent: a root that
  // does not match its own leaves would be a drop nobody can claim.
  if (toHex(eventRoot(drop.leaves.map(fromHex))) !== drop.root) throw new Error(`${path}: root does not match its leaves`);

  const conn = devnetConnection();
  const pda = deriveEventDropPDA(drop.id);
  const info = await conn.getAccountInfo(pda);
  const current = info ? decodeEventDrop(info.data) : null;

  console.log(`rpc       ${conn.rpcEndpoint.replace(/api-key=.*/, "api-key=***")}`);
  console.log(`drop      id ${drop.id}  ${drop.item} (index ${drop.index})  ${drop.leaves.length} winners`);
  console.log(`account   ${pda.toBase58()}  ${current ? "exists" : "not created yet"}`);
  console.log(`admin     ${authority.toBase58()}`);

  let ix: TransactionInstruction;
  const config = derivePackConfigPDA()[0];
  const idLe = Buffer.alloc(2); idLe.writeUInt16LE(drop.id);
  if (!current) {
    const indexLe = Buffer.alloc(2); indexLe.writeUInt16LE(drop.index);
    ix = new TransactionInstruction({
      programId: SOL_CITY_COLLECTIBLES_PROGRAM_ID,
      keys: [
        { pubkey: authority,               isSigner: true,  isWritable: true  },
        { pubkey: config,                  isSigner: false, isWritable: false },
        { pubkey: pda,                     isSigner: false, isWritable: true  },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([ixDiscriminator("init_event_drop"), idLe, indexLe, Buffer.from(fromHex(drop.root))]),
    });
    console.log(`action    init_event_drop`);
  } else {
    if (current.index !== drop.index) {
      throw new Error(`on chain this drop hands out index ${current.index}, the file says ${drop.index}. A drop never changes its item; use a new id.`);
    }
    if (toHex(current.root) === drop.root) { console.log("\nAlready published with this root. Nothing to do."); return; }
    ix = new TransactionInstruction({
      programId: SOL_CITY_COLLECTIBLES_PROGRAM_ID,
      keys: [
        { pubkey: authority, isSigner: true,  isWritable: false },
        { pubkey: config,    isSigner: false, isWritable: false },
        { pubkey: pda,       isSigner: false, isWritable: true  },
      ],
      data: Buffer.concat([ixDiscriminator("set_event_root"), idLe, Buffer.from(fromHex(drop.root))]),
    });
    console.log(`action    set_event_root  (was ${toHex(current.root)})`);
  }
  console.log(`root      ${drop.root}`);

  if (squads) {
    console.log("\nSquads instruction:");
    console.log(`  program  ${ix.programId.toBase58()}`);
    for (const k of ix.keys) {
      console.log(`  account  ${k.pubkey.toBase58()}  ${k.isSigner ? "signer " : ""}${k.isWritable ? "writable" : ""}`);
    }
    console.log(`  data     ${ix.data.toString("hex")}`);
    return;
  }
  if (!process.argv.includes("--send")) { console.log("\nDRY RUN. Add --send."); return; }
  const sig = await sendAndPoll(conn, new Transaction().add(ix), [signer!]);
  console.log(`\npublished  ${sig}`);
}

const command = process.argv[2];
(command === "build" ? Promise.resolve(build()) : command === "publish" ? publish() : Promise.reject(
  new Error("usage: event-drop.ts build ... | publish ..."),
)).catch((err) => { console.error(err.message ?? err); process.exit(1); });
