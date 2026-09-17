//! Sol Mechs — PvP, friendly duels and the season ladder.
//!
//! Three layers, deliberately split by what each one needs:
//!
//! * **Rollup (MagicBlock ER), session-key signed** — the `Duelist` account:
//!   lobby pairing, friendly challenges, and the commit–reveal exchange of one
//!   action per player per step. This is the part that needs sub-second writes.
//! * **Base layer, wallet signed** — the season ladder: `Season`, `LadderEntry`
//!   (rating + energy), `MatchQueue` (rating-based matchmaking), `MatchRoom`
//!   (one ranked pairing) and `PrizePool`. Queueing and settling happen once
//!   per match, so base latency is fine and the money never touches the rollup.
//! * **Neither** — combat itself. Both clients run the same deterministic
//!   engine (apps/web/src/game/solmechs/engine) over the revealed actions.
//!   A ranked result becomes official when BOTH players report the same
//!   outcome; a disagreement parks the room as disputed for the season admin,
//!   and silence past the timeout hands it to the player who did report.
//!   Every action is on-chain, so a later program can replay and verify.
//!
//! Lifecycle:
//!   base, wallet-signed, once per wallet    init_duelist + delegate_duelist
//!   base, once ever (any payer)             init_lobby + delegate_lobby
//!   rollup, session-key signed              search_match | pair_match,
//!                                           challenge | accept_challenge |
//!                                           decline_challenge, pair_ranked,
//!                                           commit_step, reveal_step,
//!                                           leave_match
//!   rollup, wallet-signed                   set_session (key rotated)
//!   base, admin                             init_season, init_prize_pool,
//!                                           resolve_dispute, payout
//!   base, wallet-signed                     init_ladder_entry, join_queue,
//!                                           cancel_queue, pair_from_queue,
//!                                           report_result, force_settle,
//!                                           buy_energy_pack, fund_pool
//!
//! Delegation is a hand-rolled CPI into the delegation program, the same one
//! `sol-city` uses in production, so this crate depends on nothing but
//! anchor-lang.
//!
//! CONSTANTS: the blocks below mirror `apps/web/src/game/solmechs/season/
//! config.ts`. The program is authoritative for rating and energy; the client
//! copy exists for previews ("you will gain ~12") and the simulator. Keep them
//! in step anyway, or the preview lies.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    hash::hashv,
    instruction::{AccountMeta as SolAccountMeta, Instruction as SolInstruction},
    program::invoke_signed,
    program_memory::sol_memset,
    pubkey,
    rent::Rent as SolanaRent,
    system_instruction,
    sysvar::Sysvar as SolanaSysvar,
};

// The program keypair lives with the game wallet (Burners/SolanaCity/
// sol-mechs-program.json); import it in Playground so this id stays fixed.
declare_id!("6sv4G2HuFdrcAFBRA2X4jTSRmZj2MJS5t66zRUqy5vxJ");

pub const DUELIST_SEED: &[u8] = b"mech_duelist";
pub const LOBBY_SEED: &[u8] = b"mech_lobby";
pub const BUFFER_SEED: &[u8] = b"buffer";
pub const SEASON_SEED: &[u8] = b"mech_season";
pub const ENTRY_SEED: &[u8] = b"mech_entry";
pub const QUEUE_SEED: &[u8] = b"mech_queue";
pub const ROOM_SEED: &[u8] = b"mech_room";
pub const POOL_SEED: &[u8] = b"mech_pool";

