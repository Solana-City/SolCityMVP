/**
 * Sol Mechs - emits everything the Rust engine needs from the TS one.
 *
 *   npx tsx scripts/export-battle-engine.ts
 *
 * Two files, both generated so that neither is transcribed by hand:
 *
 *   programs/sol-mechs-engine/src/catalog.generated.rs   the DATA
 *   programs/sol-mechs-engine/tests/battle-vectors.json  the BEHAVIOUR
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
  type BattleState, type RoundActions, type PlayerSide,
} from "../src/game/solmechs/engine/BattleEngine";
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

function main() {
  // The presets rather than builds assembled here. Parts are slot-specific,
  // so walking a flat list produces builds the engine would refuse, and these
  // are the ones the game itself ships.
  const names = Object.keys(PRESET_BUILDS);
  const builds: MechBuild[] = names.map((n) => PRESET_BUILDS[n as keyof typeof PRESET_BUILDS]);
  if (builds.length === 0) throw new Error("no preset builds to generate from");

  const vectors = [];
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

  mkdirSync(OUT, { recursive: true });
  mkdirSync(SRC, { recursive: true });
  const rustPath = join(SRC, "catalog.generated.rs");
  writeFileSync(rustPath, emitRust());
  console.log(`${MATRICES.length} matrices, ${ALL_PARTS.length} parts -> ${rustPath}`);

  const path = join(OUT, "battle-vectors.json");
  writeFileSync(path, JSON.stringify({
    note: "Generated by apps/web/scripts/battle-vectors.ts. The TS engine is the reference.",
    vectors,
  }, null, 1) + "\n");

  const finished = vectors.filter((v) => v.end.status === "finished").length;
  console.log(`${vectors.length} vectors, ${finished} fought to a finish`);
  console.log(`rounds: ${Math.min(...vectors.map((v) => v.rounds.length))}-${Math.max(...vectors.map((v) => v.rounds.length))}`);
  console.log(path);
}

main();
