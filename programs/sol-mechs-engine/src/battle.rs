//! The reducer, ported from `BattleEngine.ts`.
//!
//! Every function here has a counterpart over there and is named after it.
//! Where the two disagree, this one is wrong: the TypeScript engine is what
//! has been played and balanced, and the vectors in `vectors.rs` are its
//! testimony.
//!
//! What is NOT ported, on purpose: the events. `BattleEvent` is how a screen
//! narrates a round, and a program has no screen. Dropping them takes roughly
//! a third of the file with them and removes a whole class of divergence that
//! could never affect a result.

use crate::{
    js_round, matrix, part, tie_break, DamageType, Matrix, Move, Part, Slot, Stat, Stats,
    TargetType,
};

/// Stage ladder, indexed by `stage + 6` so [-6..=6] maps to [0..=12].
/// Verbatim from STAGE_MULTIPLIERS. The positive half climbs linearly, which
/// is not how Pokemon does it and is deliberate.
const STAGE_MULTIPLIERS: [f64; 13] = [
    0.25, 0.2857, 0.3333, 0.4, 0.5, 0.6667, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0,
];

const MIN_STAGE: i32 = -6;
const MAX_STAGE: i32 = 6;

/// Damage tuning. Consensus data: every one of these is in the hash of a
/// settled match, so moving one is a rebalance AND a redeploy.
pub const DAMAGE_SCALE: f64 = 0.65;
pub const MIN_MULTIPLIER: f64 = 0.35;
pub const MAX_MULTIPLIER: f64 = 1.75;
pub const MIN_DAMAGE: i32 = 1;
/// What fraction of its stats a DESTROYED limb still contributes. Not zero,
/// and the reason is balance rather than realism: at zero, offence compounds
/// and defence does not.
pub const WRECKED_STAT_RETENTION: f64 = 0.5;

/// Which of the two sides. `P1` is whoever the room calls p1.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Side {
    P1,
    P2,
}

impl Side {
    pub fn other(self) -> Side {
        match self {
            Side::P1 => Side::P2,
            Side::P2 => Side::P1,
        }
    }
}

/// A build, as the four catalog codes that make it.
#[derive(Clone, Copy, Debug)]
pub struct Build {
    pub matrix: &'static str,
    pub right_arm: &'static str,
    pub left_arm: &'static str,
    pub lower_body: &'static str,
}

/// Per-slot runtime state: hit points, and the five stages.
#[derive(Clone, Copy, Debug, Default)]
pub struct PartStatus {
    pub max_hp: i32,
    pub current_hp: i32,
    /// Stages in Stat order: ATK, DEF, ENG, SPD, SYS.
    pub stages: [i32; 5],
}

fn stat_index(s: Stat) -> usize {
    match s {
        Stat::ATK => 0,
        Stat::DEF => 1,
        Stat::ENG => 2,
        Stat::SPD => 3,
        Stat::SYS => 4,
    }
}

fn slot_index(s: Slot) -> usize {
    match s {
        Slot::RightArm => 0,
        Slot::LeftArm => 1,
        Slot::LowerBody => 2,
        Slot::Matrix => 3,
    }
}

