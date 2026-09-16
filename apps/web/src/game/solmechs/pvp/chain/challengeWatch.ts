/**
 * Watches this wallet's duelist account for an incoming friendly-duel invite.
 *
 * Read-only: no session key, no wallet popup, no setup. A player who has never
 * opened PvP has no duelist account, so the poll simply finds nothing. The
 * invite is a one-slot mailbox with a timestamp (`challenge`/`CHALLENGE_TTL_SECS`
 * in the program), so a stale one is ignored here rather than cleared on-chain.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { CHALLENGE_TTL_SECS, ER_ENDPOINT, isPvpChainConfigured, SOLMECHS_PROGRAM_ID } from "./config";
import { decodeDuelist, duelistPda, STATUS } from "./mechProgram";

const POLL_MS = 5_000;

export interface IncomingDuel {
  /** Who is inviting, base58. */
  challenger: string;
  /** Unix seconds the invite was written. */
  at: number;
}

/**
 * Calls back with the current invite, or null when there is none (including
 * while the player is already in a match). Returns an unsubscribe.
 */
export function watchIncomingDuel(
  wallet: PublicKey,
  onChange: (duel: IncomingDuel | null) => void,
): () => void {
  if (!isPvpChainConfigured() || !SOLMECHS_PROGRAM_ID) return () => {};
  const program = SOLMECHS_PROGRAM_ID;
  const er = new Connection(ER_ENDPOINT, "confirmed");
  const pda = duelistPda(program, wallet);
  let stopped = false;
  let last: string | null = null;

  const tick = async () => {
    try {
      const info = await er.getAccountInfo(pda, "processed");
      if (stopped) return;
      const me = info && info.owner.equals(program) ? decodeDuelist(new Uint8Array(info.data)) : null;
      const fresh =
        me &&
        me.challenger &&
        me.status !== STATUS.matched &&
        Date.now() / 1000 - me.challengeAt < CHALLENGE_TTL_SECS
          ? { challenger: me.challenger.toBase58(), at: me.challengeAt }
          : null;
      const key = fresh ? `${fresh.challenger}:${fresh.at}` : null;
      if (key !== last) {
        last = key;
        onChange(fresh);
      }
    } catch {
      /* rollup hiccup: try again on the next tick */
    }
  };

  void tick();
  const timer = setInterval(tick, POLL_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
