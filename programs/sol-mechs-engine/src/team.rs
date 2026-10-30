//! The squad format, ported from `TeamBattle.ts`.
//!
//! This is the one ranked plays, which is why the program needs it: the 1v1
//! reducer in `battle.rs` is the arithmetic underneath, and this is the layer
//! that decides whose mech is on the field when that arithmetic runs.
//!
//! Same rule as its sibling: the TypeScript is the reference, and the vectors
//! are how that is enforced rather than hoped for.

use crate::battle::{apply_move, create_unit, validate_move, Build, BuildError, Side, Unit};
use crate::{tie_break, Slot, TargetType};

pub const TEAM_SIZE: usize = 3;
/// The wire format: three mechs, four parts each, one byte per part.
pub const TEAM_BYTES: usize = TEAM_SIZE * 4;

/// One side's squad and which mech is out.
#[derive(Clone, Copy, Debug)]
pub struct Squad {
    pub units: [Unit; TEAM_SIZE],
    pub active: usize,
}

impl Squad {
    pub fn active_unit(&self) -> &Unit {
        &self.units[self.active]
    }

    /// `teamWiped`.
    pub fn wiped(&self) -> bool {
        self.units.iter().all(|u| u.is_defeated())
    }

    /// `switchableIndices`: anything still standing that is not already out.
    pub fn switchable(&self) -> impl Iterator<Item = usize> + '_ {
        (0..TEAM_SIZE).filter(move |i| *i != self.active && !self.units[*i].is_defeated())
    }
}

/// What a side does with its round.
#[derive(Clone, Copy, Debug)]
pub enum TeamAction {
    Move { source: Slot, move_index: usize, target: Slot },
    Switch { to: usize },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TeamStatus {
    Active,
    /// One or both sides lost their mech and owe a replacement. Free: the
    /// round that lost it is already spent.
    AwaitingSwitch { p1: bool, p2: bool },
    Finished { winner: Side },
}

#[derive(Clone, Copy, Debug)]
pub struct TeamBattle {
    pub p1: Squad,
    pub p2: Squad,
    pub status: TeamStatus,
    pub round: u32,
    pub seed: u32,
    /// Flips the tie-break. The second battle of a pair sets it so that a
    /// seeded coin does not hand the same side the initiative twice.
    pub invert_ties: bool,
}

/// `fromIndex`: one byte back to a catalog code.
///
/// The number is part of the CODE, not a position in an array: "RA03" is
/// stored as 2 and rebuilt as "RA03". That is deliberate on the TypeScript
/// side and the reason adding a part never renumbers the wire format.
///
/// Note the lower body is "IN", not "LB".
fn code_from_byte(prefix: &str, byte: u8) -> Option<&'static str> {
    let n = byte as usize + 1;
    if n > 99 {
        return None;
    }
    // Two digits, zero padded, matching `String(index + 1).padStart(2, "0")`.
    // A table rather than formatting: the crate has no allocator worth using
    // and the codes are static strings in the catalog anyway.
    let want = [
        prefix.as_bytes(),
        &[b'0' + (n / 10) as u8, b'0' + (n % 10) as u8],
    ]
    .concat();
    let matches = |code: &'static str| code.as_bytes() == want.as_slice();
    if prefix == "M" {
        crate::MATRICES.iter().find(|m| matches(m.code)).map(|m| m.code)
    } else {
        crate::PARTS.iter().find(|p| matches(p.code)).map(|p| p.code)
    }
}

/// `decodeTeam`: the twelve bytes a `Duelist` carries, back into builds.
///
/// Rejects anything the catalog does not know, which is what makes a hostile
/// team a failed settlement rather than a battle against a mech that does not
/// exist.
pub fn decode_team(bytes: &[u8; TEAM_BYTES]) -> Result<[Build; TEAM_SIZE], BuildError> {
    let mut out = [Build { matrix: "", right_arm: "", left_arm: "", lower_body: "" }; TEAM_SIZE];
    for (m, slot) in out.iter_mut().enumerate() {
        let at = |s: usize| bytes[m * 4 + s];
        *slot = Build {
            matrix: code_from_byte("M", at(0)).ok_or(BuildError::UnknownMatrix)?,
            right_arm: code_from_byte("RA", at(1)).ok_or(BuildError::UnknownPart)?,
            left_arm: code_from_byte("LA", at(2)).ok_or(BuildError::UnknownPart)?,
            lower_body: code_from_byte("IN", at(3)).ok_or(BuildError::UnknownPart)?,
        };
    }
    Ok(out)
}

fn build_squad(builds: &[Build; TEAM_SIZE]) -> Result<Squad, BuildError> {
    let first = create_unit(&builds[0])?;
    let mut units = [first; TEAM_SIZE];
    for (i, b) in builds.iter().enumerate() {
        units[i] = create_unit(b)?;
    }
    Ok(Squad { units, active: 0 })
}

