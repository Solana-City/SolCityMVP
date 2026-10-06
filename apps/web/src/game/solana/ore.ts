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

const MAINNET_RPC = "https://api.mainnet-beta.solana.com";

let connection: Connection | null = null;
function rpc(): Connection {
  connection ??= new Connection(MAINNET_RPC, "confirmed");
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
const DISCRIMINATOR = { miner: BigInt(103), board: BigInt(105) } as const;

export async function fetchBoard(): Promise<OreBoard | null> {
  try {
    const info = await rpc().getAccountInfo(ORE_BOARD);
    if (!info || info.data.length < 40) return null;
    const d = info.data;
    if (d.readBigUInt64LE(0) !== DISCRIMINATOR.board) return null;
    return {
      roundId: d.readBigUInt64LE(8),
      startSlot: d.readBigUInt64LE(16),
      endSlot: d.readBigUInt64LE(24),
      productionCostEma: d.readBigUInt64LE(32),
    };
  } catch {
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
    return await rpc().getSlot();
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
    const info = await rpc().getAccountInfo(minerPda(authority));
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
