import {
  Connection, PublicKey, Transaction, type TransactionInstruction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  SOL_CITY_COLLECTIBLES_PROGRAM_ID, derivePackConfigPDA, deriveUnlockPDA,
  decodeUnlockState, RARITY_COUNT,
} from "./program";
import { buildOpenBoosterIx, buildInitUnlockStateIx } from "./instructions";
import { baseConnection } from "./baseRpc";
import { prepareWalletTx } from "./walletTx";
import {
  readMintConfig, pendingMintIndices, buildMintPendingTxs,
  type SignedMints, type SignAllTx,
} from "./mint";
import { setOnChainUnlocks } from "@/game/config/wardrobeUnlocks";

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
  const packCount = d.readUInt8(o);
  return { admin, currencyMint, treasuryTokenAccount, currentSeason, packs: all.slice(0, packCount) };
}

/** Whether this pack can be bought right now, and why not when it cannot. */
export function packUnavailableReason(
  pack: OnChainPack, config: PackConfigAccount,
): string | null {
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
  const info = await conn.getAccountInfo(deriveUnlockPDA(wallet)[0]);
  setOnChainUnlocks(wallet.toBase58(), info ? new Uint8Array(info.data) : null);
}

export async function ownedIndices(conn: Connection, wallet: PublicKey): Promise<number[]> {
  const info = await conn.getAccountInfo(deriveUnlockPDA(wallet)[0]);
  if (!info) return [];
  return decodeUnlockState(info.data)?.owned ?? [];
}

export type SignTx = (tx: Transaction) => Promise<Transaction>;

export interface BuyResult {
  signature: string;
  /** Catalog indices the draw granted. Empty if the callback has not landed
   *  yet, which is a timeout rather than a loss: the items are still coming. */
  granted: number[];
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
  /** What those transactions owe, which is the draw plus anything a previous
   *  mint left behind. */
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

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet }).add(...ixs);

  // One approval, two kinds of transaction: the one that pays, and the ones
  // that deliver. The second kind names no index, so it can be signed now and
  // sent when the oracle has decided what the indices are.
  const mintTxs = mintConfig
    ? buildMintPendingTxs({
        wallet, config: mintConfig, blockhash,
        items: leftover.length + count * pack.size,
      })
    : [];
  // Only the payment can be simulated now: the mints read a draw that does
  // not exist yet. They carry their own compute limits (buildMintPendingTxs).
  const ready = await prepareWalletTx(conn, tx);
  const signed = await signAllTransactions([ready, ...mintTxs]);

  const signature = await conn.sendRawTransaction(signed[0].serialize(), { skipPreflight: false });
  await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");

  const { granted, timedOut } = await awaitDraw(conn, wallet, before, timeout);
  return {
    signature,
    granted,
    timedOut,
    presignedMints: mintConfig
      ? { txs: signed.slice(1), lastValidBlockHeight }
      : null,
    owed: [...leftover, ...granted.filter((i) => !leftover.includes(i))].sort((a, b) => a - b),
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
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1500));
    const info = await conn.getAccountInfo(unlockPda);
    const state = info ? decodeUnlockState(info.data) : null;
    if (!state) continue;
    // `pending` goes false in the same write that grants, so a draw that
    // genuinely gave nothing new (every item a duplicate) still ends here
    // rather than running to the timeout.
    if (!state.pending) {
      return { granted: state.owned.filter((i) => !before.has(i)), timedOut: false };
    }
  }
  return { granted: [], timedOut: true };
}

/** Program id, re-exported so a caller does not need two imports. Packs live
 *  in the collectibles program, not the city one. */
export { SOL_CITY_COLLECTIBLES_PROGRAM_ID };
