import { Connection } from "@solana/web3.js";

/**
 * A devnet connection that can actually use our Helius key.
 *
 * The key is ORIGIN-locked to solanacity.io, which is right for a key that
 * ships in client code: it is public, and the lock is what stops it being
 * someone else's free RPC. A script has no origin, so it gets 403 and falls
 * through to api.devnet, which then rate-bans the address under any real load.
 *
 * Measured 2026-10-27: no header 403, `origin: https://solanacity.io` 200.
 * So scripts send the header rather than asking for a second key.
 *
 * No websocket, ever. web3.js opens one for sendAndConfirmTransaction, and
 * api.devnet counts CONNECTIONS rather than requests: it answers "Connection
 * rate limits exceeded" and bans for a while. Send, then poll.
 */
const HELIUS_DEVNET =
  process.env.SOLCITY_RPC
  ?? "https://devnet.helius-rpc.com/?api-key=92175bf8-4484-4c09-a60a-4d08ee821058";

const ORIGIN = process.env.SOLCITY_RPC_ORIGIN ?? "https://solanacity.io";

export function devnetConnection(): Connection {
  return new Connection(HELIUS_DEVNET, {
    commitment: "confirmed",
    fetch: (input, init) =>
      fetch(input as string, {
        ...init,
        headers: { ...(init?.headers as Record<string, string>), origin: ORIGIN },
      }),
  });
}

/** Sends and polls. Never subscribes: see the note above. */
export async function sendAndPoll(
  conn: Connection,
  tx: import("@solana/web3.js").Transaction,
  signers: import("@solana/web3.js").Keypair[],
): Promise<string> {
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.feePayer = signers[0].publicKey;
  tx.sign(...signers);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const st = (await conn.getSignatureStatuses([sig])).value[0];
    if (st?.err) throw new Error(`${sig} failed: ${JSON.stringify(st.err)}`);
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return sig;
  }
  throw new Error(`${sig} never confirmed`);
}
