import {
  Connection, PublicKey, Transaction, type TransactionInstruction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  SOL_CITY_COLLECTIBLES_PROGRAM_ID, derivePackConfigPDA, deriveUnlockPDA,
  decodeUnlockState, RARITY_COUNT, deriveMintQueuePDA, decodeMintQueue,
  type UnlockState,
} from "./program";
import { buildOpenBoosterIx, buildInitUnlockStateIx, buildRetryDrawIx, buildCancelDrawIx } from "./instructions";
import { deriveDrawTicketPDA, decodeDrawTicketSlot, DRAW_CANCEL_AFTER_SLOTS } from "./program";
import { baseConnection } from "./baseRpc";
import { atStep, checkWalletKept, prepareWalletTx, type WalletStep } from "./walletTx";
import { awaitTransfer, sendAndConfirmTransfer } from "./sendTokens";
import {
  readMintConfig, pendingMintIndices, syncUnlocksToWardrobe,
  type SignedMints, type SignAllTx,
} from "./mint";
import { SOLANA_CLUSTER } from "@/game/config/clusterStorage";

/**
 * Buying a pack, on chain.
 *
 * Everything here happens on BASE, not the rollup: `open_booster` moves real
 * tokens and grows the unlock account, and UnlockState is never delegated.
 *
 * The draw is asynchronous and that shapes the whole flow. Paying only
 * REQUESTS randomness from MagicBlock's VRF; the items are granted seconds
 * later by a callback the oracle sends, which this client does not control
 * and cannot wait on inside the transaction. So the reveal is: pay, then
 * watch the unlock account until it stops being pending, then show whatever
 * is new in it.
 */

export interface OnChainPack {
  id: number;
  season: number;
  /** In the currency's smallest unit. USDC has six decimals. */
  price: bigint;
  size: number;
  /** Basis points per rarity, in RARITY_ORDER. Adds up to 10000. */
  weights: number[];
  enabled: boolean;
}

export interface PackConfigAccount {
  admin: PublicKey;
  currencyMint: PublicKey;
  treasuryTokenAccount: PublicKey;
  /** Only packs of this season can be bought. Zero means nothing is open. */
  currentSeason: number;
  packs: OnChainPack[];
  /** The emergency stop: nothing sells, opens or mints while it is set. */
  paused: boolean;
}

const MAX_PACKS = 8;

/** Re-exported from baseRpc, where it lives, so callers keep one import. */
export { baseConnection };

/**
 * Reads what the city sells. Null when the config has never been created,
 * which is the state a fresh deployment is in.
 */
export async function readPackConfig(conn: Connection): Promise<PackConfigAccount | null> {
  const info = await conn.getAccountInfo(derivePackConfigPDA()[0]);
  if (!info) return null;
  const d = Buffer.from(info.data);
  let o = 8;
  const admin = new PublicKey(d.subarray(o, o + 32)); o += 32;
  const currencyMint = new PublicKey(d.subarray(o, o + 32)); o += 32;
  const treasuryTokenAccount = new PublicKey(d.subarray(o, o + 32)); o += 32;
  const currentSeason = d.readUInt16LE(o); o += 2;

  // A fixed array of MAX_PACKS, then the count of the ones that are real.
  const all: OnChainPack[] = [];
  for (let i = 0; i < MAX_PACKS; i++) {
    const id = d.readUInt8(o); o += 1;
    const season = d.readUInt16LE(o); o += 2;
    const price = d.readBigUInt64LE(o); o += 8;
    const size = d.readUInt8(o); o += 1;
    const weights: number[] = [];
    for (let r = 0; r < RARITY_COUNT; r++) { weights.push(d.readUInt16LE(o)); o += 2; }
    const enabled = d.readUInt8(o) === 1; o += 1;
    all.push({ id, season, price, size, weights, enabled });
  }
  const packCount = d.readUInt8(o); o += 1;
  // Absent on a config written before the pause existed, which the program
  // cannot load at all until `migrate_pack_config` grows it.
  const paused = o < d.length && d.readUInt8(o) === 1;
  return {
    admin, currencyMint, treasuryTokenAccount, currentSeason,
    packs: all.slice(0, packCount), paused,
  };
}

