import { PublicKey } from "@solana/web3.js";
import { getNetwork, type PlayerLink } from "@/game/multiplayer/OnChainMultiplayer";
import { LINK_WANT, LINK_DECLINED } from "@/game/solana/instructions";
import { clusterKey } from "@/game/config/clusterStorage";

/**
 * Who you are friends with, worked out from accounts the city already reads.
 *
 * There is no friendship account and no friendship query. Each player keeps a
 * list of who they WANT as a friend on their own PlayerState, and a
 * friendship is simply both sides holding that about each other. Invite and
 * accept are the same fact, so nothing can get out of step between two
 * accounts and unfriending needs no cooperation: you drop your half.
 *
 * ── Why invites only arrive from people in the city ─────────────────────
 *
 * An invite lives on the SENDER's account, and the only accounts this client
 * reads are those of citizens it can see. So an invite reaches you when the
 * two of you are in the city together, and not before.
 *
 * That is weaker than the account-per-invite design it replaced, which sat on
 * chain waiting however long it took. It is the price of the invite costing
 * the sender nothing, and the cache below buys most of it back: once you have
 * SEEN an invite it is remembered, so the sender leaving does not take it
 * with them.
 */

const WANT = LINK_WANT;

function byPeer(links: PlayerLink[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of links) out.set(l.peer, l.state);
  return out;
}

// ── Invites you have already seen ───────────────────────────────────────────
//
// Per wallet and per cluster, like every other local store here: a devnet
// tester opening mainnet in the same browser must not arrive with devnet
// invites. This is a CONVENIENCE, never a source of truth. Nothing is granted
// from it; it only keeps an invite visible after the sender walks away, and
// the moment the sender's live account disagrees the live account wins.

function seenKey(me: string): string {
  return clusterKey(`solcity:invites-seen:${me}`);
}

function readSeen(me: string): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(seenKey(me));
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeSeen(me: string, wallets: string[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(seenKey(me), JSON.stringify([...new Set(wallets)].slice(0, 64)));
  } catch {
    // A full or blocked store costs a remembered invite, not a feature.
  }
}

/** Stop remembering an invite, once it has been answered either way. */
function forgetSeen(me: string, from: string): void {
  writeSeen(me, readSeen(me).filter((w) => w !== from));
}

/**
 * Re-reads the links of everyone in the city, and remembers any invite aimed
 * at us. Cheap enough to call when a panel opens; NOT on the 500ms poll, for
 * the reason spelled out on `refreshLinks`.
 */
export async function refreshFriends(me: PublicKey): Promise<void> {
  const net = getNetwork();
  if (!net) return;
  await net.refreshLinks();

  const mine = me.toBase58();
  const found = readSeen(mine);
  for (const wallet of net.citizenWallets()) {
    if (wallet === mine) continue;
    const theirs = byPeer(net.linksOf(wallet));
    if (theirs.get(mine) === WANT) found.push(wallet);
  }
  writeSeen(mine, found);
}

/** Kept for callers that used to force a re-query. Now just a refresh. */
export function invalidateFriends(): void {
  const net = getNetwork();
  void net?.refreshLinks();
}

/** Wallets that want us AND that we want: a friendship, from both halves. */
export async function listFriends(me: PublicKey, force = false): Promise<string[]> {
  const net = getNetwork();
  if (!net) return [];
  if (force) await refreshFriends(me);
  const mine = me.toBase58();
  const ours = byPeer(net.myLinks());
  const out: string[] = [];
  for (const [peer, state] of ours) {
    if (state !== WANT) continue;
    const theirs = byPeer(net.linksOf(peer));
    if (theirs.get(mine) === WANT) out.push(peer);
  }
  return out;
}

export interface FriendRequest { from: PublicKey; to: PublicKey }

/**
 * Invites waiting on us: someone wants us and we have not answered.
 *
 * The live reading and the remembered one are merged, which is what lets an
 * invite survive the sender leaving. Anyone we have already answered, in
 * either direction, drops out.
 */
export async function listInboundRequests(
  me: PublicKey,
  force = false,
): Promise<FriendRequest[]> {
  const net = getNetwork();
  if (!net) return [];
  if (force) await refreshFriends(me);
  const mine = me.toBase58();
  const ours = byPeer(net.myLinks());

  const candidates = new Set<string>(readSeen(mine));
  for (const wallet of net.citizenWallets()) {
    if (byPeer(net.linksOf(wallet)).get(mine) === WANT) candidates.add(wallet);
  }

  const out: FriendRequest[] = [];
  for (const from of candidates) {
    if (ours.has(from)) continue;                     // already answered
    out.push({ from: new PublicKey(from), to: me });
  }
  return out;
}

/** Invites we have sent that have not been returned. */
export async function listOutboundRequests(
  me: PublicKey,
  force = false,
): Promise<FriendRequest[]> {
  const net = getNetwork();
  if (!net) return [];
  if (force) await refreshFriends(me);
  const mine = me.toBase58();
  const out: FriendRequest[] = [];
  for (const { peer, state } of net.myLinks()) {
    if (state !== WANT) continue;
    if (byPeer(net.linksOf(peer)).get(mine) === WANT) continue;   // mutual: a friendship
    out.push({ from: me, to: new PublicKey(peer) });
  }
  return out;
}

/**
 * What the UI needs to decide which button to show on a player's card.
 *
 * Synchronous data, so opening a card costs no query: everything it reads was
 * already in hand.
 */
export type FriendStanding = "self" | "friends" | "invited-them" | "invited-me" | "none";

export async function standingWith(
  me: PublicKey,
  other: PublicKey,
  force = false,
): Promise<FriendStanding> {
  if (me.equals(other)) return "self";
  const net = getNetwork();
  if (!net) return "none";
  if (force) await refreshFriends(me);

  const mine = me.toBase58();
  const them = other.toBase58();
  const ourState = byPeer(net.myLinks()).get(them);
  const theirState = byPeer(net.linksOf(them)).get(mine);
  const theyAskedBefore = readSeen(mine).includes(them);

  if (ourState === WANT && theirState === WANT) return "friends";
  if (ourState === WANT) return "invited-them";
  if (ourState === LINK_DECLINED) return "none";
  if (theirState === WANT || theyAskedBefore) return "invited-me";
  return "none";
}

/** Called after we answer an invite, so it stops being remembered. */
export function answeredInvite(me: PublicKey, from: PublicKey): void {
  forgetSeen(me.toBase58(), from.toBase58());
}