/// One assembled mech mid-battle.
#[derive(Clone, Copy, Debug)]
pub struct Unit {
    pub matrix: &'static Matrix,
    /// Right arm, left arm, lower body. The matrix is not a part.
    pub parts: [&'static Part; 3],
    /// Indexed by `slot_index`, so the matrix is the fourth.
    pub statuses: [PartStatus; 4],
    pub matrix_hp: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DefeatCause {
    MatrixDestroyed,
    LimbsDestroyed,
}

/// Why a build would not assemble. A match that cannot be built cannot be
/// settled, and the program has to say which half was wrong.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BuildError {
    UnknownMatrix,
    UnknownPart,
    WrongSlot,
}

/// `createUnit`.
pub fn create_unit(build: &Build) -> Result<Unit, BuildError> {
    let m = matrix(build.matrix).ok_or(BuildError::UnknownMatrix)?;
    let want = [
        (build.right_arm, Slot::RightArm),
        (build.left_arm, Slot::LeftArm),
        (build.lower_body, Slot::LowerBody),
    ];
    let mut parts: [&'static Part; 3] = [part(want[0].0).ok_or(BuildError::UnknownPart)?; 3];
    for (i, (code, slot)) in want.iter().enumerate() {
        let p = part(code).ok_or(BuildError::UnknownPart)?;
        if p.slot != *slot {
            return Err(BuildError::WrongSlot);
        }
        parts[i] = p;
    }

    let mut statuses = [PartStatus::default(); 4];
    for (i, p) in parts.iter().enumerate() {
        statuses[i] = PartStatus { max_hp: p.stats.hp, current_hp: p.stats.hp, stages: [0; 5] };
    }
    statuses[3] = PartStatus { max_hp: m.base.hp, current_hp: m.base.hp, stages: [0; 5] };

    Ok(Unit { matrix: m, parts, statuses, matrix_hp: m.base.hp })
}

impl Unit {
    /// `isPartBroken`.
    pub fn is_part_broken(&self, slot: Slot) -> bool {
        self.statuses[slot_index(slot)].current_hp <= 0
    }

    /// `canAttackMatrix`. ARMS ONLY: taking the legs does not open the core.
    pub fn can_attack_matrix(&self) -> bool {
        self.is_part_broken(Slot::RightArm) || self.is_part_broken(Slot::LeftArm)
    }

    /// `allLimbsDestroyed`.
    pub fn all_limbs_destroyed(&self) -> bool {
        Slot::LIMBS.iter().all(|s| self.is_part_broken(*s))
    }

    /// `defeatCauseOf`. Order matters: the matrix is checked first.
    pub fn defeat_cause(&self) -> Option<DefeatCause> {
        if self.matrix_hp <= 0 {
            Some(DefeatCause::MatrixDestroyed)
        } else if self.all_limbs_destroyed() {
            Some(DefeatCause::LimbsDestroyed)
        } else {
            None
        }
    }

    pub fn is_defeated(&self) -> bool {
        self.defeat_cause().is_some()
    }

    /// `getStage`.
    pub fn stage(&self, slot: Slot, stat: Stat) -> i32 {
        self.statuses[slot_index(slot)].stages[stat_index(stat)]
    }

    /// `movesOf`. The matrix carries the chassis' own self-buff.
    pub fn moves_of(&self, slot: Slot) -> &'static [Move] {
        match slot {
            Slot::Matrix => self.matrix.moves,
            _ => self.parts[slot_index(slot)].moves,
        }
    }

    /// `effectiveStats`: the chassis plus the limbs, a wrecked one at half.
    ///
    /// `js_round` and not `f64::round`. The share is 0.5, so this rounds
    /// halves constantly, and the two functions disagree on exactly those.
    pub fn effective_stats(&self) -> Stats {
        let mut stats = self.matrix.base;
        for slot in Slot::LIMBS {
            let share = if self.is_part_broken(slot) { WRECKED_STAT_RETENTION } else { 1.0 };
            let m = self.parts[slot_index(slot)].stats;
            stats = Stats {
                hp: stats.hp + js_round(m.hp as f64 * share) as i32,
                atk: stats.atk + js_round(m.atk as f64 * share) as i32,
                def: stats.def + js_round(m.def as f64 * share) as i32,
                eng: stats.eng + js_round(m.eng as f64 * share) as i32,
                spd: stats.spd + js_round(m.spd as f64 * share) as i32,
                sys: stats.sys + js_round(m.sys as f64 * share) as i32,
                proc_: stats.proc_ + js_round(m.proc_ as f64 * share) as i32,
            };
        }
        stats
    }
}

fn stage_multiplier(stage: i32) -> f64 {
    STAGE_MULTIPLIERS[(stage.clamp(MIN_STAGE, MAX_STAGE) + 6) as usize]
}

/// `calculateDamage`.
///
/// The order of operations is the order over there, because floating point is
/// not associative: `base * multiplier * SCALE` is not always
/// `base * (multiplier * SCALE)`.
pub fn calculate_damage(
    mv: &Move,
    attacker: &Unit,
    defender: &Unit,
    source: Slot,
    target: Slot,
) -> i32 {
    if mv.base_damage <= 0 {
        return 0;
    }
    let physical = mv.damage_type == DamageType::Physical;
    let (atk_stat, def_stat) = if physical {
        (Stat::ATK, Stat::DEF)
    } else {
        (Stat::ENG, Stat::SYS)
    };

    // max(1, ...) guards a stripped mech at -6 rounding a stat to nothing,
    // which would divide by zero.
    let atk = (attacker.effective_stats().get(atk_stat) as f64
        * stage_multiplier(attacker.stage(source, atk_stat)))
    .max(1.0);
    let def = (defender.effective_stats().get(def_stat) as f64
        * stage_multiplier(defender.stage(target, def_stat)))
    .max(1.0);

    let multiplier = ((2.0 * atk) / (atk + def)).clamp(MIN_MULTIPLIER, MAX_MULTIPLIER);
    let raw = (mv.base_damage as f64 * multiplier * DAMAGE_SCALE).floor() as i32;
    raw.max(MIN_DAMAGE)
}

/// `validateMove`. `None` when the move is legal.
pub fn validate_move(
    attacker: &Unit,
    defender: &Unit,
    source: Slot,
    move_index: usize,
    target: Slot,
) -> Option<&'static str> {
    if attacker.is_part_broken(source) {
        return Some("source is broken");
    }
    let mv = match attacker.moves_of(source).get(move_index) {
        Some(m) => m,
        None => return Some("no such move"),
    };
    if mv.target_type == TargetType::Own {
        if target != Slot::Matrix && attacker.is_part_broken(target) {
            return Some("target is broken");
        }
        return None;
    }
    if target == Slot::Matrix && !defender.can_attack_matrix() {
        return Some("matrix locked, destroy an arm first");
    }
    if target != Slot::Matrix && defender.is_part_broken(target) {
        return Some("that part is already destroyed");
    }
    None
}

