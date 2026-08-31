/**
 * Sol Mechs — Battle Pass, on-chain addresses.
 *
 * Filled in by `scripts/solmechs-pass-setup.ts`, which creates the collection
 * and the candy machine and prints the env block to paste. Until then
 * `isPassConfigured()` is false and the mint UI stays disabled rather than
 * throwing on an invalid public key.
 */
import { PublicKey } from "@solana/web3.js";

function env(name: string): string {
  return (typeof process !== "undefined" && process.env?.[name]) || "";
}

/** Core Candy Machine that mints the passes. */
export const CANDY_MACHINE_ADDRESS = env("NEXT_PUBLIC_SOLMECHS_CANDY_MACHINE");
/** Core Collection every pass belongs to. Also the pass-ownership check. */
export const COLLECTION_ADDRESS = env("NEXT_PUBLIC_SOLMECHS_COLLECTION");
/** Receives the sale proceeds. */
export const TREASURY_ADDRESS = env("NEXT_PUBLIC_SOLMECHS_TREASURY");
/** Holds the prize pool. Published so the figure on the sale page is checkable. */
export const PRIZE_POOL_ADDRESS = env("NEXT_PUBLIC_SOLMECHS_PRIZE_POOL");

function parse(addr: string): PublicKey | null {
  if (!addr) return null;
  try {
    return new PublicKey(addr);
  } catch {
    return null;
  }
}

export const candyMachinePk = parse(CANDY_MACHINE_ADDRESS);
export const collectionPk = parse(COLLECTION_ADDRESS);
export const treasuryPk = parse(TREASURY_ADDRESS);
export const prizePoolPk = parse(PRIZE_POOL_ADDRESS);

/** True once the sale exists on-chain and the client can talk to it. */
export function isPassConfigured(): boolean {
  return candyMachinePk !== null && collectionPk !== null;
}

/** Collection metadata, used by the setup script and the sale page. */
export const PASS_METADATA = {
  name: "Sol Mechs Battle Pass — Season 1",
  symbol: "SMBP",
  /** Per-item name; the candy machine appends the sequential id. */
  itemNamePrefix: "Sol Mechs Battle Pass S1 #",
  /**
   * Royalty in basis points, enforced by the Core royalties plugin. Set at
   * creation — it cannot be added to a collection that already exists.
   */
  royaltyBasisPoints: 500,
} as const;
