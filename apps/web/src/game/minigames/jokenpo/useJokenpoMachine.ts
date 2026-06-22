/**
 * JoKenPo match state machine. Trimmed port of MagicBlock's reference
 * `useGameMachine.ts`: same on-chain sequencing (create/join → delegate →
 * init permission → pick → reveal-poll → next round / settle), but identity
 * comes from Solana City's existing session key (and the bot's local
 * keypair) instead of the reference's own burner/TopUp/Withdraw/QR system —
 * see ../../solana/rps/{client,bot,funding}.ts.
 *
 * v1 scope note: no resume-after-reload. Closing the overlay mid-match
 * abandons that match; a future iteration can add resume by re-deriving
 * state from `fetchGameAnywhere` like the reference's `runUrl` does.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BN } from "@coral-xyz/anchor";
import { Connection, LAMPORTS_PER_SOL, PublicKey, Transaction } from "@solana/web3.js";
import {
  RpsClient,
  randomChoice,
  choiceName,
  resultIsSet,
  winnerKey,
  matchDecided,
  type ChoiceName,
  type GameAccount,
} from "../../solana/rps/client";
import { loadOrCreateBotKeypair } from "../../solana/rps/bot";
import { getSolBalance, transferSolFromKeypair, topUpSessionKey } from "../../solana/rps/funding";
import { BASE_ENDPOINT, BOT_FUND_SOL, PLAY_HEADROOM_SOL, POLL_INTERVAL_MS, baseExplorerTxUrl } from "../../solana/rps/config";
import type { JokenpoOpponent } from "../types";

export { baseExplorerTxUrl };

export type Phase =
  | "loading"
  | "needs-funds"
  | "setting-up"
  | "pick"
  | "submitting"
  | "waiting"
  | "revealing"
  | "round-over"
  | "settling"
  | "done"
  | "error";

export type Outcome = "win" | "lose" | "tie";
export interface ResultView {
  me: ChoiceName;
  them: ChoiceName;
  outcome: Outcome;
}

/**
 * `layer` tells you WHERE a step ran, which is the whole transparency story:
 * "base" = ordinary Solana devnet, publicly readable by anyone right away.
 * "tee"  = inside the Private Ephemeral Rollup — choices are sealed there
 *          until `reveal_round` flips them public, even though it's a real
 *          on-chain transaction with a real signature you can go check.
 * "settle" = back on base, paying out / cleaning up once the match ends.
 */
export type LogLayer = "base" | "tee" | "settle";
export interface LogEntry {
  id: number;
  text: string;
  layer: LogLayer;
  status: "pending" | "ok" | "err";
  sig?: string;
}

const REVEAL_ANIM_MS = 2200;
const ROUND_INTERLUDE_MS = 1800;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Cancelled {
  cancelled: boolean;
}

export interface JokenpoMachineArgs {
  opponent: JokenpoOpponent;
  stakeSol: number;
  bestOf: 1 | 3;
  /** The connected real wallet — only used to top up the session key once. */
  walletPublicKey: PublicKey | null;
  sendTransaction: ((tx: Transaction, connection: Connection) => Promise<string>) | null;
  /** Raw Keypair behind Solana City's existing session key (no popup signer). */
  sessionKeypair: import("@solana/web3.js").Keypair;
}

