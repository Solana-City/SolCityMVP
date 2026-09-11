/**
 * Sol Mechs PvP — transport over programs/sol-mechs on a MagicBlock rollup.
 *
 * Setup happens once per wallet on the base layer (one wallet approval):
 * create the Duelist account and delegate it, plus the global Lobby if nobody
 * has yet. Everything after that — searching, pairing, every commit and
 * reveal — is a session-key transaction on the rollup, with no popups.
 *
 * The session key is Solana City's own (SessionKeyManager, same localStorage
 * entry), so a player who already moves around the city is not asked to
 * authorize a second one. If the Duelist was created from another device, one
 * wallet-signed `set_session` points it at this device's key.
 *
 * Reads poll the rollup. Writes are idempotent where it matters: a commit or
 * reveal whose confirmation was lost is recognised from the account state
 * instead of being resent into an "already committed" rejection.
 */
import {
  ComputeBudgetProgram, Connection,
  type PublicKey, Transaction, type TransactionInstruction,
} from "@solana/web3.js";
import { SessionKeyManager } from "@/game/solana/sessionKeys";
import { BASE_RPC_PRIMARY, resilientBaseFetch } from "@/game/solana/baseRpc";
import { DELEGATION_PROGRAM_ID } from "@/game/solana/program";
import type { TeamBuild } from "../../data/team";
import { decodeTeam, encodeTeam, matchSeed, sameBytes } from "../protocol";
import {
  OpponentGoneError, abortError, isAbortError, shortId, sleep,
  type MatchInfo, type OpponentReveal, type PvpTransport, type SearchPhase,
} from "../types";
import { ER_ENDPOINT, SOLMECHS_PROGRAM_ID } from "./config";
import * as P from "./mechProgram";

export type SignTransaction = (tx: Transaction) => Promise<Transaction>;

const POLL_MS = 450;
const GONE_POLL_MS = 1_500;
/** Re-take the lobby slot this often while waiting; well inside LOBBY_TTL_SECS. */
const HEARTBEAT_MS = 10_000;

/** The program refused the instruction; resending the same one cannot help. */
class ProgramRejected extends Error {}

function isProgramRejection(err: unknown): boolean {
  if (err instanceof ProgramRejected) return true;
  const msg = String((err as { message?: string } | null)?.message ?? err);
  return /custom program error|Error Code:|InstructionError/i.test(msg);
}

interface LiveMatch {
  id: bigint;
  opponent: PublicKey;
  opponentPda: PublicKey;
}

export class ChainTransport implements PvpTransport {
  readonly kind = "chain" as const;
  readonly label = "Devnet · MagicBlock Ephemeral Rollup";

  private readonly program: PublicKey;
  private readonly base: Connection;
  private readonly er: Connection;
  private readonly sessionKeys = new SessionKeyManager();
  private readonly mePda: PublicKey;
  private match: LiveMatch | null = null;
  private readonly goneListeners = new Set<() => void>();
  private goneTimer: ReturnType<typeof setInterval> | null = null;
  private goneFired = false;

  constructor(
    private readonly wallet: PublicKey,
    private readonly signTransaction: SignTransaction,
    private readonly displayName: string = shortId(wallet.toBase58()),
  ) {
    if (!SOLMECHS_PROGRAM_ID) throw new Error("The Sol Mechs program is not configured.");
    this.program = SOLMECHS_PROGRAM_ID;
    this.base = new Connection(BASE_RPC_PRIMARY, {
      commitment: "confirmed",
      fetch: resilientBaseFetch as unknown as typeof fetch,
    });
    this.er = new Connection(ER_ENDPOINT, "confirmed");
    this.mePda = P.duelistPda(this.program, wallet);
  }

  // ── PvpTransport ────────────────────────────────────────────────────────

