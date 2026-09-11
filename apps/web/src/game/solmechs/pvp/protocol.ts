/**
 * Sol Mechs PvP — wire format.
 *
 * Pure: no DOM, clock or network, so it behaves the same in the browser and in
 * a Node test. The byte layouts here are the ones programs/sol-mechs stores,
 * and `commitHash` is the digest its `reveal_step` recomputes.
 */
import { sha256 } from "@noble/hashes/sha256";
import type { MechBuild, ModuleSlot } from "../data/types";
import { TEAM_SIZE, type TeamBuild } from "../data/team";
import { getMatrix, getPart } from "../data/catalog";
import type { PlayerSide } from "../engine/BattleEngine";
import type { TeamAction, TeamBattleState, TeamSide } from "../engine/TeamBattle";

export const TEAM_BYTES = TEAM_SIZE * 4;
export const ACTION_BYTES = 2;
export const SALT_BYTES = 32;

// ── Teams ─────────────────────────────────────────────────────────────────
//
// One byte per part: the catalog number minus one ("RA03" → 2). Numbers are
// part of the code itself, so the encoding does not depend on array order in
// the catalog.

const SLOT_ORDER: ModuleSlot[] = ["matrix", "rightArm", "leftArm", "lowerBody"];
const PREFIX: Record<ModuleSlot, string> = {
  matrix: "M", rightArm: "RA", leftArm: "LA", lowerBody: "IN",
};

function codeOf(build: MechBuild, slot: ModuleSlot): string {
  return slot === "matrix" ? build.matrixCode : build[slot];
}

function toIndex(code: string, slot: ModuleSlot): number {
  const prefix = PREFIX[slot];
  const n = code.startsWith(prefix) ? Number.parseInt(code.slice(prefix.length), 10) : Number.NaN;
  if (!Number.isInteger(n) || n < 1 || n > 255) throw new Error(`Cannot encode ${slot} code "${code}"`);
  return n - 1;
}

function fromIndex(index: number, slot: ModuleSlot): string {
  const code = `${PREFIX[slot]}${String(index + 1).padStart(2, "0")}`;
  const known = slot === "matrix" ? getMatrix(code) : getPart(code);
  if (!known) throw new Error(`Unknown ${slot} code "${code}"`);
  return code;
}

export function encodeTeam(team: TeamBuild): Uint8Array {
  if (team.mechs.length !== TEAM_SIZE) throw new Error(`A team must hold exactly ${TEAM_SIZE} mechs`);
  const out = new Uint8Array(TEAM_BYTES);
  team.mechs.forEach((build, m) => {
    SLOT_ORDER.forEach((slot, s) => { out[m * 4 + s] = toIndex(codeOf(build, slot), slot); });
  });
  return out;
}

/** Throws on a code the catalog does not know — a malformed or hostile team. */
export function decodeTeam(bytes: Uint8Array): TeamBuild {
  if (bytes.length < TEAM_BYTES) throw new Error("Team data is too short");
  const mechs: MechBuild[] = [];
  for (let m = 0; m < TEAM_SIZE; m++) {
    const at = (s: number) => bytes[m * 4 + s];
    mechs.push({
      matrixCode: fromIndex(at(0), "matrix"),
      rightArm: fromIndex(at(1), "rightArm"),
      leftArm: fromIndex(at(2), "leftArm"),
      lowerBody: fromIndex(at(3), "lowerBody"),
    });
  }
  return { mechs };
}

// ── Actions ───────────────────────────────────────────────────────────────
//
// Two bytes, side-free (the side is whoever revealed it):
//   [0, 0]                        nothing
//   [1, src | move<<2 | target<<4] a move
//   [2, index]                    a switch

export type WireAction =
  | { kind: "none" }
  | {
      kind: "move";
      sourceSlot: Exclude<ModuleSlot, "matrix">;
      moveIndex: number;
      targetSlot: ModuleSlot;
    }
  | { kind: "switch"; toIndex: number };

const LIMBS = ["rightArm", "leftArm", "lowerBody"] as const;
const TARGETS = ["matrix", "rightArm", "leftArm", "lowerBody"] as const;

export function toWire(action: TeamAction | null): WireAction {
  if (!action) return { kind: "none" };
  if (action.kind === "switch") return { kind: "switch", toIndex: action.toIndex };
  return {
    kind: "move",
    sourceSlot: action.sourceSlot,
    moveIndex: action.moveIndex,
    targetSlot: action.targetSlot,
  };
}

export function fromWire(wire: WireAction, side: PlayerSide): TeamAction | null {
  switch (wire.kind) {
    case "none":
      return null;
    case "switch":
      return { kind: "switch", side, toIndex: wire.toIndex };
    case "move":
      return {
        kind: "move", side,
        sourceSlot: wire.sourceSlot, moveIndex: wire.moveIndex, targetSlot: wire.targetSlot,
      };
  }
}

