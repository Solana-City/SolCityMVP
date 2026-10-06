/**
 * ORE (v3) read layer: the mining board, and one miner's stake in it.
 *
 * ORE is a round-based board game on Solana mainnet. Each round lasts a few
 * hundred slots; a miner deploys lamports onto up to 25 squares, and when the
 * round ends the board pays out ORE and SOL according to where everyone landed.
 * Program: oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv
 *
 * There is no TypeScript SDK for v3 (the `ore-sdk` package on npm is the 2024
 * hash-mining version), so the layouts below are hand-rolled from the Rust at
 * github.com/regolith-labs/ore, and every one of them was verified against
 * mainnet before being written down:
 *
 *   - The Board account decodes to a live round with sane slot timing.
 *   - A real Deploy transaction confirmed the instruction layout: a ONE byte
 *     instruction discriminator (account discriminators are eight), then the
 *     amount as u64 and the squares as a u32 bitmask.
 *   - Every PDA derived here reproduced the exact addresses in that
 *     transaction.
 *   - The Miner account is 752 bytes, which pins rewards_factor at 16 bytes.
 *
 * Mainnet only, like SKR: the game itself runs on devnet, so this reads mainnet
 * directly rather than through the game's connection.
 */

import { Connection, PublicKey } from "@solana/web3.js";

export const ORE_PROGRAM = new PublicKey("oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv");
export const ORE_MINT = new PublicKey("oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp");

/** Fixed program accounts, from the Rust consts and confirmed on mainnet. */
export const ORE_BOARD = new PublicKey("BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi");
export const ORE_CONFIG = new PublicKey("9c9X7aDRAF41faiDs94ELjT19UrGnn72wBW9hPsS4Awy");
export const ORE_TREASURY = new PublicKey("45db2FSR4mcXdSVVZbKbwojU6uYDpMyhpEi7cC8nHaWG");
export const ORE_VAR = new PublicKey("BWCaDY96Xe4WkFq1M7UiCCRcChsJ3p51L5KrGzhxgm2E");

/** ORE has 11 decimals, not the usual 9. */
export const ORE_DECIMALS = 11;
/** The board is five by five. */
export const SQUARE_COUNT = 25;

/**
 * Mainnet, with a failover, for the same reason baseRpc.ts has one on devnet:
 * no single public endpoint is dependable. api.mainnet-beta.solana.com answers
 * fine from a script and refuses or throttles browsers, which is exactly how
 * the claim office first came up empty.
 *
 * Helius goes first (the project's key, the same one baseRpc uses on devnet),
 * with the public endpoint behind it.
 */
const MAINNET_RPCS: readonly string[] = [
  "https://mainnet.helius-rpc.com/?api-key=92175bf8-4484-4c09-a60a-4d08ee821058",
  "https://api.mainnet-beta.solana.com",
];

/** Why the last read failed, so a panel can say something better than nothing. */
let lastError: string | null = null;
export function lastOreError(): string | null {
  return lastError;
}