  async findMatch(
    team: TeamBuild,
    onStatus: (phase: SearchPhase, detail?: string) => void,
    signal: AbortSignal,
  ): Promise<MatchInfo> {
    onStatus("preparing");
    let me: P.DuelistAccount;
    try {
      me = await this.ensureReady(onStatus, signal);
    } catch (err) {
      // A first-ever lobby can race another player's setup; one retry sees it.
      if (isAbortError(err)) throw err;
      me = await this.ensureReady(onStatus, signal);
    }

    const teamBytes = encodeTeam(team);
    const lobby = P.lobbyPda(this.program);
    if (me.status === P.STATUS.matched) {
      await this.sendEr([P.leaveMatchIx(this.program, this.wallet, this.sessionPub)]);
    }

    onStatus("searching");
    let lastSearch = 0;
    // Freshness of the lobby slot is judged by the program's clock, not ours:
    // a pair that fails as stale flips us to taking the slot, and a take that
    // fails because someone holds it flips us back to pairing.
    let preferSearch = false;
    try {
      for (;;) {
        if (signal.aborted) throw abortError();
        const [fresh, slot] = await Promise.all([
          this.readEr(this.mePda, P.decodeDuelist).catch(() => null),
          this.readEr(lobby, P.decodeLobby).catch(() => null),
        ]);
        if (fresh) me = fresh;
        if (me.status === P.STATUS.matched) break;

        const other = slot?.waiting && !slot.waiting.equals(this.wallet) ? slot.waiting : null;
        try {
          if (other && !preferSearch) {
            await this.sendEr([P.pairMatchIx(this.program, this.wallet, this.sessionPub, other, teamBytes)]);
          } else if (!slot?.waiting?.equals(this.wallet) || Date.now() - lastSearch > HEARTBEAT_MS) {
            await this.sendEr([P.searchMatchIx(this.program, this.wallet, this.sessionPub, teamBytes)]);
            lastSearch = Date.now();
            preferSearch = false;
          }
        } catch (err) {
          if (!isProgramRejection(err)) throw err;
          preferSearch = !preferSearch;
        }
        await sleep(POLL_MS * 2, signal);
      }
    } catch (err) {
      if (isAbortError(err)) {
        await this.sendEr([P.leaveMatchIx(this.program, this.wallet, this.sessionPub)]).catch(() => undefined);
      }
      throw err;
    }

    const matchId = me.matchId;
    const opponentPda = P.duelistPda(this.program, me.opponent);
    const opp = await this.pollUntil(
      () => this.readEr(opponentPda, P.decodeDuelist),
      (d) => d.status === P.STATUS.matched && d.matchId === matchId,
      15_000,
      "Could not load your opponent's account.",
      signal,
    );

    this.match = { id: matchId, opponent: me.opponent, opponentPda };
    this.goneFired = false;
    this.startGoneWatch();

    return {
      matchId,
      role: me.role === 0 ? "host" : "guest",
      seed: matchSeed(matchId),
      me: { id: this.wallet.toBase58(), name: this.displayName, team },
      opponent: {
        id: me.opponent.toBase58(),
        name: opp.name || shortId(me.opponent.toBase58()),
        team: decodeTeam(opp.team),
      },
    };
  }

  async commit(step: number, commitment: Uint8Array): Promise<void> {
    const m = this.requireMatch();
    try {
      await this.sendEr([P.commitStepIx(this.program, this.wallet, m.opponent, this.sessionPub, step, commitment)]);
    } catch (err) {
      const me = await this.readEr(this.mePda, P.decodeDuelist).catch(() => null);
      if (me && me.step === step && me.committed && sameBytes(me.commitment, commitment)) return;
      throw err;
    }
  }

  awaitOpponentCommit(step: number, signal: AbortSignal): Promise<Uint8Array> {
    return this.watchOpponent(signal, (opp) => (opp.step === step && opp.committed ? opp.commitment : undefined));
  }

  async reveal(step: number, action: Uint8Array, salt: Uint8Array, check: number): Promise<void> {
    const m = this.requireMatch();
    try {
      await this.sendEr([
        P.revealStepIx(this.program, this.wallet, m.opponent, this.sessionPub, step, action, salt, check),
      ]);
    } catch (err) {
      const me = await this.readEr(this.mePda, P.decodeDuelist).catch(() => null);
      if (me && me.actionStep === step) return;
      throw err;
    }
  }