/// MagicBlock delegation program on devnet.
pub const DELEGATION_PROGRAM_ID: Pubkey =
    pubkey!("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

/// Metaplex Core — the season pass is a Core asset in a collection.
pub const MPL_CORE_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

/// A lobby slot older than this is abandoned and may be taken over. A
/// searching client re-sends `search_match` well inside it.
pub const LOBBY_TTL_SECS: i64 = 30;

/// A friendly challenge the other player never answered expires after this.
pub const CHALLENGE_TTL_SECS: i64 = 120;

/// After this, a ranked room with one silent side can be settled by the other.
pub const ROOM_TIMEOUT_SECS: i64 = 900;

pub const STATUS_IDLE: u8 = 0;
pub const STATUS_SEARCHING: u8 = 1;
pub const STATUS_MATCHED: u8 = 2;

/// `Duelist.mode` — how the current match was started.
pub const MODE_CASUAL: u8 = 0;
pub const MODE_RANKED: u8 = 1;
pub const MODE_FRIENDLY: u8 = 2;

/// `action_step` before the first reveal of a match.
pub const NO_REVEAL: u16 = u16::MAX;

/// `MatchRoom` status.
pub const ROOM_ACTIVE: u8 = 0;
pub const ROOM_SETTLED: u8 = 1;
pub const ROOM_DISPUTED: u8 = 2;

/// `MatchRoom` claims.
pub const CLAIM_NONE: u8 = 0;
pub const CLAIM_WIN: u8 = 1;
pub const CLAIM_LOSS: u8 = 2;

// ── Season constants (mirror season/config.ts) ────────────────────────────

pub const ENERGY_DAILY_FREE: u8 = 5;
pub const ENERGY_MAX_BANKED: u8 = 10;
pub const ENERGY_COST_PER_MATCH: u8 = 1;
pub const ENERGY_PACK_SIZE: u8 = 5;
pub const ENERGY_PACK_PRICE_LAMPORTS: u64 = 50_000_000; // 0.05 SOL, about $5
pub const ENERGY_PACKS_PER_DAY: u8 = 1;
/// Share of an energy purchase that goes to the prize pool, in percent.
pub const POOL_SHARE_OF_ENERGY_PCT: u64 = 30;

pub const RATING_START: i32 = 1_000;
pub const RATING_FLOOR: i32 = 100;
pub const K_PROVISIONAL: i64 = 48;
pub const PROVISIONAL_MATCHES: u32 = 10;
pub const K_ESTABLISHED: i64 = 24;
pub const K_TIGHTEN_ABOVE: i32 = 1_600;
pub const K_TIGHT: i64 = 12;

pub const RECENT: usize = 16;
pub const QUEUE_CAP: usize = 64;
pub const BASE_TOLERANCE: i64 = 100;
pub const WIDEN_PER_SECOND: i64 = 25;
pub const MAX_TOLERANCE: i64 = 600;
pub const REMATCH_PENALTY: i64 = 400;
pub const MAX_WAIT_SECS: i64 = 90;

/// Fixed-point scale for the rating math (10_000 = 1.0).
pub const SCALE: i64 = 10_000;

#[error_code]
pub enum MechError {
    #[msg("Session key does not match this duelist")]
    InvalidSession,
    #[msg("Wrong authority for this duelist")]
    InvalidAuthority,
    #[msg("Another duelist is waiting — pair with them instead")]
    OpponentWaiting,
    #[msg("Nobody is waiting in the lobby")]
    NobodyWaiting,
    #[msg("Cannot pair with yourself")]
    SelfPair,
    #[msg("Duelist is not in a match")]
    NotInMatch,
    #[msg("Duelist is already in a match")]
    Busy,
    #[msg("Wrong step")]
    WrongStep,
    #[msg("Already committed for this step")]
    AlreadyCommitted,
    #[msg("Opponent has not committed this step yet")]
    OpponentNotCommitted,
    #[msg("Opponent has not revealed the previous step yet")]
    OpponentBehind,
    #[msg("Nothing committed to reveal")]
    NothingCommitted,
    #[msg("Reveal does not match the commitment")]
    BadReveal,
    #[msg("Duelists are not in the same match")]
    MatchMismatch,
    #[msg("No challenge from this player")]
    NoChallenge,
    #[msg("The challenge expired")]
    ChallengeExpired,
    #[msg("The season is not open")]
    SeasonClosed,
    #[msg("This entry belongs to another season")]
    WrongSeason,
    #[msg("Not enough energy")]
    NoEnergy,
    #[msg("No energy packs left today")]
    PackLimit,
    #[msg("Already in the ranked queue")]
    AlreadyQueued,
    #[msg("Not in the ranked queue")]
    NotQueued,
    #[msg("The ranked queue is full")]
    QueueFull,
    #[msg("Finish your current ranked match first")]
    InRankedMatch,
    #[msg("That opponent is not the pairing the queue offers")]
    NotBestPairing,
    #[msg("No acceptable opponent yet")]
    NoPairing,
    #[msg("This room is already settled")]
    RoomClosed,
    #[msg("You are not in this room")]
    NotYourRoom,
    #[msg("Already reported this match")]
    AlreadyReported,
    #[msg("The opponent still has time to report")]
    TooEarly,
    #[msg("The room is not disputed")]
    NotDisputed,
    #[msg("Season admin only")]
    NotAdmin,
    #[msg("A current season pass is required")]
    NoPass,
    #[msg("The prize pool cannot cover that payout")]
    PoolTooSmall,
}

#[program]
pub mod sol_mechs {
    use super::*;

    // ── Base layer: setup ─────────────────────────────────────────────────

    pub fn init_duelist(ctx: Context<InitDuelist>, session: Pubkey, name: [u8; 20]) -> Result<()> {
        let d = &mut ctx.accounts.duelist;
        d.authority = ctx.accounts.authority.key();
        d.session = session;
        d.name = name;
        d.status = STATUS_IDLE;
        d.action_step = NO_REVEAL;
        d.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn delegate_duelist(ctx: Context<DelegateDuelist>) -> Result<()> {
        let authority_key = ctx.accounts.authority.key();
        {
            let data = ctx.accounts.duelist.try_borrow_data()?;
            require!(data.len() >= 8 + 32, MechError::InvalidAuthority);
            let stored: [u8; 32] = data[8..40].try_into().unwrap();
            require_keys_eq!(Pubkey::from(stored), authority_key, MechError::InvalidAuthority);
        }
        let bump = ctx.bumps.duelist;
        delegate_pda(
            &ctx.accounts.authority.to_account_info(),
            &ctx.accounts.duelist.to_account_info(),
            &ctx.accounts.owner_program.to_account_info(),
            &ctx.accounts.delegate_buffer.to_account_info(),
            &ctx.accounts.delegation_record.to_account_info(),
            &ctx.accounts.delegation_metadata.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            &[DUELIST_SEED, authority_key.as_ref()],
            bump,
        )
    }

    pub fn init_lobby(ctx: Context<InitLobby>) -> Result<()> {
        let lobby = &mut ctx.accounts.lobby;
        lobby.waiting = Pubkey::default();
        lobby.waiting_since = 0;
        lobby.next_match_id = 1;
        Ok(())
    }

    pub fn delegate_lobby(ctx: Context<DelegateLobby>) -> Result<()> {
        let bump = ctx.bumps.lobby;
        delegate_pda(
            &ctx.accounts.payer.to_account_info(),
            &ctx.accounts.lobby.to_account_info(),
            &ctx.accounts.owner_program.to_account_info(),
            &ctx.accounts.delegate_buffer.to_account_info(),
            &ctx.accounts.delegation_record.to_account_info(),
            &ctx.accounts.delegation_metadata.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            &[LOBBY_SEED],
            bump,
        )
    }

    // ── Rollup: casual lobby ──────────────────────────────────────────────

    /// Points the duelist at a new session key. Wallet-signed, on the rollup.
    pub fn set_session(ctx: Context<SetSession>, session: Pubkey) -> Result<()> {
        let d = &mut ctx.accounts.duelist;
        d.session = session;
        d.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Takes the lobby slot, or refreshes it. Fails with `OpponentWaiting`
    /// when someone else holds a fresh slot — the client then pairs instead.
    pub fn search_match(ctx: Context<LobbyAction>, team: [u8; 12]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let lobby = &mut ctx.accounts.lobby;
        let me = &mut ctx.accounts.duelist;
        require!(me.status != STATUS_MATCHED, MechError::Busy);

        let free = lobby.waiting == Pubkey::default()
            || lobby.waiting == me.authority
            || now - lobby.waiting_since >= LOBBY_TTL_SECS;
        require!(free, MechError::OpponentWaiting);

        lobby.waiting = me.authority;
        lobby.waiting_since = now;
        me.status = STATUS_SEARCHING;
        me.team = team;
        me.updated_at = now;
        Ok(())
    }

    /// Pairs the caller with whoever holds the lobby slot. The slot holder is
    /// the host (role 0), the caller the guest (role 1).
    pub fn pair_match(ctx: Context<PairMatch>, team: [u8; 12]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let lobby = &mut ctx.accounts.lobby;
        let me = &mut ctx.accounts.duelist;
        let host = &mut ctx.accounts.host;

        require!(host.authority != me.authority, MechError::SelfPair);
        require!(
            lobby.waiting != Pubkey::default() && lobby.waiting == host.authority,
            MechError::NobodyWaiting
        );
        require!(now - lobby.waiting_since < LOBBY_TTL_SECS, MechError::NobodyWaiting);
        require!(host.status == STATUS_SEARCHING, MechError::NobodyWaiting);
        require!(me.status != STATUS_MATCHED, MechError::Busy);

        let match_id = lobby.next_match_id;
        lobby.next_match_id = match_id.wrapping_add(1);
        lobby.waiting = Pubkey::default();
        lobby.waiting_since = 0;

        let host_key = host.authority;
        let me_key = me.authority;
        me.team = team;
        start_match(&mut **host, me_key, match_id, 0, MODE_CASUAL, now);
        start_match(&mut **me, host_key, match_id, 1, MODE_CASUAL, now);
        Ok(())
    }

    // ── Rollup: friendly duels ────────────────────────────────────────────

    /// Invites another player to a friendly duel. Writes a one-slot mailbox on
    /// the target's duelist: the newest challenge replaces any older one, and
    /// it expires by itself after `CHALLENGE_TTL_SECS`.
    ///
    /// The target must already have a duelist account (they have played PvP at
    /// least once). Nothing is at stake and no rating moves.
    pub fn challenge(ctx: Context<Challenge>, team: [u8; 12]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let me = &mut ctx.accounts.duelist;
        require!(me.status != STATUS_MATCHED, MechError::Busy);
        let me_key = me.authority;
        me.team = team;
        me.updated_at = now;

        let target = &mut ctx.accounts.target;
        require!(target.authority != me_key, MechError::SelfPair);
        target.challenger = me_key;
        target.challenge_at = now;
        Ok(())
    }

    /// Accepts the standing challenge. The challenger is the host (role 0),
    /// so the speed-tie rule matches a lobby match exactly.
    pub fn accept_challenge(ctx: Context<AcceptChallenge>, team: [u8; 12]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let lobby = &mut ctx.accounts.lobby;
        let me = &mut ctx.accounts.duelist;
        let challenger = &mut ctx.accounts.challenger;

        require!(me.challenger == challenger.authority, MechError::NoChallenge);
        require!(now - me.challenge_at < CHALLENGE_TTL_SECS, MechError::ChallengeExpired);
        require!(me.status != STATUS_MATCHED, MechError::Busy);
        require!(challenger.status != STATUS_MATCHED, MechError::Busy);

        let match_id = lobby.next_match_id;
        lobby.next_match_id = match_id.wrapping_add(1);
        if lobby.waiting == me.authority || lobby.waiting == challenger.authority {
            lobby.waiting = Pubkey::default();
            lobby.waiting_since = 0;
        }

        let me_key = me.authority;
        let challenger_key = challenger.authority;
        me.team = team;
        me.challenger = Pubkey::default();
        me.challenge_at = 0;
        start_match(&mut **challenger, me_key, match_id, 0, MODE_FRIENDLY, now);
        start_match(&mut **me, challenger_key, match_id, 1, MODE_FRIENDLY, now);
        Ok(())
    }

    /// Clears the standing challenge (declined, or already answered).
    pub fn decline_challenge(ctx: Context<DuelistOnly>) -> Result<()> {
        let me = &mut ctx.accounts.duelist;
        me.challenger = Pubkey::default();
        me.challenge_at = 0;
        me.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Starts the rollup side of a ranked match that `pair_from_queue` already
    /// opened on the base layer. Either player may call it; the second call is
    /// a no-op rather than an error, since both clients race to send it.
    ///
    /// Host is the lower authority key, so both sides agree without a round
    /// trip. Forging a `room_id` here gains nothing: ratings only ever move
    /// through the base-layer room, which this cannot touch.
    pub fn pair_ranked(ctx: Context<PairRanked>, room_id: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let me = &mut ctx.accounts.duelist;
        let opponent = &mut ctx.accounts.opponent;
        require!(me.authority != opponent.authority, MechError::SelfPair);

        let already = me.status == STATUS_MATCHED
            && me.match_id == room_id
            && me.opponent == opponent.authority;
        if already {
            return Ok(());
        }
        require!(me.status != STATUS_MATCHED, MechError::Busy);
        require!(opponent.status != STATUS_MATCHED, MechError::Busy);

        let me_key = me.authority;
        let opp_key = opponent.authority;
        let me_hosts = me_key.to_bytes() < opp_key.to_bytes();
        start_match(
            &mut **me,
            opp_key,
            room_id,
            if me_hosts { 0 } else { 1 },
            MODE_RANKED,
            now,
        );
        start_match(
            &mut **opponent,
            me_key,
            room_id,
            if me_hosts { 1 } else { 0 },
            MODE_RANKED,
            now,
        );
        Ok(())
    }

    // ── Rollup: the exchange ──────────────────────────────────────────────

    /// Commits `hash(match_id, step, action, salt)` for a step.
    ///
    /// Moving on to the next step requires having revealed this one, and the
    /// opponent having revealed it too — so neither side can run ahead.
    pub fn commit_step(ctx: Context<Exchange>, step: u16, commitment: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let opp = &ctx.accounts.opponent;
        let me = &mut ctx.accounts.duelist;
        require!(me.status == STATUS_MATCHED, MechError::NotInMatch);
        require!(same_match(&**me, &**opp), MechError::MatchMismatch);

        if me.committed {
            require!(me.revealed, MechError::AlreadyCommitted);
            require!(step == me.step.wrapping_add(1), MechError::WrongStep);
            require!(
                opp.action_step == me.step || opp.step > me.step,
                MechError::OpponentBehind
            );
        } else {
            require!(step == me.step, MechError::WrongStep);
        }

        me.step = step;
        me.committed = true;
        me.revealed = false;
        me.commitment = commitment;
        me.updated_at = now;
        Ok(())
    }

    /// Reveals a committed action. Only possible once BOTH sides have
    /// committed this step, which is what keeps the choice simultaneous.
    pub fn reveal_step(
        ctx: Context<Exchange>,
        step: u16,
        action: [u8; 2],
        salt: [u8; 32],
        check: u32,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let opp = &ctx.accounts.opponent;
        let me = &mut ctx.accounts.duelist;
        require!(
            me.status == STATUS_MATCHED && opp.status == STATUS_MATCHED,
            MechError::NotInMatch
        );
        require!(same_match(&**me, &**opp), MechError::MatchMismatch);
        require!(me.committed && !me.revealed, MechError::NothingCommitted);
        require!(step == me.step, MechError::WrongStep);
        require!(opp.committed && opp.step == step, MechError::OpponentNotCommitted);

        let match_id_bytes = me.match_id.to_le_bytes();
        let step_bytes = step.to_le_bytes();
        let digest = hashv(&[
            &match_id_bytes[..],
            &step_bytes[..],
            &action[..],
            &salt[..],
        ])
        .to_bytes();
        require!(digest == me.commitment, MechError::BadReveal);

        me.revealed = true;
        me.action_step = step;
        me.action = action;
        me.check = check;
        me.updated_at = now;
        Ok(())
    }

    /// Stops searching, or leaves / resigns a match. The opponent's client
    /// sees this duelist stop pointing at them and ends the match.
    pub fn leave_match(ctx: Context<LobbyAction>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let lobby = &mut ctx.accounts.lobby;
        let me = &mut ctx.accounts.duelist;
        if lobby.waiting == me.authority {
            lobby.waiting = Pubkey::default();
            lobby.waiting_since = 0;
        }
        me.status = STATUS_IDLE;
        me.opponent = Pubkey::default();
        me.committed = false;
        me.revealed = false;
        me.action_step = NO_REVEAL;
        me.updated_at = now;
        Ok(())
    }

    // ── Base layer: season ────────────────────────────────────────────────

    /// Opens a season. `pass_collection` is the Metaplex Core collection whose
    /// assets count as a pass; pass `require_pass = false` to run a season
    /// open to everyone (the devnet alpha).
    pub fn init_season(
        ctx: Context<InitSeason>,
        id: u16,
        starts_at: i64,
        ends_at: i64,
        pass_collection: Pubkey,
        require_pass: bool,
    ) -> Result<()> {
        require!(ends_at > starts_at, MechError::SeasonClosed);
        let s = &mut ctx.accounts.season;
        s.id = id;
        s.admin = ctx.accounts.admin.key();
        s.treasury = ctx.accounts.treasury.key();
        s.starts_at = starts_at;
        s.ends_at = ends_at;
        s.pass_collection = pass_collection;
        s.require_pass = require_pass;
        s.entrants = 0;
        s.next_room_id = 1;
        Ok(())
    }

    /// Creates the ranked queue. Separate from `init_season` because the queue
    /// is a zero-copy account: creating it beside another `init` in the same
    /// instruction made the runtime fail the whole thing with "Overlapping
    /// copy" once its 3KB of data was written back.
    pub fn init_queue(ctx: Context<InitQueue>) -> Result<()> {
        let mut q = ctx.accounts.queue.load_init()?;
        q.season = ctx.accounts.season.id;
        q.len = 0;
        Ok(())
    }

    /// The prize pool is a PDA that only holds lamports; keeping it separate
    /// from the season account means the pool figure is checkable on an
    /// explorer without decoding anything.
    pub fn init_prize_pool(ctx: Context<InitPrizePool>) -> Result<()> {
        let p = &mut ctx.accounts.pool;
        p.season = ctx.accounts.season.id;
        p.deposited = 0;
        p.paid_out = 0;
        Ok(())
    }

    /// Anyone can top the pool up (the pass sale sweeps its share here).
    pub fn fund_pool(ctx: Context<FundPool>, lamports: u64) -> Result<()> {
        transfer_lamports(
            &ctx.accounts.payer.to_account_info(),
            &ctx.accounts.pool.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            lamports,
        )?;
        let p = &mut ctx.accounts.pool;
        p.deposited = p.deposited.saturating_add(lamports);
        Ok(())
    }

    pub fn init_ladder_entry(ctx: Context<InitLadderEntry>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let season = &mut ctx.accounts.season;
        let e = &mut ctx.accounts.entry;
        e.authority = ctx.accounts.authority.key();
        e.season = season.id;
        e.rating = RATING_START;
        e.wins = 0;
        e.losses = 0;
        e.distinct_opponents = 0;
        e.recent = [Pubkey::default(); RECENT];
        e.recent_len = 0;
        e.energy = ENERGY_DAILY_FREE;
        e.energy_day = day_index(now);
        e.packs_today = 0;
        e.queued = false;
        e.room_id = 0;
        e.opponent = Pubkey::default();
        e.last_match_at = 0;
        season.entrants = season.entrants.saturating_add(1);
        Ok(())
    }

    /// Enters the ranked queue. Energy is spent HERE, not at pairing: the
    /// player who waits has already paid, so the pairing transaction only
    /// needs the caller's own accounts.
    pub fn join_queue(ctx: Context<JoinQueue>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let season = &ctx.accounts.season;
        require!(now >= season.starts_at && now < season.ends_at, MechError::SeasonClosed);

        if season.require_pass {
            let pass = ctx
                .accounts
                .pass_asset
                .as_ref()
                .ok_or(error!(MechError::NoPass))?;
            verify_pass(
                &pass.to_account_info(),
                &ctx.accounts.authority.key(),
                &season.pass_collection,
            )?;
        }

        let e = &mut ctx.accounts.entry;
        require!(e.season == season.id, MechError::WrongSeason);
        require!(!e.queued, MechError::AlreadyQueued);
        require!(e.room_id == 0, MechError::InRankedMatch);

        refill_energy(e, now);
        require!(e.energy >= ENERGY_COST_PER_MATCH, MechError::NoEnergy);
        e.energy -= ENERGY_COST_PER_MATCH;

        let mut q = ctx.accounts.queue.load_mut()?;
        require!((q.len as usize) < QUEUE_CAP, MechError::QueueFull);
        let slot = q.len as usize;
        q.tickets[slot] = Ticket {
            authority: e.authority,
            rating: e.rating,
            _pad: [0; 4],
            enqueued_at: now,
        };
        q.len += 1;
        e.queued = true;
        Ok(())
    }

    /// Leaves the queue and refunds the energy.
    pub fn cancel_queue(ctx: Context<CancelQueue>) -> Result<()> {
        let e = &mut ctx.accounts.entry;
        require!(e.queued, MechError::NotQueued);
        let mut q = ctx.accounts.queue.load_mut()?;
        remove_ticket(&mut q, &e.authority);
        e.queued = false;
        e.energy = (e.energy + ENERGY_COST_PER_MATCH).min(ENERGY_MAX_BANKED);
        Ok(())
    }

    /// Pairs the caller with `opponent`, but ONLY if the queue offers no
    /// cheaper pairing. That is the whole anti-collusion story: a player
    /// cannot choose who they face, because the program recomputes the best
    /// candidate and rejects anything else.
    ///
    /// Cost is `|rating gap| + REMATCH_PENALTY * meetings in the caller's
    /// recent window`, and it must sit under a tolerance that widens with the
    /// longer of the two waits.
    pub fn pair_from_queue(ctx: Context<PairFromQueue>, opponent: Pubkey) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let season_id = ctx.accounts.season.id;
        require!(now < ctx.accounts.season.ends_at, MechError::SeasonClosed);

        let me_key = ctx.accounts.authority.key();
        require!(me_key != opponent, MechError::SelfPair);
        require_keys_eq!(ctx.accounts.opponent_entry.authority, opponent, MechError::NotBestPairing);

        let (my_rating, my_recent, my_recent_len, my_wait_from) = {
            let e = &ctx.accounts.entry;
            require!(e.season == season_id, MechError::WrongSeason);
            require!(e.queued, MechError::NotQueued);
            require!(e.room_id == 0, MechError::InRankedMatch);
            let q = ctx.accounts.queue.load()?;
            let mine = find_ticket(&q, &me_key).ok_or(error!(MechError::NotQueued))?;
            (e.rating, e.recent, e.recent_len, q.tickets[mine].enqueued_at)
        };

        // Best candidate by cost, seen from the caller's history. Meetings are
        // symmetric, so the caller's own window is enough — no need to read
        // every queued player's account, which would never fit in one
        // transaction.
        let mut best_cost = i64::MAX;
        let queue_len = { ctx.accounts.queue.load()?.len as usize };
        for i in 0..queue_len {
            let t = { ctx.accounts.queue.load()?.tickets[i] };
            if t.authority == me_key {
                continue;
            }
            let meetings = count_recent(&my_recent, my_recent_len, &t.authority);
            let cost = (my_rating as i64 - t.rating as i64).abs()
                + REMATCH_PENALTY * meetings as i64;
            if cost < best_cost {
                best_cost = cost;
            }
        }
        require!(best_cost != i64::MAX, MechError::NoPairing);

        // Any candidate tied with the best is acceptable: the caller still
        // cannot steer the choice, and insisting on one exact key would make
        // ties unpairable.
        let chosen_wait_from = {
            let q = ctx.accounts.queue.load()?;
            let idx = find_ticket(&q, &opponent).ok_or(error!(MechError::NotBestPairing))?;
            let t = q.tickets[idx];
            let meetings = count_recent(&my_recent, my_recent_len, &t.authority);
            let cost = (my_rating as i64 - t.rating as i64).abs()
                + REMATCH_PENALTY * meetings as i64;
            require!(cost <= best_cost, MechError::NotBestPairing);
            t.enqueued_at
        };

        let waited = (now - my_wait_from).max(now - chosen_wait_from).max(0);
        if waited < MAX_WAIT_SECS {
            require!(best_cost <= tolerance(waited), MechError::NoPairing);
        }

        {
            let mut q = ctx.accounts.queue.load_mut()?;
            remove_ticket(&mut q, &me_key);
            remove_ticket(&mut q, &opponent);
        }

        let season = &mut ctx.accounts.season;
        let room_id = season.next_room_id;
        season.next_room_id = room_id.wrapping_add(1);

        let opp_entry = &mut ctx.accounts.opponent_entry;
        require!(opp_entry.season == season_id, MechError::WrongSeason);
        require!(opp_entry.queued, MechError::NotQueued);
        opp_entry.queued = false;
        opp_entry.room_id = room_id;
        opp_entry.opponent = me_key;

        let entry = &mut ctx.accounts.entry;
        entry.queued = false;
        entry.room_id = room_id;
        entry.opponent = opponent;

        let room = &mut ctx.accounts.room;
        room.season = season_id;
        room.id = room_id;
        room.p1 = me_key;
        room.p2 = opponent;
        room.opened_at = now;
        room.p1_claim = CLAIM_NONE;
        room.p2_claim = CLAIM_NONE;
        room.status = ROOM_ACTIVE;
        room.winner = Pubkey::default();
        Ok(())
    }

    /// Reports how the match ended. The result becomes official once both
    /// sides report the same thing; two "I won" reports park the room as
    /// disputed instead of moving any rating.
    pub fn report_result(ctx: Context<ReportResult>, won: bool) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let me_key = ctx.accounts.authority.key();
        let claim = if won { CLAIM_WIN } else { CLAIM_LOSS };

        let (is_p1, other_claim) = {
            let room = &ctx.accounts.room;
            require!(room.status == ROOM_ACTIVE, MechError::RoomClosed);
            if room.p1 == me_key {
                (true, room.p2_claim)
            } else if room.p2 == me_key {
                (false, room.p1_claim)
            } else {
                return err!(MechError::NotYourRoom);
            }
        };

        {
            let room = &mut ctx.accounts.room;
            let mine = if is_p1 { room.p1_claim } else { room.p2_claim };
            require!(mine == CLAIM_NONE, MechError::AlreadyReported);
            if is_p1 {
                room.p1_claim = claim;
            } else {
                room.p2_claim = claim;
            }
        }

        if other_claim == CLAIM_NONE {
            return Ok(()); // waiting for the other side
        }

        let agree = (claim == CLAIM_WIN && other_claim == CLAIM_LOSS)
            || (claim == CLAIM_LOSS && other_claim == CLAIM_WIN);
        if !agree {
            ctx.accounts.room.status = ROOM_DISPUTED;
            return Ok(());
        }

        let winner = if claim == CLAIM_WIN { me_key } else { ctx.accounts.opponent_entry.authority };
        settle_room(
            &mut ctx.accounts.room,
            &mut ctx.accounts.entry,
            &mut ctx.accounts.opponent_entry,
            winner,
            now,
        )
    }

    /// The opponent went silent. After `ROOM_TIMEOUT_SECS` the player who did
    /// report takes the result they reported.
    pub fn force_settle(ctx: Context<ReportResult>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let me_key = ctx.accounts.authority.key();

        let (my_claim, other_claim) = {
            let room = &ctx.accounts.room;
            require!(room.status == ROOM_ACTIVE, MechError::RoomClosed);
            require!(now - room.opened_at >= ROOM_TIMEOUT_SECS, MechError::TooEarly);
            if room.p1 == me_key {
                (room.p1_claim, room.p2_claim)
            } else if room.p2 == me_key {
                (room.p2_claim, room.p1_claim)
            } else {
                return err!(MechError::NotYourRoom);
            }
        };
        require!(my_claim != CLAIM_NONE, MechError::AlreadyReported);
        require!(other_claim == CLAIM_NONE, MechError::AlreadyReported);

        let winner = if my_claim == CLAIM_WIN { me_key } else { ctx.accounts.opponent_entry.authority };
        settle_room(
            &mut ctx.accounts.room,
            &mut ctx.accounts.entry,
            &mut ctx.accounts.opponent_entry,
            winner,
            now,
        )
    }

    /// Season admin settles a room both players claimed. The actions are all
    /// on the rollup, so the call is made after replaying them.
    pub fn resolve_dispute(ctx: Context<ResolveDispute>, winner: Pubkey) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require_keys_eq!(ctx.accounts.admin.key(), ctx.accounts.season.admin, MechError::NotAdmin);
        require!(ctx.accounts.room.status == ROOM_DISPUTED, MechError::NotDisputed);
        require!(
            winner == ctx.accounts.room.p1 || winner == ctx.accounts.room.p2,
            MechError::NotYourRoom
        );
        ctx.accounts.room.status = ROOM_ACTIVE;
        settle_room(
            &mut ctx.accounts.room,
            &mut ctx.accounts.entry,
            &mut ctx.accounts.opponent_entry,
            winner,
            now,
        )
    }

    /// Buys one energy pack. Bounded per day, so paid matches cannot scale
    /// without limit. The pool keeps its share; the rest goes to the treasury.
    pub fn buy_energy_pack(ctx: Context<BuyEnergyPack>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(now < ctx.accounts.season.ends_at, MechError::SeasonClosed);
        require_keys_eq!(ctx.accounts.treasury.key(), ctx.accounts.season.treasury, MechError::NotAdmin);

        {
            let e = &mut ctx.accounts.entry;
            require!(e.season == ctx.accounts.season.id, MechError::WrongSeason);
            refill_energy(e, now);
            require!(e.packs_today < ENERGY_PACKS_PER_DAY, MechError::PackLimit);
        }

        let to_pool = ENERGY_PACK_PRICE_LAMPORTS * POOL_SHARE_OF_ENERGY_PCT / 100;
        let to_treasury = ENERGY_PACK_PRICE_LAMPORTS - to_pool;
        transfer_lamports(
            &ctx.accounts.authority.to_account_info(),
            &ctx.accounts.pool.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            to_pool,
        )?;
        transfer_lamports(
            &ctx.accounts.authority.to_account_info(),
            &ctx.accounts.treasury.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            to_treasury,
        )?;

        let pool = &mut ctx.accounts.pool;
        pool.deposited = pool.deposited.saturating_add(to_pool);

        let e = &mut ctx.accounts.entry;
        e.packs_today += 1;
        e.energy = (e.energy + ENERGY_PACK_SIZE).min(ENERGY_MAX_BANKED);
        Ok(())
    }

    /// Pays a place out of the pool once the season is over. Admin-signed:
    /// the standings are computed off-chain from these accounts, which are
    /// public, so a payout is checkable even though it is not trustless yet.
    pub fn payout(ctx: Context<Payout>, lamports: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require_keys_eq!(ctx.accounts.admin.key(), ctx.accounts.season.admin, MechError::NotAdmin);
        require!(now >= ctx.accounts.season.ends_at, MechError::SeasonClosed);

        let pool_info = ctx.accounts.pool.to_account_info();
        let rent_floor = SolanaRent::get()?.minimum_balance(pool_info.data_len());
        let available = pool_info.lamports().saturating_sub(rent_floor);
        require!(lamports <= available, MechError::PoolTooSmall);

        let recipient_info = ctx.accounts.recipient.to_account_info();
        **pool_info.try_borrow_mut_lamports()? -= lamports;
        **recipient_info.try_borrow_mut_lamports()? += lamports;

        let pool = &mut ctx.accounts.pool;
        pool.paid_out = pool.paid_out.saturating_add(lamports);
        Ok(())
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────

fn start_match(d: &mut Duelist, opponent: Pubkey, match_id: u64, role: u8, mode: u8, now: i64) {
    d.status = STATUS_MATCHED;
    d.opponent = opponent;
    d.match_id = match_id;
    d.role = role;
    d.step = 0;
    d.committed = false;
    d.commitment = [0u8; 32];
    d.revealed = false;
    d.action_step = NO_REVEAL;
    d.action = [0u8; 2];
    d.check = 0;
    d.mode = mode;
    d.updated_at = now;
}

fn same_match(me: &Duelist, opp: &Duelist) -> bool {
    me.match_id == opp.match_id && me.opponent == opp.authority && opp.opponent == me.authority
}

fn day_index(now: i64) -> u32 {
    (now / 86_400).max(0) as u32
}

/// Credits one day's free energy, however many days were missed, capped.
fn refill_energy(e: &mut LadderEntry, now: i64) {
    let today = day_index(now);
    if today == e.energy_day {
        return;
    }
    e.energy = (e.energy + ENERGY_DAILY_FREE).min(ENERGY_MAX_BANKED);
    e.energy_day = today;
    e.packs_today = 0;
}

fn tolerance(waited_secs: i64) -> i64 {
    (BASE_TOLERANCE + waited_secs * WIDEN_PER_SECOND).min(MAX_TOLERANCE)
}

fn count_recent(recent: &[Pubkey; RECENT], len: u8, who: &Pubkey) -> u32 {
    let mut n = 0;
    for i in 0..(len as usize).min(RECENT) {
        if recent[i] == *who {
            n += 1;
        }
    }
    n
}

fn push_recent(e: &mut LadderEntry, who: Pubkey) -> bool {
    let known = count_recent(&e.recent, e.recent_len, &who) > 0;
    let mut i = (e.recent_len as usize).min(RECENT - 1);
    while i > 0 {
        e.recent[i] = e.recent[i - 1];
        i -= 1;
    }
    e.recent[0] = who;
    if (e.recent_len as usize) < RECENT {
        e.recent_len += 1;
    }
    !known
}

fn find_ticket(q: &MatchQueue, who: &Pubkey) -> Option<usize> {
    (0..(q.len as usize)).find(|&i| q.tickets[i].authority == *who)
}

fn remove_ticket(q: &mut MatchQueue, who: &Pubkey) {
    if let Some(i) = find_ticket(q, who) {
        let last = q.len as usize - 1;
        q.tickets[i] = q.tickets[last];
        q.tickets[last] = Ticket::default();
        q.len -= 1;
    }
}

/// Elo expectation, in units of 1/10_000, for a rating difference in [-800, 800].
/// A 33-entry table at 50-point steps with linear interpolation between them:
/// `10f64.powf()` is not available on-chain, and a table is exact enough for a
/// ladder (the client's floating-point copy is only ever a preview).
const ELO_TABLE: [i64; 33] = [
    99, 132, 175, 232, 307, 405, 532, 697, 909, 1177, 1510, 1917, 2403, 2967, 3600, 4285, 5000,
    5715, 6400, 7033, 7597, 8083, 8490, 8823, 9091, 9303, 9468, 9595, 9693, 9768, 9825, 9868, 9901,
];

fn expected_score(my_rating: i32, opp_rating: i32) -> i64 {
    let diff = (my_rating as i64 - opp_rating as i64).clamp(-800, 800);
    let pos = diff + 800; // 0..1600
    let idx = (pos / 50) as usize;
    if idx >= ELO_TABLE.len() - 1 {
        return ELO_TABLE[ELO_TABLE.len() - 1];
    }
    let lo = ELO_TABLE[idx];
    let hi = ELO_TABLE[idx + 1];
    let within = pos % 50;
    lo + (hi - lo) * within / 50
}

fn k_factor(e: &LadderEntry) -> i64 {
    let played = e.wins as u32 + e.losses as u32;
    if played < PROVISIONAL_MATCHES {
        K_PROVISIONAL
    } else if e.rating >= K_TIGHTEN_ABOVE {
        K_TIGHT
    } else {
        K_ESTABLISHED
    }
}

/// `0.5 ^ ((n - 2) / 2)` with a 0.05 floor, in units of 1/10_000 — the value of
/// the Nth meeting between the same two accounts this season.
fn repeat_weight(prior_meetings: u32) -> i64 {
    match prior_meetings {
        0..=2 => 10_000,
        3 => 7_071,
        4 => 5_000,
        5 => 3_536,
        6 => 2_500,
        7 => 1_768,
        8 => 1_250,
        9 => 884,
        10 => 625,
        _ => 500,
    }
}

fn apply_rating(winner: &mut LadderEntry, loser: &mut LadderEntry, now: i64) {
    let meetings = count_recent(&winner.recent, winner.recent_len, &loser.authority);
    let weight = repeat_weight(meetings);

    // Both deltas use the PRE-match ratings, so the result does not depend on
    // which account is written first.
    let winner_rating = winner.rating;
    let loser_rating = loser.rating;
    let e_winner = expected_score(winner_rating, loser_rating);
    let e_loser = SCALE - e_winner;

    let gain = k_factor(winner) * weight * (SCALE - e_winner) / (SCALE * SCALE);
    let drop = k_factor(loser) * weight * e_loser / (SCALE * SCALE);

    winner.rating = (winner_rating as i64 + gain).max(RATING_FLOOR as i64) as i32;
    loser.rating = (loser_rating as i64 - drop).max(RATING_FLOOR as i64) as i32;

    winner.wins = winner.wins.saturating_add(1);
    loser.losses = loser.losses.saturating_add(1);

    if push_recent(winner, loser.authority) {
        winner.distinct_opponents = winner.distinct_opponents.saturating_add(1);
    }
    if push_recent(loser, winner.authority) {
        loser.distinct_opponents = loser.distinct_opponents.saturating_add(1);
    }

    winner.last_match_at = now;
    loser.last_match_at = now;
    winner.room_id = 0;
    loser.room_id = 0;
    winner.opponent = Pubkey::default();
    loser.opponent = Pubkey::default();
}

fn settle_room(
    room: &mut Account<MatchRoom>,
    entry: &mut Account<LadderEntry>,
    opponent_entry: &mut Account<LadderEntry>,
    winner: Pubkey,
    now: i64,
) -> Result<()> {
    require_keys_neq!(entry.key(), opponent_entry.key(), MechError::SelfPair);
    require!(room.status == ROOM_ACTIVE, MechError::RoomClosed);
    require!(entry.room_id == room.id, MechError::NotYourRoom);
    require!(opponent_entry.room_id == room.id, MechError::NotYourRoom);

    if entry.authority == winner {
        apply_rating(entry, opponent_entry, now);
    } else {
        apply_rating(opponent_entry, entry, now);
    }
    room.winner = winner;
    room.status = ROOM_SETTLED;
    Ok(())
}

fn transfer_lamports<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    lamports: u64,
) -> Result<()> {
    if lamports == 0 {
        return Ok(());
    }
    anchor_lang::solana_program::program::invoke(
        &system_instruction::transfer(from.key, to.key, lamports),
        &[from.clone(), to.clone(), system_program.clone()],
    )
    .map_err(Into::into)
}

/// A Metaplex Core asset owned by `owner` and belonging to `collection`.
///
/// Layout read here (the only fixed-offset part of an asset):
///   0       key, 1 = AssetV1
///   1..33   owner
///   33      update authority tag, 2 = Collection
///   34..66  the collection address
fn verify_pass(asset: &AccountInfo, owner: &Pubkey, collection: &Pubkey) -> Result<()> {
    require_keys_eq!(*asset.owner, MPL_CORE_ID, MechError::NoPass);
    let data = asset.try_borrow_data()?;
    require!(data.len() >= 66, MechError::NoPass);
    require!(data[0] == 1, MechError::NoPass);
    let asset_owner: [u8; 32] = data[1..33].try_into().unwrap();
    require!(Pubkey::from(asset_owner) == *owner, MechError::NoPass);
    require!(data[33] == 2, MechError::NoPass);
    let asset_collection: [u8; 32] = data[34..66].try_into().unwrap();
    require!(Pubkey::from(asset_collection) == *collection, MechError::NoPass);
    Ok(())
}

/// Delegates a PDA owned by this program to the MagicBlock rollup.
///
/// Same sequence as `sol-city::delegate`: copy the data into a buffer PDA,
/// zero and reassign the account to the delegation program, CPI into it with
/// the PDA's seeds, then close the buffer back to the payer.
#[allow(clippy::too_many_arguments)]
fn delegate_pda<'info>(
    payer: &AccountInfo<'info>,
    pda: &AccountInfo<'info>,
    owner_program: &AccountInfo<'info>,
    buffer: &AccountInfo<'info>,
    delegation_record: &AccountInfo<'info>,
    delegation_metadata: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    seeds: &[&[u8]],
    bump: u8,
) -> Result<()> {
    let pda_key = *pda.key;

    let bump_bytes = [bump];
    let mut pda_seeds: Vec<&[u8]> = seeds.to_vec();
    pda_seeds.push(&bump_bytes);
    let pda_signer: &[&[u8]] = &pda_seeds;

    let (_, buffer_bump) =
        Pubkey::find_program_address(&[BUFFER_SEED, pda_key.as_ref()], &crate::ID);
    let buffer_bump_bytes = [buffer_bump];
    let buffer_seeds: [&[u8]; 3] = [BUFFER_SEED, pda_key.as_ref(), &buffer_bump_bytes];
    let buffer_signer: &[&[u8]] = &buffer_seeds;

    let data_len = pda.data_len();
    let rent = SolanaRent::get()?;

    // 1. Buffer PDA
    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            buffer.key,
            rent.minimum_balance(data_len),
            data_len as u64,
            &crate::ID,
        ),
        &[payer.clone(), buffer.clone(), system_program.clone()],
        &[buffer_signer],
    )?;

    // 2. Copy data → buffer
    {
        let src = pda.try_borrow_data()?;
        let mut dst = buffer.try_borrow_mut_data()?;
        dst.copy_from_slice(&src);
    }

    // 3. Zero the PDA
    {
        let mut data = pda.try_borrow_mut_data()?;
        sol_memset(&mut data, 0, data_len);
    }

    // 4. Reassign to the delegation program
    pda.assign(&anchor_lang::solana_program::system_program::id());
    invoke_signed(
        &system_instruction::assign(pda.key, &DELEGATION_PROGRAM_ID),
        &[pda.clone(), system_program.clone()],
        &[pda_signer],
    )?;

    // 5. CPI → delegation program
    //    discriminator [0; 8], u32 commit_frequency_ms,
    //    u32 seed count + (u32 len + bytes) per seed, u8 validator option (0 = none)
    let mut ix_data: Vec<u8> = Vec::with_capacity(64);
    ix_data.extend_from_slice(&[0u8; 8]);
    ix_data.extend_from_slice(&3_000u32.to_le_bytes());
    ix_data.extend_from_slice(&(seeds.len() as u32).to_le_bytes());
    for seed in seeds {
        ix_data.extend_from_slice(&(seed.len() as u32).to_le_bytes());
        ix_data.extend_from_slice(seed);
    }
    ix_data.push(0u8);

    let delegate_ix = SolInstruction {
        program_id: DELEGATION_PROGRAM_ID,
        accounts: vec![
            SolAccountMeta::new(*payer.key, true),
            SolAccountMeta::new(*pda.key, true),
            SolAccountMeta::new_readonly(crate::ID, false),
            SolAccountMeta::new(*buffer.key, false),
            SolAccountMeta::new(*delegation_record.key, false),
            SolAccountMeta::new(*delegation_metadata.key, false),
            SolAccountMeta::new_readonly(*system_program.key, false),
        ],
        data: ix_data,
    };
    invoke_signed(
        &delegate_ix,
        &[
            payer.clone(),
            pda.clone(),
            owner_program.clone(),
            buffer.clone(),
            delegation_record.clone(),
            delegation_metadata.clone(),
            system_program.clone(),
        ],
        &[pda_signer],
    )?;

    // 6. Close the buffer
    let buffer_lamports = buffer.lamports();
    **buffer.try_borrow_mut_lamports()? -= buffer_lamports;
    **payer.try_borrow_mut_lamports()? += buffer_lamports;

    Ok(())
}

