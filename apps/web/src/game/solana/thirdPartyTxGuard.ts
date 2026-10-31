import {
  Connection, PublicKey, SystemProgram, Transaction, TransactionMessage,
  VersionedTransaction, type AddressLookupTableAccount,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, NATIVE_MINT } from "@solana/spl-token";

/**
 * A look at a transaction somebody ELSE built, before the player is asked to
 * sign it (audit R-12).
 *
 * Jupiter, the stock venue and MagicBlock's payments API all hand back a
 * finished transaction, and the city passes it to the wallet. Whatever that
 * API returns, the player signs inside our game, trusting our game. An API
 * that is compromised, a proxy in the way, or a plain bug, and the wallet is
 * shown something with one extra instruction in it.
 *
 * Trusting the API is the deal with any integration, and the city will have
 * many, so this is deliberately NOT a list of allowed programs (owner's call,
 * 2026-10-31). It is two things that hold whatever the integration is:
 *
 *   1. Instructions that are never part of an honest swap, deposit or
 *      transfer are refused outright: handing a delegate or an authority over
 *      the player's tokens, closing the player's account into somebody else's,
 *      reassigning the player's own account.
 *   2. The transaction is simulated and what the player would LOSE, per
 *      asset, is compared with what they agreed to spend. More than that,
 *      beyond a small margin, and the wallet never opens.
 *
 * Neither replaces the wallet's own simulation. They are here because most
 * players do not read it, and because the refusal should come from the game
 * that asked.
 */

export class UnsafeTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeTransactionError";
  }
}

/** What the player agreed to give up. `mint` is a mint address, or "SOL". */
export interface Spend {
  mint: string;
  amount: bigint;
}

export interface GuardOptions {
  /** Where to simulate: the cluster the transaction will land on. */
  conn: Connection;
  /** The player's wallet. */
  owner: PublicKey;
  /** What the player agreed to spend. Empty means "nothing but fees". */
  spend: Spend[];
  /** Tolerance on each agreed amount, in basis points. Default 100 (1%). */
  marginBps?: number;
  /**
   * SOL the transaction may cost on top of any SOL in `spend`: fees, priority
   * fees, and the rent of token accounts it creates for the player. Default
   * 0.02 SOL, which is several new accounts.
   */
  solAllowanceLamports?: bigint;
}

const SOL = "SOL";
const DEFAULT_MARGIN_BPS = 100;
const DEFAULT_SOL_ALLOWANCE = BigInt(20_000_000);

// SPL Token instruction tags, the same in Token-2022.
const TOKEN_APPROVE = 4;
const TOKEN_SET_AUTHORITY = 6;
const TOKEN_CLOSE_ACCOUNT = 9;
const TOKEN_APPROVE_CHECKED = 13;
// System Program instruction tag, little-endian u32.
const SYSTEM_ASSIGN = 1;

export interface PlainInstruction {
  programId: PublicKey;
  keys: { pubkey: PublicKey }[];
  data: Uint8Array;
}

/**
 * What in these instructions no honest integration needs. Empty when nothing.
 *
 * Pure, so it is tested without a network: everything that needs resolving
 * (lookup tables) has been resolved by the caller.
 */
export function staticViolations(ixs: PlainInstruction[], owner: PublicKey): string[] {
  const out: string[] = [];
  const is = (k: PublicKey | undefined) => !!k && k.equals(owner);
  for (const ix of ixs) {
    const k = ix.keys.map((m) => m.pubkey);
    if (ix.programId.equals(TOKEN_PROGRAM_ID) || ix.programId.equals(TOKEN_2022_PROGRAM_ID)) {
      const tag = ix.data[0];
      // A delegate over the player's tokens can spend them later, after this
      // transaction and outside anything the player saw.
      if (tag === TOKEN_APPROVE && is(k[2])) out.push("it would give someone else the right to spend your tokens");
      if (tag === TOKEN_APPROVE_CHECKED && is(k[3])) out.push("it would give someone else the right to spend your tokens");
      // A new owner or close authority is the account itself, handed over.
      if (tag === TOKEN_SET_AUTHORITY && is(k[1])) out.push("it would hand control of one of your token accounts to someone else");
      // Closing is normal (a swap unwraps its temporary SOL account); closing
      // INTO somebody else's account is how the balance leaves.
      if (tag === TOKEN_CLOSE_ACCOUNT && is(k[2]) && !is(k[1])) out.push("it would close one of your token accounts into someone else's");
    }
    if (ix.programId.equals(SystemProgram.programId) && ix.data.length >= 4) {
      const tag = ix.data[0] | (ix.data[1] << 8) | (ix.data[2] << 16) | (ix.data[3] << 24);
      if (tag === SYSTEM_ASSIGN && is(k[0])) out.push("it would reassign your wallet account to a program");
    }
  }
  return out;
}

/**
 * What the player would lose beyond what they agreed to. Empty when nothing.
 *
 * `losses` is per asset ("SOL" or a mint), positive meaning the balance goes
 * down. Gains are not judged: receiving more is never the attack.
 */