/** Whether this pack can be bought right now, and why not when it cannot. */
export function packUnavailableReason(
  pack: OnChainPack, config: PackConfigAccount,
): string | null {
  if (config.paused) return "The shop is paused for maintenance.";
  if (!pack.enabled) return "This pack is not on sale.";
  if (config.currentSeason === 0) return "No season is open yet.";
  if (pack.season !== config.currentSeason) return "This pack belongs to a season that has closed.";
  return null;
}

/**
 * The buyer's balance in the config's currency, in the smallest unit.
 *
 * Null when they have no account for that mint at all, which is different
 * from a zero balance: it means the token has never reached this wallet, and
 * on devnet that usually means they have not been to a faucet.
 */
export async function currencyBalance(
  conn: Connection, wallet: PublicKey, mint: PublicKey,
): Promise<bigint | null> {
  try {
    const ata = getAssociatedTokenAddressSync(mint, wallet);
    const info = await conn.getAccountInfo(ata);
    if (!info) return null;
    // SPL Token account: mint(32) owner(32) amount(8).
    return Buffer.from(info.data).readBigUInt64LE(64);
  } catch {
    return null;
  }
}

/** What a wallet already owns, as catalog indices. Empty when it has no
 *  unlock account yet. */
/**
 * Re-reads what this wallet owns and hands it to the wardrobe.
 *
 * Has to run right after a pack lands. Since the chain became the authority
 * for pack items, a freshly drawn hat is NOT wearable until these bytes are
 * read back: the local grant is a mirror now, not the record, and a mirror
 * cannot authorise anything.
 */
export async function syncOwnedToWardrobe(conn: Connection, wallet: PublicKey): Promise<void> {
  // The queue with it, so a tile's MINT NOW is as fresh as its lock.
  await syncUnlocksToWardrobe(conn, wallet);
}

export async function ownedIndices(conn: Connection, wallet: PublicKey): Promise<number[]> {
  const info = await conn.getAccountInfo(deriveUnlockPDA(wallet)[0]);
  if (!info) return [];
  return decodeUnlockState(info.data)?.owned ?? [];
}

export type SignTx = (tx: Transaction) => Promise<Transaction>;

export interface BuyResult {
  signature: string;
  /** Every copy the draw handed out, in draw order, REPEATS INCLUDED. Empty
   *  if the callback has not landed yet, which is a timeout rather than a
   *  loss: the items are still coming. */
  granted: number[];
  /** What the wallet could already wear before this pack, so the reveal can
   *  mark a repeat as one. */
  ownedBefore: number[];
  timedOut: boolean;
  /**
   * Mint transactions the wallet signed at the till, waiting to be sent.
   *
   * Null when minting is not configured yet, which is the only state in which
   * a pack resolves to nothing but a grant. Handed back rather than sent here
   * so the reveal can be shown first: the player watches what they got while
   * these land behind it.
   */
  presignedMints: SignedMints | null;
  /** What is owed after the draw: anything a previous mint left behind, then
   *  every copy of this draw, repeats included. */
  owed: number[];
}

/**
 * Pays for a pack and waits for the draw.
 *
 * The wallet signs, we send. The transaction carries `init_unlock_state` too
 * when the account does not exist, because it must be there before the
 * callback can grant into it and this is the signature the player is already
 * giving: asking for a second popup at the till is how a purchase is
 * abandoned.
 */