// ── Accounts: rollup side ─────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitDuelist<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Duelist::INIT_SPACE,
        seeds = [DUELIST_SEED, authority.key().as_ref()],
        bump,
    )]
    pub duelist: Account<'info, Duelist>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DelegateDuelist<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: address verified by seeds; stored authority checked in the body
    #[account(mut, seeds = [DUELIST_SEED, authority.key().as_ref()], bump)]
    pub duelist: UncheckedAccount<'info>,
    /// CHECK: this program's id, required by the delegation CPI
    pub owner_program: UncheckedAccount<'info>,
    /// CHECK: ["buffer", duelist] under this program
    #[account(mut)]
    pub delegate_buffer: UncheckedAccount<'info>,
    /// CHECK: ["delegation", duelist] under the delegation program
    #[account(mut)]
    pub delegation_record: UncheckedAccount<'info>,
    /// CHECK: ["delegation-metadata", duelist] under the delegation program
    #[account(mut)]
    pub delegation_metadata: UncheckedAccount<'info>,
    /// CHECK: MagicBlock delegation program
    pub delegation_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitLobby<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + Lobby::INIT_SPACE,
        seeds = [LOBBY_SEED],
        bump,
    )]
    pub lobby: Account<'info, Lobby>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DelegateLobby<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: address verified by seeds
    #[account(mut, seeds = [LOBBY_SEED], bump)]
    pub lobby: UncheckedAccount<'info>,
    /// CHECK: this program's id, required by the delegation CPI
    pub owner_program: UncheckedAccount<'info>,
    /// CHECK: ["buffer", lobby] under this program
    #[account(mut)]
    pub delegate_buffer: UncheckedAccount<'info>,
    /// CHECK: ["delegation", lobby] under the delegation program
    #[account(mut)]
    pub delegation_record: UncheckedAccount<'info>,
    /// CHECK: ["delegation-metadata", lobby] under the delegation program
    #[account(mut)]
    pub delegation_metadata: UncheckedAccount<'info>,
    /// CHECK: MagicBlock delegation program
    pub delegation_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetSession<'info> {
    #[account(
        mut,
        seeds = [DUELIST_SEED, authority.key().as_ref()],
        bump,
        has_one = authority @ MechError::InvalidAuthority,
    )]
    pub duelist: Account<'info, Duelist>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct LobbyAction<'info> {
    #[account(mut, seeds = [LOBBY_SEED], bump)]
    pub lobby: Account<'info, Lobby>,
    #[account(
        mut,
        seeds = [DUELIST_SEED, duelist.authority.as_ref()],
        bump,
        constraint = duelist.session == session.key() @ MechError::InvalidSession,
    )]
    pub duelist: Account<'info, Duelist>,
    pub session: Signer<'info>,
}

