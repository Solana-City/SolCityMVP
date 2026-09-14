/**
 * Sol Mechs — create the Season 1 Battle Pass sale on devnet.
 *
 * One-time setup. Creates the Core collection and the candy machine that
 * mints from it, then prints the env block to paste into `.env.local`.
 *
 *   SOLMECHS_SETUP_KEYPAIR=~/.config/solana/id.json \
 *   SOLMECHS_TREASURY=<pubkey> \
 *   npx tsx apps/web/scripts/solmechs-pass-setup.ts
 *
 * Idempotency: it is NOT idempotent. Running it twice creates a second
 * collection and a second candy machine, and the first pair keeps existing.
 * Check for an existing address in `.env.local` before running.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Connection } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  generateSigner, keypairIdentity, percentAmount, publicKey, sol, some, dateTime,
} from "@metaplex-foundation/umi";
import { createCollection, mplCore, ruleSet } from "@metaplex-foundation/mpl-core";
import { create, mplCandyMachine } from "@metaplex-foundation/mpl-core-candy-machine";

const RPC = process.env.SOLMECHS_RPC || "https://api.devnet.solana.com";

/** Total supply, including the reserved tranche. Mirrors season/config.ts. */
const ITEMS_AVAILABLE = 1_111;
const PRICE_SOL = 0.1;
/** Per-wallet cap. Mirrors SUPPLY.PER_WALLET. */
const PER_WALLET_LIMIT = 10;
/**
 * Seeds the per-wallet counter PDA. Changing it later resets every buyer's
 * allowance, so it is fixed here and mirrored in `pass/mint.ts`.
 */
const MINT_LIMIT_ID = 1;
const ROYALTY_BASIS_POINTS = 500;

/** Metadata served from the app itself, so we control it and it is stable. */
const METADATA_URI =
  process.env.SOLMECHS_METADATA_URI
  || "https://solanacity.io/assets/minigames/sol-mechs/pass/battle-pass-s1.json";

function loadKeypairBytes(): Uint8Array {
  const raw = process.env.SOLMECHS_SETUP_KEYPAIR;
  if (!raw) throw new Error("SOLMECHS_SETUP_KEYPAIR is required (path to a Solana keypair json)");
  const file = raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
  return Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8")) as number[]);
}

async function main(): Promise<void> {
  const treasury = process.env.SOLMECHS_TREASURY;
  if (!treasury) throw new Error("SOLMECHS_TREASURY is required (pubkey receiving sale proceeds)");

  const umi = createUmi(new Connection(RPC, "confirmed")).use(mplCore()).use(mplCandyMachine());
  const authority = umi.eddsa.createKeypairFromSecretKey(loadKeypairBytes());
  umi.use(keypairIdentity(authority));

  const balance = await umi.rpc.getBalance(authority.publicKey);
  console.log(`authority ${authority.publicKey}`);
  console.log(`balance   ${Number(balance.basisPoints) / 1e9} SOL`);
  if (Number(balance.basisPoints) < 0.5e9) {
    throw new Error("authority needs at least ~0.5 SOL for rent; airdrop first");
  }

  // ── collection ────────────────────────────────────────────────────────────
  // Royalties are a creation-time plugin: they cannot be added to a collection
  // that already exists, and secondary is the long-term revenue line.
  const collection = generateSigner(umi);
  console.log(`\ncreating collection ${collection.publicKey} ...`);
  await createCollection(umi, {
    collection,
    name: "Sol Mechs Battle Pass — Season 1",
    uri: METADATA_URI,
    plugins: [
      {
        type: "Royalties",
        basisPoints: ROYALTY_BASIS_POINTS,
        creators: [{ address: authority.publicKey, percentage: 100 }],
        ruleSet: ruleSet("None"),
      },
    ],
  }).sendAndConfirm(umi, { confirm: { commitment: "confirmed" } });
  console.log("  collection created");

  // ── candy machine ─────────────────────────────────────────────────────────
  // `hiddenSettings` rather than config lines: every pass is identical, so one
  // name template and one URI describe all 1,111. Config lines would mean
  // inserting 1,111 rows across ~100 transactions to say the same thing.
  const candyMachine = generateSigner(umi);
  console.log(`\ncreating candy machine ${candyMachine.publicKey} ...`);
  await (await create(umi, {
    candyMachine,
    collection: collection.publicKey,
    collectionUpdateAuthority: umi.identity,
    itemsAvailable: BigInt(ITEMS_AVAILABLE),
    isMutable: true,
    hiddenSettings: some({
      name: "Sol Mechs Battle Pass S1 #$ID$",
      uri: METADATA_URI,
      // No reveal, so the hash is not a commitment to anything; it just has to
      // be 32 bytes.
      hash: new Uint8Array(32),
    }),
    guards: {
      solPayment: some({ lamports: sol(PRICE_SOL), destination: publicKey(treasury) }),
      mintLimit: some({ id: MINT_LIMIT_ID, limit: PER_WALLET_LIMIT }),
      startDate: some({ date: dateTime(new Date()) }),
    },
  })).sendAndConfirm(umi, { confirm: { commitment: "confirmed" } });
  console.log("  candy machine created");

  console.log(`
─────────────────────────────────────────────────────────────
Paste into apps/web/.env.local :

NEXT_PUBLIC_SOLMECHS_CANDY_MACHINE=${candyMachine.publicKey}
NEXT_PUBLIC_SOLMECHS_COLLECTION=${collection.publicKey}
NEXT_PUBLIC_SOLMECHS_TREASURY=${treasury}
NEXT_PUBLIC_SOLMECHS_PRIZE_POOL=<pubkey holding the prize pool>
─────────────────────────────────────────────────────────────

supply ${ITEMS_AVAILABLE} · ${PRICE_SOL} SOL · max ${PER_WALLET_LIMIT}/wallet
royalty ${ROYALTY_BASIS_POINTS / 100}%
metadata ${METADATA_URI}
`);
}

main().catch((e) => {
  console.error("setup failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
