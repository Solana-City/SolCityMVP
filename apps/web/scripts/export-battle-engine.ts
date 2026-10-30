/**
 * Sol Mechs - emits everything the Rust engine needs from the TS one.
 *
 *   npx tsx scripts/export-battle-engine.ts
 *
 * Two files, both generated so that neither is transcribed by hand:
 *
 *   programs/sol-mechs-engine/src/catalog.generated.rs   the DATA
 *   programs/sol-mechs-engine/src/vectors.generated.rs   the BEHAVIOUR, 1v1
 *   programs/sol-mechs-engine/src/team_vectors.generated.rs the BEHAVIOUR, 3v3
 *
 * The 3v3 set is the one ranked actually plays. The 1v1 set is not redundant:
 * it isolates the arithmetic, so a failure there says the damage formula
 * drifted while a failure only in the squad set says the switching did.
 *
 * Both as Rust, which is why neither brings a dependency with it: a JSON
 * vector file would need serde_json in the crate just to be read by a test,
 * and that is a dependency in the program's tree for the sake of a fixture.
 *
 * The catalog is three hundred lines of numbers. Retyping those into Rust is
 * the kind of work that is ninety-nine percent right, and the one percent is
 * a chassis that settles differently on chain than it fought in the browser.
 * Generating it means a balance change is one edit in TS, and the vectors
 * below catch any reducer that stopped agreeing with it.
 *
 * ── Why these exist ────────────────────────────────────────────────────
 *
 * A verifiable ranked result needs the PROGRAM to decide the winner, which
 * means the reducer in BattleEngine.ts has to exist in Rust too. Two
 * implementations of one rule set drift, and the drift is silent: the clients
 * agree with each other and disagree with the chain, so a legitimately won
 * match settles the other way.
 *
 * Reading the two side by side does not catch that. Floating point is where
 * it hides. The damage path runs
 * `clamp(2*atk/(atk+def)) * baseDamage * 0.65` through a stage table holding
 * 0.2857 and 0.3333, and `effectiveStats` rounds. JS numbers are IEEE-754
 * doubles and so is Rust's f64, so `+ - * /` agree exactly -- but
 * `Math.round` rounds a half UP and Rust's `f64::round` rounds a half AWAY
 * FROM ZERO, which differ at -0.5. That one is a bug nobody finds by eye.
 *
 * So the TS engine, which is the one that has been played, is the reference,
 * and these vectors are its testimony. The Rust port is correct when it
 * reproduces them byte for byte.
 *
 * ── What a vector contains ─────────────────────────────────────────────
 *
 * Both builds, the seed, the ordered action list, and the full end state:
 * per-slot HP and stages for both mechs, plus the winner. The end state
 * rather than only the winner, because a port can reach the right winner by
 * the wrong arithmetic and the next balance change would expose it.
 *
 * Deterministic: the scripted battles below are fixed, not sampled, so
 * re-running this writes an identical file or something really changed.
 */
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  createBattle, resolveRound, availableMoves, legalTargets, isDefeated,
  type BattleState, type RoundActions, type PlayerSide, type BattleAction,
} from "../src/game/solmechs/engine/BattleEngine";
import {
  createTeamBattle, resolveTeamRound, resolveForcedSwitches, activeUnit, switchableIndices,
  type TeamAction, type TeamRoundActions, type TeamSide,
} from "../src/game/solmechs/engine/TeamBattle";
import { encodeAction, toWire } from "../src/game/solmechs/pvp/protocol";
import {
  MODULE_SLOTS,
  type MechBuild, type ModuleSlot, type StatBlock, type MoveDefinition,
} from "../src/game/solmechs/data/types";
import { PRESET_BUILDS, MATRICES, ALL_PARTS } from "../src/game/solmechs/data/catalog";

const HERE = dirname(fileURLToPath(import.meta.url));
const CRATE = join(HERE, "..", "..", "..", "programs", "sol-mechs-engine");
const OUT = join(CRATE, "tests");
const SRC = join(CRATE, "src");