#[derive(Accounts)]
pub struct DuelistOnly<'info> {
    #[account(
        mut,
        seeds = [DUELIST_SEED, duelist.authority.as_ref()],
        bump,
        constraint = duelist.session == session.key() @ MechError::InvalidSession,
    )]
    pub duelist: Account<'info, Duelist>,
    pub session: Signer<'info>,
}

#[derive(Accounts)]
pub struct PairMatch<'info> {
    #[account(mut, seeds = [LOBBY_SEED], bump)]
    pub lobby: Account<'info, Lobby>,
    #[account(
        mut,
        seeds = [DUELIST_SEED, duelist.authority.as_ref()],
        bump,
        constraint = duelist.session == session.key() @ MechError::InvalidSession,
    )]
    pub duelist: Account<'info, Duelist>,
    #[account(mut, seeds = [DUELIST_SEED, host.authority.as_ref()], bump)]
    pub host: Account<'info, Duelist>,
    pub session: Signer<'info>,
}

#[derive(Accounts)]
pub struct Challenge<'info> {
    #[account(
        mut,
        seeds = [DUELIST_SEED, duelist.authority.as_ref()],
        bump,
        constraint = duelist.session == session.key() @ MechError::InvalidSession,
    )]
    pub duelist: Account<'info, Duelist>,
    #[account(mut, seeds = [DUELIST_SEED, target.authority.as_ref()], bump)]
    pub target: Account<'info, Duelist>,
    pub session: Signer<'info>,
}

