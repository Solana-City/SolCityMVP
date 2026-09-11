/**
 * Sol Mechs PvP — picks the transport for this page.
 *
 * With NEXT_PUBLIC_SOLMECHS_PROGRAM set, matches run on the devnet rollup and
 * need a connected wallet. Without it, or with `?pvp=local` in the URL, they
 * run between two tabs of this browser.
 */
import type { PublicKey } from "@solana/web3.js";
import { isPvpChainConfigured } from "./chain/config";
import { ChainTransport, type SignTransaction } from "./chain/ChainTransport";
import { LocalTransport } from "./localTransport";
import type { PvpTransport } from "./types";

export type PvpAvailability =
  | { ok: true; transport: PvpTransport }
  | { ok: false; reason: string };

export function openPvpTransport(opts: {
  wallet: PublicKey | null;
  signTransaction?: SignTransaction;
}): PvpAvailability {
  const forceLocal = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("pvp") === "local";

  if (isPvpChainConfigured() && !forceLocal) {
    if (!opts.wallet || !opts.signTransaction) {
      return { ok: false, reason: "Connect your wallet to play PvP on devnet." };
    }
    try {
      return { ok: true, transport: new ChainTransport(opts.wallet, opts.signTransaction) };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  }

  if (typeof BroadcastChannel === "undefined") {
    return { ok: false, reason: "This browser cannot run the local PvP test." };
  }
  return { ok: true, transport: new LocalTransport() };
}

export { PvpSession } from "./session";
export type { MatchInfo, PvpTransport, SearchPhase } from "./types";