export function encodeAction(wire: WireAction): Uint8Array {
  const out = new Uint8Array(ACTION_BYTES);
  switch (wire.kind) {
    case "none":
      break;
    case "switch":
      if (!Number.isInteger(wire.toIndex) || wire.toIndex < 0 || wire.toIndex > 255) {
        throw new Error("Bad switch index");
      }
      out[0] = 2;
      out[1] = wire.toIndex;
      break;
    case "move": {
      const src = LIMBS.indexOf(wire.sourceSlot);
      const tgt = TARGETS.indexOf(wire.targetSlot as (typeof TARGETS)[number]);
      if (src < 0 || tgt < 0 || !Number.isInteger(wire.moveIndex) || wire.moveIndex < 0 || wire.moveIndex > 3) {
        throw new Error("Bad move");
      }
      out[0] = 1;
      out[1] = src | (wire.moveIndex << 2) | (tgt << 4);
      break;
    }
  }
  return out;
}

/**
 * Throws on a malformed action. A well-formed but illegal one (a broken limb,
 * a sealed matrix) decodes fine — the engine rejects it when it resolves,
 * exactly as it would a local player's.
 */
export function decodeAction(bytes: Uint8Array): WireAction {
  switch (bytes[0]) {
    case 0:
      return { kind: "none" };
    case 1: {
      const b = bytes[1];
      const src = b & 0b11;
      if (src > 2) throw new Error("Malformed move");
      return {
        kind: "move",
        sourceSlot: LIMBS[src],
        moveIndex: (b >> 2) & 0b11,
        targetSlot: TARGETS[(b >> 4) & 0b11],
      };
    }
    case 2:
      return { kind: "switch", toIndex: bytes[1] };
    default:
      throw new Error(`Malformed action kind ${bytes[0]}`);
  }
}

// ── Commitments ───────────────────────────────────────────────────────────

/** sha256(match_id u64 LE ‖ step u16 LE ‖ action[2] ‖ salt[32]) — lib.rs `reveal_step`. */
export function commitHash(matchId: bigint, step: number, action: Uint8Array, salt: Uint8Array): Uint8Array {
  const buf = new Uint8Array(8 + 2 + ACTION_BYTES + SALT_BYTES);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, BigInt.asUintN(64, matchId), true);
  view.setUint16(8, step, true);
  buf.set(action.subarray(0, ACTION_BYTES), 10);
  buf.set(salt.subarray(0, SALT_BYTES), 12);
  return sha256(buf);
}

export function randomSalt(): Uint8Array {
  const out = new Uint8Array(SALT_BYTES);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Speed-tie seed both clients derive from the match id alone. */
export function matchSeed(matchId: bigint): number {
  const label = new TextEncoder().encode("solmechs:seed:v1");
  const buf = new Uint8Array(label.length + 8);
  buf.set(label, 0);
  new DataView(buf.buffer).setBigUint64(label.length, BigInt.asUintN(64, matchId), true);
  const d = sha256(buf);
  return ((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 1;
}

// ── Desync detection ──────────────────────────────────────────────────────

function mix(h: number, n: number): number {
  for (let i = 0; i < 4; i++) {
    h ^= (n >>> (i * 8)) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function sideHash(side: TeamSide): number {
  let h = 0x811c9dc5;
  h = mix(h, side.activeIndex);
  for (const unit of side.units) {
    for (const slot of SLOT_ORDER) {
      const status = unit.partStatuses[slot];
      h = mix(h, status.currentHP);
      const buffs = status.buffs as Record<string, number | undefined>;
      for (const key of Object.keys(buffs).sort()) {
        const value = buffs[key] ?? 0;
        if (value === 0) continue;
        h = mix(h, key.charCodeAt(0) | (key.charCodeAt(1) << 8) | (key.charCodeAt(2) << 16));
        h = mix(h, value + 16);
      }
    }
  }
  return h;
}

/**
 * A checksum of the board that is the SAME on both clients.
 *
 * Each client simulates with itself as p1, so the two boards are mirror
 * images; hashing each side and ordering the pair makes the checksum
 * independent of which side is which. Both clients send theirs with every
 * reveal, and a mismatch means their engines have diverged.
 */
export function stateCheck(state: TeamBattleState): number {
  const a = sideHash(state.p1);
  const b = sideHash(state.p2);
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  const status = state.status.kind === "active"
    ? 0
    : state.status.kind === "awaiting-switch" ? 10 + state.status.sides.length : 20;
  return mix(mix(mix(mix(0x811c9dc5, lo), hi), state.round), status);
}
