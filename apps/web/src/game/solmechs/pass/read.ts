/**
 * Sol Mechs — reading the pass sale and pass ownership from chain.
 *
 * Ownership is read here rather than trusted from local state: the hangar
 * gates four mechs on holding a pass, so "do I own one" has to come from the
 * chain every time, not from a cached flag.
 */
import { publicKey } from "@metaplex-foundation/umi";
import { fetchCandyMachine } from "@metaplex-foundation/mpl-core-candy-machine";
import { fetchAssetsByOwner, type AssetV1 } from "@metaplex-foundation/mpl-core";
import { getPassUmi } from "./umi";
import { candyMachinePk, collectionPk, prizePoolPk, isPassConfigured } from "./config";

export interface SaleState {
  /** Items the candy machine can still mint. */
  remaining: number;
  minted: number;
  available: number;
}

export async function fetchSaleState(): Promise<SaleState | null> {
  if (!candyMachinePk) return null;
  const umi = getPassUmi();
  const cm = await fetchCandyMachine(umi, publicKey(candyMachinePk.toBase58()));
  const minted = Number(cm.itemsRedeemed);
  const available = Number(cm.data.itemsAvailable);
  return { minted, available, remaining: Math.max(0, available - minted) };
}

/**
 * Passes held by a wallet.
 *
 * `fetchAssetsByOwner` is a getProgramAccounts scan, so it is filtered here by
 * collection rather than by asking the RPC for a narrower set — Core stores
 * the collection in the asset's update authority, which is not a fixed offset
 * we can hand to a memcmp filter.
 */
export async function fetchOwnedPasses(owner: string): Promise<AssetV1[]> {
  if (!collectionPk) return [];
  const umi = getPassUmi();
  const assets = await fetchAssetsByOwner(umi, publicKey(owner), {
    skipDerivePlugins: true,
  });
  const collection = collectionPk.toBase58();
  return assets.filter(
    (a) => a.updateAuthority.type === "Collection"
      && a.updateAuthority.address?.toString() === collection,
  );
}

/** Whether this wallet may play ranked — one pass is enough. */
export async function holdsPass(owner: string): Promise<boolean> {
  if (!isPassConfigured()) return false;
  const passes = await fetchOwnedPasses(owner);
  return passes.length > 0;
}

/**
 * Prize pool balance, straight from the wallet that holds it.
 *
 * Read rather than accumulated in the client so the number shown is the number
 * anyone can verify against the address.
 */
export async function fetchPrizePoolLamports(): Promise<number | null> {
  if (!prizePoolPk) return null;
  const umi = getPassUmi();
  const account = await umi.rpc.getAccount(publicKey(prizePoolPk.toBase58()));
  return account.exists ? Number(account.lamports.basisPoints) : 0;
}
