import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  buildAcceptFriendRequestIx,
  buildCancelFriendRequestIx,
  buildDeclineFriendRequestIx,
  buildRemoveFriendIx,
  buildSendFriendRequestIx,
} from "@/game/solana/instructions";
import { BASE_RPC_PRIMARY, resilientBaseFetch } from "@/game/solana/baseRpc";
import { transactionLog } from "@/game/telemetry/transactionLog";
import { invalidateFriends } from "./friends";

/**
 * The four things you can do about a friendship, as base-layer transactions.
 *
 * Wallet-signed, one prompt each, because they create and close accounts and
 * the session key holds no lamports. That is the right shape anyway: inviting
 * somebody is a deliberate act, not a movement update.
 *
 * Sent the way everything else here sends base transactions: the wallet SIGNS
 * only and we do the sending, over the failover RPC. Never the Magic Router,
 * which hangs on sendRawTransaction.
 */

export type FriendAction = "invite" | "accept" | "decline" | "cancel" | "remove";

export type FriendResult =
  | { ok: true; signature: string }
  | { ok: false; message: string };

type SignTransaction = (tx: Transaction) => Promise<Transaction>;

let shared: Connection | null = null;

function baseConnection(): Connection {
  if (!shared) {
    shared = new Connection(BASE_RPC_PRIMARY, {
      commitment: "confirmed",
      fetch: resilientBaseFetch,
    });
  }
  return shared;
}

const LABEL: Record<FriendAction, string> = {
  invite: "Friend invite sent",
  accept: "Friend invite accepted",
  decline: "Friend invite declined",
  cancel: "Friend invite cancelled",
  remove: "Friend removed",
};

/**
 * Turns a program failure into something a player can act on.
 *
 * The two that actually happen: inviting someone twice (the invite PDA already
 * exists, so `init` fails), and inviting a wallet with no player account. The
 * second is a consequence of the player_v3 reset rather than anything the
 * inviter did wrong, so it says what to do about it.
 */
function explain(err: unknown, action: FriendAction): string {
  const raw = String((err as Error)?.message ?? err ?? "");
  if (/already in use|custom program error: 0x0\b/i.test(raw)) {
    return action === "invite"
      ? "You already invited them. Give them a moment."
      : "That already went through.";
  }
  if (/AccountNotInitialized|could not find account|AccountOwnedByWrongProgram/i.test(raw)) {
    return "They need to visit the city once before they can be invited.";
  }
  if (/FriendSelf/i.test(raw)) return "You can't befriend yourself.";
  if (/insufficient|0x1\b/i.test(raw)) {
    return "Not enough SOL to cover the account. It comes back when the invite is answered.";
  }
  if (/User rejected|rejected the request/i.test(raw)) return "Cancelled.";
  return "That didn't go through. Try again in a moment.";
}

function buildIx(action: FriendAction, me: PublicKey, other: PublicKey) {
  switch (action) {
    case "invite":  return buildSendFriendRequestIx(me, other);
    case "accept":  return buildAcceptFriendRequestIx(me, other);
    case "decline": return buildDeclineFriendRequestIx(me, other);
    case "cancel":  return buildCancelFriendRequestIx(me, other);
    case "remove":  return buildRemoveFriendIx(me, other);
  }
}

export async function runFriendAction(
  action: FriendAction,
  me: PublicKey,
  other: PublicKey,
  signTransaction: SignTransaction,
): Promise<FriendResult> {
  const entry = transactionLog.record({
    kind: "friend",
    layer: "base",
    label: LABEL[action],
    status: "pending",
  });

  try {
    const conn = baseConnection();
    const tx = new Transaction().add(buildIx(action, me, other));
    tx.feePayer = me;
    tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;

    const signed = await signTransaction(tx);
    const signature = await conn.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
    });
    await conn.confirmTransaction(signature, "confirmed");

    // The lists just changed, so the next read must go to the chain.
    invalidateFriends();
    transactionLog.markConfirmed(entry.id, signature);
    return { ok: true, signature };
  } catch (err) {
    transactionLog.markFailed(entry.id, String((err as Error)?.message ?? err));
    return { ok: false, message: explain(err, action) };
  }
}
