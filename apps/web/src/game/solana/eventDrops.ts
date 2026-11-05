/**
 * Event rewards a winner claims for themselves, from the wardrobe.
 *
 * An event ends with a list of winners. The admin publishes that list on
 * chain as ONE Merkle root per event (`init_event_drop`), whatever its size,
 * and the site publishes the leaves as a static file under /events. A winner
 * who connects finds their own leaf, builds the proof from the file, and
 * sends `claim_event_item`, which checks the proof and adds the cosmetic to
 * their UnlockState. They pay for their own claim, as for a first pack; the
 * admin pays for the root and nothing else.
 *
 * The file holds hashes, not addresses. Anyone can still check whether a
 * given wallet won, by hashing it, which is exactly what /api/won already
 * answers for any wallet, so nothing new is disclosed.
 *
 * `eventLeaf` and `eventNode` must hash exactly as `event_leaf` and
 * `event_node` in programs/sol-city-collectibles. Both sides pin the same
 * root in their tests.
 */
import {
  Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction,
} from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import {
  SOL_CITY_COLLECTIBLES_PROGRAM_ID, derivePackConfigPDA, deriveUnlockPDA,
} from "./program";
import { ixDiscriminator, buildInitUnlockStateIx } from "./instructions";
import { prepareWalletTx } from "./walletTx";
import { awaitTransfer } from "./sendTokens";

/**
 * The events with a reward to claim. A file that is not there yet (the list
 * is published after the event closes) simply offers nothing.
 */
export const EVENT_DROPS: readonly { id: number; file: string }[] = [
  { id: 1, file: "/events/pumpkin-carving.json" },
];

/** What /events/<name>.json holds. Written by scripts/event-drop.ts. */
export interface EventDropFile {
  id: number;
  /** `category:Variant`, for people reading the file. */
  item: string;
  /** Catalog index, in the event block. */
  index: number;
  /** Hex. */
  root: string;
  /** Hex, sorted. */
  leaves: string[];
}

const LEAF_PREFIX = new TextEncoder().encode("solcity:event-leaf");
const NODE_PREFIX = new TextEncoder().encode("solcity:event-node");

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export const toHex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
export const fromHex = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "hex"));

function u16le(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
}

export function eventLeaf(id: number, wallet: PublicKey): Uint8Array {
  return sha256(concat(LEAF_PREFIX, u16le(id), wallet.toBytes()));
}

export function eventNode(a: Uint8Array, b: Uint8Array): Uint8Array {
  const [lo, hi] = compareBytes(a, b) <= 0 ? [a, b] : [b, a];
  return sha256(concat(NODE_PREFIX, lo, hi));
}

/** Sorted and without repeats, which is the order every tree is built in. */
export function sortLeaves(leaves: Uint8Array[]): Uint8Array[] {
  const sorted = [...leaves].sort(compareBytes);
  return sorted.filter((l, i) => i === 0 || compareBytes(l, sorted[i - 1]) !== 0);
}

/** Every level, leaves first. An odd node out moves up unchanged. */
function levels(leaves: Uint8Array[]): Uint8Array[][] {
  if (leaves.length === 0) throw new Error("an event list needs at least one winner");
  const out = [sortLeaves(leaves)];
  while (out[out.length - 1].length > 1) {
    const level = out[out.length - 1];
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? eventNode(level[i], level[i + 1]) : level[i]);
    }
    out.push(next);
  }
  return out;
}

export function eventRoot(leaves: Uint8Array[]): Uint8Array {
  const all = levels(leaves);
  return all[all.length - 1][0];
}

/** The siblings from `leaf` to the root, or null if it is not on the list. */
export function eventProof(leaves: Uint8Array[], leaf: Uint8Array): Uint8Array[] | null {
  const all = levels(leaves);
  let at = all[0].findIndex((l) => compareBytes(l, leaf) === 0);
  if (at < 0) return null;
  const proof: Uint8Array[] = [];
  for (const level of all.slice(0, -1)) {
    const sibling = at ^ 1;
    if (sibling < level.length) proof.push(level[sibling]);
    at >>= 1;
  }
  return proof;
}

