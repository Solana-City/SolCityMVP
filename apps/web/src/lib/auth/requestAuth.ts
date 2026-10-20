/**
 * Server side of a request signed by the player's session key: the same scheme
 * as /api/checkin and /api/dm, in one place for the routes that only need a
 * yes or a no.
 *
 * Every failure is a 401 and nothing has been written yet. Order matters for
 * cost: the signature is checked first (CPU only), and only a request that
 * passed it can reach the on-chain ownership check, which is cached.
 */
import { PublicKey } from "@solana/web3.js";
import { verifyEd25519, verifySessionOwner } from "@/lib/auth/sessionAuth";

export const SIGNED_MAX_AGE_MS = 60_000;

export interface SignedFields {
  wallet?: unknown;
  sessionKey?: unknown;
  ts?: unknown;
  signature?: unknown;
}

export type AuthResult =
  | { ok: true; wallet: string }
  | { ok: false; status: 401; body: { ok: false; retry?: boolean; serverTs?: number; message: string } };

function isWallet(s: string): boolean {
  try { return new PublicKey(s).toBase58() === s; } catch { return false; }
}

const deny = (message: string, extra: { retry?: boolean; serverTs?: number } = {}): AuthResult => ({
  ok: false, status: 401, body: { ok: false, message, ...extra },
});

/**
 * `message` builds the string the client signed from the verified wallet and
 * timestamp. Resolves to the wallet the request is allowed to act for.
 */
export async function authorizeSigned(
  body: SignedFields,
  message: (wallet: string, ts: number) => string,
): Promise<AuthResult> {
  const wallet = typeof body.wallet === "string" ? body.wallet : "";
  const sessionKey = typeof body.sessionKey === "string" ? body.sessionKey : "";
  const signature = typeof body.signature === "string" ? body.signature : "";
  const ts = Number(body.ts ?? 0);
  if (!signature || !Number.isFinite(ts) || !isWallet(wallet) || !isWallet(sessionKey)) return deny("Signature required.");

  if (Math.abs(Date.now() - ts) > SIGNED_MAX_AGE_MS) {
    // Almost always a clock, not an attack: hand ours back so the client signs
    // again with a corrected one (lib/clockSkew.ts).
    return deny("Expired.", { serverTs: Date.now() });
  }
  if (!verifyEd25519(sessionKey, message(wallet, ts), signature)) return deny("Bad signature.");
  // The session key is authorized on-chain a few seconds after the city
  // loads; the client retries.
  if (!(await verifySessionOwner(wallet, sessionKey))) return deny("Session not verified.", { retry: true });
  return { ok: true, wallet };
}
