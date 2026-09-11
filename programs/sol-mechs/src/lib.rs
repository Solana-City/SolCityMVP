//! Sol Mechs — casual PvP on a MagicBlock Ephemeral Rollup.
//!
//! What the program does: pairs two players through a single lobby slot, and
//! carries a commit–reveal exchange of one action per player per step.
//!
//! What it does NOT do: simulate combat or record a winner. Both clients run
//! the same deterministic engine (apps/web/src/game/solmechs/engine) over the
//! revealed actions and arrive at the same board. Verifying results on-chain
//! is a separate, later program.
//!
//! Lifecycle:
//!   base layer, wallet-signed, once per wallet   init_duelist + delegate_duelist
//!   base layer, once ever (any payer)            init_lobby + delegate_lobby
//!   rollup, session-key signed                   search_match | pair_match,
//!                                                commit_step, reveal_step,
//!                                                leave_match
//!   rollup, wallet-signed                        set_session (key rotated)
//!
//! Delegation is a hand-rolled CPI into the delegation program, the same one
//! `sol-city` uses in production, so this crate depends on nothing but
//! anchor-lang.

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

// Replaced by Solana Playground on first build.
declare_id!("11111111111111111111111111111111");

pub const DUELIST_SEED: &[u8] = b"mech_duelist";
pub const LOBBY_SEED: &[u8] = b"mech_lobby";
pub const BUFFER_SEED: &[u8] = b"buffer";

/// MagicBlock delegation program on devnet.
pub const DELEGATION_PROGRAM_ID: Pubkey =
    pubkey!("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

/// A lobby slot older than this is abandoned and may be taken over. A
/// searching client re-sends `search_match` well inside it.
pub const LOBBY_TTL_SECS: i64 = 30;

pub const STATUS_IDLE: u8 = 0;
pub const STATUS_SEARCHING: u8 = 1;
pub const STATUS_MATCHED: u8 = 2;

/// `action_step` before the first reveal of a match.
pub const NO_REVEAL: u16 = u16::MAX;

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

    // ── Rollup ────────────────────────────────────────────────────────────

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
        start_match(&mut **host, me_key, match_id, 0, now);
        start_match(&mut **me, host_key, match_id, 1, now);
        Ok(())
    }

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
}

fn start_match(d: &mut Duelist, opponent: Pubkey, match_id: u64, role: u8, now: i64) {
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
    d.updated_at = now;
}

fn same_match(me: &Duelist, opp: &Duelist) -> bool {
    me.match_id == opp.match_id && me.opponent == opp.authority && opp.opponent == me.authority
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

// ── Accounts ──────────────────────────────────────────────────────────────

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

// ── State ─────────────────────────────────────────────────────────────────
//
// Field order is the byte layout the client decodes
// (apps/web/src/game/solmechs/pvp/chain/mechProgram.ts). Reordering a field is
// a breaking change for every client.

/// One per wallet. 8 + 190 bytes.
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
}

/// Single global waiting slot. 8 + 48 bytes.
#[account]
#[derive(InitSpace)]
pub struct Lobby {
    pub waiting: Pubkey,      // 8
    pub waiting_since: i64,   // 40
    pub next_match_id: u64,   // 48
}
