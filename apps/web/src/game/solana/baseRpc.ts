/**
 * Resilient devnet base-layer RPC.
 *
 * No single public devnet RPC is reliable for us:
 *   - api.devnet.solana.com  → 429-bans for hours under load
 *   - Helius devnet (free)   → intermittent 503s on reads
 *   - Magic Router           → HANGS on sendRawTransaction (routing proxy, not
 *                              a full RPC) and lacks simulateTransaction
 *
 * So we front a plain Connection with a fetch that fails over across the two
 * RPCs that DO accept sends (Helius, api.devnet). A JSON-RPC error (HTTP 200
 * with an error body — e.g. "insufficient funds") is a real answer and returns
 * immediately; only transport failures (5xx / 429 / timeout) fall through to
 * the next endpoint. Each attempt is time-boxed so a hung endpoint can't stall
 * the chain of fallbacks.
 *
 * The Magic Router is deliberately excluded here — it is used only via
 * ConnectionMagicRouter for payment auto-routing, never for base sends.
 */

// Free Helius devnet key — client-side and low-risk; override with
// NEXT_PUBLIC_HELIUS_DEVNET. Kept first because when it's up it's fastest and
// isn't rate-banned; api.devnet is the fallback.
const HELIUS_DEVNET =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_HELIUS_DEVNET) ||
  "https://devnet.helius-rpc.com/?api-key=92175bf8-4484-4c09-a60a-4d08ee821058";

export const BASE_RPC_ENDPOINTS: readonly string[] = [
  HELIUS_DEVNET,
  "https://api.devnet.solana.com",
];

// Primary endpoint reported as Connection.rpcEndpoint; the fetch below ignores
// it and walks the full list, so this is cosmetic.
export const BASE_RPC_PRIMARY = BASE_RPC_ENDPOINTS[0];

const PER_ATTEMPT_TIMEOUT_MS = 8_000;

function withTimeout(p: Promise<Response>, ms: number): Promise<Response> {
  return Promise.race([
    p,
    new Promise<Response>((_, reject) =>
      setTimeout(() => reject(new Error("rpc fetch timeout")), ms)
    ),
  ]);
}

/**
 * A `fetch` drop-in for web3.js `Connection({ fetch })`. Tries each base RPC in
 * order; returns the first transport-level success (including JSON-RPC error
 * bodies), else throws the last error.
 */
export async function resilientBaseFetch(
  _input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  let lastErr: unknown;
  for (const url of BASE_RPC_ENDPOINTS) {
    try {
      const res = await withTimeout(fetch(url, init), PER_ATTEMPT_TIMEOUT_MS);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status} from ${url}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("all base RPCs failed");
}