/** A tiny deterministic generator, so "pick a move" is reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function snapshot(state: BattleState) {
  const side = (s: PlayerSide) => {
    const unit = state[s];
    const slots: Record<string, { hp: number; stages: Record<string, number> }> = {};
    for (const slot of MODULE_SLOTS) {
      const st = unit.partStatuses[slot];
      slots[slot] = {
        hp: st.currentHP,
        stages: { ...st.buffs } as Record<string, number>,
      };
    }
    return { defeated: isDefeated(unit), slots };
  };
  return {
    status: state.status.kind,
    winner: state.status.kind === "finished" ? state.status.winner : null,
    round: state.round,
    p1: side("p1"),
    p2: side("p2"),
  };
}

/**
 * Plays a battle to its end, choosing moves from a seeded generator.
 *
 * The choice does not have to be clever, only reproducible: what is being
 * pinned is the arithmetic, and a dull battle exercises it as well as a
 * sharp one.
 */
function play(p1: MechBuild, p2: MechBuild, seed: number, maxRounds: number) {
  const rnd = lcg(seed);
  let state = createBattle(p1, p2, { seed });
  const rounds: RoundActions[] = [];

  const pick = (s: PlayerSide): RoundActions["p1"] => {
    const unit = state[s];
    const moves = availableMoves(unit);
    const chosen = moves[Math.floor(rnd() * moves.length)];
    const targets = legalTargets(state[s === "p1" ? "p2" : "p1"]);
    const target = targets[Math.floor(rnd() * targets.length)] as ModuleSlot;
    return { side: s, sourceSlot: chosen.slot, moveIndex: chosen.moveIndex, targetSlot: target };
  };

  for (let i = 0; i < maxRounds && state.status.kind === "active"; i++) {
    const round: RoundActions = { p1: pick("p1"), p2: pick("p2") };
    rounds.push(round);
    state = resolveRound(state, round).state;
  }
  return { rounds, end: snapshot(state) };
}

const STAT_ORDER = ["HP", "ATK", "DEF", "ENG", "SPD", "SYS", "PROC"] as const;

/** `proc` is a reserved word in Rust, so the field carries the trailing _. */
const RUST_FIELD: Record<(typeof STAT_ORDER)[number], string> = {
  HP: "hp", ATK: "atk", DEF: "def", ENG: "eng", SPD: "spd", SYS: "sys", PROC: "proc_",
};

function rustStats(b: StatBlock): string {
  return `Stats { ${STAT_ORDER.map((k) => `${RUST_FIELD[k]}: ${b[k]}`).join(", ")} }`;
}

/** `Self` is a reserved word too, so the self-target variant is `Own`. */
const RUST_TARGET: Record<string, string> = { single: "Single", self: "Own", aoe: "Aoe" };

function rustMove(m: MoveDefinition): string {
  const mods = m.statModifiers
    .map((x) => `StatMod { stat: Stat::${x.stat}, amount: ${x.amount} }`)
    .join(", ");
  return [
    "Move {",
    `name: ${JSON.stringify(m.name)},`,
    `base_damage: ${m.baseDamage},`,
    `damage_type: DamageType::${m.damageType},`,
    `target_type: TargetType::${RUST_TARGET[m.targetType]},`,
    `mods: &[${mods}],`,
    `heal: ${m.healAmount ?? 0},`,
    "}",
  ].join(" ");
}

/**
 * Writes the catalog as Rust constants.
 *
 * Only what the REDUCER reads: codes, stats and moves. Names, roles, sprites,
 * passives and rarity stay in TS, because the program has no opinion about
 * any of them and every byte of a const is a byte of the .so.
 */