export function verifyEventProof(root: Uint8Array, leaf: Uint8Array, proof: Uint8Array[]): boolean {
  return compareBytes(proof.reduce(eventNode, leaf), root) === 0;
}

// ── On chain ─────────────────────────────────────────────────────────────────

export function deriveEventDropPDA(id: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("event_drop"), Buffer.from(u16le(id))],
    SOL_CITY_COLLECTIBLES_PROGRAM_ID,
  )[0];
}

/** EventDrop: 8-byte discriminator, id u16, index u16, root [u8; 32]. */
export function decodeEventDrop(data: Uint8Array): { id: number; index: number; root: Uint8Array } | null {
  if (data.length < 8 + 36) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    id: view.getUint16(8, true),
    index: view.getUint16(10, true),
    root: data.slice(12, 44),
  };
}

export function buildClaimEventItemIx(
  claimer: PublicKey, id: number, proof: Uint8Array[],
): TransactionInstruction {
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, proof.length, true);
  return new TransactionInstruction({
    programId: SOL_CITY_COLLECTIBLES_PROGRAM_ID,
    keys: [
      { pubkey: claimer,                       isSigner: true,  isWritable: true },
      { pubkey: deriveUnlockPDA(claimer)[0],   isSigner: false, isWritable: true },
      { pubkey: deriveEventDropPDA(id),        isSigner: false, isWritable: false },
      { pubkey: derivePackConfigPDA()[0],      isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,       isSigner: false, isWritable: false },
    ],
    data: Buffer.from(concat(ixDiscriminator("claim_event_item"), u16le(id), len, ...proof)),
  });
}

// ── What the wardrobe asks ───────────────────────────────────────────────────

export interface ClaimableDrop {
  id: number;
  index: number;
  proof: Uint8Array[];
}

const files = new Map<string, Promise<EventDropFile | null>>();

function loadFile(path: string): Promise<EventDropFile | null> {
  if (!files.has(path)) {
    files.set(path, fetch(path)
      .then((r) => (r.ok ? (r.json() as Promise<EventDropFile>) : null))
      .catch(() => null));
  }
  return files.get(path)!;
}

/**
 * Event rewards this wallet won and does not own yet.
 *
 * Offered only when the drop is on chain with the same root as the file, so
 * the button never leads to a claim the program would refuse.
 */
export async function claimableDrops(
  conn: Connection, wallet: PublicKey, owned: number[],
): Promise<ClaimableDrop[]> {
  const out: ClaimableDrop[] = [];
  for (const { id, file } of EVENT_DROPS) {
    const drop = await loadFile(file);
    if (!drop || drop.id !== id || owned.includes(drop.index)) continue;
    const leaves = drop.leaves.map(fromHex);
    const proof = eventProof(leaves, eventLeaf(id, wallet));
    if (!proof) continue;
    const info = await conn.getAccountInfo(deriveEventDropPDA(id));
    const onChain = info ? decodeEventDrop(info.data) : null;
    if (!onChain || onChain.index !== drop.index || toHex(onChain.root) !== drop.root) continue;
    out.push({ id, index: drop.index, proof });
  }
  return out;
}

/** One approval. Creates the wallet's UnlockState in the same transaction if it has none. */
export async function claimEventDrop(args: {
  conn: Connection;
  wallet: PublicKey;
  drop: ClaimableDrop;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
}): Promise<string> {
  const { conn, wallet, drop } = args;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet });
  if (!(await conn.getAccountInfo(deriveUnlockPDA(wallet)[0]))) {
    tx.add(buildInitUnlockStateIx(wallet));
  }
  tx.add(buildClaimEventItemIx(wallet, drop.id, drop.proof));
  const signed = await args.signTransaction(await prepareWalletTx(conn, tx));
  const signature = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  await awaitTransfer(conn, signature, lastValidBlockHeight);
  return signature;
}
