/**
 * Proving "this request comes from that wallet" without a wallet popup.
 *
 * The game already has a session key per player, authorized on-chain as the
 * `session_authority` of the wallet's player PDA. A request signed by that
 * key is as good as one signed by the wallet for low-stakes actions (DMs,
 * daily check-in): the server checks the key against the PDA once (rollup
 * first, then base) and caches the match for a day.
 *
 * Keys:
 *   auth:sk:<sessionKey>  -> the wallet it belongs to (1 day)
 */
import { createPublicKey, verify } from "crypto";
import { PublicKey } from "@solana/web3.js";
import { get, setex } from "@/lib/kv";
import { derivePlayerPDA } from "@/game/solana/program";
import { BASE_RPC_ENDPOINTS } from "@/game/solana/baseRpc";

const ER_RPC = "https://devnet.magicblock.app";
const SK_CACHE_SECS = 86_400;
/**
 * A warm server instance remembers a match for a few minutes, so a busy
 * client (quest and event writes, one per action) costs the store nothing
 * beyond the first request on that instance. Short, because the store entry
 * is the one that lasts a day.
 */
const MEM_CACHE_MS = 10 * 60_000;
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

async function readAccount(endpoint: string, address: string): Promise<Buffer | null> {
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
    const data = body?.result?.value?.data?.[0];
    return typeof data === "string" ? Buffer.from(data, "base64") : null;
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
  for (const endpoint of [ER_RPC, ...BASE_RPC_ENDPOINTS]) {
    const data = await readAccount(endpoint, pda);
    if (data && sessionAuthorityOf(data, wallet) === sessionKey) {
      await setex(`auth:sk:${sessionKey}`, wallet, SK_CACHE_SECS);
      remember(sessionKey, wallet);
      return true;
    }
  }
  return false;
}