#[derive(Accounts)]
pub struct AcceptChallenge<'info> {
    #[account(mut, seeds = [LOBBY_SEED], bump)]
    pub lobby: Account<'info, Lobby>,
    #[account(
        mut,
        seeds = [DUELIST_SEED, duelist.authority.as_ref()],
        bump,
        constraint = duelist.session == session.key() @ MechError::InvalidSession,
    )]
    pub duelist: Account<'info, Duelist>,
    #[account(mut, seeds = [DUELIST_SEED, challenger.authority.as_ref()], bump)]
    pub challenger: Account<'info, Duelist>,
    pub session: Signer<'info>,
}

#[derive(Accounts)]
pub struct PairRanked<'info> {
    #[account(
        mut,
        seeds = [DUELIST_SEED, duelist.authority.as_ref()],
        bump,
        constraint = duelist.session == session.key() @ MechError::InvalidSession,
    )]
    pub duelist: Account<'info, Duelist>,
    #[account(mut, seeds = [DUELIST_SEED, opponent.authority.as_ref()], bump)]
    pub opponent: Account<'info, Duelist>,
    pub session: Signer<'info>,
}

#[derive(Accounts)]
pub struct Exchange<'info> {
    #[account(
        mut,
        seeds = [DUELIST_SEED, duelist.authority.as_ref()],
        bump,
        constraint = duelist.session == session.key() @ MechError::InvalidSession,
    )]
    pub duelist: Account<'info, Duelist>,
    #[account(seeds = [DUELIST_SEED, opponent.authority.as_ref()], bump)]
    pub opponent: Account<'info, Duelist>,
    pub session: Signer<'info>,
}

