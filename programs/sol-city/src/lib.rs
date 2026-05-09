use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    program::invoke_signed,
    system_instruction,
    program_memory::sol_memset,
    rent::Rent as SolanaRent,
    sysvar::Sysvar as SolanaSysvar,
    instruction::{AccountMeta as SolAccountMeta, Instruction as SolInstruction},
};

declare_id!("HPvDFVnruSXHwKKP44eUvRh8oYqBaHCeQbK1sKWT1aU2");

pub const PLAYER_SEED: &[u8] = b"player";
pub const BUFFER_SEED: &[u8] = b"buffer";

/// MagicBlock delegation program on devnet.
pub const DELEGATION_PROGRAM_ID: Pubkey =
    pubkey!("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

#[error_code]
pub enum SolCityError {
    #[msg("Invalid session key — call authorize_session first")]
    InvalidSessionKey,
    #[msg("Authority mismatch — wrong wallet for this player")]
    InvalidAuthority,
}

#[program]
pub mod sol_city {
    use super::*;

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

    pub fn authorize_session(ctx: Context<AuthorizeSession>, session_key: Pubkey) -> Result<()> {
        ctx.accounts.player.session_authority = Some(session_key);
        Ok(())
    }

    pub fn revoke_session(ctx: Context<UpdatePlayer>) -> Result<()> {
        ctx.accounts.player.session_authority = None;
        Ok(())
    }

    pub fn update_position(ctx: Context<UpdatePlayer>, x: u32, y: u32, direction: u8) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.x = x;
        player.y = y;
        player.direction = direction;
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Hot path: signed by session key, zero popups. Sub-50ms in rollup.
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

    pub fn record_swap(ctx: Context<UpdatePlayer>) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.swap_count += 1;
        player.score += 50;
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn record_transfer(ctx: Context<UpdatePlayer>) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.transfer_count += 1;
        player.score += 25;
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn record_bounty(ctx: Context<UpdatePlayer>) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.bounty_count += 1;
        player.score += 30;
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn change_outfit(ctx: Context<UpdatePlayer>, outfit_id: u8) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.outfit_id = outfit_id;
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Delegates the player PDA to the MagicBlock Ephemeral Rollup.
    ///
    /// The wallet only needs to sign as fee payer. PDA signing happens inside
    /// this instruction via invoke_signed with the PDA's canonical seeds.
    ///
    /// Steps:
    ///   1. Verify caller owns this player account
    ///   2. Create a buffer PDA with a copy of the player state
    ///   3. Zero the player PDA data
    ///   4. Reassign the player PDA to the delegation program
    ///   5. CPI to the delegation program (it sets up ephemeral rollup records)
    ///   6. Close the buffer (return rent to payer)
    pub fn delegate(ctx: Context<DelegatePlayer>) -> Result<()> {
        let authority_key = ctx.accounts.authority.key();
        let player_key    = ctx.accounts.player.key();

        // Verify the stored authority matches the signer
        {
            let data = ctx.accounts.player.data.borrow();
            require!(data.len() >= 8 + 32, SolCityError::InvalidAuthority);
            let stored: [u8; 32] = data[8..40].try_into().unwrap();
            require_keys_eq!(
                Pubkey::from(stored),
                authority_key,
                SolCityError::InvalidAuthority
            );
        }

        let player_bump = ctx.bumps.player;

        // Signer seeds for the player PDA (WITH bump, for invoke_signed)
        let player_signer_seeds: &[&[u8]] = &[
            PLAYER_SEED,
            authority_key.as_ref(),
            &[player_bump],
        ];

        // Derive the buffer PDA
        let (_, buffer_bump) = Pubkey::find_program_address(
            &[BUFFER_SEED, player_key.as_ref()],
            &crate::ID,
        );
        let buffer_signer_seeds: &[&[u8]] = &[
            BUFFER_SEED,
            player_key.as_ref(),
            &[buffer_bump],
        ];

        let data_len = ctx.accounts.player.data_len();
        let rent = SolanaRent::get()?;

        // ── 1. Create the buffer PDA ───────────────────────────────────────
        invoke_signed(
            &system_instruction::create_account(
                ctx.accounts.authority.key,
                ctx.accounts.delegate_buffer.key,
                rent.minimum_balance(data_len),
                data_len as u64,
                &crate::ID,
            ),
            &[
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.delegate_buffer.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[buffer_signer_seeds],
        )?;

        // ── 2. Copy player data → buffer ───────────────────────────────────
        {
            let player_data = ctx.accounts.player.data.borrow();
            let mut buffer_data = ctx.accounts.delegate_buffer.data.borrow_mut();
            buffer_data.copy_from_slice(&player_data);
        }

        // ── 3. Zero the player PDA data ────────────────────────────────────
        {
            let mut player_data = ctx.accounts.player.data.borrow_mut();
            sol_memset(&mut player_data, 0, data_len);
        }

        // ── 4. Reassign player PDA → delegation program ────────────────────
        // First move ownership to system program so assign CPI can proceed
        ctx.accounts.player.assign(&anchor_lang::solana_program::system_program::id());
        invoke_signed(
            &system_instruction::assign(
                ctx.accounts.player.key,
                &DELEGATION_PROGRAM_ID,
            ),
            &[
                ctx.accounts.player.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[player_signer_seeds],
        )?;

        // ── 5. CPI → delegation program ────────────────────────────────────
        // Instruction discriminator: [0,0,0,0,0,0,0,0]
        // Data layout (Borsh after discriminator):
        //   u32  commit_frequency_ms
        //   u32  seeds.len()
        //   [u32 len + bytes] for each seed
        //   u8   option tag (0 = no validator preference)
        let seeds_vec: [Vec<u8>; 2] = [
            PLAYER_SEED.to_vec(),
            authority_key.to_bytes().to_vec(),
        ];
        let mut ix_data: Vec<u8> = Vec::with_capacity(64);
        ix_data.extend_from_slice(&[0u8; 8]);                          // discriminator
        ix_data.extend_from_slice(&3_000u32.to_le_bytes());            // commit_frequency_ms
        ix_data.extend_from_slice(&(seeds_vec.len() as u32).to_le_bytes()); // seeds.len()
        for seed in &seeds_vec {
            ix_data.extend_from_slice(&(seed.len() as u32).to_le_bytes());
            ix_data.extend_from_slice(seed);
        }
        ix_data.push(0u8);                                              // None validator

        let delegate_ix = SolInstruction {
            program_id: DELEGATION_PROGRAM_ID,
            accounts: vec![
                SolAccountMeta::new(*ctx.accounts.authority.key, true),
                SolAccountMeta::new(*ctx.accounts.player.key, true),
                SolAccountMeta::new_readonly(crate::ID, false),
                SolAccountMeta::new(*ctx.accounts.delegate_buffer.key, false),
                SolAccountMeta::new(*ctx.accounts.delegation_record.key, false),
                SolAccountMeta::new(*ctx.accounts.delegation_metadata.key, false),
                SolAccountMeta::new_readonly(*ctx.accounts.system_program.key, false),
            ],
            data: ix_data,
        };

        invoke_signed(
            &delegate_ix,
            &[
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.player.to_account_info(),
                ctx.accounts.owner_program.to_account_info(),
                ctx.accounts.delegate_buffer.to_account_info(),
                ctx.accounts.delegation_record.to_account_info(),
                ctx.accounts.delegation_metadata.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[player_signer_seeds],
        )?;

        // ── 6. Close buffer PDA (return rent to authority) ─────────────────
        {
            let buffer_lamports = ctx.accounts.delegate_buffer.lamports();
            **ctx.accounts.delegate_buffer.try_borrow_mut_lamports()? -= buffer_lamports;
            **ctx.accounts.authority.try_borrow_mut_lamports()? += buffer_lamports;
        }

        Ok(())
    }
}

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
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: PDA verified via seeds; authority ownership verified in instruction body
    #[account(
        mut,
        seeds = [PLAYER_SEED, authority.key().as_ref()],
        bump,
    )]
    pub player: UncheckedAccount<'info>,
    /// CHECK: our own program ID, used by the delegation CPI to verify PDA ownership
    pub owner_program: UncheckedAccount<'info>,
    /// CHECK: delegate buffer PDA — seeds ["buffer", player.key()], owned by this program
    #[account(mut)]
    pub delegate_buffer: UncheckedAccount<'info>,
    /// CHECK: delegation record PDA — ["delegation", player.key()], owned by delegation program
    #[account(mut)]
    pub delegation_record: UncheckedAccount<'info>,
    /// CHECK: delegation metadata PDA — ["delegation-metadata", player.key()], owned by delegation program
    #[account(mut)]
    pub delegation_metadata: UncheckedAccount<'info>,
    /// CHECK: MagicBlock delegation program
    pub delegation_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct PlayerState {
    pub authority: Pubkey,
    pub session_authority: Option<Pubkey>,
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
