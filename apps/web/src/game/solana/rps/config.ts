import { PublicKey } from "@solana/web3.js";
import rawIdl from "./idl/sol_city_rps.json";

/**
 * PLACEHOLDER until `programs/sol-city-rps` is built + deployed to devnet
 * (see programs/sol-city-rps/README.md). This is a copy of the porting
 * source's IDL — the instruction/account layout is byte-identical to
 * programs/sol-city-rps/src/lib.rs, so it's accurate for everything except
 * the on-chain address, which `anchor build` will fill in for real once
 * deployed (overwrite this file with `target/idl/sol_city_rps.json`).
 */
export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_SOL_CITY_RPS_PROGRAM_ID || (rawIdl as { address: string }).address
);

export const BASE_ENDPOINT =
  process.env.NEXT_PUBLIC_RPS_BASE_ENDPOINT || "https://api.devnet.solana.com";

// MagicBlock's TEE-backed devnet ER — what makes choices unreadable until
// reveal_round. Distinct from the plain (non-private) ER endpoint sol-city's
// position sync uses (see ../magicblock.ts).
export const TEE_ENDPOINT =
  process.env.NEXT_PUBLIC_RPS_TEE_ENDPOINT || "https://devnet-tee.magicblock.app";
export const TEE_WS_ENDPOINT = TEE_ENDPOINT.replace(/^http/, "ws");

// TEE ER validator the PDAs get delegated to — must be the TEE-capable
// validator, not the plain ER one sol-city's position sync uses, or the
// Permission Program CPIs in reveal_round/init_permission will fail.
export const ER_VALIDATOR = new PublicKey(
  process.env.NEXT_PUBLIC_RPS_VALIDATOR || "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo"
);
export const EPHEMERAL_VAULT_ID = new PublicKey("MagicVau1t999999999999999999999999999999999");

export const GAME_SEED = "game";
export const PLAYER_CHOICE_SEED = "player_choice";
export const VAULT_SEED = "vault";

/** localStorage key for the JoKenPo Master NPC's local "bot" keypair. */
export const BOT_STORAGE_KEY = "sol-city-rps-bot-keypair";

// Fixed stake presets (devnet SOL per player; match winner takes the pot).
export const STAKE_PRESETS_SOL = [0, 0.05, 0.1] as const;
export const DEFAULT_STAKE_SOL = 0;

// Best-of-N presets → wins needed = ceil(N/2).
export const BEST_OF_PRESETS = [1, 3] as const;
export const DEFAULT_BEST_OF = 1;
export const targetWinsForBestOf = (bestOf: number) => Math.ceil(bestOf / 2);

// Headroom kept on top of stake+rent when topping up a session/bot key so the
// match's gameplay txs (make_choice, reveal_round, next_round, undelegate)
// never run dry mid-match.
export const PLAY_HEADROOM_SOL = 0.01;
export const BOT_FUND_SOL = 0.02;

export const POLL_INTERVAL_MS = 2000;

export const isDevnet = BASE_ENDPOINT.includes("devnet");
export const baseExplorerTxUrl = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}${isDevnet ? "?cluster=devnet" : ""}`;