  awaitOpponentReveal(step: number, signal: AbortSignal): Promise<OpponentReveal> {
    return this.watchOpponent(signal, (opp) =>
      opp.actionStep === step ? { action: opp.action, check: opp.check } : undefined,
    );
  }

  onOpponentGone(cb: () => void): () => void {
    this.goneListeners.add(cb);
    return () => { this.goneListeners.delete(cb); };
  }

  async leave(): Promise<void> {
    this.stopGoneWatch();
    this.match = null;
    await this.sendEr([P.leaveMatchIx(this.program, this.wallet, this.sessionPub)]).catch(() => undefined);
  }

  dispose(): void {
    this.stopGoneWatch();
    this.goneListeners.clear();
    this.match = null;
  }

  // ── Setup ───────────────────────────────────────────────────────────────

  private get sessionPub(): PublicKey {
    return this.sessionKeys.getSessionPublicKey();
  }

  private async ensureReady(
    onStatus: (phase: SearchPhase, detail?: string) => void,
    signal: AbortSignal,
  ): Promise<P.DuelistAccount> {
    // Solana City derives its session key from a wallet signature, so the key
    // is the same on every device. Load that one first: the key this browser
    // merely last stored could differ, and the Duelist would then point at a
    // key the city does not use — costing a `set_session` approval.
    await this.sessionKeys.ensureForWallet(this.wallet);

    const lobby = P.lobbyPda(this.program);
    // Delegation state is read from the BASE layer: a delegated account is
    // owned by the delegation program there, while the rollup may still show
    // a read-only copy of an undelegated one.
    const [baseLobby, baseMe] = await Promise.all([
      this.base.getAccountInfo(lobby),
      this.base.getAccountInfo(this.mePda),
    ]);

    const ixs: TransactionInstruction[] = [];
    if (!baseLobby) {
      ixs.push(P.initLobbyIx(this.program, this.wallet), P.delegateLobbyIx(this.program, this.wallet));
    } else if (!baseLobby.owner.equals(DELEGATION_PROGRAM_ID)) {
      ixs.push(P.delegateLobbyIx(this.program, this.wallet));
    }
    if (!baseMe) {
      ixs.push(
        P.initDuelistIx(this.program, this.wallet, this.sessionPub, this.displayName),
        P.delegateDuelistIx(this.program, this.wallet),
      );
    } else if (!baseMe.owner.equals(DELEGATION_PROGRAM_ID)) {
      ixs.push(P.delegateDuelistIx(this.program, this.wallet));
    }

    if (ixs.length > 0) {
      onStatus("preparing", "Creating your PvP account — approve once in your wallet.");
      await this.sendBase(ixs);
    }

    onStatus("preparing", "Connecting to the rollup…");
    let me = await this.pollUntil(
      () => this.readEr(this.mePda, P.decodeDuelist),
      () => true,
      25_000,
      "Your PvP account has not reached the rollup yet. Try again in a moment.",
      signal,
    );
    await this.pollUntil(
      () => this.readEr(lobby, P.decodeLobby),
      () => true,
      25_000,
      "The lobby has not reached the rollup yet. Try again in a moment.",
      signal,
    );

    if (!me.session.equals(this.sessionPub)) {
      onStatus("preparing", "Authorizing this device — approve once in your wallet.");
      await this.sendEr([P.setSessionIx(this.program, this.wallet, this.sessionPub)], "wallet");
      me = await this.pollUntil(
        () => this.readEr(this.mePda, P.decodeDuelist),
        (d) => d.session.equals(this.sessionPub),
        15_000,
        "Could not authorize this device.",
        signal,
      );
    }
    return me;
  }

  // ── Opponent watching ───────────────────────────────────────────────────

  private isGone(opp: P.DuelistAccount, m: LiveMatch): boolean {
    return opp.status !== P.STATUS.matched || opp.matchId !== m.id || !opp.opponent.equals(this.wallet);
  }