impl TeamBattle {
    pub fn new(
        p1: &[Build; TEAM_SIZE],
        p2: &[Build; TEAM_SIZE],
        seed: u32,
        invert_ties: bool,
    ) -> Result<TeamBattle, BuildError> {
        Ok(TeamBattle {
            p1: build_squad(p1)?,
            p2: build_squad(p2)?,
            status: TeamStatus::Active,
            round: 1,
            seed,
            invert_ties,
        })
    }

    fn squad(&self, s: Side) -> &Squad {
        match s {
            Side::P1 => &self.p1,
            Side::P2 => &self.p2,
        }
    }

    /// `bySpeed`: the ACTIVE mechs' surviving speed, ties on the seeded flip.
    fn by_speed(&self, a: Side, b: Side) -> [Side; 2] {
        let sa = self.squad(a).active_unit().effective_stats().spd;
        let sb = self.squad(b).active_unit().effective_stats().spd;
        if sa != sb {
            return if sa > sb { [a, b] } else { [b, a] };
        }
        if tie_break(self.seed, self.round) != self.invert_ties {
            [a, b]
        } else {
            [b, a]
        }
    }

    /// `clearStages`: a mech leaving the field drops its buffs.
    fn clear_stages(u: &mut Unit) {
        for st in u.statuses.iter_mut() {
            st.stages = [0; 5];
        }
    }

    /// `resolveTeamRound`.
    ///
    /// Substitutions first, then attacks in speed order, then casualties.
    /// Switching costs the round, which is why the attack aimed at the mech
    /// that left still lands on whatever came in.
    pub fn resolve_round(&mut self, p1: Option<TeamAction>, p2: Option<TeamAction>) {
        if self.status != TeamStatus::Active {
            return;
        }
        // The order the double-wipe falls back to is taken BEFORE the round,
        // same as the TypeScript, which reads it off `state` and not `next`.
        let opening_order = self.by_speed(Side::P1, Side::P2);

        let action = |s: Side| match s {
            Side::P1 => p1,
            Side::P2 => p2,
        };
        // ── 1. substitutions ────────────────────────────────────────────
        let mut switched_in = [false; 2];
        let switch_order = self.by_speed(Side::P1, Side::P2);
        for side in switch_order {
            let Some(TeamAction::Switch { to }) = action(side) else { continue };
            let me = match side {
                Side::P1 => &mut self.p1,
                Side::P2 => &mut self.p2,
            };
            if to == me.active || to >= TEAM_SIZE || me.units[to].is_defeated() {
                continue;
            }
            let from = me.active;
            Self::clear_stages(&mut me.units[from]);
            me.active = to;
            switched_in[side as usize] = true;
        }

        // ── 2. moves, in speed order ────────────────────────────────────
        let move_order = self.by_speed(Side::P1, Side::P2);
        for side in move_order {
            let Some(TeamAction::Move { source, move_index, target }) = action(side) else {
                continue;
            };
            let (me, foe) = match side {
                Side::P1 => (self.p1, self.p2),
                Side::P2 => (self.p2, self.p1),
            };
            let actor = me.units[me.active];
            let defender = foe.units[foe.active];
            if actor.is_defeated() {
                continue;
            }

            // The mech this was aimed at left the field this round. The attack
            // still lands on whoever came in, which is what makes switching
            // cost something; a slot that is not legal on the incoming mech is
            // redirected to the first legal one instead of fizzling.
            let mut target = target;
            let firing = actor.moves_of(source).get(move_index).copied();
            if switched_in[side.other() as usize] {
                if let Some(mv) = firing {
                    if mv.target_type != TargetType::Own
                        && !legal_targets(&defender).any(|t| t == target)
                    {
                        if let Some(first) = legal_targets(&defender).next() {
                            target = first;
                        }
                    }
                }
            }

            if validate_move(&actor, &defender, source, move_index, target).is_some() {
                continue;
            }
            let (a, d) = match side {
                Side::P1 => {
                    let (x, y) = (&mut self.p1, &mut self.p2);
                    (&mut x.units[x.active], &mut y.units[y.active])
                }
                Side::P2 => {
                    let (x, y) = (&mut self.p2, &mut self.p1);
                    (&mut x.units[x.active], &mut y.units[y.active])
                }
            };
            apply_move(a, d, source, move_index, target);
        }

        // ── 3. casualties ───────────────────────────────────────────────
        let p1_wiped = self.p1.wiped();
        let p2_wiped = self.p2.wiped();
        if p1_wiped || p2_wiped {
            let loser = if p1_wiped && p2_wiped {
                opening_order[1]
            } else if p1_wiped {
                Side::P1
            } else {
                Side::P2
            };
            self.status = TeamStatus::Finished { winner: loser.other() };
            return;
        }

        let owes_p1 = self.p1.active_unit().is_defeated();
        let owes_p2 = self.p2.active_unit().is_defeated();
        if owes_p1 || owes_p2 {
            self.status = TeamStatus::AwaitingSwitch { p1: owes_p1, p2: owes_p2 };
            return;
        }

        self.round += 1;
    }

