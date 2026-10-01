import { Connection, PublicKey } from "@solana/web3.js";
import {
  accountDiscriminator,
  decodeFriendRequest,
  decodeFriendship,
  FRIEND_ACCOUNT_SIZE,
  FRIEND_OFFSET,
  friendCounterpart,
  SOL_CITY_PROGRAM_ID,
  toBase58,
  type FriendRequest,
} from "@/game/solana/program";
import { BASE_RPC_PRIMARY, resilientBaseFetch } from "@/game/solana/baseRpc";

/**
 * Reading who is friends with whom.
 *
 * A friendship and an invite are each their own account, keyed by their
 * members, so "my friends" is a `getProgramAccounts` with a memcmp filter
 * rather than a list stored anywhere. That is what keeps friends off the 500ms
 * position poll: nothing here runs on a timer.
 *
 * `getProgramAccounts` is the expensive call in this codebase - the rate limits
 * that have bitten us were all on reads - so every result is cached and the
 * cache is invalidated by the mutations, not by time. Call these at login and
 * when the panel opens. Never in a loop.
 *
 * Both account kinds are the same 80 bytes, so each filter must ALSO match the
 * 8-byte discriminator at offset 0 or the two come back mixed together.
 */

const FRIENDSHIP_DISC = accountDiscriminator("Friendship");
const REQUEST_DISC = accountDiscriminator("FriendRequest");

/** How long a result is trusted before a caller can force a refetch. */
const CACHE_MS = 60_000;

interface Cached<T> {
  at: number;
  owner: string;
  value: T;
}

let friendsCache: Cached<string[]> | null = null;
let inboundCache: Cached<FriendRequest[]> | null = null;
let outboundCache: Cached<FriendRequest[]> | null = null;

/** Drops the caches. Call after any friend mutation lands. */
export function invalidateFriends(): void {
  friendsCache = null;
  inboundCache = null;
  outboundCache = null;
}

function fresh<T>(c: Cached<T> | null, owner: string, force: boolean): T | null {
  if (force || !c || c.owner !== owner) return null;
  return Date.now() - c.at < CACHE_MS ? c.value : null;
}

let shared: Connection | null = null;

/** The failover base connection. Friend accounts live on base, not the rollup. */
function baseConnection(): Connection {
  if (!shared) {
    shared = new Connection(BASE_RPC_PRIMARY, {
      commitment: "confirmed",
      fetch: resilientBaseFetch,
    });
  }
  return shared;
}

async function queryPairs(
  conn: Connection,
  disc: Buffer,
  offset: number,
  who: PublicKey,
): Promise<{ pubkey: PublicKey; data: Uint8Array }[]> {
  const res = await conn.getProgramAccounts(SOL_CITY_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [
      { dataSize: FRIEND_ACCOUNT_SIZE },
      { memcmp: { offset: 0, bytes: toBase58(disc) } },
      { memcmp: { offset, bytes: who.toBase58() } },
    ],
  });
  return res.map((r) => ({ pubkey: r.pubkey, data: r.account.data }));
}

/**
 * Every wallet this player is friends with.
 *
 * Two queries, because the pair is stored sorted: this player is in slot `a`
 * for roughly half their friendships and in slot `b` for the rest, and a
 * memcmp filter can only ask about one offset at a time.
 */
export async function listFriends(me: PublicKey, force = false): Promise<string[]> {
  const owner = me.toBase58();
  const hit = fresh(friendsCache, owner, force);
  if (hit) return hit;

  const conn = baseConnection();
  const [asA, asB] = await Promise.all([
    queryPairs(conn, FRIENDSHIP_DISC, FRIEND_OFFSET.first, me),
    queryPairs(conn, FRIENDSHIP_DISC, FRIEND_OFFSET.second, me),
  ]);

  const out = new Set<string>();
  for (const { data } of [...asA, ...asB]) {
    const f = decodeFriendship(data);
    if (f) out.add(friendCounterpart(f, me).toBase58());
  }
  const value = [...out];
  friendsCache = { at: Date.now(), owner, value };
  return value;
}

/**
 * Invites waiting for this player.
 *
 * This is the whole of "they get it next time they log in": the invite is an
 * account that sat on-chain until now, so there was never anything to deliver
 * and nothing expired while they were away.
 */
export async function listInboundRequests(me: PublicKey, force = false): Promise<FriendRequest[]> {
  const owner = me.toBase58();
  const hit = fresh(inboundCache, owner, force);
  if (hit) return hit;

  const rows = await queryPairs(baseConnection(), REQUEST_DISC, FRIEND_OFFSET.second, me);
  const value = rows
    .map((r) => decodeFriendRequest(r.data))
    .filter((r): r is FriendRequest => r !== null)
    .sort((x, y) => y.createdAt - x.createdAt);
  inboundCache = { at: Date.now(), owner, value };
  return value;
}

/** Invites this player sent and has not been answered on yet. */
export async function listOutboundRequests(me: PublicKey, force = false): Promise<FriendRequest[]> {
  const owner = me.toBase58();
  const hit = fresh(outboundCache, owner, force);
  if (hit) return hit;

  const rows = await queryPairs(baseConnection(), REQUEST_DISC, FRIEND_OFFSET.first, me);
  const value = rows
    .map((r) => decodeFriendRequest(r.data))
    .filter((r): r is FriendRequest => r !== null)
    .sort((x, y) => y.createdAt - x.createdAt);
  outboundCache = { at: Date.now(), owner, value };
  return value;
}

/**
 * What the UI needs to decide which button to show on a player's card, in one
 * pass so opening a card costs no queries of its own.
 */
export type FriendStanding = "self" | "friends" | "invited-them" | "invited-me" | "none";

export async function standingWith(
  me: PublicKey,
  other: PublicKey,
  force = false,
): Promise<FriendStanding> {
  if (me.equals(other)) return "self";
  const [friends, inbound, outbound] = await Promise.all([
    listFriends(me, force),
    listInboundRequests(me, force),
    listOutboundRequests(me, force),
  ]);
  const them = other.toBase58();
  if (friends.includes(them)) return "friends";
  if (outbound.some((r) => r.to.toBase58() === them)) return "invited-them";
  if (inbound.some((r) => r.from.toBase58() === them)) return "invited-me";
  return "none";
}