export function useJokenpoMachine(args: JokenpoMachineArgs) {
  const { opponent, stakeSol, bestOf, walletPublicKey, sendTransaction, sessionKeypair } = args;

  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [fundNeededSol, setFundNeededSol] = useState(0);
  const [opponentLocked, setOpponentLocked] = useState(false);
  const [myChoice, setMyChoice] = useState<ChoiceName | null>(null);
  const [result, setResult] = useState<ResultView | null>(null);
  const [myWins, setMyWins] = useState(0);
  const [theirWins, setTheirWins] = useState(0);
  const [round, setRound] = useState(1);
  const [matchOver, setMatchOver] = useState(false);
  const [settled, setSettled] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);

  const clientRef = useRef<RpsClient | null>(null);
  const gameIdRef = useRef<BN | null>(null);
  const playersRef = useRef<{ p1: PublicKey; p2: PublicKey } | null>(null);
  const botRef = useRef<RpsClient | null>(null);
  const tokenRef = useRef<Cancelled>({ cancelled: false });
  const logIdRef = useRef(0);
  const targetWins = bestOf === 3 ? 2 : 1;

  const stakeLamports = new BN(Math.round(stakeSol * LAMPORTS_PER_SOL));

  // ----- transparency log: every on-chain step, in order, with its real signature -----
  const pushLog = useCallback((text: string, layer: LogLayer): number => {
    const id = ++logIdRef.current;
    setLog((l) => [...l, { id, text, layer, status: "pending" }]);
    return id;
  }, []);
  const settleLog = useCallback((id: number, status: "ok" | "err", sig?: string) => {
    setLog((l) => l.map((e) => (e.id === id ? { ...e, status, sig } : e)));
  }, []);
  const step = useCallback(
    async <T extends string | void>(text: string, layer: LogLayer, fn: () => Promise<T>): Promise<T> => {
      const id = pushLog(text, layer);
      try {
        const sig = await fn();
        settleLog(id, "ok", typeof sig === "string" ? sig : undefined);
        return sig;
      } catch (e) {
        settleLog(id, "err");
        throw e;
      }
    },
    [pushLog, settleLog]
  );

  // ----- funding (session key only — the bot funds itself from the player) -----
  const ensureSessionFunds = useCallback(
    async (token: Cancelled, minSol: number) => {
      const conn = new Connection(BASE_ENDPOINT, "confirmed");
      let bal = await getSolBalance(conn, sessionKeypair.publicKey);
      if (bal >= minSol) return;
      if (!walletPublicKey || !sendTransaction) {
        throw new Error("Connect a wallet to fund this match.");
      }
      setFundNeededSol(minSol - bal);
      setPhase("needs-funds");
      const lamportsShort = Math.round((minSol - bal) * LAMPORTS_PER_SOL);
      await topUpSessionKey(conn, walletPublicKey, sendTransaction, sessionKeypair.publicKey, lamportsShort);
      if (token.cancelled) return;
      bal = await getSolBalance(conn, sessionKeypair.publicKey);
      if (bal < minSol) throw new Error("Top-up didn't land in time — try again.");
    },
    [sessionKeypair, walletPublicKey, sendTransaction]
  );

  // ----- bot's secret pick -----
  const botPick = useCallback(
    async (gameId: BN) => {
      const bot = botRef.current;
      if (!bot) return;
      setOpponentLocked(false);
      await sleep(400);
      await step("🤖 JoKenPo Master locked in a secret choice", "tee", () => bot.makeChoice(gameId, randomChoice()));
      setOpponentLocked(true);
    },
    [step]
  );

  const advanceRound = useCallback(
    async (client: RpsClient, gameId: BN, token: Cancelled) => {
      const players = playersRef.current;
      if (!players) return;
      await sleep(ROUND_INTERLUDE_MS);
      if (token.cancelled) return;
      await step("Next round — choices re-sealed", "tee", () =>
        client.nextRound(gameId, players.p1, players.p2)
      ).catch(() => undefined);
      for (let i = 0; i < 30 && !token.cancelled; i++) {
        const g = await client.fetchGameEr(gameId).catch(() => null);
        if (g && !resultIsSet(g)) break;
        await sleep(700);
      }
      if (token.cancelled) return;
      setMyChoice(null);
      setResult(null);
      setPhase("pick");
      if (botRef.current) botPick(gameId).catch(() => undefined);
    },
    [botPick, step]
  );

  const finish = useCallback(
    (client: RpsClient, game: GameAccount, token: Cancelled) => {
      const meIsP1 = !!game.player1?.equals(client.publicKey);
      const me = choiceName(meIsP1 ? game.player1Choice : game.player2Choice);
      const them = choiceName(meIsP1 ? game.player2Choice : game.player1Choice);
      const w = winnerKey(game);
      const outcome: Outcome =
        "tie" in game.roundResult ? "tie" : w?.equals(client.publicKey) ? "win" : "lose";
      if (me && them) setResult({ me, them, outcome });
      setMyChoice(me);
      setMyWins(meIsP1 ? game.player1Wins : game.player2Wins);
      setTheirWins(meIsP1 ? game.player2Wins : game.player1Wins);
      setRound(game.round);
      if (game.player1 && game.player2) playersRef.current = { p1: game.player1, p2: game.player2 };

      const decided = matchDecided(game);
      setMatchOver(decided);
      setPhase("revealing");
      window.setTimeout(() => {
        if (token.cancelled) return;
        if (decided) setPhase("done");
        else {
          setPhase("round-over");
          advanceRound(client, gameIdRef.current!, token).catch(() => undefined);
        }
      }, REVEAL_ANIM_MS);
    },
    [advanceRound]
  );

  const revealLoop = useCallback(
    async (client: RpsClient, gameId: BN, token: Cancelled) => {
      setPhase("waiting");
      let revealLogged = false;
      while (!token.cancelled) {
        const erGame = await client.fetchGameEr(gameId).catch(() => null);
        if (resultIsSet(erGame)) return finish(client, erGame!, token);
        if (erGame?.player1 && erGame?.player2) {
          const sig = await client.tryReveal(gameId, erGame.player1, erGame.player2).catch(() => null);
          if (sig && !revealLogged) {
            revealLogged = true;
            const id = pushLog("Both choices in — revealed in the TEE", "tee");
            settleLog(id, "ok", sig);
          }
          const revealed = await client.fetchGameEr(gameId).catch(() => null);
          if (resultIsSet(revealed)) return finish(client, revealed!, token);
        }
        await sleep(POLL_INTERVAL_MS);
      }
    },
    [finish, pushLog, settleLog]
  );

  const pick = useCallback(
    async (choice: ChoiceName) => {
      const client = clientRef.current;
      const gameId = gameIdRef.current;
      const token = tokenRef.current;
      if (!client || !gameId || phase !== "pick") return;
      setPhase("submitting");
      setMyChoice(choice);
      try {
        await step("Lock in your choice 🔒", "tee", () => client.makeChoice(gameId, choice));
        await revealLoop(client, gameId, token);
      } catch (e) {
        if (token.cancelled) return;
        setError(errMsg(e));
        setPhase("error");
      }
    },
    [phase, revealLoop, step]
  );

  const settle = useCallback(async () => {
    const client = clientRef.current;
    const gameId = gameIdRef.current;
    const players = playersRef.current;
    const token = tokenRef.current;
    if (!client || !gameId || !players || settled) return;
    setPhase("settling");
    try {
      if (!(await client.isOnBase(gameId))) {
        await step("Commit & undelegate back to Solana", "settle", () =>
          client.undelegateAll(gameId, players.p1, players.p2)
        );
      }
      for (let i = 0; i < 30 && !(await client.isOnBase(gameId)); i++) await sleep(800);
      const game = await client.fetchGameBase(gameId).catch(() => null);
      if (game && !game.stake.isZero() && !game.paid) {
        await step("Pay out the pot 💰", "settle", () => client.claimPot(gameId, players.p1, players.p2));
      }
      // Solo: sweep the bot's burner balance back so it doesn't pile up devnet SOL.
      if (opponent.kind === "bot" && botRef.current) {
        const bot = botRef.current;
        const botBal = await getSolBalance(bot.baseConnection, bot.publicKey);
        const reserve = 0.001;
        if (botBal > reserve) {
          await step("Return JoKenPo Master's balance to you", "settle", () =>
            transferSolFromKeypair(bot.baseConnection, bot.keypair, client.publicKey, botBal - reserve)
          );
        }
      }
      if (!token.cancelled) {
        setSettled(true);
        setPhase("done");
      }
    } catch (e) {
      const game = await client.fetchGameBase(gameId).catch(() => null);
      if (game?.paid || (game && game.stake.isZero() && resultIsSet(game))) {
        setSettled(true);
        setPhase("done");
      } else if (!token.cancelled) {
        setError(errMsg(e));
        setPhase("error");
      }
    }
  }, [settled, opponent, step]);

  // ----- flows -----
  const runSolo = useCallback(
    async (token: Cancelled) => {
      const player = new RpsClient(sessionKeypair);
      clientRef.current = player;
      await ensureSessionFunds(token, PLAY_HEADROOM_SOL + BOT_FUND_SOL + stakeSol * 2);
      if (token.cancelled) return;

      setPhase("setting-up");
      const gameId = new BN(Date.now());
      gameIdRef.current = gameId;

      await step("Create game & delegate to the TEE", "base", () =>
        player.createGameAndDelegate(gameId, stakeLamports, targetWins)
      );
      await step("Make your choice readable by you alone", "tee", () => player.initOwnChoicePermission(gameId));
      if (token.cancelled) return;
      setPhase("pick");

      (async () => {
        const bot = new RpsClient(loadOrCreateBotKeypair());
        botRef.current = bot;
        const botNeeds = BOT_FUND_SOL + stakeSol;
        const botBal = await getSolBalance(bot.baseConnection, bot.publicKey);
        if (botBal < botNeeds) {
          await step("Fund JoKenPo Master", "base", () =>
            transferSolFromKeypair(player.baseConnection, player.keypair, bot.publicKey, botNeeds - botBal)
          );
        }
        await step("JoKenPo Master joins & delegates the game", "base", () => bot.joinGameAndDelegate(gameId));
        await step("Game shared by both, JoKenPo Master's choice sealed", "tee", () =>
          bot.initGameAndOwnChoicePermissions(gameId, player.publicKey)
        );
        await sleep(500);
        await step("🤖 JoKenPo Master locked in a secret choice", "tee", () =>
          bot.makeChoice(gameId, randomChoice())
        );
        setOpponentLocked(true);
      })().catch((e) => {
        if (token.cancelled) return;
        setError(`JoKenPo Master ran into a problem: ${errMsg(e)}`);
        setPhase("error");
      });
    },
    [sessionKeypair, ensureSessionFunds, stakeSol, stakeLamports, targetWins, step]
  );

  const runPvpHost = useCallback(
    async (token: Cancelled, gameId: BN, opponentWallet: PublicKey) => {
      const player = new RpsClient(sessionKeypair);
      clientRef.current = player;
      gameIdRef.current = gameId;
      await ensureSessionFunds(token, PLAY_HEADROOM_SOL + stakeSol);
      if (token.cancelled) return;

      setPhase("setting-up");
      await step("Create game & delegate to the TEE", "base", () =>
        player.createGameAndDelegate(gameId, stakeLamports, targetWins)
      );
      await step("Make your choice readable by you alone", "tee", () => player.initOwnChoicePermission(gameId));
      if (token.cancelled) return;
      setPhase("pick");

      // Wait for the joiner to show up on base, then keep tracking via ER.
      while (!token.cancelled) {
        const game = await player.fetchGameBase(gameId).catch(() => null);
        if (game?.player2) {
          playersRef.current = { p1: player.publicKey, p2: game.player2 };
          return;
        }
        await sleep(POLL_INTERVAL_MS);
      }
    },
    [sessionKeypair, ensureSessionFunds, stakeSol, stakeLamports, targetWins, step]
  );

  const runPvpJoin = useCallback(
    async (token: Cancelled, gameId: BN, hostWallet: PublicKey) => {
      const player = new RpsClient(sessionKeypair);
      clientRef.current = player;
      gameIdRef.current = gameId;
      await ensureSessionFunds(token, PLAY_HEADROOM_SOL + stakeSol);
      if (token.cancelled) return;

      setPhase("setting-up");
      // Host may still be approving their own funding wallet popup — give
      // this a generous budget (~90s) rather than the program's other
      // tight on-chain-confirmation polls.
      for (let i = 0; i < 90 && !token.cancelled; i++) {
        const g = await player.fetchGameBase(gameId).catch(() => null);
        if (g?.player1) break;
        await sleep(1000);
      }
      if (token.cancelled) return;
      await step(
        stakeSol > 0 ? `Join game & stake ${stakeSol} SOL — delegate to the TEE` : "Join game & delegate to the TEE",
        "base",
        () => player.joinGameAndDelegate(gameId)
      );
      await step("Game shared by both, your choice sealed", "tee", () =>
        player.initGameAndOwnChoicePermissions(gameId, hostWallet)
      );
      if (token.cancelled) return;
      playersRef.current = { p1: hostWallet, p2: player.publicKey };
      setPhase("pick");
    },
    [sessionKeypair, ensureSessionFunds, stakeSol, step]
  );

  // ----- lifecycle -----
  useEffect(() => {
    const token: Cancelled = { cancelled: false };
    tokenRef.current = token;
    setPhase("loading");
    setError(null);
    setLog([]);
    setResult(null);
    setMyChoice(null);
    setOpponentLocked(false);
    setSettled(false);
    setMyWins(0);
    setTheirWins(0);
    setRound(1);
    setMatchOver(false);
    playersRef.current = null;
    botRef.current = null;

    const run = async () => {
      if (opponent.kind === "bot") {
        await runSolo(token);
      } else {
        const gameId = new BN(opponent.gameId);
        const oppWallet = new PublicKey(opponent.wallet);
        if (opponent.isHost) await runPvpHost(token, gameId, oppWallet);
        else await runPvpJoin(token, gameId, oppWallet);
      }
    };
    run().catch((e) => {
      if (token.cancelled) return;
      setError(errMsg(e));
      setPhase("error");
    });

    return () => {
      token.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    phase,
    error,
    log,
    fundNeededSol,
    opponentLocked,
    myChoice,
    result,
    myWins,
    theirWins,
    round,
    targetWins,
    matchOver,
    settled,
    potSol: stakeSol * 2,
    pick,
    settle,
  };
}
