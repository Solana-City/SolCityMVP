import { AddressLookupTableAccount, Connection, PublicKey } from "@solana/web3.js";
import { SOLANA_CLUSTER } from "@/game/config/clusterStorage";

/**
 * The address lookup table the pack transactions compile against.
 *
 * Opening a sealed pack names ~30 accounts: the burn (Bubblegum, the tree and
 * its proof), the draw (MagicBlock's VRF queue, program and identity), and our
 * own config PDAs. Written out in full that is over the 1232 bytes a
 * transaction may have, even with the proof cut down to what the canopy does
 * not hold (devnet, 2026-11-05: 1575 bytes, refused before the wallet opened).
 *
 * A lookup table holds the accounts that never change, and a v0 transaction
 * names each of them in one byte instead of thirty-two. The proof nodes, the
 * opener and the opener's unlock account stay in the transaction itself,
 * because they are different every time. An account the table does not hold
 * is simply written out, so a table that is out of date (a rotated tree, a
 * new season) makes a transaction bigger, never wrong.
 *
 * Created by scripts/lookup-table-setup.ts. NEXT_PUBLIC_PACK_LOOKUP_TABLE
 * overrides the address. Mainnet has no default: its table exists only once
 * that script has run there (frozen, see the script), and next.config.js
 * refuses a mainnet build without the variable.
 */
const DEFAULTS: Record<string, string> = {
  // 2026-11-05, 23 addresses, authority the devnet test wallet (9592…KhEp),
  // left unfrozen so a new season or tree can be added with --table.
  devnet: "6v9YaQPiE467BNCaQFHkfcBwMss1SANkT6s3W65ivfYi",
};

export const PACK_LOOKUP_TABLE: PublicKey | null = (() => {
  const raw = (typeof process !== "undefined" && process.env.NEXT_PUBLIC_PACK_LOOKUP_TABLE)
    || DEFAULTS[SOLANA_CLUSTER];
  try { return raw ? new PublicKey(raw) : null; } catch { return null; }
})();

let cached: { key: string; table: AddressLookupTableAccount } | null = null;

/**
 * The table's current contents, or null when there is none for this cluster
 * or it cannot be read. Read once per page: its addresses only ever grow, and
 * a stale copy is still correct (see above).
 */
export async function readPackLookupTable(
  conn: Connection,
  address: PublicKey | null = PACK_LOOKUP_TABLE,
): Promise<AddressLookupTableAccount | null> {
  if (!address) return null;
  if (cached?.key === address.toBase58()) return cached.table;
  try {
    const { value } = await conn.getAddressLookupTable(address);
    // A deactivated table is still served until it is closed, but a
    // transaction that uses it is refused, so it counts as no table at all.
    if (!value || !value.isActive()) return null;
    cached = { key: address.toBase58(), table: value };
    return value;
  } catch {
    return null;
  }
}
