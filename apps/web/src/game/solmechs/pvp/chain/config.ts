/**
 * Sol Mechs PvP — chain configuration.
 *
 * The program id is unknown until the program is deployed (Solana Playground,
 * see REDEPLOY_CHECKLIST.md). Until NEXT_PUBLIC_SOLMECHS_PROGRAM is set, PvP
 * runs on the local two-tab transport instead.
 */
import { PublicKey } from "@solana/web3.js";

// A literal `process.env.NEXT_PUBLIC_…` read: Next inlines only static
// expressions, so a dynamic lookup would always be undefined in the browser.
const RAW_PROGRAM_ID = process.env.NEXT_PUBLIC_SOLMECHS_PROGRAM ?? "";

export const SOLMECHS_PROGRAM_ID: PublicKey | null = (() => {
  try {
    return RAW_PROGRAM_ID.length >= 32 ? new PublicKey(RAW_PROGRAM_ID) : null;
  } catch {
    return null;
  }
})();

export function isPvpChainConfigured(): boolean {
  return SOLMECHS_PROGRAM_ID !== null;
}

/** MagicBlock devnet rollup — the same endpoint Solana City plays on. */
export const ER_ENDPOINT = "https://devnet.magicblock.app";

export const DUELIST_SEED = "mech_duelist";
export const LOBBY_SEED = "mech_lobby";

/** Must equal LOBBY_TTL_SECS in programs/sol-mechs/src/lib.rs. */
export const LOBBY_TTL_SECS = 30;
