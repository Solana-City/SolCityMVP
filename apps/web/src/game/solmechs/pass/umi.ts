/**
 * Sol Mechs — umi instance for the pass sale.
 *
 * Built on a Connection that uses `resilientBaseFetch`, so the mint inherits
 * the same Helius→api.devnet failover as the rest of the game. The Magic
 * Router is deliberately not in that list: it hangs on `sendRawTransaction`,
 * which is exactly what a mint does.
 */
import { Connection } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { mplCore } from "@metaplex-foundation/mpl-core";
import { mplCandyMachine } from "@metaplex-foundation/mpl-core-candy-machine";
import type { Umi } from "@metaplex-foundation/umi";
import { BASE_RPC_PRIMARY, resilientBaseFetch } from "@/game/solana/baseRpc";

let cached: Umi | null = null;

/** Read-only umi. Add a signer with `umi.use(walletAdapterIdentity(wallet))`. */
export function getPassUmi(): Umi {
  if (cached) return cached;
  const connection = new Connection(BASE_RPC_PRIMARY, {
    commitment: "confirmed",
    fetch: resilientBaseFetch as unknown as typeof fetch,
  });
  cached = createUmi(connection).use(mplCore()).use(mplCandyMachine());
  return cached;
}
