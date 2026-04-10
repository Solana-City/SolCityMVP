import { VersionedTransaction, Connection } from "@solana/web3.js";

const BASE_URL = "https://api.jup.ag/swap/v2";

// Common token mints on Solana mainnet
export const TOKEN_LIST = [
  { symbol: "SOL", mint: "So11111111111111111111111111111111111111112", decimals: 9, logo: "" },
  { symbol: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, logo: "" },
  { symbol: "USDT", mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6, logo: "" },
  { symbol: "JUP", mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", decimals: 6, logo: "" },
  { symbol: "BONK", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", decimals: 5, logo: "" },
  { symbol: "WIF", mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", decimals: 6, logo: "" },
] as const;

export type TokenInfo = (typeof TOKEN_LIST)[number];

export interface SwapQuote {
  requestId: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  inUsdValue: number;
  outUsdValue: number;
  priceImpact: number;
  slippageBps: number;
  transaction: string | null;
  gasless: boolean;
  routePlan: Array<{
    swapInfo: { label: string; inputMint: string; outputMint: string };
    percent: number;
  }>;
  error?: string;
}

export interface SwapResult {
  status: "Success" | "Failed";
  signature: string;
  inputAmountResult: string;
  outputAmountResult: string;
  error?: string;
}

/**
 * Fetches a swap order from Jupiter Swap V2 API.
 *
 * Flow: GET /order → returns quote + base64 transaction
 *
 * The transaction is partially signed by Jupiter (for RFQ routes).
 * The taker (user wallet) must sign it before executing via /execute.
 *
 * Requires a Jupiter API key set in NEXT_PUBLIC_JUPITER_API_KEY.
 * Get one free at https://developers.jup.ag/portal
 */
export async function getSwapOrder(
  inputMint: string,
  outputMint: string,
  amount: string,
  takerPublicKey: string,
  apiKey?: string
): Promise<SwapQuote> {
  const key = apiKey || process.env.NEXT_PUBLIC_JUPITER_API_KEY || "";

  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    taker: takerPublicKey,
  });

  const headers: Record<string, string> = {
    "Accept": "application/json",
  };
  if (key) headers["x-api-key"] = key;

  const res = await fetch(`${BASE_URL}/order?${params}`, { headers });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jupiter /order failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data as SwapQuote;
}

/**
 * Signs the swap transaction using the wallet adapter.
 * Jupiter may use VersionedTransaction for complex routes.
 */
export function deserializeTransaction(base64Tx: string): VersionedTransaction {
  const buffer = Buffer.from(base64Tx, "base64");
  return VersionedTransaction.deserialize(buffer);
}

/**
 * Executes a signed swap transaction via Jupiter's /execute endpoint.
 *
 * Jupiter handles transaction landing (Beam), MEV protection,
 * and additional signatures for RFQ routes.
 */
export async function executeSwap(
  signedTransaction: string,
  requestId: string,
  apiKey?: string
): Promise<SwapResult> {
  const key = apiKey || process.env.NEXT_PUBLIC_JUPITER_API_KEY || "";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (key) headers["x-api-key"] = key;

  const res = await fetch(`${BASE_URL}/execute`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      signedTransaction,
      requestId,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jupiter /execute failed (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Converts a human-readable amount to the smallest unit.
 * e.g. toSmallestUnit("1.5", 9) => "1500000000"
 */
export function toSmallestUnit(amount: string, decimals: number): string {
  const parts = amount.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  const raw = BigInt(whole) * BigInt(10 ** decimals) + BigInt(frac);
  return raw.toString();
}

/**
 * Converts smallest unit to human-readable amount.
 * e.g. fromSmallestUnit("1500000000", 9) => "1.5"
 */
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
