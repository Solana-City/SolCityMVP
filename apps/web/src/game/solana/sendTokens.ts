import { ComputeBudgetProgram, Connection, PublicKey, Transaction } from "@solana/web3.js";

import { mainnetConnection } from "./mainnetRpc";

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
}): Promise<{ tx: Transaction; connection: Connection; lastValidBlockHeight: number }> {
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

  // A mainnet transfer with no priority fee is a transfer the leader is free
  // to drop, and under load it does: the send is accepted by the RPC, a
  // signature comes back, and the transaction simply never lands. The fee is
  // worth about 0.00002 SOL at the default compute limit, which is nothing
  // against money that otherwise goes nowhere. Devnet has no such contention
  // and is left alone.
  if (token.cluster === "mainnet") {
    tx.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICROLAMPORTS }),
    );
  }

  // The blockhash the builders set, re-read here for the height it dies at:
  // that number is what lets a wait say "this will never land" instead of
  // "unknown". Overwriting it also means the hash is as fresh as possible
  // when it goes in front of the wallet.
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;

  return { tx, connection, lastValidBlockHeight };
}

/**
 * What a mainnet transfer pays to be picked up, in microlamports per compute
 * unit. Flat rather than quoted from getRecentPrioritizationFees: a transfer
 * is small enough that even a generous flat fee rounds to nothing, and a
 * quote is one more call that can fail in front of somebody sending money.
 */
const PRIORITY_MICROLAMPORTS = 100_000;

/** How often the transaction goes back out while nobody has picked it up. */
const REBROADCAST_MS = 4_000;
/** How often the chain is asked what happened to it. */
const POLL_MS = 2_000;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * Waits for a signature over plain HTTP.
 *
 * Connection.confirmTransaction(signature) does this over a websocket
 * subscription, which is a second transport with its own way of failing: our
 * mainnet Connection fails over between RPC hosts through a custom `fetch`,
 * and a websocket goes to whichever host the Connection was constructed with,
 * failover or not. When that socket does not come up, the wait ends after
 * exactly 30 seconds with "it is unknown if it succeeded or failed", which is
 * both useless to read and untrue: the chain knows, nobody asked it.
 *
 * So ask it. getSignatureStatuses and getBlockHeight go through the same
 * failover as everything else, and between them they give a real answer:
 * confirmed, failed with a reason, or dead because the blockhash expired.
 */
export async function awaitTransfer(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number,
): Promise<void> {
  for (let poll = 0; ; poll++) {
    await sleep(POLL_MS);

    const { value } = await connection.getSignatureStatuses([signature]);
    const status = value[0];
    if (status?.err) throw new Error(`The network rejected it: ${describeTxError(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return;

    // Every third poll, because the height moves slower than the status does
    // and this is the expensive half of the question.
    if (poll % 3 === 2) {
      const height = await connection.getBlockHeight("confirmed");
      // Past this height the blockhash cannot be accepted by anyone, so the
      // transaction is not slow, it is gone. Nothing was spent.
      if (height > lastValidBlockHeight) {
        throw new Error("It did not go through in time and was dropped. Nothing left your wallet.");
      }
    }
  }
}

/**
 * Broadcasts a signed transfer, keeps broadcasting it, and waits.
 *
 * One send is a request, not a delivery: an RPC that accepts the bytes and
 * hands back a signature has promised nothing, and a transfer that nobody
 * picks up before the blockhash expires disappears without a trace. Sending
 * it again every few seconds until it lands is what the wallets themselves
 * do, and it costs nothing, because the same signature can only ever be
 * included once.
 */
export async function sendAndConfirmTransfer(args: {
  connection: Connection;
  signed: Transaction;
  lastValidBlockHeight: number;
}): Promise<string> {
  const { connection, signed, lastValidBlockHeight } = args;
  const raw = signed.serialize();

  // The first send runs preflight, because a transaction that cannot work
  // should say so now, in words, rather than time out in a minute and a half.
  const signature = await connection.sendRawTransaction(raw);

  let settled = false;
  const waiting = awaitTransfer(connection, signature, lastValidBlockHeight)
    .finally(() => { settled = true; });

  void (async () => {
    while (!settled) {
      await sleep(REBROADCAST_MS);
      if (settled) return;
      // Preflight is skipped from here: it has already passed once, and a
      // transaction the network has seen answers preflight with errors about
      // itself that are not worth surfacing.
      await connection.sendRawTransaction(raw, { skipPreflight: true }).catch(() => {});
    }
  })();

  await waiting;
  return signature;
}

/** A chain error as a line somebody can read, instead of a JSON blob. */
function describeTxError(err: unknown): string {
  if (typeof err === "string") return err;
  const raw = JSON.stringify(err);
  // The one failure worth naming, because it is the one with something the
  // player can do about it. Everything else goes out as it came.
  if (raw.includes("InsufficientFundsForRent") || raw.includes("\"Custom\":1")) {
    return "not enough SOL for the amount and the fee";
  }
  return raw;
}

/** Where a signature from this token's cluster can be looked up. */
export function explorerUrl(signature: string, cluster: SendToken["cluster"]): string {
  const suffix = cluster === "devnet" ? "?cluster=devnet" : "";
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}
