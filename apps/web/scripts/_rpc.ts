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

/**
 * A refusal a person can act on: one line saying the script STOPPED, why, and
 * what to do, with nothing sent. Every guard in the setup scripts ends here,
 * so nobody has to dig through a stack trace or an RPC error to find out
 * whether the problem was a missing variable or the network (2026-11-05:
 * a 403 from the RPC hid the real refusal).
 */
export class Stopped extends Error {
  constructor(why: string, fix?: string) {
    super(`STOPPED: ${why}${fix ? `\n  Fix: ${fix}` : ""}\n  Nothing was sent.`);
  }
}

const GENESIS: Record<string, "devnet" | "mainnet"> = {
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: "devnet",
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d": "mainnet",
};

/**
 * Which cluster this RPC really is, asked of the chain (its genesis hash),
 * since a URL's name proves nothing. If the question itself fails, that is
 * the refusal, said plainly, rather than whatever the RPC threw.
 */
export async function networkOf(conn: Connection): Promise<"devnet" | "mainnet" | "other"> {
  let genesis: string;
  try {
    genesis = await conn.getGenesisHash();
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).split("\n")[0].slice(0, 160);
    throw new Stopped(
      `could not ask the RPC which network it is (${msg})`,
      "check SOLCITY_RPC: the URL, its API key, and that it allows this machine",
    );
  }
  return GENESIS[genesis] ?? "other";
}