function emitRust(): string {
  const parts = ALL_PARTS.map((p) => [
    "    Part {",
    `        code: ${JSON.stringify(p.partCode)},`,
    `        slot: Slot::${p.slot[0].toUpperCase()}${p.slot.slice(1)},`,
    `        stats: ${rustStats(p.statModifiers)},`,
    `        moves: &[${p.moves.map(rustMove).join(", ")}],`,
    "    },",
  ].join("\n")).join("\n");

  const matrices = MATRICES.map((m) => [
    "    Matrix {",
    `        code: ${JSON.stringify(m.matrixCode)},`,
    `        base: ${rustStats(m.baseStats)},`,
    `        moves: &[${m.moves.map(rustMove).join(", ")}],`,
    "    },",
  ].join("\n")).join("\n");

  return `// GENERATED by apps/web/scripts/export-battle-engine.ts. Do not edit.
//
// The TS catalog is the source: apps/web/src/game/solmechs/data/catalog.ts.
// Regenerate after any balance change, and the vector test will tell you
// whether the reducer still agrees with it.

use crate::{DamageType, Matrix, Move, Part, Slot, Stat, StatMod, Stats, TargetType};

pub const MATRICES: &[Matrix] = &[
${matrices}
];

pub const PARTS: &[Part] = &[
${parts}
];
`;
}

const STAGE_ORDER = ["ATK", "DEF", "ENG", "SPD", "SYS"] as const;

function rustSlot(s: ModuleSlot): string {
  return `Slot::${{ rightArm: "RightArm", leftArm: "LeftArm", lowerBody: "LowerBody", matrix: "Matrix" }[s]}`;
}

function rustBuild(b: MechBuild): string {
  return `Build { matrix: ${JSON.stringify(b.matrixCode)}, right_arm: ${JSON.stringify(b.rightArm)}, `
    + `left_arm: ${JSON.stringify(b.leftArm)}, lower_body: ${JSON.stringify(b.lowerBody)} }`;
}

function rustAction(a: BattleAction): string {
  return `Action { source: ${rustSlot(a.sourceSlot)}, move_index: ${a.moveIndex}, target: ${rustSlot(a.targetSlot)} }`;
}

function rustSide(side: Snapshot["p1"]): string {
  const slots = MODULE_SLOTS.map((slot) => {
    const st = side.slots[slot];
    const stages = STAGE_ORDER.map((k) => st.stages[k] ?? 0).join(", ");
    return `VSlot { hp: ${st.hp}, stages: [${stages}] }`;
  }).join(", ");
  return `VSide { defeated: ${side.defeated}, slots: [${slots}] }`;
}

/**
 * Writes the vectors as Rust.
 *
 * The slot order is MODULE_SLOTS and it is load-bearing: the Rust side
 * indexes `statuses` the same way, so a reordering here silently compares a
 * mech's arm against its legs.
 */
function emitVectors(vectors: Vector[]): string {
  const body = vectors.map((v) => [
    "    Vector {",
    `        name: ${JSON.stringify(v.name)},`,
    `        p1: ${rustBuild(v.p1Build)},`,
    `        p2: ${rustBuild(v.p2Build)},`,
    `        seed: ${v.seed},`,
    `        rounds: &[`,
    // Both are always present: `play` fills them every round. The type
    // allows null because a forfeit round has no action, and a forfeit is
    // settled from the clock rather than replayed.
    ...v.rounds.map((r) => `            (${rustAction(r.p1!)}, ${rustAction(r.p2!)}),`),
    "        ],",
    `        winner: ${v.end.winner === null ? "None" : `Some(Side::${v.end.winner === "p1" ? "P1" : "P2"})`},`,
    `        end_p1: ${rustSide(v.end.p1)},`,
    `        end_p2: ${rustSide(v.end.p2)},`,
    "    },",
  ].join("\n")).join("\n");

  return `// GENERATED by apps/web/scripts/export-battle-engine.ts. Do not edit.
//
// What the TypeScript engine did, so the Rust one can be asked to do it too.
// The TS side is the reference; a disagreement here means the port is wrong.

use crate::battle::{Action, Build, Side};
use crate::Slot;

pub struct VSlot {
    pub hp: i32,
    /// ATK, DEF, ENG, SPD, SYS.
    pub stages: [i32; 5],
}

pub struct VSide {
    pub defeated: bool,
    /// Right arm, left arm, lower body, matrix: MODULE_SLOTS order.
    pub slots: [VSlot; 4],
}

pub struct Vector {
    pub name: &'static str,
    pub p1: Build,
    pub p2: Build,
    pub seed: u32,
    pub rounds: &'static [(Action, Action)],
    pub winner: Option<Side>,
    pub end_p1: VSide,
    pub end_p2: VSide,
}

pub const VECTORS: &[Vector] = &[
${body}
];
`;
}

