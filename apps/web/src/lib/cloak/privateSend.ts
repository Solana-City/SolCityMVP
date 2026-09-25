/**
 * Cloak private transfers — what the integration needs, in one place.
 *
 * Cloak (cloak.ag) is a shielded balance on Solana: you SHIELD funds into a
 * private note, SEND from it without your wallet appearing as the sender, and
 * UNSHIELD back to a normal address. The proof that the transfer is valid is
 * a Groth16 proof generated in the player's own browser; nothing about the
 * amounts or the parties is revealed on chain.
 *
 * Two facts decide how far the city can take this today, both from their own
 * docs (docs.cloak.ag/sdk/llms.txt, read 2026-09-26):
 *
 *   1. The published `@cloak.dev/sdk` talks to the MAINNET program
 *      (zh1eLd6…). A devnet program exists, but it is served by a local-only
 *      fork, `@cloak.dev/sdk-devnet`, which is NOT on npm. Solana City runs
 *      on devnet, so there is no build of Cloak the city can sign against.
 *   2. On mainnet the flow moves real money: minimum shield is 0.01 SOL, and
 *      withdrawing costs 0.005 SOL plus 0.3%.
 *
 * So the panel teaches the flow, prices it with their real numbers, and hands
 * the signing step to Cloak itself. When the city moves to mainnet (backlog
 * M11), `privateSend` below is the seam: install `@cloak.dev/sdk`, implement
 * the body from the recipe in the comment, and set NEXT_PUBLIC_CLOAK_LIVE=1.
 * Nothing else in the city needs to know.
 */

/** Cloak's own numbers, so the panel never invents a fee. */
export const CLOAK_FEES = {
  /** Fixed part of the withdraw/swap fee, in lamports. */
  withdrawFixedLamports: 5_000_000,
  /** Variable part, as a fraction of the amount. */
  withdrawRate: 0.003,
  /** Smallest amount that can be shielded, in lamports. */
  minShieldLamports: 10_000_000,
};

export const CLOAK_DOCS = "https://docs.cloak.ag/guide/what-is-cloak";
export const CLOAK_APP = "https://www.cloak.ag/";

/** True once a mainnet build has the SDK wired (see the note above). */
export const CLOAK_LIVE =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_CLOAK_LIVE === "1";

/** What a withdrawal of `lamports` costs, by Cloak's published model. */
export function withdrawFee(lamports: number): number {
  return CLOAK_FEES.withdrawFixedLamports + Math.floor(lamports * CLOAK_FEES.withdrawRate);
}

export interface PrivateSendRequest {
  /** Recipient, any Solana address. */
  to: string;
  lamports: number;
}

export interface PrivateSendResult {
  ok: boolean;
  signature?: string;
  error?: string;
}

/**
 * Send from the shielded balance. Not wired yet — see the file comment.
 *
 * The recipe, from their SDK reference, for whoever turns this on:
 *
 *   const { CloakClient } = await import("@cloak.dev/sdk");   // dynamic:
 *   // the package pulls ~200 dependencies (snarkjs and friends) and must
 *   // never land in the city's main bundle.
 *   const client = new CloakClient({ connection });
 *   await client.transfer({
 *     to, amount: BigInt(lamports),
 *     relayUrl: CLOAK_PRODUCTION_RELAY_URL,   // an allowlisted origin
 *     signMessage, walletPublicKey,           // the player's real wallet
 *   });
 *
 * Invariants worth keeping from their docs: amounts are bigint everywhere;
 * the authenticated sender must be the player's own wallet, never a session
 * key (ours would be rejected and would break the privacy anyway); and the
 * resulting `outputUtxos` are the player's notes — losing them loses the
 * funds, so they must be persisted before the call is considered done.
 */
export async function privateSend(_req: PrivateSendRequest): Promise<PrivateSendResult> {
  return {
    ok: false,
    error: CLOAK_LIVE
      ? "Cloak is enabled but the SDK is not installed in this build."
      : "Cloak signs on mainnet; Solana City is on devnet.",
  };
}