/// `applyMove`, minus the events. Mutates both units.
pub fn apply_move(
    attacker: &mut Unit,
    defender: &mut Unit,
    source: Slot,
    move_index: usize,
    target: Slot,
) {
    let mv = attacker.moves_of(source)[move_index];
    let self_targeted = mv.target_type == TargetType::Own;

    if !self_targeted && mv.base_damage > 0 {
        let amount = calculate_damage(&mv, attacker, defender, source, target);
        let st = &mut defender.statuses[slot_index(target)];
        st.current_hp = (st.current_hp - amount).max(0);
        if target == Slot::Matrix {
            defender.matrix_hp = st.current_hp;
        }
    }

    // The rider and the heal land on the TARGET SLOT of whichever unit is
    // being targeted, which for a self-buff is the attacker's own slot.
    let unit: &mut Unit = if self_targeted { attacker } else { defender };

    if mv.heal > 0 {
        let st = &mut unit.statuses[slot_index(target)];
        st.current_hp = (st.current_hp + mv.heal).min(st.max_hp);
        if target == Slot::Matrix {
            unit.matrix_hp = unit.statuses[slot_index(target)].current_hp;
        }
    }

    for m in mv.mods {
        let st = &mut unit.statuses[slot_index(target)];
        let i = stat_index(m.stat);
        st.stages[i] = (st.stages[i] + m.amount).clamp(MIN_STAGE, MAX_STAGE);
    }
}

/// One side's committed action for a round.
#[derive(Clone, Copy, Debug)]
pub struct Action {
    pub source: Slot,
    pub move_index: usize,
    pub target: Slot,
}

