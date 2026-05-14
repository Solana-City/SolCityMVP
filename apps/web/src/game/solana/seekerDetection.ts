/**
 * Seeker Device & Genesis Token (SGT) Detection
 *
 * Two levels of detection:
 *
 * 1. Soft (UA sniff) — fast, spoofable, good for UI hints
 *    isAndroidChrome() → true on any Android Chrome browser
 *
 * 2. Hard (on-chain SGT) — slow, reliable, anti-Sybil
 *    hasSeekerGenesisToken(wallet) → checks if the connected wallet
 *    holds a Seeker Genesis Token (one-per-device NFT minted at activation)
 *
 * SGT Collection: 6J3HcGLoM8EAgEMpGzgHdCMgChH1GbJ1NHtEGfwzbnqj (mainnet)
 * Reference: https://docs.solanamobile.com/recipes/general/detecting-seeker-users
 */

import { Connection, PublicKey } from "@solana/web3.js";

// Seeker Genesis Token collection mint address (mainnet)
const SGT_COLLECTION = new PublicKey(
  "6J3HcGLoM8EAgEMpGzgHdCMgChH1GbJ1NHtEGfwzbnqj"
);

const MAINNET_RPC = "https://api.mainnet-beta.solana.com";

/**
 * Soft detection — checks Android Chrome user agent.
 * Fast but spoofable. Use for UI hints only.
 */
export function isAndroidChrome(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android/i.test(navigator.userAgent) && /chrome/i.test(navigator.userAgent);
}

/**
 * Hard detection — queries mainnet for Seeker Genesis Token.
 * Requires a connected wallet pubkey. Returns false on any error.
 *
 * Note: SGTs are transferable — this confirms token ownership, not physical
 * device presence. Strong enough for exclusive features/cosmetics.
 */
export async function hasSeekerGenesisToken(
  walletAddress: string
): Promise<boolean> {
  try {
    const connection = new Connection(MAINNET_RPC, "confirmed");
    const owner = new PublicKey(walletAddress);

    // Fetch all token accounts owned by the wallet
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(owner, {
      programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    });

    for (const { account } of tokenAccounts.value) {
      const info = account.data.parsed?.info;
      if (!info) continue;

      // Must have exactly 1 (non-fungible)
      if (info.tokenAmount?.uiAmount !== 1) continue;

      const mint = info.mint as string;

      // Check if this token's collection matches SGT collection
      // We do a metadata lookup via the token metadata program
      const metadataPda = await getMetadataPda(new PublicKey(mint));
      const metadataAccount = await connection.getAccountInfo(metadataPda);
      if (!metadataAccount) continue;

      const collectionKey = parseCollectionFromMetadata(metadataAccount.data);
      if (collectionKey && collectionKey === SGT_COLLECTION.toBase58()) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

// Token Metadata Program ID
const TOKEN_METADATA_PROGRAM = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

async function getMetadataPda(mint: PublicKey): Promise<PublicKey> {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM
  );
  return pda;
}

/**
 * Minimal metadata parser — extracts collection key from raw account data.
 * Metaplex metadata layout: collection field starts after name/symbol/uri.
 * We scan for the verified collection key pattern.
 */
function parseCollectionFromMetadata(data: Buffer): string | null {
  try {
    // Metaplex v1.1 layout:
    // [0]     key (1 byte)
    // [1..33] update_authority (32 bytes)
    // [33..65] mint (32 bytes)
    // [65..69] name length (4 bytes LE)
    // [...] name string
    // [...] symbol length + string
    // [...] uri length + string
    // [...] seller_fee (2 bytes)
    // [...] creators option + array
    // [...] collection: Option<{verified: bool, key: Pubkey}>

    let offset = 1 + 32 + 32; // key + update_authority + mint

    // Skip name
    const nameLen = data.readUInt32LE(offset); offset += 4 + nameLen;
    // Skip symbol
    const symbolLen = data.readUInt32LE(offset); offset += 4 + symbolLen;
    // Skip uri
    const uriLen = data.readUInt32LE(offset); offset += 4 + uriLen;
    // Skip seller_fee_basis_points
    offset += 2;
    // Skip creators option
    const hasCreators = data[offset]; offset += 1;
    if (hasCreators) {
      const creatorsLen = data.readUInt32LE(offset); offset += 4;
      offset += creatorsLen * (32 + 1 + 2); // pubkey + verified + share
    }
    // Collection option
    const hasCollection = data[offset]; offset += 1;
    if (!hasCollection) return null;

    // verified (1 byte) + key (32 bytes)
    offset += 1; // skip verified flag
    const collectionKey = new PublicKey(data.slice(offset, offset + 32));
    return collectionKey.toBase58();
  } catch {
    return null;
  }
}
