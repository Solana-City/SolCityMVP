import { Connection } from "@solana/web3.js";

/**
 * Mainnet endpoints, in the order they are tried.
 *
 * Helius first (the project's key, the same one baseRpc uses on devnet), the
 * public endpoint behind it: api.mainnet-beta throttles browsers, so on its
 * own it fails exactly when a player is trying to send.
 *
 * ore.ts keeps its own copy on purpose and is left alone: it is live
 * money-handling code with its own failover, and this module exists to stop
 * the newer mainnet readers (sends, the donation board) growing a third and
 * fourth list between them.
 */
export const MAINNET_RPCS: readonly string[] = [
  "https://mainnet.helius-rpc.com/?api-key=92175bf8-4484-4c09-a60a-4d08ee821058",
  "https://api.mainnet-beta.solana.com",
];

/** Tries each endpoint in order, keeping the reason if they all refuse. */
export const mainnetFailoverFetch: typeof fetch = async (input, init) => {
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
/** The failover mainnet connection, shared by every real send and read. */
export function mainnetConnection(): Connection {
  mainnet ??= new Connection(MAINNET_RPCS[0], {
    commitment: "confirmed",
    fetch: mainnetFailoverFetch,
  });
  return mainnet;
}