interface Snapshot {
  status: string;
  winner: string | null;
  round: number;
  p1: { defeated: boolean; slots: Record<string, { hp: number; stages: Record<string, number> }> };
  p2: { defeated: boolean; slots: Record<string, { hp: number; stages: Record<string, number> }> };
}

interface Vector {
  name: string;
  p1Build: MechBuild;
  p2Build: MechBuild;
  seed: number;
  rounds: RoundActions[];
  end: Snapshot;
}

// ── 3v3 ───────────────────────────────────────────────────────────────────

interface TeamVector {
  name: string;
  p1: MechBuild[];
  p2: MechBuild[];
  seed: number;
  invertTies: boolean;
  rounds: TeamRoundActions[];
  winner: string | null;
  endP1: TeamSnapshot;
  endP2: TeamSnapshot;
}

interface TeamSnapshot {
  active: number;
  units: Array<{ defeated: boolean; slots: Record<string, { hp: number; stages: Record<string, number> }> }>;
}

function teamSnapshot(side: TeamSide): TeamSnapshot {
  return {
    active: side.activeIndex,
    units: side.units.map((unit) => {
      const slots: TeamSnapshot["units"][number]["slots"] = {};
      for (const slot of MODULE_SLOTS) {
        const st = unit.partStatuses[slot];
        slots[slot] = { hp: st.currentHP, stages: { ...st.buffs } as Record<string, number> };
      }
      return { defeated: isDefeated(unit), slots };
    }),
  };
}

/**
 * Plays a squad battle to its end with seeded choices.
 *
 * Switching is chosen sometimes rather than never, because the switch path is
 * where the squad layer differs from the 1v1 one: dropped stages, the forced
 * substitution after a loss, and the retarget that stops a switch from
 * dodging the attack aimed at the mech that left.
 */
function playTeam(p1: MechBuild[], p2: MechBuild[], seed: number, invertTies: boolean, maxRounds: number) {
  const rnd = lcg(seed ^ 0x5eed);
  let state = createTeamBattle({ mechs: p1 }, { mechs: p2 }, { seed, invertTies });
  const rounds: TeamRoundActions[] = [];

  const choose = (side: PlayerSide): TeamAction | null => {
    const me = side === "p1" ? state.p1 : state.p2;
    const foe = side === "p1" ? state.p2 : state.p1;
    const unit = activeUnit(me);
    const reserves = switchableIndices(me);
    // One round in six is a substitution when there is anything to send.
    if (reserves.length > 0 && rnd() < 1 / 6) {
      return { kind: "switch", side, toIndex: reserves[Math.floor(rnd() * reserves.length)] };
    }
    const moves = availableMoves(unit);
    if (moves.length === 0) return null;
    const chosen = moves[Math.floor(rnd() * moves.length)];
    const targets = legalTargets(activeUnit(foe));
    if (targets.length === 0) return null;
    return {
      kind: "move", side,
      sourceSlot: chosen.slot,
      moveIndex: chosen.moveIndex,
      targetSlot: targets[Math.floor(rnd() * targets.length)] as ModuleSlot,
    };
  };

  for (let i = 0; i < maxRounds && state.status.kind !== "finished"; i++) {
    if (state.status.kind === "awaiting-switch") {
      // A forced substitution is recorded AS the round, which is how
      // replayTeam reads it back.
      const round: TeamRoundActions = { p1: null, p2: null };
      for (const side of state.status.sides) {
        const me = side === "p1" ? state.p1 : state.p2;
        const options = switchableIndices(me);
        if (options.length === 0) continue;
        const pick = options[Math.floor(rnd() * options.length)];
        if (side === "p1") round.p1 = { kind: "switch", side, toIndex: pick };
        else round.p2 = { kind: "switch", side, toIndex: pick };
      }
      rounds.push(round);
      state = resolveForcedSwitches(state, {
        p1: round.p1?.kind === "switch" ? round.p1.toIndex : undefined,
        p2: round.p2?.kind === "switch" ? round.p2.toIndex : undefined,
      }).state;
      continue;
    }
    const round: TeamRoundActions = { p1: choose("p1"), p2: choose("p2") };
    rounds.push(round);
    state = resolveTeamRound(state, round).state;
  }

  return {
    rounds,
    winner: state.status.kind === "finished" ? state.status.winner : null,
    endP1: teamSnapshot(state.p1),
    endP2: teamSnapshot(state.p2),
  };
}

