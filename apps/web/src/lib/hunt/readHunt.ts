import { PublicKey } from "@solana/web3.js";
import { Connection } from "@solana/web3.js";
import { decodeHuntState, deriveHuntPDA } from "@/game/solana/program";
import { BASE_RPC_PRIMARY } from "@/game/solana/baseRpc";

/**
 * Reading the global Find Someone round, for the dev panel.
 *
 * This file used to also CRANK it. The round only advanced when somebody sent
 * `claim_find` or `expire_round`, so a city with nobody standing in it left
 * the same citizen hunted forever - round 952 sat expired for over an hour on
 * 2026-10-02 - and the server cranked it from a funded keypair to cover that.
 *
 * `HuntState` now stores an ANCHOR rather than a counter, and the round being
 * hunted is derived from the clock by the program and by every client. An
 * unfound citizen rotates on time with no transaction at all, so there is
 * nothing left to crank: no keypair, no lock, no `HUNT_CRANK_SECRET`, and no
 * `expire_round` instruction to call. What is left is the read.
 */
export interface HuntStatus {
  /** The round being hunted right now, derived from the anchor. */
  round: number | null;
  /** Who claimed the previous round, when there is one. */
  winner: string | null;
  /** When this citizen rotates. Unix seconds. */
  deadline: number | null;
  /** Seconds until that happens. Never negative now: the round self-advances. */
  secondsLeft: number;
}

const EMPTY: HuntStatus = { round: null, winner: null, deadline: null, secondsLeft: 0 };

function connection(): Connection {
  return new Connection(BASE_RPC_PRIMARY, "confirmed");
}

/** Reads the hunt without touching it. */
export async function readHunt(): Promise<HuntStatus> {
  try {
    const [pda] = deriveHuntPDA();
    const info = await connection().getAccountInfo(pda);
    if (!info) return EMPTY;
    const now = Math.floor(Date.now() / 1000);
    const hunt = decodeHuntState(info.data, now);
    if (!hunt) return EMPTY;
    return {
      round: hunt.round,
      winner: hunt.winner.equals(PublicKey.default) ? null : hunt.winner.toBase58(),
      deadline: hunt.deadline,
      secondsLeft: Math.max(0, hunt.deadline - now),
    };
  } catch {
    return EMPTY;
  }
}
