use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::cpi::{delegate_account, commit_and_undelegate_accounts};
use ephemeral_rollups_sdk::consts::DELEGATION_PROGRAM_ID;

declare_id!("11111111111111111111111111111111"); // Replace after first deploy

pub const PLAYER_SEED: &[u8] = b"player";

#[program]
pub mod sol_city {
    use super::*;

    /// Initializes a new player state account.
    /// Called once when a player first connects their wallet.
    pub fn initialize_player(ctx: Context<InitializePlayer>, display_name: String) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.authority = ctx.accounts.authority.key();
        player.display_name = display_name;
        player.x = 512;  // spawn X (tile 16 * 32)
        player.y = 288;  // spawn Y (tile 9 * 32)
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

    /// Updates player position.
    /// In ephemeral rollup mode, this runs at sub-50ms with zero gas.
    pub fn update_position(ctx: Context<UpdatePlayer>, x: u32, y: u32, direction: u8) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.x = x;
        player.y = y;
        player.direction = direction;
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Records that the player completed a swap action.
    /// Increments score and swap counter.
    pub fn record_swap(ctx: Context<UpdatePlayer>) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.swap_count += 1;
        player.score += 50;
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Records that the player completed a token transfer.
    pub fn record_transfer(ctx: Context<UpdatePlayer>) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.transfer_count += 1;
        player.score += 25;
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Records that the player completed a bounty.
    pub fn record_bounty(ctx: Context<UpdatePlayer>) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.bounty_count += 1;
        player.score += 30;
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Changes the player's outfit.
    pub fn change_outfit(ctx: Context<UpdatePlayer>, outfit_id: u8) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.outfit_id = outfit_id;
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Delegates the player PDA to a MagicBlock Ephemeral Rollup.
    /// After delegation, position updates run gasless at sub-50ms.
    /// Called when the player enters the game session.
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
            0,     // no time limit
            3_000, // commit to base layer every 3 seconds
        )?;
        Ok(())
    }

    /// Undelegates the player PDA back to the base layer.
    /// Commits final state and unlocks the account on Solana mainnet.
    /// Called when the player exits the game session.
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
    /// CHECK: Owner program account
    pub owner_program: AccountInfo<'info>,
    /// CHECK: Buffer account for delegation
    #[account(mut)]
    pub buffer: AccountInfo<'info>,
    /// CHECK: Delegation record PDA
    #[account(mut)]
    pub delegation_record: AccountInfo<'info>,
    /// CHECK: Delegation metadata PDA
    #[account(mut)]
    pub delegation_metadata: AccountInfo<'info>,
    /// CHECK: MagicBlock delegation program
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
