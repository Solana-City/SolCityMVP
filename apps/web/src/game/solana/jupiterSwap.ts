import { VersionedTransaction } from "@solana/web3.js";

// Jupiter V6 Quote API — completely free, no API key required.
// Docs: https://station.jup.ag/docs/apis/swap-api
const QUOTE_URL = "https://quote-api.jup.ag/v6/quote";
const SWAP_URL  = "https://quote-api.jup.ag/v6/swap";

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

// Shape returned by /v6/quote
export interface QuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: Array<{
    swapInfo: {
      ammKey: string;
      label: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
      feeAmount: string;
      feeMint: string;
    };
    percent: number;
  }>;
}

export interface SwapTransaction {
  swapTransaction: string; // base64 VersionedTransaction
  lastValidBlockHeight: number;
}

/**
 * Gets a swap quote from Jupiter V6.
 * No API key required. Slippage defaults to 0.5% (50 bps).
 */
export async function getQuote(
  inputMint: string,
  outputMint: string,
  amount: string,
  slippageBps = 50
): Promise<QuoteResponse> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    slippageBps: slippageBps.toString(),
    onlyDirectRoutes: "false",
    asLegacyTransaction: "false",
  });

  const res = await fetch(`${QUOTE_URL}?${params}`, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jupiter /quote failed (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Builds the swap transaction from a quote.
 * Returns a base64-encoded VersionedTransaction that the user must sign.
 */
export async function buildSwapTransaction(
  quoteResponse: QuoteResponse,
  userPublicKey: string
): Promise<SwapTransaction> {
  const res = await fetch(SWAP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      // wrap/unwrap SOL automatically
      wrapAndUnwrapSol: true,
      // use shared accounts for lower fees
      useSharedAccounts: true,
      // dynamic slippage protects against MEV
      dynamicComputeUnitLimit: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jupiter /swap failed (${res.status}): ${text}`);
  }

  return res.json();
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