  private async watchOpponent<T>(
    signal: AbortSignal,
    pick: (opp: P.DuelistAccount) => T | undefined,
  ): Promise<T> {
    for (;;) {
      const m = this.match;
      if (!m) throw new OpponentGoneError();
      const opp = await this.readEr(m.opponentPda, P.decodeDuelist).catch(() => null);
      if (opp) {
        if (this.isGone(opp, m)) {
          this.fireGone();
          throw new OpponentGoneError();
        }
        const value = pick(opp);
        if (value !== undefined) return value;
      }
      await sleep(POLL_MS, signal);
    }
  }

  private startGoneWatch(): void {
    this.stopGoneWatch();
    this.goneTimer = setInterval(() => {
      const m = this.match;
      if (!m) return;
      this.readEr(m.opponentPda, P.decodeDuelist)
        .then((opp) => { if (opp && this.match === m && this.isGone(opp, m)) this.fireGone(); })
        .catch(() => undefined);
    }, GONE_POLL_MS);
  }

  private stopGoneWatch(): void {
    if (this.goneTimer) clearInterval(this.goneTimer);
    this.goneTimer = null;
  }

  private fireGone(): void {
    if (this.goneFired) return;
    this.goneFired = true;
    this.stopGoneWatch();
    this.match = null;
    for (const cb of [...this.goneListeners]) cb();
  }

  private requireMatch(): LiveMatch {
    if (!this.match) throw new OpponentGoneError();
    return this.match;
  }

  // ── RPC ─────────────────────────────────────────────────────────────────

  private async readEr<T>(pda: PublicKey, decode: (raw: Uint8Array) => T | null): Promise<T | null> {
    const info = await this.er.getAccountInfo(pda, "processed");
    if (!info || !info.owner.equals(this.program)) return null;
    return decode(new Uint8Array(info.data));
  }

  private async pollUntil<T>(
    read: () => Promise<T | null>,
    done: (value: T) => boolean,
    timeoutMs: number,
    failure: string,
    signal?: AbortSignal,
  ): Promise<T> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const value = await read().catch(() => null);
      if (value !== null && done(value)) return value;
      if (Date.now() > until) throw new Error(failure);
      await sleep(POLL_MS, signal);
    }
  }

  private async sendEr(ixs: TransactionInstruction[], by: "session" | "wallet" = "session"): Promise<string> {
    // A wallet-signed send is not retried: each attempt would be another popup.
    const attempts = by === "session" ? 3 : 1;
    let lastErr: unknown = null;
    for (let i = 0; i < attempts; i++) {
      try {
        const { blockhash } = await this.er.getLatestBlockhash();
        const feePayer = by === "session" ? this.sessionPub : this.wallet;
        let tx = new Transaction({ feePayer, recentBlockhash: blockhash }).add(...ixs);
        if (by === "session") tx.sign(this.sessionKeys.getSessionKey());
        else tx = await this.signTransaction(tx);
        const sig = await this.er.sendRawTransaction(tx.serialize(), { skipPreflight: false });
        await this.confirm(this.er, sig);
        return sig;
      } catch (err) {
        if (isProgramRejection(err)) throw err;
        lastErr = err;
      }
    }
    throw lastErr ?? new Error("Rollup transaction failed.");
  }

  private async sendBase(ixs: TransactionInstruction[]): Promise<void> {
    const { blockhash, lastValidBlockHeight } = await this.base.getLatestBlockhash();
    const tx = new Transaction({ feePayer: this.wallet, recentBlockhash: blockhash })
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), ...ixs);
    const signed = await this.signTransaction(tx);
    const sig = await this.base.sendRawTransaction(signed.serialize(), { skipPreflight: false });
    const result = await this.base.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    if (result.value.err) throw new Error(`Setup transaction failed: ${JSON.stringify(result.value.err)}`);
  }

  private async confirm(conn: Connection, sig: string): Promise<void> {
    for (const wait of [250, 400, 700, 1_000, 1_500, 2_500]) {
      await sleep(wait);
      const { value } = await conn.getSignatureStatuses([sig]);
      const status = value[0];
      if (status?.err) throw new ProgramRejected(`Transaction failed: ${JSON.stringify(status.err)}`);
      if (status) return;
    }
    throw new Error("Transaction was not confirmed in time.");
  }
}