    /// `resolveForcedSwitches`: replacements for whoever lost a mech.
    ///
    /// A missing or illegal pick falls back to the first standing reserve. On
    /// a ladder, refusing to choose would otherwise be a way to deny an
    /// opponent the win they earned.
    pub fn resolve_forced_switches(&mut self, p1: Option<usize>, p2: Option<usize>) {
        let TeamStatus::AwaitingSwitch { p1: owes1, p2: owes2 } = self.status else {
            return;
        };
        for (side, owes, pick) in [(Side::P1, owes1, p1), (Side::P2, owes2, p2)] {
            if !owes {
                continue;
            }
            let me = match side {
                Side::P1 => &mut self.p1,
                Side::P2 => &mut self.p2,
            };
            let legal: Option<usize> = match pick {
                Some(i) if i != me.active && i < TEAM_SIZE && !me.units[i].is_defeated() => Some(i),
                _ => (0..TEAM_SIZE).find(|i| *i != me.active && !me.units[*i].is_defeated()),
            };
            if let Some(i) = legal {
                me.active = i;
            }
        }
        self.status = TeamStatus::Active;
        self.round += 1;
    }

    pub fn winner(&self) -> Option<Side> {
        match self.status {
            TeamStatus::Finished { winner } => Some(winner),
            _ => None,
        }
    }
}

/// `legalTargets`: the limbs still standing, plus the core once an arm is off.
fn legal_targets(u: &Unit) -> impl Iterator<Item = Slot> + '_ {
    Slot::LIMBS
        .into_iter()
        .filter(move |s| !u.is_part_broken(*s))
        .chain(if u.can_attack_matrix() { Some(Slot::Matrix) } else { None })
}

/// `replayTeam`: two squads plus the rounds determine exactly one winner.
///
/// A round arriving while a substitution is owed IS the substitution, same as
/// the TypeScript: the switch actions in it are the picks.
pub fn replay_team(
    p1: &[Build; TEAM_SIZE],
    p2: &[Build; TEAM_SIZE],
    seed: u32,
    invert_ties: bool,
    rounds: &[(Option<TeamAction>, Option<TeamAction>)],
) -> Result<TeamBattle, BuildError> {
    let mut b = TeamBattle::new(p1, p2, seed, invert_ties)?;
    for (a, d) in rounds {
        if matches!(b.status, TeamStatus::AwaitingSwitch { .. }) {
            let pick = |x: &Option<TeamAction>| match x {
                Some(TeamAction::Switch { to }) => Some(*to),
                _ => None,
            };
            b.resolve_forced_switches(pick(a), pick(d));
            continue;
        }
        b.resolve_round(*a, *d);
    }
    Ok(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_code_byte_round_trips() {
        // "M01" is byte 0, "RA03" is byte 2: the number is the code's own.
        assert_eq!(code_from_byte("M", 0), Some("M01"));
        assert_eq!(code_from_byte("RA", 2), Some("RA03"));
        assert_eq!(code_from_byte("IN", 0).map(|c| &c[..2]), Some("IN"));
        assert_eq!(code_from_byte("M", 200), None);
    }
}

// ── The wire format ───────────────────────────────────────────────────────

/// A source slot, as `encodeAction` numbers them.
///
/// THE TWO ORDERS ARE NOT THE SAME. A source is numbered
/// [rightArm, leftArm, lowerBody, matrix] and a target is
/// [matrix, rightArm, leftArm, lowerBody]. Getting that backwards yields a
/// decoder that is right about the matrix and silently swaps the arms, which
/// is the kind of wrong that settles matches the wrong way for weeks.
fn source_slot(i: u8) -> Option<Slot> {
    match i {
        0 => Some(Slot::RightArm),
        1 => Some(Slot::LeftArm),
        2 => Some(Slot::LowerBody),
        3 => Some(Slot::Matrix),
        _ => None,
    }
}

/// A target slot, as `encodeAction` numbers them. See above.
fn target_slot(i: u8) -> Option<Slot> {
    match i {
        0 => Some(Slot::Matrix),
        1 => Some(Slot::RightArm),
        2 => Some(Slot::LeftArm),
        3 => Some(Slot::LowerBody),
        _ => None,
    }
}

/// `decodeAction`: the two bytes a reveal carries, back into an action.
///
/// `Ok(None)` is a side that did nothing, which is a legal round: a mech with
/// no standing limb and a sealed opponent has nothing to send. `Err` is a
/// malformed kind, which a settlement must refuse rather than guess at.
pub fn decode_action(bytes: &[u8; 2]) -> Result<Option<TeamAction>, BuildError> {
    match bytes[0] {
        0 => Ok(None),
        1 => {
            let b = bytes[1];
            let source = source_slot(b & 0b11).ok_or(BuildError::UnknownPart)?;
            let target = target_slot((b >> 4) & 0b11).ok_or(BuildError::UnknownPart)?;
            Ok(Some(TeamAction::Move {
                source,
                move_index: ((b >> 2) & 0b11) as usize,
                target,
            }))
        }
        2 => Ok(Some(TeamAction::Switch { to: bytes[1] as usize })),
        _ => Err(BuildError::UnknownPart),
    }
}