function rustTeamAction(a: TeamAction | null): string {
  if (!a) return "None";
  if (a.kind === "switch") return `Some(TeamAction::Switch { to: ${a.toIndex} })`;
  return `Some(TeamAction::Move { source: ${rustSlot(a.sourceSlot)}, `
    + `move_index: ${a.moveIndex}, target: ${rustSlot(a.targetSlot)} })`;
}

function rustTeamSide(t: TeamSnapshot): string {
  const units = t.units.map((u) => {
    const slots = MODULE_SLOTS.map((slot) => {
      const st = u.slots[slot];
      return `VSlot { hp: ${st.hp}, stages: [${STAGE_ORDER.map((k) => st.stages[k] ?? 0).join(", ")}] }`;
    }).join(", ");
    return `VSide { defeated: ${u.defeated}, slots: [${slots}] }`;
  }).join(", ");
  return `VSquad { active: ${t.active}, units: [${units}] }`;
}

function emitTeamVectors(vs: TeamVector[]): string {
  const body = vs.map((v) => [
    "    TeamVector {",
    `        name: ${JSON.stringify(v.name)},`,
    `        p1: [${v.p1.map(rustBuild).join(", ")}],`,
    `        p2: [${v.p2.map(rustBuild).join(", ")}],`,
    `        seed: ${v.seed},`,
    `        invert_ties: ${v.invertTies},`,
    "        rounds: &[",
    ...v.rounds.map((r) => `            (${rustTeamAction(r.p1)}, ${rustTeamAction(r.p2)}),`),
    "        ],",
    `        winner: ${v.winner === null ? "None" : `Some(Side::${v.winner === "p1" ? "P1" : "P2"})`},`,
    `        end_p1: ${rustTeamSide(v.endP1)},`,
    `        end_p2: ${rustTeamSide(v.endP2)},`,
    "    },",
  ].join("\n")).join("\n");

  return `// GENERATED by apps/web/scripts/export-battle-engine.ts. Do not edit.
//
// The squad format, which is the one ranked plays.

use crate::battle::{Build, Side};
use crate::team::TeamAction;
use crate::vectors::{VSide, VSlot};
use crate::Slot;

pub struct VSquad {
    pub active: usize,
    pub units: [VSide; 3],
}

pub struct TeamVector {
    pub name: &'static str,
    pub p1: [Build; 3],
    pub p2: [Build; 3],
    pub seed: u32,
    pub invert_ties: bool,
    pub rounds: &'static [(Option<TeamAction>, Option<TeamAction>)],
    pub winner: Option<Side>,
    pub end_p1: VSquad,
    pub end_p2: VSquad,
}

pub const TEAM_VECTORS: &[TeamVector] = &[
${body}
];
`;
}

/**
 * Every distinct action in the squad vectors, with the two bytes it travels
 * as.
 *
 * The decoder is small and the two index orders in it are NOT the same -
 * a source is [rightArm, leftArm, lowerBody, matrix] and a target is
 * [matrix, rightArm, leftArm, lowerBody]. Reading that asymmetry wrong gives
 * a decoder that works for the matrix and silently swaps the arms, which no
 * amount of staring at the table catches.
 */