export async function buyPack(args: {
  conn: Connection;
  wallet: PublicKey;
  /**
   * One signing call for the purchase AND the mint that follows it.
   *
   * Not `signTransaction`, even though only one transaction is sent here.
   * The mint cannot wait for the draw and then ask again: that second popup
   * is what broke the flow, and a wallet shows one approval for a batch.
   */
  signAllTransactions: SignAllTx;
  pack: OnChainPack;
  config: PackConfigAccount;
  /** How long to watch for the VRF callback. */
  revealTimeoutMs?: number;
  /**
   * How many packs of this kind, resolved as ONE draw.
   *
   * One payment, one randomness request, one reveal. The program caps
   * count x pack size at fifty, because a wallet can only have one draw in
   * flight and the callback has to resolve the whole bundle in a single
   * transaction that is not allowed to fail.
   */
  count?: number;
}): Promise<BuyResult> {
  const { conn, wallet, signAllTransactions, pack, config } = args;
  const count = Math.max(1, Math.round(args.count ?? 1));
  const timeout = args.revealTimeoutMs ?? 45_000;

  const before = new Set(await ownedIndices(conn, wallet));

  const ixs: TransactionInstruction[] = [];
  const unlockPda = deriveUnlockPDA(wallet)[0];
  if (!(await conn.getAccountInfo(unlockPda))) ixs.push(buildInitUnlockStateIx(wallet));

  const clientSeed = new Uint8Array(32);
  (globalThis.crypto ?? ({} as Crypto)).getRandomValues?.(clientSeed);
  ixs.push(buildOpenBoosterIx({
    payer: wallet,
    packId: pack.id,
    season: pack.season,
    // The price on screen came from this same read of the config.
    maxPrice: pack.price,
    clientSeed,
    treasuryTokenAccount: config.treasuryTokenAccount,
    buyerTokenAccount: getAssociatedTokenAddressSync(config.currencyMint, wallet),
    count,
  }));

  // What the mint will owe, worked out before the draw exists.
  //
  // The pack is one part of it. The other is anything a previous mint left
  // behind, because `mint_pending` takes the oldest work first and would
  // otherwise spend this pack's transactions on last week's leftovers.
  const mintConfig = await readMintConfig(conn);
  const leftover = mintConfig ? await pendingMintIndices(conn, wallet) : [];

  const { blockhash } = await conn.getLatestBlockhash();
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet }).add(...ixs);
  const ready = await prepareWalletTx(conn, tx);

  // The payment is signed ALONE. It used to share one approval with the
  // mint_pending transactions that deliver the items, but those cannot run
  // until the oracle answers: the program refuses every mint while a draw is
  // pending (BoosterPending), and the payment is what makes it pending. A
  // wallet that simulates a batch in order sees the second transaction fail,
  // and Phantom refused the batch outright with 4100, "not authorized", for
  // every account (devnet, 2026-11-05), while a single transaction ("keep
  // sealed", "MINT NOW") went through. The items are minted after the draw,
  // with a second approval (settleMints, with no pre-signed mints).
  //
  // The blockhash is taken again right before the wallet opens: the reads and
  // the simulation above take time it does not have to spare.
  const fresh = await conn.getLatestBlockhash();
  ready.recentBlockhash = fresh.blockhash;
  const asked = { blockhash: fresh.blockhash, message: ready.serializeMessage() };
  const [signedTx] = await atStep("wallet", signAllTransactions([ready]));
  const kept = await atStep("wallet", checkWalletKept(conn, asked, signedTx));

  // Sent again every few seconds until it lands, and confirmed by polling,
  // not confirmTransaction: that waits on a websocket, which the RPC refused,
  // and then declared a purchase that had LANDED expired (devnet, 2026-11-05).
  const signature = await atStep("network", sendAndConfirmTransfer({
    connection: conn, signed: signedTx, lastValidBlockHeight: fresh.lastValidBlockHeight, context: kept,
  }));

  const { granted, timedOut } = await awaitDraw(conn, wallet, before, timeout);
  return {
    signature,
    granted,
    ownedBefore: [...before],
    timedOut,
    presignedMints: null,
    owed: [...leftover, ...granted],
  };
}

/**
 * Waits for the VRF callback to resolve a draw, however the pack was spent.
 *
 * Shared by buying-and-opening and by burning a sealed pack, because the
 * wait is the same: the oracle answers on its own schedule and the only
 * thing that changes is which transaction preceded it.
 *
 * Polled rather than subscribed. The oracle writes whenever it writes, and a
 * missed websocket frame here would leave somebody who has already paid
 * staring at an empty pack.
 */
export async function awaitDraw(
  conn: Connection,
  wallet: PublicKey,
  before: Set<number>,
  timeoutMs = 45_000,
): Promise<{ granted: number[]; timedOut: boolean }> {
  const unlockPda = deriveUnlockPDA(wallet)[0];
  const queuePda = deriveMintQueuePDA(wallet);
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1500));
    const [info, queueInfo] = await conn.getMultipleAccountsInfo([unlockPda, queuePda]);
    const state = info ? decodeUnlockState(info.data) : null;
    if (!state) continue;
    // `pending` goes false in the same write that queues the draw, so a draw
    // of nothing but repeats ends here like any other.
    if (!state.pending) {
      return { granted: drawnCopies(state, queueInfo?.data ?? null, queueInfo?.owner ?? null, before), timedOut: false };
    }
  }
  return { granted: [], timedOut: true };
}