/// The battle, as the program holds it.
#[derive(Clone, Copy, Debug)]
pub struct Battle {
    pub p1: Unit,
    pub p2: Unit,
    pub round: u32,
    pub seed: u32,
    pub winner: Option<Side>,
    pub finished: bool,
}

impl Battle {
    pub fn new(p1: &Build, p2: &Build, seed: u32) -> Result<Battle, BuildError> {
        Ok(Battle {
            p1: create_unit(p1)?,
            p2: create_unit(p2)?,
            round: 1,
            seed,
            winner: None,
            finished: false,
        })
    }

    fn unit(&self, side: Side) -> &Unit {
        match side {
            Side::P1 => &self.p1,
            Side::P2 => &self.p2,
        }
    }

    /// `orderOfPlay`. Higher SURVIVING speed first; a tie is the seeded flip,
    /// not an alternation, so going first cannot be planned around.
    pub fn order_of_play(&self) -> [Side; 2] {
        let s1 = self.p1.effective_stats().spd;
        let s2 = self.p2.effective_stats().spd;
        if s1 != s2 {
            return if s1 > s2 { [Side::P1, Side::P2] } else { [Side::P2, Side::P1] };
        }
        if tie_break(self.seed, self.round) {
            [Side::P1, Side::P2]
        } else {
            [Side::P2, Side::P1]
        }
    }

    /// `resolveRound`. Both sides committed; they play out in speed order.
    ///
    /// Legality is judged WHEN A SIDE ACTS, not when it committed. That is
    /// what makes stripping a limb worth doing: take the arm the slower mech
    /// was going to swing with and the swing does not happen.
    pub fn resolve_round(&mut self, p1: Action, p2: Action) {
        if self.finished {
            return;
        }
        let order = self.order_of_play();
        for side in order {
            let action = match side {
                Side::P1 => p1,
                Side::P2 => p2,
            };
            if self.unit(side).is_defeated() {
                continue;
            }
            let (actor, foe) = match side {
                Side::P1 => (self.p1, self.p2),
                Side::P2 => (self.p2, self.p1),
            };
            if validate_move(&actor, &foe, action.source, action.move_index, action.target)
                .is_some()
            {
                continue;
            }
            // Disjoint fields, so the borrow checker allows both at once.
            // No clone of the battle and no unsafe: `self.p1` and `self.p2`
            // are different places and Rust can see that.
            let (a, d) = match side {
                Side::P1 => {
                    let (x, y) = (&mut self.p1, &mut self.p2);
                    (x, y)
                }
                Side::P2 => {
                    let (x, y) = (&mut self.p2, &mut self.p1);
                    (x, y)
                }
            };
            apply_move(a, d, action.source, action.move_index, action.target);
        }

        // A double knockout resolves to the mech still standing when it acted,
        // so the faster one wins the trade. The only reading consistent with
        // resolving in speed order.
        // No Vec: two sides, so counting them is two bools. A program pays
        // for an allocation and there is nothing here to allocate for.
        let p1_down = self.p1.is_defeated();
        let p2_down = self.p2.is_defeated();
        if p1_down || p2_down {
            let loser = if p1_down && p2_down {
                order[1]
            } else if p1_down {
                Side::P1
            } else {
                Side::P2
            };
            self.winner = Some(loser.other());
            self.finished = true;
            return;
        }
        self.round += 1;
    }
}

/// `replay`: both builds plus the ordered rounds determine exactly one winner.
///
/// This is the function a settlement calls. `None` for the winner means the
/// rounds ran out with both mechs standing, which is not a result: the room
/// settles that from the clock, the way a forfeit is settled.
pub fn replay(
    p1: &Build,
    p2: &Build,
    seed: u32,
    rounds: &[(Action, Action)],
) -> Result<Battle, BuildError> {
    let mut b = Battle::new(p1, p2, seed)?;
    for (a, d) in rounds {
        b.resolve_round(*a, *d);
    }
    Ok(b)
}