export function balanceViolations(
  losses: Map<string, bigint>,
  spend: Spend[],
  marginBps = DEFAULT_MARGIN_BPS,
  solAllowanceLamports = DEFAULT_SOL_ALLOWANCE,
): string[] {
  const allowed = new Map<string, bigint>();
  for (const s of spend) {
    const key = s.mint === NATIVE_MINT.toBase58() ? SOL : s.mint;
    const withMargin = s.amount + (s.amount * BigInt(marginBps)) / BigInt(10_000);
    allowed.set(key, (allowed.get(key) ?? BigInt(0)) + withMargin);
  }
  allowed.set(SOL, (allowed.get(SOL) ?? BigInt(0)) + solAllowanceLamports);

  const out: string[] = [];
  for (const [asset, lost] of losses) {
    if (lost <= BigInt(0)) continue;
    const cap = allowed.get(asset) ?? BigInt(0);
    if (lost > cap) {
      out.push(asset === SOL
        ? `it would take ${lost} lamports of SOL, more than the ${cap} this action can cost`
        : `it would take ${lost} of token ${asset.slice(0, 8)}…, more than the ${cap} you agreed to`);
    }
  }
  return out;
}

async function resolve(
  conn: Connection, tx: Transaction | VersionedTransaction,
): Promise<{ vtx: VersionedTransaction; ixs: PlainInstruction[]; writable: PublicKey[] }> {
  if (tx instanceof Transaction) {
    const vtx = new VersionedTransaction(tx.compileMessage());
    const writable = new Map<string, PublicKey>();
    for (const ix of tx.instructions) {
      for (const m of ix.keys) if (m.isWritable) writable.set(m.pubkey.toBase58(), m.pubkey);
    }
    return { vtx, ixs: tx.instructions, writable: [...writable.values()] };
  }
  const lookups: AddressLookupTableAccount[] = [];
  for (const l of tx.message.addressTableLookups) {
    const table = (await conn.getAddressLookupTable(l.accountKey)).value;
    if (!table) throw new UnsafeTransactionError("a lookup table it names does not exist");
    lookups.push(table);
  }
  const msg = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: lookups });
  const writable = new Map<string, PublicKey>();
  for (const ix of msg.instructions) {
    for (const m of ix.keys) if (m.isWritable) writable.set(m.pubkey.toBase58(), m.pubkey);
  }
  return { vtx: tx, ixs: msg.instructions, writable: [...writable.values()] };
}

function isTokenProgram(p: PublicKey): boolean {
  return p.equals(TOKEN_PROGRAM_ID) || p.equals(TOKEN_2022_PROGRAM_ID);
}

/**
 * Refuses the transaction, with a reason a player can read, if it does
 * something no honest version of this action would. Resolves when it is fine.
 *
 * Fails CLOSED: a transaction that cannot be inspected or simulated is not
 * shown to the wallet. That can block an action when an RPC is down, which is
 * the right trade for something that moves a player's money.
 */
export async function guardThirdPartyTx(
  tx: Transaction | VersionedTransaction,
  opts: GuardOptions,
): Promise<void> {
  const { conn, owner } = opts;
  const { vtx, ixs, writable } = await resolve(conn, tx);

  const bad = staticViolations(ixs, owner);
  if (bad.length) throw new UnsafeTransactionError(`Refused before signing: ${bad[0]}.`);

  // Whose balances to watch: the wallet itself, and every token account the
  // transaction writes that belongs to the player.
  const preInfos = await conn.getMultipleAccountsInfo(writable);
  const watched: PublicKey[] = [owner];
  const mintOf = new Map<string, string>();
  const pre = new Map<string, bigint>();
  const ownerInfo = await conn.getAccountInfo(owner);
  pre.set(owner.toBase58(), BigInt(ownerInfo?.lamports ?? 0));
  writable.forEach((key, i) => {
    const info = preInfos[i];
    if (!info || !isTokenProgram(info.owner) || info.data.length < 72) return;
    const data = Buffer.from(info.data);
    if (!new PublicKey(data.subarray(32, 64)).equals(owner)) return;
    watched.push(key);
    mintOf.set(key.toBase58(), new PublicKey(data.subarray(0, 32)).toBase58());
    pre.set(key.toBase58(), data.readBigUInt64LE(64));
  });

  const sim = await conn.simulateTransaction(vtx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    accounts: { encoding: "base64", addresses: watched.map((k) => k.toBase58()) },
  });
  if (sim.value.err) {
    throw new UnsafeTransactionError("Refused before signing: it fails in simulation.");
  }
  const post = sim.value.accounts ?? [];

  const losses = new Map<string, bigint>();
  watched.forEach((key, i) => {
    const k = key.toBase58();
    const after = post[i];
    let postAmount = BigInt(0);
    if (key.equals(owner)) {
      postAmount = BigInt(after?.lamports ?? 0);
      losses.set(SOL, (losses.get(SOL) ?? BigInt(0)) + (pre.get(k)! - postAmount));
      return;
    }
    if (after && Array.isArray(after.data)) {
      const data = Buffer.from(after.data[0], "base64");
      if (data.length >= 72) postAmount = data.readBigUInt64LE(64);
    }
    // Wrapped SOL counts as SOL, in the same sum as the wallet's lamports.
    // Wrapping moves lamports out of the wallet and into this balance, and
    // closing moves them back, so only what really leaves is left over;
    // counting the two apart would read every wrap as a loss.
    const mint = mintOf.get(k)!;
    const asset = mint === NATIVE_MINT.toBase58() ? SOL : mint;
    losses.set(asset, (losses.get(asset) ?? BigInt(0)) + (pre.get(k)! - postAmount));
  });

  const over = balanceViolations(losses, opts.spend, opts.marginBps, opts.solAllowanceLamports);
  if (over.length) throw new UnsafeTransactionError(`Refused before signing: ${over[0]}.`);
}