/**
 * Every copy a resolved draw handed out, in draw order, repeats included.
 *
 * Read from the MintQueue, not from `owned`: `owned` is a set, so a second
 * copy of anything, or a copy of something already owned, never shows up in
 * it. The callback appends the whole draw to the END of the queue, and the
 * draw's size stays on the UnlockState after it resolves; minting takes from
 * the FRONT, so the tail is this draw even if older copies were minted in
 * between.
 *
 * Only what is new can be seen when there is no queue (the program before
 * 2026-11-10), or when copies of this draw were already minted.
 */
export function drawnCopies(
  state: UnlockState,
  queueData: Uint8Array | null,
  queueOwner: PublicKey | null,
  before: Set<number>,
): number[] {
  const size = state.draw.size;
  const queue = queueData && queueOwner?.equals(SOL_CITY_COLLECTIBLES_PROGRAM_ID)
    ? decodeMintQueue(queueData)
    : null;
  if (queue && size > 0 && queue.owed.length >= size) {
    return queue.owed.slice(queue.owed.length - size);
  }
  return state.owned.filter((i) => !before.has(i));
}

/**
 * Whether this wallet has a pack paid for and still waiting on the oracle.
 *
 * While it does, the program refuses every other write to the unlock account
 * (a mint, a claim, an event grant), because each would take the room the
 * draw was paid for. The UI asks this so it can say so instead of offering a
 * button that will fail.
 */
export async function hasPendingDraw(conn: Connection, wallet: PublicKey): Promise<boolean> {
  const info = await conn.getAccountInfo(deriveUnlockPDA(wallet)[0]);
  return info ? (decodeUnlockState(info.data)?.pending ?? false) : false;
}

/**
 * Asks the oracle again for a draw that was paid for and never answered, and
 * waits for it.
 *
 * Costs the VRF request and a fee, never the pack: the program keeps the
 * pack, its odds and its season exactly as they were frozen at payment. The
 * retry keeps the purchase's draw id, so if the original answer turns up
 * after all, whichever lands first resolves the pack and the other finds
 * nothing pending: asking again can never draw twice, nor reroll.
 */
export async function retryStuckDraw(args: {
  conn: Connection;
  wallet: PublicKey;
  signAllTransactions: SignAllTx;
  revealTimeoutMs?: number;
}): Promise<{ granted: number[]; ownedBefore: number[]; timedOut: boolean; packId: number | null }> {
  const { conn, wallet, signAllTransactions } = args;
  const info = await conn.getAccountInfo(deriveUnlockPDA(wallet)[0]);
  const state = info ? decodeUnlockState(info.data) : null;
  if (!state?.pending) return { granted: [], ownedBefore: [], timedOut: false, packId: null };

  const before = new Set(state.owned);
  const clientSeed = new Uint8Array(32);
  (globalThis.crypto ?? ({} as Crypto)).getRandomValues?.(clientSeed);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet }).add(
    buildRetryDrawIx({ payer: wallet, season: state.draw.season, clientSeed }),
  );
  const [signed] = await signAllTransactions([await prepareWalletTx(conn, tx)]);
  const signature = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  await awaitTransfer(conn, signature, lastValidBlockHeight);
  const result = await awaitDraw(conn, wallet, before, args.revealTimeoutMs ?? 45_000);
  return { ...result, ownedBefore: [...before], packId: state.draw.packId };
}

/**
 * Whether the wallet's stuck draw has waited long enough to be cancelled
 * (`cancel_draw`, audit r2 R2-04). False with no ticket: a draw paid before
 * tickets existed is resolved with a retry, which creates one.
 */
export async function canCancelDraw(conn: Connection, wallet: PublicKey): Promise<boolean> {
  const [info, slot] = await Promise.all([
    conn.getAccountInfo(deriveDrawTicketPDA(wallet)),
    conn.getSlot(),
  ]);
  const requested = info ? decodeDrawTicketSlot(info.data) : null;
  return requested !== null && slot >= requested + DRAW_CANCEL_AFTER_SLOTS;
}

/** Gives up on the stuck draw. Clears it on chain; the refund is by hand. */
export async function cancelStuckDraw(args: {
  conn: Connection;
  wallet: PublicKey;
  signAllTransactions: SignAllTx;
}): Promise<void> {
  const { conn, wallet, signAllTransactions } = args;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet }).add(buildCancelDrawIx(wallet));
  const [signed] = await signAllTransactions([await prepareWalletTx(conn, tx)]);
  const signature = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  await awaitTransfer(conn, signature, lastValidBlockHeight);
}