/** Tries each endpoint in order, and keeps the reason if they all fail. */
const failoverFetch: typeof fetch = async (input, init) => {
  const body = init?.body;
  let problem = "no endpoint answered";
  for (const url of MAINNET_RPCS) {
    try {
      const res = await fetch(url, { ...init, body });
      // A 403 or a 429 from a public endpoint is a refusal, not an answer.
      if (res.ok) return res;
      problem = `${new URL(url).host} replied ${res.status}`;
    } catch (err) {
      problem = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(problem);
};

let connection: Connection | null = null;
/** The failover mainnet connection, shared by every ORE read and send. */
export function oreConnection(): Connection {
  connection ??= new Connection(MAINNET_RPCS[0], {
    commitment: "confirmed",
    fetch: failoverFetch,
  });
  return connection;
}

// ── PDAs ─────────────────────────────────────────────────────────────────────

function pda(seeds: (Buffer | Uint8Array)[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, ORE_PROGRAM)[0];
}

function u64le(value: bigint | number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(value));
  return b;
}

export function minerPda(authority: PublicKey): PublicKey {
  return pda([Buffer.from("miner"), authority.toBuffer()]);
}

export function automationPda(authority: PublicKey): PublicKey {
  return pda([Buffer.from("automation"), authority.toBuffer()]);
}

export function roundPda(roundId: bigint | number): PublicKey {
  return pda([Buffer.from("round"), u64le(roundId)]);
}

// ── Board ────────────────────────────────────────────────────────────────────

export interface OreBoard {
  roundId: bigint;
  startSlot: bigint;
  endSlot: bigint;
  /** Lamports per whole ORE, as an exponential moving average. */
  productionCostEma: bigint;
}

/** Account discriminators, from the OreAccount enum. */
const DISCRIMINATOR = { miner: BigInt(103), board: BigInt(105), round: BigInt(109) } as const;

export async function fetchBoard(): Promise<OreBoard | null> {
  try {
    const info = await oreConnection().getAccountInfo(ORE_BOARD);
    if (!info || info.data.length < 40) {
      lastError = "the board account came back empty";
      return null;
    }
    const d = info.data;
    if (d.readBigUInt64LE(0) !== DISCRIMINATOR.board) {
      lastError = "the board account is not shaped the way this client expects";
      return null;
    }
    lastError = null;
    return {
      roundId: d.readBigUInt64LE(8),
      startSlot: d.readBigUInt64LE(16),
      endSlot: d.readBigUInt64LE(24),
      productionCostEma: d.readBigUInt64LE(32),
    };
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    return null;
  }
}

/** How far through the round we are, 0 to 1, for a progress bar. */
export function roundProgress(board: OreBoard, currentSlot: number): number {
  const start = Number(board.startSlot);
  const end = Number(board.endSlot);
  if (end <= start) return 0;
  return Math.min(1, Math.max(0, (currentSlot - start) / (end - start)));
}

/** Rounds are slot-based; a Solana slot is about 400ms. */
export function slotsToSeconds(slots: number): number {
  return Math.max(0, Math.round(slots * 0.4));
}

export async function currentSlot(): Promise<number> {
  try {
    return await oreConnection().getSlot();
  } catch {
    return 0;
  }
}

// ── Miner ────────────────────────────────────────────────────────────────────

export interface OreMiner {
  authority: PublicKey;
  checkpointId: bigint;
  /** Lamports this miner has on each of the 25 squares this round. */
  deployed: bigint[];
  roundId: bigint;
  /** Claimable now. */
  rewardsSol: bigint;
  rewardsOre: bigint;
  refinedOre: bigint;
  lifetimeDeployed: bigint;
  lifetimeRewardsOre: bigint;
  lifetimeRewardsSol: bigint;
}

/**
 * Byte offsets into the Miner account, straight from the Rust field order.
 * `rewards_factor` is a 16-byte Numeric: the account is 752 bytes, and every
 * other field is accounted for, which leaves exactly 16.
 */
const MINER = (() => {
  let o = 8; // account discriminator
  const at = (size: number) => { const start = o; o += size; return start; };
  const offsets = {
    authority: at(32),
    autoReturn: at(8),
    checkpointId: at(8),
    checkpointFee: at(8),
    deployed: at(8 * SQUARE_COUNT),
    mass: at(8 * SQUARE_COUNT),
    cumulative: at(8 * SQUARE_COUNT),
    roundId: at(8),
    rewardsFactor: at(16),
    rewardsSol: at(8),
    refinedOre: at(8),
    rewardsOre: at(8),
    lastClaimOreAt: at(8),
    lastClaimSolAt: at(8),
    lifetimeRewardsOre: at(8),
    lifetimeDeployed: at(8),
    lifetimeRewardsSol: at(8),
  };
  return { ...offsets, size: o };
})();

/** Account size the layout above implies; the real account is 752 bytes. */
export const MINER_ACCOUNT_SIZE = MINER.size;

export async function fetchMiner(authority: PublicKey): Promise<OreMiner | null> {
  try {
    const info = await oreConnection().getAccountInfo(minerPda(authority));
    // A wallet that has never deployed simply has no miner account yet.
    if (!info || info.data.length < MINER.size) return null;
    const d = info.data;
    if (d.readBigUInt64LE(0) !== DISCRIMINATOR.miner) return null;
    const deployed: bigint[] = [];
    for (let i = 0; i < SQUARE_COUNT; i++) {
      deployed.push(d.readBigUInt64LE(MINER.deployed + i * 8));
    }
    return {
      authority: new PublicKey(d.subarray(MINER.authority, MINER.authority + 32)),
      checkpointId: d.readBigUInt64LE(MINER.checkpointId),
      deployed,
      roundId: d.readBigUInt64LE(MINER.roundId),
      rewardsSol: d.readBigUInt64LE(MINER.rewardsSol),
      rewardsOre: d.readBigUInt64LE(MINER.rewardsOre),
      refinedOre: d.readBigUInt64LE(MINER.refinedOre),
      lifetimeDeployed: d.readBigUInt64LE(MINER.lifetimeDeployed),
      lifetimeRewardsOre: d.readBigUInt64LE(MINER.lifetimeRewardsOre),
      lifetimeRewardsSol: d.readBigUInt64LE(MINER.lifetimeRewardsSol),
    };
  } catch {
    return null;
  }
}

/**
 * True when the miner still owes a checkpoint for an earlier round. The program
 * rejects a deploy in that state, so the UI has to send Checkpoint first.
 */
export function needsCheckpoint(miner: OreMiner | null, board: OreBoard): boolean {
  if (!miner) return false;
  return miner.roundId !== board.roundId && miner.checkpointId !== miner.roundId;
}

/** ORE amounts come in at 11 decimals. */
export function formatOre(raw: bigint, places = 4): string {
  const scale = BigInt(10) ** BigInt(ORE_DECIMALS);
  const whole = raw / scale;
  const frac = ((raw % scale) * BigInt(10) ** BigInt(places)) / scale;
  return `${whole}.${frac.toString().padStart(places, "0")}`;
}

// ── Round ────────────────────────────────────────────────────────────────────

export interface OreRound {
  id: bigint;
  /** Lamports every miner put on each square. */
  deployed: bigint[];
  /** How many miners were on each square. */
  count: bigint[];
  /**
   * NOT a per-square payout, despite the name. The program's only use of it
   * sums all 25 to get the top miner's reward, which is why index 0 carries the
   * whole amount and the rest are zero in every round.
   */
  rewards: bigint[];
  /** 32 bytes of entropy. The winning square is derived from this. */
  slotHash: Buffer;
  totalMiners: bigint;
  motherlode: bigint;
}

/**
 * Byte offsets into a Round account, from the Rust field order and checked
 * against a closed round on mainnet: 952 bytes, discriminator 109.
 */
const ROUND = {
  id: 8,
  deployed: 16,
  mass: 216,
  count: 416,
  slotHash: 616,
  expiresAt: 648,
  motherlode: 656,
  rentPayer: 664,
  rewards: 696,
  totalVaulted: 896,
  totalReturnedSol: 904,
  totalMiners: 912,
  topMiner: 920,
  size: 952,
} as const;

export const ROUND_ACCOUNT_SIZE = ROUND.size;

/**
 * Reads a round, which is how the office knows which square paid.
 *
 * A round account is closed once it expires, so an old round reads as null
 * rather than as an error.
 */
export async function fetchRound(roundId: bigint): Promise<OreRound | null> {
  try {
    const info = await oreConnection().getAccountInfo(roundPda(roundId));
    if (!info || info.data.length < ROUND.size) return null;
    const d = info.data;
    if (d.readBigUInt64LE(0) !== DISCRIMINATOR.round) return null;
    const read = (base: number): bigint[] =>
      Array.from({ length: SQUARE_COUNT }, (_, i) => d.readBigUInt64LE(base + i * 8));
    return {
      id: d.readBigUInt64LE(ROUND.id),
      deployed: read(ROUND.deployed),
      count: read(ROUND.count),
      rewards: read(ROUND.rewards),
      slotHash: d.subarray(ROUND.slotHash, ROUND.slotHash + 32),
      totalMiners: d.readBigUInt64LE(ROUND.totalMiners),
      motherlode: d.readBigUInt64LE(ROUND.motherlode),
    };
  } catch {
    return null;
  }
}

/**
 * The square that won, 1 to 25.
 *
 * The program does not store it. `winning_square()` derives it from the
 * round's entropy: the 32-byte slot hash is read as four little-endian u64s,
 * XORed together, and taken modulo 25.
 *
 * Reading `rewards` as the result instead was wrong, and looked right for a
 * while: that array always carries its whole value at index 0, so the office
 * reported square 1 winning every single round.
 */
export function winningSquare(round: OreRound): number {
  let rng = BigInt(0);
  for (let i = 0; i < 4; i++) rng ^= round.slotHash.readBigUInt64LE(i * 8);
  return Number(rng % BigInt(SQUARE_COUNT)) + 1;
}

/** What the round's top miner took, in ORE. */
export function topMinerReward(round: OreRound): bigint {
  return round.rewards.reduce((sum, v) => sum + v, BigInt(0));
}

/** The squares a miner was on, as 1-based numbers. */
export function minerSquares(miner: OreMiner): number[] {
  const out: number[] = [];
  miner.deployed.forEach((lamports, i) => { if (lamports > BigInt(0)) out.push(i + 1); });
  return out;
}