// ── Accounts: season (base layer) ─────────────────────────────────────────

#[derive(Accounts)]
#[instruction(id: u16)]
pub struct InitSeason<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + Season::INIT_SPACE,
        seeds = [SEASON_SEED, &id.to_le_bytes()],
        bump,
    )]
    pub season: Account<'info, Season>,
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: where sale proceeds land; stored and checked on every purchase
    pub treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitQueue<'info> {
    #[account(seeds = [SEASON_SEED, &season.id.to_le_bytes()], bump)]
    pub season: Account<'info, Season>,
    #[account(
        init,
        payer = payer,
        space = 8 + std::mem::size_of::<MatchQueue>(),
        seeds = [QUEUE_SEED, &season.id.to_le_bytes()],
        bump,
    )]
    pub queue: AccountLoader<'info, MatchQueue>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitPrizePool<'info> {
    #[account(seeds = [SEASON_SEED, &season.id.to_le_bytes()], bump)]
    pub season: Account<'info, Season>,
    #[account(
        init,
        payer = payer,
        space = 8 + PrizePool::INIT_SPACE,
        seeds = [POOL_SEED, &season.id.to_le_bytes()],
        bump,
    )]
    pub pool: Account<'info, PrizePool>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundPool<'info> {
    #[account(mut, seeds = [POOL_SEED, &pool.season.to_le_bytes()], bump)]
    pub pool: Account<'info, PrizePool>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitLadderEntry<'info> {
    #[account(mut, seeds = [SEASON_SEED, &season.id.to_le_bytes()], bump)]
    pub season: Account<'info, Season>,
    #[account(
        init,
        payer = authority,
        space = 8 + LadderEntry::INIT_SPACE,
        seeds = [ENTRY_SEED, &season.id.to_le_bytes(), authority.key().as_ref()],
        bump,
    )]
    pub entry: Account<'info, LadderEntry>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinQueue<'info> {
    #[account(seeds = [SEASON_SEED, &season.id.to_le_bytes()], bump)]
    pub season: Account<'info, Season>,
    #[account(mut, seeds = [QUEUE_SEED, &season.id.to_le_bytes()], bump)]
    pub queue: AccountLoader<'info, MatchQueue>,
    #[account(
        mut,
        seeds = [ENTRY_SEED, &season.id.to_le_bytes(), authority.key().as_ref()],
        bump,
        has_one = authority @ MechError::InvalidAuthority,
    )]
    pub entry: Account<'info, LadderEntry>,
    pub authority: Signer<'info>,
    /// CHECK: a Metaplex Core asset; fully validated in `verify_pass`
    pub pass_asset: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
