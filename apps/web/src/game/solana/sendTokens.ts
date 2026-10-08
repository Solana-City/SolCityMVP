import { Connection, PublicKey, Transaction } from "@solana/web3.js";

import { toSmallestUnit } from "./jupiterSwap";
import { buildSolTransfer, buildSplTransfer } from "./transfer";

/**
 * What the send panel can hand to a friend.
 *
 * The city runs on devnet, but every token worth sending apart from SOL only
 * exists on mainnet, so this catalog carries the cluster per entry instead of
 * assuming one. SOL therefore appears twice, deliberately: the devnet entry is
 * the free practice money the city has always sent, the mainnet entry is real.
 * Nothing here guesses which one the player meant, and the panel never picks
 * the real one on their behalf.
 */
export interface SendToken {
  /** Unique across clusters, so the two SOL entries never collide. */
  id: string;
  symbol: string;
  cluster: "devnet" | "mainnet";
  /** null for native SOL; an SPL mint otherwise. */
  mint: string | null;
  decimals: number;
  /** Shown next to the symbol in the picker. Empty renders no image. */
  logo: string;
  /** One word on the cluster badge: what the player is actually spending. */
  note: string;
}

const LOGO = "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet";
const SOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * Devnet SOL leads, because it is the one a player can spend without
 * consequences and the one the city's own quests expect.
 */
export const SEND_TOKENS: readonly SendToken[] = [
  { id: "sol-devnet", symbol: "SOL",  cluster: "devnet",  mint: null, decimals: 9,
    logo: `${LOGO}/${SOL_MINT}/logo.png`, note: "practice" },
  { id: "sol",        symbol: "SOL",  cluster: "mainnet", mint: null, decimals: 9,
    logo: `${LOGO}/${SOL_MINT}/logo.png`, note: "real" },
  { id: "usdc",       symbol: "USDC", cluster: "mainnet", decimals: 6,
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    logo: `${LOGO}/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png`, note: "real" },
  { id: "usdt",       symbol: "USDT", cluster: "mainnet", decimals: 6,
    mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    logo: `${LOGO}/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg`, note: "real" },
  // SKR is the Solana Mobile token, the same mint Seeker Lover checks for.
  { id: "skr",        symbol: "SKR",  cluster: "mainnet", decimals: 6,
    mint: "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3",
    logo: "", note: "real" },
  { id: "jup",        symbol: "JUP",  cluster: "mainnet", decimals: 6,
    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    logo: "https://static.jup.ag/jup/icon.png", note: "real" },
  { id: "bonk",       symbol: "BONK", cluster: "mainnet", decimals: 5,
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    logo: "https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I", note: "real" },
];

/** The default: practice money, never the player's real balance. */
export const DEFAULT_SEND_TOKEN = SEND_TOKENS[0];

export function getSendToken(id: string): SendToken | undefined {
  return SEND_TOKENS.find((t) => t.id === id);
}

/** What to call a token in a log line or a receipt, cluster included. */
export function sendTokenLabel(token: SendToken): string {
  return token.cluster === "devnet" ? `${token.symbol} (devnet)` : token.symbol;
}

// ── Mainnet connection ───────────────────────────────────────────────────────

/**
 * Helius first (the project's key, as on devnet in baseRpc), the public
 * endpoint behind it: api.mainnet-beta throttles browsers, so on its own it
 * fails exactly when a player is trying to send.
 */
const MAINNET_RPCS: readonly string[] = [
  "https://mainnet.helius-rpc.com/?api-key=92175bf8-4484-4c09-a60a-4d08ee821058",
  "https://api.mainnet-beta.solana.com",
];

/** Tries each endpoint in order, keeping the reason if they all refuse. */
const failoverFetch: typeof fetch = async (input, init) => {
  let problem = "no endpoint answered";
  for (const url of MAINNET_RPCS) {
    try {
      const res = await fetch(url, init);
      // A 403 or 429 from a public endpoint is a refusal, not an answer.
      if (res.ok) return res;
      problem = `${new URL(url).host} replied ${res.status}`;
    } catch (err) {
      problem = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(problem);
};

let mainnet: Connection | null = null;
/** The failover mainnet connection, shared by every real send. */
export function mainnetConnection(): Connection {
  mainnet ??= new Connection(MAINNET_RPCS[0], {
    commitment: "confirmed",
    fetch: failoverFetch,
  });
  return mainnet;
}

// ── Building the transfer ────────────────────────────────────────────────────

/**
 * What the player typed, as a plain decimal string.
 *
 * A comma becomes a dot, because half this city types "0,5" and the exact
 * converter splits on "." alone: left as it is, that reaches BigInt and throws
 * a syntax error at somebody who typed their amount perfectly correctly.
 * Returns null when the text is not a number at all, so the caller can say so
 * in its own words.
 */
export function normalizeAmount(input: string): string | null {
  const cleaned = input.trim().replace(",", ".");
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === "" || cleaned === ".") return null;
  return cleaned;
}

/**
 * The transaction for one entry in the catalog, on that entry's own cluster.
 *
 * `devnetConnection` is the game's own (failover) devnet connection, passed in
 * rather than imported so this stays usable from anywhere the wallet adapter's
 * connection is already in hand.
 */
export async function buildSendTransfer(args: {
  token: SendToken;
  devnetConnection: Connection;
  from: PublicKey;
  to: PublicKey;
  /** The amount exactly as typed, converted without going through a float. */
  amount: string;
}): Promise<{ tx: Transaction; connection: Connection }> {
  const { token, devnetConnection, from, to, amount } = args;
  const connection = token.cluster === "devnet" ? devnetConnection : mainnetConnection();

  const clean = normalizeAmount(amount);
  if (clean === null) throw new Error("That is not an amount.");

  const raw = BigInt(toSmallestUnit(clean, token.decimals));
  // A below-one-unit amount (0.0000001 USDC) truncates to zero, which would
  // otherwise send nothing and still charge a fee.
  if (raw <= BigInt(0)) throw new Error("Amount is too small to send.");

  const tx = token.mint === null
    ? await buildSolTransfer(connection, from, to, raw)
    : await buildSplTransfer(connection, from, to, new PublicKey(token.mint), raw);

  return { tx, connection };
}

/** Where a signature from this token's cluster can be looked up. */
export function explorerUrl(signature: string, cluster: SendToken["cluster"]): string {
  const suffix = cluster === "devnet" ? "?cluster=devnet" : "";
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}
