use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::cpi::{delegate_account, commit_and_undelegate_accounts};
use ephemeral_rollups_sdk::consts::DELEGATION_PROGRAM_ID;

declare_id!("11111111111111111111111111111111"); // Replace after first deploy

pub const PLAYER_SEED: &[u8] = b"player";

#[error_code]
pub enum SolCityError {
    #[msg("Invalid session key — call authorize_session first")]
    InvalidSessionKey,
}

#[program]
pub mod sol_city {
    use super::*;

    /// Initializes a new player state account.
    /// Called once when a player first connects their wallet.
    pub fn initialize_player(ctx: Context<InitializePlayer>, display_name: String) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.authority = ctx.accounts.authority.key();
        player.session_authority = None;
        player.display_name = display_name;
        player.x = 512;
        player.y = 288;
        player.direction = 0;
        player.outfit_id = 0;
        player.score = 0;
        player.swap_count = 0;
        player.transfer_count = 0;
        player.bounty_count = 0;
        player.last_active = Clock::get()?.unix_timestamp;
        player.created_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Authorizes an ephemeral session key for the current session.
    /// The main wallet signs this once; subsequent position updates
    /// use the session key with no further wallet popups.
    pub fn authorize_session(ctx: Context<AuthorizeSession>, session_key: Pubkey) -> Result<()> {
        ctx.accounts.player.session_authority = Some(session_key);
        Ok(())
    }

    /// Revokes the active session key. Main wallet signs.
    /// Called automatically on disconnect.
    pub fn revoke_session(ctx: Context<UpdatePlayer>) -> Result<()> {
        ctx.accounts.player.session_authority = None;
        Ok(())
    }

    /// Updates player position — signed by main wallet (base layer fallback).
    pub fn update_position(ctx: Context<UpdatePlayer>, x: u32, y: u32, direction: u8) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.x = x;
        player.y = y;
        player.direction = direction;
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Updates player position — signed by session key (ephemeral rollup path).
    /// Zero popups. Runs at sub-50ms inside the MagicBlock validator.
    pub fn update_position_session(
        ctx: Context<UpdatePlayerSession>,
        x: u32,
        y: u32,
        direction: u8,
    ) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.x = x;
        player.y = y;
        player.direction = direction;
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Records a completed swap. Increments score. Main wallet signs.
    pub fn record_swap(ctx: Context<UpdatePlayer>) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.swap_count += 1;
        player.score += 50;
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Records a completed token transfer. Main wallet signs.
    pub fn record_transfer(ctx: Context<UpdatePlayer>) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.transfer_count += 1;
        player.score += 25;
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Records a completed bounty. Main wallet signs.
    pub fn record_bounty(ctx: Context<UpdatePlayer>) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.bounty_count += 1;
        player.score += 30;
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Changes the player's outfit. Main wallet signs.
    pub fn change_outfit(ctx: Context<UpdatePlayer>, outfit_id: u8) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.outfit_id = outfit_id;
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Delegates the player PDA to a MagicBlock Ephemeral Rollup.
    /// After delegation, position updates run gasless at sub-50ms.
    pub fn delegate(ctx: Context<DelegatePlayer>) -> Result<()> {
        let pda_seeds: &[&[u8]] = &[
            PLAYER_SEED,
            ctx.accounts.authority.key.as_ref(),
            &[ctx.bumps.player],
        ];

        delegate_account(
            &ctx.accounts.authority,
            &ctx.accounts.player.to_account_info(),
            &ctx.accounts.owner_program,
            &ctx.accounts.buffer,
            &ctx.accounts.delegation_record,
            &ctx.accounts.delegation_metadata,
            &ctx.accounts.delegation_program,
            &ctx.accounts.system_program,
            pda_seeds,
            0,
            3_000,
        )?;
        Ok(())
    }

    /// Undelegates and commits final state back to Solana base layer.
    pub fn undelegate(ctx: Context<UndelegatePlayer>) -> Result<()> {
        commit_and_undelegate_accounts(
            &ctx.accounts.authority,
            vec![&ctx.accounts.player.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        Ok(())
    }
}

// ── Accounts ────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializePlayer<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + PlayerState::INIT_SPACE,
        seeds = [PLAYER_SEED, authority.key().as_ref()],
        bump,
    )]
    pub player: Account<'info, PlayerState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Authorizes a session key — main wallet signs once per session.
#[derive(Accounts)]
pub struct AuthorizeSession<'info> {
    #[account(
        mut,
        seeds = [PLAYER_SEED, authority.key().as_ref()],
        bump,
        has_one = authority,
    )]
    pub player: Account<'info, PlayerState>,
    pub authority: Signer<'info>,
}

/// Standard player update — main wallet signs. Used for score events
/// (record_swap, record_transfer, record_bounty) and outfit changes.
#[derive(Accounts)]
pub struct UpdatePlayer<'info> {
    #[account(
        mut,
        seeds = [PLAYER_SEED, authority.key().as_ref()],
        bump,
        has_one = authority,
    )]
    pub player: Account<'info, PlayerState>,
    pub authority: Signer<'info>,
}

/// Session key update — ephemeral session keypair signs.
/// Used for high-frequency position updates in the rollup (no popup).
#[derive(Accounts)]
pub struct UpdatePlayerSession<'info> {
    #[account(
        mut,
        seeds = [PLAYER_SEED, player.authority.as_ref()],
        bump,
        constraint = player.session_authority == Some(session_authority.key())
            @ SolCityError::InvalidSessionKey,
    )]
    pub player: Account<'info, PlayerState>,
    pub session_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct DelegatePlayer<'info> {
    #[account(
        mut,
        seeds = [PLAYER_SEED, authority.key().as_ref()],
        bump,
    )]
    pub player: Account<'info, PlayerState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: must be this program's own ID (validated by address constraint)
    #[account(address = crate::ID)]
    pub owner_program: AccountInfo<'info>,
    /// CHECK: buffer PDA — address validated inside the delegation CPI
    #[account(mut)]
    pub buffer: AccountInfo<'info>,
    /// CHECK: delegation record PDA — validated inside the delegation CPI
    #[account(mut)]
    pub delegation_record: AccountInfo<'info>,
    /// CHECK: delegation metadata PDA — validated inside the delegation CPI
    #[account(mut)]
    pub delegation_metadata: AccountInfo<'info>,
    /// CHECK: MagicBlock delegation program (address enforced)
    #[account(address = DELEGATION_PROGRAM_ID)]
    pub delegation_program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UndelegatePlayer<'info> {
    #[account(
        mut,
        seeds = [PLAYER_SEED, authority.key().as_ref()],
        bump,
        has_one = authority,
    )]
    pub player: Account<'info, PlayerState>,
    pub authority: Signer<'info>,
    /// CHECK: MagicBlock context account
    pub magic_context: AccountInfo<'info>,
    /// CHECK: MagicBlock program
    pub magic_program: AccountInfo<'info>,
}

// ── State ───────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct PlayerState {
    pub authority: Pubkey,
    pub session_authority: Option<Pubkey>, // authorized ephemeral session key
    #[max_len(20)]
    pub display_name: String,
    pub x: u32,
    pub y: u32,
    pub direction: u8,
    pub outfit_id: u8,
    pub score: u32,
    pub swap_count: u16,
    pub transfer_count: u16,
    pub bounty_count: u16,
    pub last_active: i64,
    pub created_at: i64,
}
