import { VersionedTransaction } from "@solana/web3.js";

// Jupiter Swap API V2 (meta-aggregator): /order returns a quote plus an
// assembled transaction for the taker, the wallet signs it, and /execute
// lands it on mainnet for us, so no mainnet RPC is needed on our side.
// Docs: https://developers.jup.ag/docs/swap/order-and-execute
// Keyless works (0.5 RPS per IP); NEXT_PUBLIC_JUPITER_API_KEY raises the limit.
const JUP_BASE = "https://api.jup.ag";
const API_KEY = process.env.NEXT_PUBLIC_JUPITER_API_KEY || "";

// Common token mints on Solana mainnet.
// Jupiter operates on mainnet — so swaps here use real mainnet tokens.
export const TOKEN_LIST = [
  { symbol: "SOL",  mint: "So11111111111111111111111111111111111111112",  decimals: 9, logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" },
  { symbol: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png" },
  { symbol: "USDT", mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6, logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg" },
  { symbol: "JUP",  mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",  decimals: 6, logo: "https://static.jup.ag/jup/icon.png" },
  { symbol: "BONK", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", decimals: 5, logo: "https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I" },
] as const;

export type TokenInfo = (typeof TOKEN_LIST)[number];

// Shape returned by GET /swap/v2/order (fields we use).
export interface OrderResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpact?: number;       // percent
  priceImpactPct?: string;    // fraction
  router?: string;
  mode?: string;
  feeBps?: number;
  inUsdValue?: number;
  outUsdValue?: number;
  rentFeeLamports?: number;
  /** base64 VersionedTransaction; empty when the order can't be filled (see errorCode). */
  transaction: string | null;
  requestId: string;
  lastValidBlockHeight?: string;
  errorCode?: number;
  errorMessage?: string;
  error?: string;
}

// Shape returned by POST /swap/v2/execute.
export interface ExecuteResponse {
  status: "Success" | "Failed";
  signature?: string;
  code: number;
  error?: string;
  totalInputAmount?: string;
  totalOutputAmount?: string;
  inputAmountResult?: string;
  outputAmountResult?: string;
}

/** Orders older than this get re-quoted before signing (requestId expires). */
export const ORDER_TTL_MS = 25_000;

function jupHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json", ...extra };
  if (API_KEY) h["x-api-key"] = API_KEY;
  return h;
}

/** Player-readable message for a Jupiter error code. */
function orderErrorMessage(order: OrderResponse): string {
  switch (order.errorCode) {
    case 1: return "Not enough balance for this swap.";
    case 2: return "Not enough SOL to pay network fees.";
    case 3: return "Amount too small for this route.";
    default: return order.errorMessage || order.error || "Jupiter could not build this swap.";
  }
}

function executeErrorMessage(res: ExecuteResponse): string {
  switch (res.code) {
    case -1:
    case -2003: return "Quote expired. Get a new quote and try again.";
    case -2: return "Wallet signature was invalid.";
    case -2004: return "Swap rejected by the route. Try again.";
    default: return res.error || `Swap failed (code ${res.code}).`;
  }
}

/**
 * Gets a quote + ready-to-sign transaction for `taker`.
 * Without a taker Jupiter still quotes but returns no transaction.
 * Throws when the order has a price but can't be filled (e.g. low balance).
 */
export async function getOrder(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  taker?: string;
  slippageBps?: number;
}): Promise<OrderResponse> {
  const qs = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
  });
  if (params.taker) qs.set("taker", params.taker);
  if (params.slippageBps != null) qs.set("slippageBps", String(params.slippageBps));

  const res = await fetch(`${JUP_BASE}/swap/v2/order?${qs}`, { headers: jupHeaders() });
  if (res.status === 429) throw new Error("Jupiter is busy. Wait a moment and try again.");
  const order = (await res.json().catch(() => null)) as OrderResponse | null;
  if (!res.ok || !order) {
    throw new Error(order?.error || order?.errorMessage || `Jupiter /order failed (${res.status})`);
  }
  if (params.taker && !order.transaction) throw new Error(orderErrorMessage(order));
  return order;
}

/** Sends a wallet-signed /order transaction to Jupiter, which lands it. */
export async function executeOrder(signed: VersionedTransaction, requestId: string): Promise<ExecuteResponse> {
  const res = await fetch(`${JUP_BASE}/swap/v2/execute`, {
    method: "POST",
    headers: jupHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      signedTransaction: Buffer.from(signed.serialize()).toString("base64"),
      requestId,
    }),
  });
  const out = (await res.json().catch(() => null)) as ExecuteResponse | null;
  if (!out) throw new Error(`Jupiter /execute failed (${res.status})`);
  if (out.status !== "Success") throw new Error(executeErrorMessage(out));
  return out;
}

export function deserializeTransaction(base64Tx: string): VersionedTransaction {
  const buffer = Buffer.from(base64Tx, "base64");
  return VersionedTransaction.deserialize(buffer);
}

// ── Amount helpers ──────────────────────────────────────────────────────

export function toSmallestUnit(amount: string, decimals: number): string {
  const parts = amount.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  const raw = BigInt(whole) * BigInt(10 ** decimals) + BigInt(frac);
  return raw.toString();
}

export function fromSmallestUnit(amount: string, decimals: number): string {
  const raw = BigInt(amount);
  const divisor = BigInt(10 ** decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

export function getTokenBySymbol(symbol: string): TokenInfo | undefined {
  return TOKEN_LIST.find((t) => t.symbol === symbol);
}

export function getTokenByMint(mint: string): TokenInfo | undefined {
  return TOKEN_LIST.find((t) => t.mint === mint);
}
