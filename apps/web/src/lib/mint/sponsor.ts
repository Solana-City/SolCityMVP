/**
 * The sponsored mint: the site's own wallet pays to turn a player's drawn
 * items into assets, so a pack costs the player ONE approval.
 *
 * Why it exists: the mint cannot ride in the purchase. It can only run once
 * the VRF oracle has answered, and a wallet will not sign a batch whose second
 * transaction fails until then (Phantom refused it with 4100, devnet,
 * 2026-11-05). Minting inside the oracle's callback does not fit either: the
 * oracle caps that transaction at 300k compute units, and five mints are
 * ~410k. So once the draw lands, the client asks this server to send
 * `mint_pending` with the sponsor as payer and the player as owner.
 *
 * What the sponsor can and cannot do is the program's business, not ours:
 * `mint_pending` reads the items from the owner's UnlockState and gives every
 * asset to the owner, whoever pays. So this route takes any wallet, from
 * anyone. It cannot be made to mint something unpaid for (the simulation
 * fails and nothing is sent, so nothing is spent either), and the most a
 * stranger can do is mint a player's items for them, at our expense, which
 * is what the player bought.
 *
 * Server only: the key comes from SOLCITY_MINT_SPONSOR_KEY (the JSON array
 * solana-keygen writes), which must never be a NEXT_PUBLIC_ variable.
 */
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction } from "@solana/web3.js";
import { BASE_RPC_ENDPOINTS } from "@/game/solana/baseRpc";
import {
  buildMintPendingIx, MINTS_PER_TX, pendingMintIndices, readMintConfig,
} from "@/game/solana/mint";
import { decodeUnlockState, deriveUnlockPDA } from "@/game/solana/program";
import { prepareWalletTx } from "@/game/solana/walletTx";
import { sendAndConfirmTransfer } from "@/game/solana/sendTokens";

/** Below this the sponsor stops sending and says so, rather than failing mid-pack. */
const MIN_SPONSOR_LAMPORTS = 0.01 * LAMPORTS_PER_SOL;
/** Transactions per request: 20 items, inside a serverless function's time. */
const MAX_TXS_PER_REQUEST = 4;

export type SponsoredMintStatus =
  /** Something was minted. */
  | "minted"
  /** Nothing owed: everything drawn is already an asset. */
  | "nothing"
  /** The draw has not landed yet; ask again in a moment. */
  | "pending"
  /** No sponsor here (no key, too little SOL, no mint config): use the wallet. */
  | "unavailable"
  /** It was tried and did not go through. */
  | "failed";

export interface SponsoredMint {
  status: SponsoredMintStatus;
  /** Indices that became assets in this request. */
  minted: number[];
  /** Indices still owed afterwards (more than one request's worth, or a failure). */
  left: number;
  signatures: string[];
  message?: string;
}

/** The sponsor key, or null when this deployment has none. */
export function sponsorKeypair(raw = process.env.SOLCITY_MINT_SPONSOR_KEY): Keypair | null {
  if (!raw) return null;
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
  } catch {
    console.error("[mint] SOLCITY_MINT_SPONSOR_KEY is not a keypair JSON array");
    return null;
  }
}

/**
 * The base RPC, from the server.
 *
 * The client's Helius key is origin-locked to solanacity.io and a server
 * request has no origin, so it would get 403 and fall through to the public
 * endpoint. The origin is sent explicitly, as the scripts do (scripts/_rpc.ts),
 * and SOLCITY_SERVER_RPC, if set, is tried first.
 */
export function serverConnection(): Connection {
  const origin = process.env.SOLCITY_RPC_ORIGIN ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://solanacity.io";
  const endpoints = process.env.SOLCITY_SERVER_RPC
    ? [process.env.SOLCITY_SERVER_RPC, ...BASE_RPC_ENDPOINTS]
    : [...BASE_RPC_ENDPOINTS];
  const failover = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let last: unknown = null;
    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          ...init,
          headers: { ...(init?.headers as Record<string, string>), origin },
          cache: "no-store",
          signal: AbortSignal.timeout(8_000),
        });
        if (res.ok) return res;
        last = new Error(`HTTP ${res.status} from the RPC`);
      } catch (err) {
        last = err;
      }
    }
    throw last ?? new Error("no RPC answered");
  };
  return new Connection(endpoints[0], { commitment: "confirmed", fetch: failover as typeof fetch });
}

/**
 * Mints what `owner` is owed, paid by the sponsor. Up to MAX_TXS_PER_REQUEST
 * transactions of MINTS_PER_TX items; `left` says whether to ask again.
 */
export async function sponsorMint(
  owner: PublicKey,
  deps: { conn?: Connection; sponsor?: Keypair | null } = {},
): Promise<SponsoredMint> {
  const none = (status: SponsoredMintStatus, message?: string, left = 0): SponsoredMint =>
    ({ status, minted: [], left, signatures: [], message });

  const sponsor = deps.sponsor === undefined ? sponsorKeypair() : deps.sponsor;
  if (!sponsor) return none("unavailable", "No sponsor wallet is configured here.");
  const conn = deps.conn ?? serverConnection();

  const config = await readMintConfig(conn);
  if (!config) return none("unavailable", "Minting is not set up on this network.");
  const info = await conn.getAccountInfo(deriveUnlockPDA(owner)[0]);
  const state = info ? decodeUnlockState(info.data) : null;
  if (!state) return none("nothing");
  // The program refuses every mint while a draw is pending (BoosterPending).
  if (state.pending) return none("pending", "The draw has not landed yet.");

  const before = await pendingMintIndices(conn, owner);
  if (before.length === 0) return none("nothing");

  if ((await conn.getBalance(sponsor.publicKey)) < MIN_SPONSOR_LAMPORTS) {
    console.error(`[mint] sponsor ${sponsor.publicKey.toBase58()} is below ${MIN_SPONSOR_LAMPORTS} lamports`);
    return none("unavailable", "The sponsor wallet needs SOL.", before.length);
  }

  const signatures: string[] = [];
  let failure: string | undefined;
  const txs = Math.min(MAX_TXS_PER_REQUEST, Math.ceil(before.length / MINTS_PER_TX));
  for (let n = 0; n < txs; n++) {
    try {
      const { blockhash } = await conn.getLatestBlockhash();
      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: sponsor.publicKey }).add(
        buildMintPendingIx({ payer: sponsor.publicKey, owner, limit: MINTS_PER_TX, config }),
      );
      // Simulated first: a mint that would fail is not sent, so it costs
      // nothing. Also sets the compute and loaded-data limits it needs.
      const ready = await prepareWalletTx(conn, tx);
      const fresh = await conn.getLatestBlockhash();
      ready.recentBlockhash = fresh.blockhash;
      ready.sign(sponsor);
      signatures.push(await sendAndConfirmTransfer({
        connection: conn, signed: ready, lastValidBlockHeight: fresh.lastValidBlockHeight,
      }));
    } catch (err) {
      failure = String((err as Error)?.message ?? err).split("\n")[0].slice(0, 200);
      console.error(`[mint] sponsored mint for ${owner.toBase58()} failed:`, failure);
      break;
    }
  }

  // Read back rather than inferred: the account is what makes them assets.
  const after = new Set(await pendingMintIndices(conn, owner));
  const minted = before.filter((i) => !after.has(i));
  return {
    status: minted.length > 0 ? "minted" : "failed",
    minted,
    left: after.size,
    signatures,
    message: failure,
  };
}
