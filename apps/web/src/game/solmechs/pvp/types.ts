/**
 * Sol Mechs PvP — the contract between a match and whatever carries it.
 *
 * Two transports implement it: LocalTransport (BroadcastChannel between two
 * tabs of one browser, no chain) and ChainTransport (the `sol-mechs` program
 * on a MagicBlock Ephemeral Rollup). PvpSession and the battle screen only see
 * this interface, so a match plays the same over either.
 *
 * Every exchange is commit–reveal: both sides commit a hash of their action,
 * and only once both commitments exist does either reveal. Without it, the
 * second player to act could read the first's choice and answer it.
 */
import type { TeamBuild } from "../data/team";

export interface PvpPlayer {
  id: string;
  name: string;
  team: TeamBuild;
}

export interface MatchInfo {
  matchId: bigint;
  /**
   * The host waited in the lobby; the guest joined. The guest inverts the
   * speed-tie flip — see TeamBattle `invertTies`.
   */
  role: "host" | "guest";
  /** Shared by both clients; breaks speed ties. */
  seed: number;
  me: PvpPlayer;
  opponent: PvpPlayer;
}

export interface OpponentReveal {
  action: Uint8Array;
  /**
   * Present when the transport cannot vouch for the reveal itself (the local
   * tab transport). PvpSession then re-checks it against the commitment. The
   * chain transport omits it: the program already refused a mismatch.
   */
  salt?: Uint8Array;
  /** The opponent's board checksum before the step — see protocol.stateCheck. */
  check: number;
}

export type SearchPhase = "preparing" | "searching";

export interface PvpTransport {
  readonly kind: "local" | "chain";
  /** Shown in the lobby, so a tester knows which network they are on. */
  readonly label: string;

  /** Resolves once paired. Rejects with an AbortError when `signal` aborts. */
  findMatch(
    team: TeamBuild,
    onStatus: (phase: SearchPhase, detail?: string) => void,
    signal: AbortSignal,
  ): Promise<MatchInfo>;

  commit(step: number, commitment: Uint8Array): Promise<void>;
  /** Resolves with the opponent's commitment for `step` once it exists. */
  awaitOpponentCommit(step: number, signal: AbortSignal): Promise<Uint8Array>;
  reveal(step: number, action: Uint8Array, salt: Uint8Array, check: number): Promise<void>;
  awaitOpponentReveal(step: number, signal: AbortSignal): Promise<OpponentReveal>;

  /** Fires once when the opponent leaves, resigns or disconnects. */
  onOpponentGone(cb: () => void): () => void;
  /** Leave the current match (or stop searching). Safe to call twice. */
  leave(): Promise<void>;
  /** Release timers and channels. The transport is unusable afterwards. */
  dispose(): void;
}

export class OpponentGoneError extends Error {
  constructor() {
    super("Your opponent left the match.");
    this.name = "OpponentGoneError";
  }
}

export function abortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("Aborted", "AbortError") as unknown as Error;
  }
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

export function isAbortError(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === "AbortError";
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}