pub struct CancelQueue<'info> {
    #[account(mut, seeds = [QUEUE_SEED, &entry.season.to_le_bytes()], bump)]
    pub queue: AccountLoader<'info, MatchQueue>,
    #[account(
        mut,
        seeds = [ENTRY_SEED, &entry.season.to_le_bytes(), authority.key().as_ref()],
        bump,
        has_one = authority @ MechError::InvalidAuthority,
    )]
    pub entry: Account<'info, LadderEntry>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct PairFromQueue<'info> {
    #[account(mut, seeds = [SEASON_SEED, &season.id.to_le_bytes()], bump)]
    pub season: Account<'info, Season>,
    #[account(mut, seeds = [QUEUE_SEED, &season.id.to_le_bytes()], bump)]
    pub queue: AccountLoader<'info, MatchQueue>,
    #[account(
        mut,
        seeds = [ENTRY_SEED, &season.id.to_le_bytes(), authority.key().as_ref()],
        bump,
        has_one = authority @ MechError::InvalidAuthority,
    )]
    pub entry: Account<'info, LadderEntry>,
    #[account(
        mut,
        seeds = [ENTRY_SEED, &season.id.to_le_bytes(), opponent_entry.authority.as_ref()],
        bump,
    )]
    pub opponent_entry: Account<'info, LadderEntry>,
    #[account(
        init,
        payer = authority,
        space = 8 + MatchRoom::INIT_SPACE,
        seeds = [ROOM_SEED, &season.id.to_le_bytes(), &season.next_room_id.to_le_bytes()],
        bump,
    )]
    pub room: Account<'info, MatchRoom>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReportResult<'info> {
    #[account(mut, seeds = [ROOM_SEED, &room.season.to_le_bytes(), &room.id.to_le_bytes()], bump)]
    pub room: Account<'info, MatchRoom>,
    #[account(
        mut,
        seeds = [ENTRY_SEED, &room.season.to_le_bytes(), authority.key().as_ref()],
        bump,
        has_one = authority @ MechError::InvalidAuthority,
    )]
    pub entry: Account<'info, LadderEntry>,
    #[account(
        mut,
        seeds = [ENTRY_SEED, &room.season.to_le_bytes(), opponent_entry.authority.as_ref()],
        bump,
    )]
    pub opponent_entry: Account<'info, LadderEntry>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    #[account(seeds = [SEASON_SEED, &season.id.to_le_bytes()], bump)]
    pub season: Account<'info, Season>,
    #[account(mut, seeds = [ROOM_SEED, &room.season.to_le_bytes(), &room.id.to_le_bytes()], bump)]
    pub room: Account<'info, MatchRoom>,
    #[account(
        mut,
        seeds = [ENTRY_SEED, &room.season.to_le_bytes(), entry.authority.as_ref()],
        bump,
    )]
    pub entry: Account<'info, LadderEntry>,
    #[account(
        mut,
        seeds = [ENTRY_SEED, &room.season.to_le_bytes(), opponent_entry.authority.as_ref()],
        bump,
    )]
    pub opponent_entry: Account<'info, LadderEntry>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct BuyEnergyPack<'info> {
    #[account(seeds = [SEASON_SEED, &season.id.to_le_bytes()], bump)]
    pub season: Account<'info, Season>,
    #[account(
        mut,
        seeds = [ENTRY_SEED, &season.id.to_le_bytes(), authority.key().as_ref()],
        bump,
        has_one = authority @ MechError::InvalidAuthority,
    )]
    pub entry: Account<'info, LadderEntry>,
    #[account(mut, seeds = [POOL_SEED, &season.id.to_le_bytes()], bump)]
    pub pool: Account<'info, PrizePool>,
    /// CHECK: checked against `season.treasury`
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Payout<'info> {
    #[account(seeds = [SEASON_SEED, &season.id.to_le_bytes()], bump)]
    pub season: Account<'info, Season>,
    #[account(mut, seeds = [POOL_SEED, &season.id.to_le_bytes()], bump)]
    pub pool: Account<'info, PrizePool>,
    /// CHECK: paid out to; the admin names the place winners
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
    pub admin: Signer<'info>,
}

