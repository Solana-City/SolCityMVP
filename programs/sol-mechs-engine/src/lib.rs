//! Sol Mechs combat rules, in the language the program speaks.
//!
//! ── Why this exists ──────────────────────────────────────────────────────
//!
//! A ranked result is only trustworthy if the PROGRAM decides it. Today both
//! clients report who won and the chain believes them when they agree, which
//! means a pair can agree on anything. The fix is for the chain to replay the
//! match from its action list, and replaying needs these rules here.
//!
//! ── Why it is a crate of its own ─────────────────────────────────────────
//!
//! Not tidiness. `sol-mechs` is deliberately outside host `cargo check`,
//! because its zero-copy accounts derive `Pod` on the BPF target and not on
//! the host, where alignment differs; a host check reports errors the real
//! build does not have. Combat arithmetic has no accounts in it, so as its
//! own crate it can be checked AND tested on the host. That is the only way
//! the vectors generated from the TypeScript engine become a gate rather
//! than a file nobody runs.
//!
//! ── The rule this file lives under ───────────────────────────────────────
//!
//! The TypeScript engine in `apps/web/src/game/solmechs/engine/BattleEngine.ts`
//! is the REFERENCE. It is the one that has been played and balanced. This is
//! a port of it, and where they disagree this one is wrong, however reasonable
//! it looks.
//!
//! The disagreement to fear is arithmetic, not logic. The damage path runs
//! `clamp(2*atk/(atk+def)) * base * 0.65` through a stage table holding
//! 0.2857 and 0.3333. JavaScript numbers are IEEE-754 doubles and so is
//! `f64`, so `+ - * /` agree exactly. Rounding does not: JS `Math.round`
//! takes a half UP, `f64::round` takes a half AWAY FROM ZERO, and they part
//! company at -0.5. Use [`js_round`] and never `f64::round`.

#![allow(clippy::excessive_precision)]

/// The five stats a move can stage up or down. HP and PROC are not staged.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Stat {
    ATK,
    DEF,
    ENG,
    SPD,
    SYS,
}

/// The four places a mech is assembled from and attacked at.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Slot {
    RightArm,
    LeftArm,
    LowerBody,
    Matrix,
}

impl Slot {
    /// Every slot, in the order the TypeScript `MODULE_SLOTS` lists them.
    /// The order is load-bearing: it is how a vector's per-slot end state
    /// lines up with the unit it describes.
    pub const ALL: [Slot; 4] = [Slot::RightArm, Slot::LeftArm, Slot::LowerBody, Slot::Matrix];

    /// The three that can be destroyed on their own. The matrix is the core.
    pub const LIMBS: [Slot; 3] = [Slot::RightArm, Slot::LeftArm, Slot::LowerBody];
}

/// Physical weighs ATK against DEF, Energy weighs ENG against SYS, and Effect
/// deals no damage at all and only moves stages.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DamageType {
    Physical,
    Energy,
    Effect,
}

/// `Own` and not `Self`, which Rust reserves.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TargetType {
    Single,
    Own,
    Aoe,
}

/// A chassis' or a part's contribution, and a unit's total.
///
/// `proc_` carries the trailing underscore because `proc` is reserved. The
/// generator knows; see `RUST_FIELD` in the exporter.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct Stats {
    pub hp: i32,
    pub atk: i32,
    pub def: i32,
    pub eng: i32,
    pub spd: i32,
    pub sys: i32,
    pub proc_: i32,
}

impl Stats {
    pub fn plus(self, o: Stats) -> Stats {
        Stats {
            hp: self.hp + o.hp,
            atk: self.atk + o.atk,
            def: self.def + o.def,
            eng: self.eng + o.eng,
            spd: self.spd + o.spd,
            sys: self.sys + o.sys,
            proc_: self.proc_ + o.proc_,
        }
    }

    pub fn get(&self, s: Stat) -> i32 {
        match s {
            Stat::ATK => self.atk,
            Stat::DEF => self.def,
            Stat::ENG => self.eng,
            Stat::SPD => self.spd,
            Stat::SYS => self.sys,
        }
    }
}

/// A stat stage carried by a move. Stages, not points.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct StatMod {
    pub stat: Stat,
    pub amount: i32,
}

/// One move. `chance` is absent on purpose: every rider in the catalog lands,
/// and a probability would make a battle unreplayable.
#[derive(Clone, Copy, Debug)]
pub struct Move {
    pub name: &'static str,
    pub base_damage: i32,
    pub damage_type: DamageType,
    pub target_type: TargetType,
    pub mods: &'static [StatMod],
    pub heal: i32,
}

#[derive(Clone, Copy, Debug)]
pub struct Matrix {
    pub code: &'static str,
    pub base: Stats,
    pub moves: &'static [Move],
}

