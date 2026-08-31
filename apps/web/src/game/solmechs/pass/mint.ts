/**
 * Sol Mechs — minting a Genesis pass.
 *
 * The buyer mints; the candy machine enforces price, supply and the per-wallet
 * limit. Nothing here can be talked out of those by a modified client, which
 * is what lets the sale run with no backend of ours.
 */
import { generateSigner, publicKey, some, transactionBuilder } from "@metaplex-foundation/umi";
import type { Umi } from "@metaplex-foundation/umi";
import { walletAdapterIdentity } from "@metaplex-foundation/umi-signer-wallet-adapters";
import { mintV1, fetchCandyMachine } from "@metaplex-foundation/mpl-core-candy-machine";
import { setComputeUnitLimit } from "@metaplex-foundation/mpl-toolbox";
import type { WalletAdapter } from "@solana/wallet-adapter-base";
import { getPassUmi } from "./umi";
import { candyMachinePk, collectionPk, treasuryPk } from "./config";
import { SUPPLY } from "../season/config";

/**
 * Compute budget for one mint.
 *
 * Core mints run over the 200k default once the guard set is non-trivial, and
 * the failure mode is an exceeded-CU error rather than anything that names the
 * real cause — so the limit is raised explicitly instead of being discovered.
 */
const MINT_COMPUTE_UNITS = 800_000;

export interface MintResult {
  /** The minted pass. */
  asset: string;
  signature: string;
}

/**
 * Mint one pass to the connected wallet.
 *
 * `mintLimit` needs an id that matches the guard configured at creation, and
 * the same id must be used forever: it seeds the per-wallet counter PDA, so
 * changing it silently resets everyone's allowance.
 */
export async function mintPass(wallet: WalletAdapter): Promise<MintResult> {
  if (!candyMachinePk || !collectionPk) {
    throw new Error("Pass sale is not configured yet.");
  }
  if (!treasuryPk) throw new Error("Treasury address is missing.");

  const umi: Umi = getPassUmi().use(walletAdapterIdentity(wallet));
  const cm = await fetchCandyMachine(umi, publicKey(candyMachinePk.toBase58()));
  const asset = generateSigner(umi);

  const built = await transactionBuilder()
    .add(setComputeUnitLimit(umi, { units: MINT_COMPUTE_UNITS }))
    .add(
      mintV1(umi, {
        candyMachine: cm.publicKey,
        asset,
        collection: publicKey(collectionPk.toBase58()),
        mintArgs: {
          solPayment: some({ destination: publicKey(treasuryPk.toBase58()) }),
          mintLimit: some({ id: MINT_LIMIT_ID }),
        },
      }),
    )
    .sendAndConfirm(umi, { confirm: { commitment: "confirmed" } });

  return {
    asset: asset.publicKey.toString(),
    signature: Buffer.from(built.signature).toString("base64"),
  };
}

/**
 * Guard id for the per-wallet mint limit. Must match the value the candy
 * machine was created with — see `scripts/solmechs-pass-setup.ts`.
 */
export const MINT_LIMIT_ID = 1;

/** Per-wallet cap the guard enforces, mirrored for the UI. */
export const PER_WALLET_LIMIT = SUPPLY.PER_WALLET;