// ── State ─────────────────────────────────────────────────────────────────
//
// Field order is the byte layout the client decodes
// (apps/web/src/game/solmechs/pvp/chain/mechProgram.ts). Reordering a field is
// a breaking change for every client; appending one is not.

/// One per wallet, delegated to the rollup. 8 + 231 bytes.
#[account]
#[derive(InitSpace)]
pub struct Duelist {
    pub authority: Pubkey,     // 8
    pub session: Pubkey,       // 40
    pub name: [u8; 20],        // 72
    pub status: u8,            // 92
    pub team: [u8; 12],        // 93   3 mechs × (matrix, right arm, left arm, legs) catalog index
    pub opponent: Pubkey,      // 105
    pub match_id: u64,         // 137
    pub role: u8,              // 145  0 host, 1 guest
    pub step: u16,             // 146
    pub committed: bool,       // 148
    pub commitment: [u8; 32],  // 149
    pub revealed: bool,        // 181
    pub action_step: u16,      // 182  step of `action`, NO_REVEAL before the first reveal
    pub action: [u8; 2],       // 184
    pub check: u32,            // 186  revealer's board checksum, for desync detection
    pub updated_at: i64,       // 190
    // Appended after the casual-PvP release; older clients ignore them.
    pub challenger: Pubkey,    // 198  who invited this player to a friendly duel
    pub challenge_at: i64,     // 230
    pub mode: u8,              // 238  MODE_CASUAL | MODE_RANKED | MODE_FRIENDLY
}

/// Single global waiting slot for casual matches. 8 + 48 bytes.
#[account]
#[derive(InitSpace)]
pub struct Lobby {
    pub waiting: Pubkey,      // 8
    pub waiting_since: i64,   // 40
    pub next_match_id: u64,   // 48
}

/// One ranked season. Base layer.
#[account]
#[derive(InitSpace)]
pub struct Season {
    pub id: u16,
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub starts_at: i64,
    pub ends_at: i64,
    /// Metaplex Core collection whose assets count as a pass.
    pub pass_collection: Pubkey,
    pub require_pass: bool,
    pub entrants: u32,
    pub next_room_id: u64,
}

/// A wallet's standing and energy for one season. Base layer.
#[account]
#[derive(InitSpace)]
pub struct LadderEntry {
    pub authority: Pubkey,
    pub season: u16,
    pub rating: i32,
    pub wins: u16,
    pub losses: u16,
    /// Counted against the recent window, so it under-counts a player who
    /// faces more than RECENT distinct opponents and then meets one again.
    pub distinct_opponents: u16,
    /// Ring buffer, newest first. Feeds both the matchmaking rematch penalty
    /// and the repeat-pairing rating decay.
    pub recent: [Pubkey; RECENT],
    pub recent_len: u8,
    pub energy: u8,
    pub energy_day: u32,
    pub packs_today: u8,
    pub queued: bool,
    /// Non-zero while a ranked match is open.
    pub room_id: u64,
    pub opponent: Pubkey,
    pub last_match_at: i64,
}

/// A queued player. `_pad` keeps the 8-byte alignment zero-copy requires.
#[zero_copy]
#[derive(Default)]
pub struct Ticket {
    pub authority: Pubkey,  // 0
    pub rating: i32,        // 32
    pub _pad: [u8; 4],      // 36
    pub enqueued_at: i64,   // 40, ends at 48
}

/// The ranked queue. One per season, base layer.
///
/// Zero-copy: 64 tickets is 3KB, and serialising that through Anchor's normal
/// account writer made the runtime reject the whole instruction with
/// "Overlapping copy". Zero-copy writes in place, and costs less compute too.
#[account(zero_copy)]
pub struct MatchQueue {
    pub season: u16,       // 0
    pub len: u8,           // 2
    pub _pad: [u8; 5],     // 3
    pub tickets: [Ticket; QUEUE_CAP], // 8
}

/// One ranked pairing, opened by `pair_from_queue` and closed by a result.
#[account]
#[derive(InitSpace)]
pub struct MatchRoom {
    pub season: u16,
    pub id: u64,
    pub p1: Pubkey,
    pub p2: Pubkey,
    pub opened_at: i64,
    pub p1_claim: u8,
    pub p2_claim: u8,
    pub status: u8,
    pub winner: Pubkey,
}

/// Holds the season's prize lamports.
#[account]
#[derive(InitSpace)]
pub struct PrizePool {
    pub season: u16,
    pub deposited: u64,
    pub paid_out: u64,
}