#[derive(Clone, Copy, Debug)]
pub struct Part {
    pub code: &'static str,
    pub slot: Slot,
    pub stats: Stats,
    pub moves: &'static [Move],
}

// The filename keeps saying "generated" so nobody edits it by hand.
#[path = "catalog.generated.rs"]
mod catalog;
pub use catalog::{MATRICES, PARTS};

pub fn matrix(code: &str) -> Option<&'static Matrix> {
    MATRICES.iter().find(|m| m.code == code)
}

pub fn part(code: &str) -> Option<&'static Part> {
    PARTS.iter().find(|p| p.code == code)
}

/// `Math.round` as JavaScript does it: a half goes UP, towards +infinity.
///
/// `f64::round` takes a half AWAY FROM ZERO, so the two agree on 2.5 and
/// disagree on -2.5, and `effectiveStats` can hand this a negative when a
/// wrecked part's share is subtracted. One character of difference, and the
/// chain settles a match the clients did not play.
pub fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// The deterministic coin flip that breaks a speed tie.
///
/// An xorshift over the battle seed and the round, ported from `tieBreak`.
/// Every step is `u32` wrapping arithmetic, which is what `>>> 0` and
/// `Math.imul` mean on the other side.
pub fn tie_break(seed: u32, round: u32) -> bool {
    let mut x = seed ^ round.wrapping_mul(0x9E37_79B1);
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    x & 1 == 0
}

pub mod battle;
pub mod team;
pub use battle::{replay, Action, Battle, Build, Side};
pub use team::{
    decode_action, decode_team, replay_team, TeamAction, TeamBattle, TeamStatus, TEAM_BYTES,
    TEAM_SIZE,
};

// What the TypeScript engine did, generated from it. Test-only, so none of
// it reaches the program.
#[cfg(test)]
#[path = "vectors.generated.rs"]
mod vectors;

#[cfg(test)]
#[path = "team_vectors.generated.rs"]
mod team_vectors;

#[cfg(test)]
#[path = "wire_vectors.generated.rs"]
mod wire_vectors;

/// The port, judged against the engine it was ported from.
///
/// This is the test the whole crate exists for. Everything else in it is
/// arithmetic that looks right; this is the only thing that says it IS right,
/// and it says so by replaying battles the other engine actually played.
#[cfg(test)]
mod vector_tests {
    use super::battle::{replay, Side};
    use super::vectors::VECTORS;
    use super::Slot;

    #[test]
    fn every_vector_replays_to_the_same_battle() {
        assert!(!VECTORS.is_empty(), "no vectors; regenerate vectors.generated.rs");
        for v in VECTORS {
            let b = replay(&v.p1, &v.p2, v.seed, v.rounds)
                .unwrap_or_else(|e| panic!("{}: the build does not assemble: {:?}", v.name, e));

            assert_eq!(b.winner, v.winner, "{}: wrong winner", v.name);

            // The end state and not only the winner. A port can reach the
            // right winner by the wrong arithmetic, and the next balance
            // change is when that would surface.
            for (side, want, got) in [
                ("p1", &v.end_p1, &b.p1),
                ("p2", &v.end_p2, &b.p2),
            ] {
                assert_eq!(got.is_defeated(), want.defeated, "{}: {} defeated", v.name, side);
                for (i, slot) in Slot::ALL.iter().enumerate() {
                    assert_eq!(
                        got.statuses[i].current_hp, want.slots[i].hp,
                        "{}: {} {:?} hp", v.name, side, slot,
                    );
                    assert_eq!(
                        got.statuses[i].stages, want.slots[i].stages,
                        "{}: {} {:?} stages", v.name, side, slot,
                    );
                }
            }
        }
    }

    /// The squad format, which is the one ranked plays.
    ///
    /// The 1v1 set above isolates the arithmetic; this one adds everything
    /// the squad layer puts on top of it: stages dropped on the way out, the
    /// free substitution after a mech falls, and the retarget that stops a
    /// switch from dodging the attack aimed at the mech that left.
    #[test]
    fn every_squad_vector_replays_to_the_same_battle() {
        use super::team::replay_team;
        use super::team_vectors::TEAM_VECTORS;

        assert!(!TEAM_VECTORS.is_empty(), "no squad vectors; regenerate them");
        for v in TEAM_VECTORS {
            let b = replay_team(&v.p1, &v.p2, v.seed, v.invert_ties, v.rounds)
                .unwrap_or_else(|e| panic!("{}: the squad does not assemble: {:?}", v.name, e));

            assert_eq!(b.winner(), v.winner, "{}: wrong winner", v.name);

            for (name, want, got) in [("p1", &v.end_p1, &b.p1), ("p2", &v.end_p2, &b.p2)] {
                assert_eq!(got.active, want.active, "{}: {} has the wrong mech out", v.name, name);
                for (u, (wu, gu)) in want.units.iter().zip(got.units.iter()).enumerate() {
                    assert_eq!(gu.is_defeated(), wu.defeated, "{}: {} mech {} defeated", v.name, name, u);
                    for i in 0..4 {
                        assert_eq!(
                            gu.statuses[i].current_hp, wu.slots[i].hp,
                            "{}: {} mech {} slot {:?} hp", v.name, name, u, Slot::ALL[i],
                        );
                        assert_eq!(
                            gu.statuses[i].stages, wu.slots[i].stages,
                            "{}: {} mech {} slot {:?} stages", v.name, name, u, Slot::ALL[i],
                        );
                    }
                }
            }
        }
    }

