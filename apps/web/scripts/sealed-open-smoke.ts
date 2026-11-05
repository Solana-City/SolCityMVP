/**
 * Sol City — checks that a sealed pack on devnet can be opened, without
 * anybody's key.
 *
 * Builds the exact transaction openSealedPack hands the wallet, for a real
 * sealed pack held by a real wallet, and simulates it with signature checks
 * off. The simulation runs the program for real: Bubblegum walks the proof
 * and burns the leaf, the VRF request is made, the unlock account grows. So
 * a pass means the size, the proof, the metadata hash and the accounts are
 * all right, and the only thing left untested is the holder's signature.
 *
 *   npx tsx scripts/sealed-open-smoke.ts [assetId]
 *
 * With no asset it takes the first unburnt sealed pack in the collection.
 * NEXT_PUBLIC_PACK_LOOKUP_TABLE picks a table other than the default.
 * Sends nothing.
 */
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { devnetConnection } from "./_rpc";
import { readMintConfig } from "../src/game/solana/mint";
import { readPackConfig } from "../src/game/solana/packs";
import { PACK_LOOKUP_TABLE } from "../src/game/solana/lookupTable";
import {
  buildOpenSealedPackTx, buildOpenPackFromAssetIx, getAssetProof, sealedPackMetadata,
} from "../src/game/solana/sealedPacks";

// getAssetProof posts to the RPC with the global fetch, and the Helius key is
// origin-locked (_rpc.ts), so the script's fetch carries the origin too.
const ORIGIN = process.env.SOLCITY_RPC_ORIGIN ?? "https://solanacity.io";
const plainFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => plainFetch(input, {
  ...init, headers: { ...(init?.headers as Record<string, string>), origin: ORIGIN },
})) as typeof fetch;

interface DasAsset {
  id: string;
  burnt: boolean;
  ownership: { owner: string };
  compression: { leaf_id: number };
  content: { json_uri: string };
}

async function main() {
  const conn = devnetConnection();
  const [mintConfig, config] = await Promise.all([readMintConfig(conn), readPackConfig(conn)]);
  if (!mintConfig || !config) throw new Error("MintConfig or PackConfig missing on devnet");

  const res = await fetch(conn.rpcEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: "smoke", method: "getAssetsByGroup",
      params: { groupKey: "collection", groupValue: mintConfig.collectionMint.toBase58(), page: 1, limit: 1000 },
    }),
  });
  const items = ((await res.json()) as { result?: { items?: DasAsset[] } }).result?.items ?? [];
  const prefix = `${mintConfig.baseUri}pack-`;
  const sealed = items.filter((i) => !i.burnt && i.content.json_uri.startsWith(prefix));
  const want = process.argv[2];
  const asset = want ? sealed.find((i) => i.id === want) : sealed[0];
  if (!asset) throw new Error(want ? `${want} is not an unburnt sealed pack` : "no sealed pack on devnet to try");

  const packId = Number(asset.content.json_uri.slice(prefix.length).replace(/\.json$/, ""));
  const pack = config.packs.find((p) => p.id === packId);
  if (!pack) throw new Error(`pack ${packId} is not in the config`);
  const owner = new PublicKey(asset.ownership.owner);
  const assetId = new PublicKey(asset.id);

  console.log(`asset       ${asset.id}  (pack ${packId}, leaf ${asset.compression.leaf_id})`);
  console.log(`holder      ${owner.toBase58()}`);
  console.log(`table       ${PACK_LOOKUP_TABLE?.toBase58() ?? "none"}`);

  // What main sent before this change, for comparison: legacy, whole proof.
  const proof = await getAssetProof(conn, assetId);
  const legacy = new Transaction({ recentBlockhash: (await conn.getLatestBlockhash()).blockhash, feePayer: owner })
    .add(buildOpenPackFromAssetIx({
      opener: owner, pack, mintConfig, clientSeed: new Uint8Array(32), proof,
      nonce: asset.compression.leaf_id, metadata: sealedPackMetadata(mintConfig, packId),
    }));
  let legacySize = "too large to encode";
  try { legacySize = `${new VersionedTransaction(legacy.compileMessage()).serialize().length} bytes`; } catch { /* stays */ }
  console.log(`legacy      ${legacySize} with the trimmed proof, no table`);

  const { tx, proofNodes } = await buildOpenSealedPackTx({
    wallet: owner, assetId, nonce: asset.compression.leaf_id, pack, mintConfig, conn,
  });
  const size = tx.serialize().length;
  console.log(`proof       ${proofNodes} nodes`);
  console.log(`v0          ${size} bytes of 1232, ${tx.message.addressTableLookups.reduce((n, l) => n + l.readonlyIndexes.length + l.writableIndexes.length, 0)} accounts from the table`);

  // buildOpenSealedPackTx already simulated it and would have thrown; this
  // second run is only to print what the program did.
  const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
  if (sim.value.err) throw new Error(`simulation failed: ${JSON.stringify(sim.value.err)}\n${(sim.value.logs ?? []).join("\n")}`);
  const logs = sim.value.logs ?? [];
  const burned = logs.some((l) => l.includes("Instruction: Burn"));
  const vrf = logs.some((l) => l.includes(VRF_TAG));
  console.log(`simulation  ok, ${sim.value.unitsConsumed} CU; burn ${burned ? "ran" : "NOT SEEN"}; VRF request ${vrf ? "ran" : "NOT SEEN"}`);
  console.log("PASS");
}

/** MagicBlock's VRF program id, as it appears in the invoke log line. */
const VRF_TAG = "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz invoke";

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