function emitWireVectors(vs: TeamVector[]): string {
  const seen = new Map<string, string>();
  for (const v of vs) {
    for (const r of v.rounds) {
      for (const a of [r.p1, r.p2]) {
        const bytes = encodeAction(toWire(a));
        const key = `${bytes[0]},${bytes[1]}`;
        if (!seen.has(key)) seen.set(key, rustTeamAction(a));
      }
    }
  }
  const rows = [...seen.entries()]
    .sort((x, y) => x[0].localeCompare(y[0]))
    .map(([key, action]) => {
      const [b0, b1] = key.split(",");
      return `    ([${b0}, ${b1}], ${action}),`;
    })
    .join("\n");

  return `// GENERATED by apps/web/scripts/export-battle-engine.ts. Do not edit.
//
// The two bytes an action travels as, and what it means. Taken from the
// actions the squad vectors actually use, so the set covers what a real match
// sends rather than what a decoder author imagined.

use crate::team::TeamAction;
use crate::Slot;

pub const WIRE_VECTORS: &[([u8; 2], Option<TeamAction>)] = &[
${rows}
];
`;
}

function main() {
  // The presets rather than builds assembled here. Parts are slot-specific,
  // so walking a flat list produces builds the engine would refuse, and these
  // are the ones the game itself ships.
  const names = Object.keys(PRESET_BUILDS);
  const builds: MechBuild[] = names.map((n) => PRESET_BUILDS[n as keyof typeof PRESET_BUILDS]);
  if (builds.length === 0) throw new Error("no preset builds to generate from");

  const vectors: Vector[] = [];
  for (let a = 0; a < builds.length; a++) {
    for (let b = 0; b < builds.length; b++) {
      const seed = 1000 + a * 31 + b;
      const { rounds, end } = play(builds[a], builds[b], seed, 40);
      vectors.push({
        name: `${names[a]} vs ${names[b]}`,
        p1Build: builds[a], p2Build: builds[b], seed, rounds, end,
      });
    }
  }

  mkdirSync(SRC, { recursive: true });
  const rustPath = join(SRC, "catalog.generated.rs");
  writeFileSync(rustPath, emitRust());
  console.log(`${MATRICES.length} matrices, ${ALL_PARTS.length} parts -> ${rustPath}`);

  const path = join(SRC, "vectors.generated.rs");
  writeFileSync(path, emitVectors(vectors));

  // ── 3v3 ───────────────────────────────────────────────────────────────
  //
  // Squads of three DISTINCT presets: `validateTeam` refuses the same part on
  // two mechs, and each preset is a different family, so distinct presets are
  // a legal squad by construction.
  const teamVectors: TeamVector[] = [];
  for (let a = 0; a < builds.length; a++) {
    const p1 = [0, 1, 2].map((k) => builds[(a + k) % builds.length]);
    for (let b = 0; b < builds.length; b++) {
      const p2 = [0, 1, 2].map((k) => builds[(b + k + 1) % builds.length]);
      const seed = 7000 + a * 37 + b;
      const invertTies = (a + b) % 2 === 1;
      const played = playTeam(p1, p2, seed, invertTies, 120);
      teamVectors.push({
        name: `${names[a]} squad vs ${names[b]} squad`,
        p1, p2, seed, invertTies,
        rounds: played.rounds,
        winner: played.winner,
        endP1: played.endP1,
        endP2: played.endP2,
      });
    }
  }
  const teamPath = join(SRC, "team_vectors.generated.rs");
  writeFileSync(teamPath, emitTeamVectors(teamVectors));
  writeFileSync(join(SRC, "wire_vectors.generated.rs"), emitWireVectors(teamVectors));
  const settled = teamVectors.filter((v) => v.winner !== null).length;
  console.log(`${teamVectors.length} squad vectors, ${settled} settled`);

  const finished = vectors.filter((v) => v.end.status === "finished").length;
  console.log(`${vectors.length} vectors, ${finished} fought to a finish`);
  console.log(`rounds: ${Math.min(...vectors.map((v) => v.rounds.length))}-${Math.max(...vectors.map((v) => v.rounds.length))}`);
  console.log(path);
}

main();