    /// Every action the squad vectors send, decoded from its two bytes.
    ///
    /// The two index orders in `encodeAction` are NOT the same: a source is
    /// [rightArm, leftArm, lowerBody, matrix] and a target is
    /// [matrix, rightArm, leftArm, lowerBody]. A decoder that reads the
    /// asymmetry backwards is right about the matrix and swaps the arms, and
    /// nothing but a table like this one notices.
    #[test]
    fn every_wire_action_decodes_to_what_was_encoded() {
        use super::team::{decode_action, TeamAction};
        use super::wire_vectors::WIRE_VECTORS;

        assert!(!WIRE_VECTORS.is_empty(), "no wire vectors; regenerate them");
        for (bytes, want) in WIRE_VECTORS {
            let got = decode_action(bytes).unwrap_or_else(|e| {
                panic!("{:?} did not decode: {:?}", bytes, e)
            });
            match (got, want) {
                (None, None) => {}
                (
                    Some(TeamAction::Move { source: gs, move_index: gm, target: gt }),
                    Some(TeamAction::Move { source: ws, move_index: wm, target: wt }),
                ) => {
                    assert_eq!(gs, *ws, "{:?} source", bytes);
                    assert_eq!(gm, *wm, "{:?} move index", bytes);
                    assert_eq!(gt, *wt, "{:?} target", bytes);
                }
                (Some(TeamAction::Switch { to: g }), Some(TeamAction::Switch { to: w })) => {
                    assert_eq!(g, *w, "{:?} switch index", bytes);
                }
                _ => panic!("{:?} decoded to the wrong kind", bytes),
            }
        }
    }

    /// A kind the client never sends must be refused, not guessed at.
    #[test]
    fn a_malformed_action_is_an_error() {
        use super::team::decode_action;
        assert!(decode_action(&[3, 0]).is_err());
        assert!(decode_action(&[255, 255]).is_err());
    }

    /// Both outcomes are in the set, so neither branch of the defeat check is
    /// untested by accident.
    #[test]
    fn the_vectors_cover_both_winners() {
        let p1 = VECTORS.iter().filter(|v| v.winner == Some(Side::P1)).count();
        let p2 = VECTORS.iter().filter(|v| v.winner == Some(Side::P2)).count();
        assert!(p1 > 0 && p2 > 0, "one-sided vectors prove less than they look");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_catalog_arrived() {
        assert!(!MATRICES.is_empty(), "no chassis; regenerate catalog.generated.rs");
        assert!(!PARTS.is_empty(), "no parts; regenerate catalog.generated.rs");
        // Every part belongs to a slot that can hold one. A matrix is not a
        // part, so nothing should claim that slot.
        for p in PARTS {
            assert!(p.slot != Slot::Matrix, "{} claims the matrix slot", p.code);
        }
    }

    #[test]
    fn codes_are_unique() {
        for (i, a) in MATRICES.iter().enumerate() {
            for b in &MATRICES[i + 1..] {
                assert_ne!(a.code, b.code, "two chassis share a code");
            }
        }
        for (i, a) in PARTS.iter().enumerate() {
            for b in &PARTS[i + 1..] {
                assert_ne!(a.code, b.code, "two parts share {}", a.code);
            }
        }
    }

    /// The rounding trap, stated as a test so it cannot be undone quietly.
    #[test]
    fn js_round_is_not_f64_round() {
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0);
        // What the obvious implementation would have given.
        assert_eq!((-2.5f64).round(), -3.0);
    }

    /// Pinned against the TypeScript `tieBreak` for the first few rounds of
    /// the seed the vectors are generated from.
    #[test]
    fn tie_break_is_deterministic() {
        let a = tie_break(1000, 1);
        assert_eq!(a, tie_break(1000, 1), "same input, same answer");
        assert_ne!(
            (1..40).map(|r| tie_break(1000, r)).filter(|b| *b).count(),
            0,
            "a flip that never comes up heads is not a flip",
        );
    }
}