/** Program id, re-exported so a caller does not need two imports. Packs live
 *  in the collectibles program, not the city one. */
export { SOL_CITY_COLLECTIBLES_PROGRAM_ID };

/**
 * Whether this wallet's payment account IS the shop's treasury.
 *
 * The program refuses that purchase (audit R-41: paying the treasury from
 * itself is no payment) with a bare "Wrong treasury account". It happens to
 * exactly one wallet, the one the treasury was set up with, which on devnet
 * is the admin everyone tests with, so the shop says it in words instead.
 */
export function buyerIsTreasury(config: PackConfigAccount, wallet: PublicKey): boolean {
  return getAssociatedTokenAddressSync(config.currencyMint, wallet).equals(config.treasuryTokenAccount);
}

/**
 * Why this wallet cannot pay for `count` of `pack`, or null when it can.
 *
 * Checked BEFORE the wallet is asked to sign. A wallet with no token account
 * for the currency at all made the program fail with a bare
 * "InvalidAccountData" (devnet, 2026-11-05), because `currencyBalance`
 * answers null for "no account", and the shop only warned on zero.
 */
export async function fundsShortfall(
  conn: Connection, wallet: PublicKey, config: PackConfigAccount, pack: OnChainPack, count: number,
): Promise<string | null> {
  const need = pack.price * BigInt(Math.max(1, count));
  const have = (await currencyBalance(conn, wallet, config.currencyMint)) ?? BigInt(0);
  if (have >= need) return null;
  const usdc = (n: bigint) => (Number(n) / 1e6).toFixed(2);
  const faucet = SOLANA_CLUSTER === "mainnet" ? "" : " Get devnet USDC at faucet.circle.com (Solana Devnet).";
  return `This needs ${usdc(need)} USDC and the wallet has ${usdc(have)}.${faucet}`;
}

/**
 * A failed send in words: the program's own error message when the logs carry
 * one, else the first line. web3.js puts the logs on the error and the useful
 * part was being cut off, leaving only "Simulation failed." on screen.
 */
export function txErrorText(err: unknown, fallback: string): string {
  const text = baseErrorText(err, fallback);
  // Where it broke, unless the player said no themselves (4001): the same
  // words mean different fixes from the wallet and from the network.
  const step = (err as { walletStep?: WalletStep } | null)?.walletStep;
  const declined = (err as { code?: number } | null)?.code === 4001
    || /rejected|declined|cancel/i.test((err as { message?: string } | null)?.message ?? "");
  if (!step || declined) return text;
  const where = `${text} (${step === "wallet" ? "in the wallet" : "on the network"})`;
  // What sendAndConfirmTransfer saw on the way, off mainnet only: it is for
  // whoever is debugging the shop, not for a player.
  const diagnosis = (err as { diagnosis?: string } | null)?.diagnosis;
  return diagnosis && SOLANA_CLUSTER !== "mainnet" ? `${where} [${diagnosis}]` : where;
}

function baseErrorText(err: unknown, fallback: string): string {
  const e = err as { message?: string; logs?: string[]; transactionLogs?: string[]; code?: number } | null;
  // A signed transaction whose blockhash ran out before it was sent: the
  // approval took too long. It never landed, so nothing was charged.
  if (/Blockhash not found|block height exceeded|BlockhashNotFound/i.test(`${e?.message ?? ""} ${(e?.logs ?? []).join(" ")}`)) {
    return "The approval took too long and the transaction expired. Nothing was charged. Try again.";
  }
  // Phantom's 4100: it does not count this site as connected for the account
  // in use, typically after switching accounts in the wallet.
  if (e?.code === 4100 || /not been authorized by the user/i.test(e?.message ?? "")) {
    return "Your wallet isn't connected to this site for this account. Disconnect the site in your wallet, reload, and connect again.";
  }
  const logs = e?.logs ?? e?.transactionLogs ?? [];
  const anchor = logs.find((l) => l.includes("Error Message:"));
  if (anchor) return anchor.slice(anchor.indexOf("Error Message:") + 14).trim();
  const failed = [...logs].reverse().find((l) => / failed: /.test(l));
  if (failed) return failed.slice(failed.indexOf("failed: ") + 8).trim();
  const msg = e?.message ?? "";
  const inner = msg.match(/Message:\s*([^\n]+)/);
  if (inner) return inner[1].trim().slice(0, 200);
  return msg.split("\n")[0] || fallback;
}
