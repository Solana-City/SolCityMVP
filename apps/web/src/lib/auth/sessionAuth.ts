/**
 * Proving "this request comes from that wallet" without a wallet popup.
 *
 * The game already has a session key per player, authorized on-chain as the
 * `session_authority` of the wallet's player PDA. A request signed by that
 * key is as good as one signed by the wallet for low-stakes actions (DMs,
 * daily check-in): the server checks the key against the PDA, reading only
 * the copy that is CURRENT, and remembers a match for a few minutes.
 *
 * Keys:
 *   auth:sk:<sessionKey>  -> the wallet it belongs to (5 minutes)
 *
 * Both changed with the security pass (audit R-16). A match used to be
 * cached for a day, and either copy of the account was accepted, the
 * rollup's or the base one, which is frozen at whatever it held when the
 * account was delegated. A key the player had replaced kept passing for up
 * to a day, and a stale base copy could vouch for it indefinitely.
 */
import { createPublicKey, verify } from "crypto";
import { PublicKey } from "@solana/web3.js";
import { get, setex } from "@/lib/kv";
import { derivePlayerPDA, DELEGATION_PROGRAM_ID } from "@/game/solana/program";
import { BASE_RPC_ENDPOINTS } from "@/game/solana/baseRpc";
import { ER_VALIDATORS } from "@/game/multiplayer/erValidators";
import { delegationRecordPdaFromDelegatedAccount } from "@magicblock-labs/ephemeral-rollups-sdk";

/**
 * The rollup that holds a delegated account, from its delegation record
 * (validator in bytes 8..40). Audit r2 X-2: this used to be one hardcoded
 * devnet host, the Asian rollup. That read a stale copy for every player
 * delegated to the US or Europe, and on mainnet it would have failed every
 * delegated player outright. ER_VALIDATORS follows NEXT_PUBLIC_SOLANA_CLUSTER,
 * so the same code is right on both clusters.
 */
async function owningRollup(baseEndpoint: string, pda: string): Promise<string | null> {
  const record = delegationRecordPdaFromDelegatedAccount(new PublicKey(pda)).toBase58();
  const rec = await readAccount(baseEndpoint, record);
  if (!rec || rec.data.length < 40) return null;
  const validator = new PublicKey(rec.data.subarray(8, 40)).toBase58();
  return ER_VALIDATORS.find((v) => v.identity === validator)?.rpc ?? null;
}
/** How long a verified match is trusted before the chain is asked again. */
const SK_CACHE_SECS = 5 * 60;
/**
 * A warm server instance remembers a match for a minute, so a busy client
 * (quest and event writes, one per action) costs the store nothing beyond the
 * first request on that instance.
 */
const MEM_CACHE_MS = 60_000;
const MEM_CACHE_MAX = 5_000;
const owners = new Map<string, { wallet: string; until: number }>();

function remember(sessionKey: string, wallet: string): void {
  if (owners.size >= MEM_CACHE_MAX) owners.clear();
  owners.set(sessionKey, { wallet, until: Date.now() + MEM_CACHE_MS });
}

/** Testing seam. */
export function resetSessionOwnerCache(): void {
  owners.clear();
}

// ── Signatures ───────────────────────────────────────────────────────────────

export function verifyEd25519(signer: string, message: string, signatureB64: string): boolean {
  try {
    const raw = new PublicKey(signer).toBytes();
    const key = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(raw).toString("base64url") },
      format: "jwk",
    });
    return verify(null, Buffer.from(message, "utf8"), key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

// ── Session key ownership ───────────────────────────────────────────────────

async function readAccount(
  endpoint: string, address: string,
): Promise<{ data: Buffer; owner: string } | null> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "getAccountInfo",
        params: [address, { encoding: "base64", commitment: "confirmed" }],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    });
    const body = await res.json();
    const value = body?.result?.value;
    const data = value?.data?.[0];
    return typeof data === "string" && typeof value?.owner === "string"
      ? { data: Buffer.from(data, "base64"), owner: value.owner }
      : null;
  } catch {
    return null;
  }
}

/** PlayerState: 8 discriminator, authority (32), Option<Pubkey> session_authority. */
function sessionAuthorityOf(data: Buffer, wallet: string): string | null {
  if (data.length < 8 + 32 + 1) return null;
  if (new PublicKey(data.subarray(8, 40)).toBase58() !== wallet) return null;
  if (data[40] !== 1 || data.length < 41 + 32) return null;
  return new PublicKey(data.subarray(41, 73)).toBase58();
}

/**
 * True when `sessionKey` is the session key authorized on `wallet`'s player
 * PDA. Checked against the chain once, then cached.
 */
export async function verifySessionOwner(wallet: string, sessionKey: string): Promise<boolean> {
  const hit = owners.get(sessionKey);
  if (hit && hit.until > Date.now() && hit.wallet === wallet) return true;
  if ((await get(`auth:sk:${sessionKey}`)) === wallet) { remember(sessionKey, wallet); return true; }
  let pda: string;
  try { pda = derivePlayerPDA(new PublicKey(wallet))[0].toBase58(); } catch { return false; }

  // Which copy is current is decided by BASE: a delegated account is owned by
  // the delegation program there, and then only the rollup's copy is live;
  // otherwise the base copy is. The first base endpoint that answers decides.
  let base: { data: Buffer; owner: string } | null = null;
  let baseEndpoint = "";
  for (const endpoint of BASE_RPC_ENDPOINTS) {
    base = await readAccount(endpoint, pda);
    if (base) { baseEndpoint = endpoint; break; }
  }
  if (!base) return false;
  let current: { data: Buffer; owner: string } | null = base;
  if (base.owner === DELEGATION_PROGRAM_ID.toBase58()) {
    const rollup = await owningRollup(baseEndpoint, pda);
    current = rollup ? await readAccount(rollup, pda) : null;
  }
  if (!current || sessionAuthorityOf(current.data, wallet) !== sessionKey) return false;

  await setex(`auth:sk:${sessionKey}`, wallet, SK_CACHE_SECS);
  remember(sessionKey, wallet);
  return true;
}

