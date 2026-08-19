use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    pubkey,
    program::{invoke, invoke_signed},
    system_instruction,
    program_memory::sol_memset,
    rent::Rent as SolanaRent,
    sysvar::Sysvar as SolanaSysvar,
    instruction::{AccountMeta as SolAccountMeta, Instruction as SolInstruction},
};

// ── MagicBlock ephemeral VRF (outfit booster) ──────────────────────────────
// BUILD NOTES (verify against ephemeral-vrf-sdk 0.3.0 when building in Solana
// Playground — the crate's exact module paths may differ slightly and the
// build will name any mismatch):
//   • #[vrf] macro augments the request Accounts ctx with the VRF program and
//     adds `ctx.accounts.invoke_signed_vrf(&payer, &ix)`.
//   • create_request_randomness_ix(RequestRandomnessParams { payer, oracle_queue,
//     callback_program_id, callback_discriminator, caller_seed, accounts_metas, .. })
//   • consts::DEFAULT_QUEUE (base devnet Cuj97…AxGh) / VRF_PROGRAM_IDENTITY
//   • rnd helpers exist too; we derive indices from the raw [u8;32] here.
use ephemeral_vrf_sdk::anchor::vrf;
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;
use ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY;

declare_id!("HPvDFVnruSXHwKKP44eUvRh8oYqBaHCeQbK1sKWT1aU2");

// Bumped to "player_v2" when the PlayerState layout grew (loadout / expression
// / chat fields). New PDAs are fresh at the new size, so existing accounts are
// simply ignored — no on-chain migration/realloc needed. The client's
// derivePlayerPDA uses the same seed.
pub const PLAYER_SEED: &[u8] = b"player_v2";
pub const BUFFER_SEED: &[u8] = b"buffer";
/// Global "Find Someone" hunt state — one account for the whole city.
pub const HUNT_SEED: &[u8] = b"hunt";
/// How long a citizen sticks around before it rotates unfound (seconds).
pub const CITIZEN_DURATION_SECS: i64 = 300;

// ── Outfit booster ─────────────────────────────────────────────────────────
/// Per-wallet unlock store (bitset of booster-pool item indices).
pub const UNLOCKS_SEED: &[u8] = b"unlocks";
/// Bitset capacity in bytes → 256 possible item indices. The CLIENT owns the
/// index→item table (getBoosterPool order); the pool count per draw is passed
/// per request and stored on the account, so the pool can grow without a
/// redeploy (append-only, never reorder).
pub const UNLOCK_BITS: usize = 32;
/// Pieces granted per pack.
pub const BOOSTER_PACK_SIZE: usize = 5;
/// Price to open a pack (0.01 SOL on devnet).
pub const BOOSTER_PRICE_LAMPORTS: u64 = 10_000_000;
/// Treasury that receives pack payments (the game wallet).
pub const TREASURY: Pubkey = pubkey!("9592QS34mPUwqA7sPAkug1kcuFddjn59QPQMzzCgKhEp");

/// MagicBlock delegation program on devnet.
pub const DELEGATION_PROGRAM_ID: Pubkey =
    pubkey!("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

#[error_code]
pub enum SolCityError {
    #[msg("Invalid session key — call authorize_session first")]
    InvalidSessionKey,
    #[msg("Authority mismatch — wrong wallet for this player")]
    InvalidAuthority,
    #[msg("Hunt round is stale — someone already advanced it")]
    HuntRoundStale,
    #[msg("Hunt citizen has not expired yet")]
    HuntNotExpired,
    #[msg("A booster pack is already being opened for this wallet")]
    BoosterPending,
    #[msg("Booster pool count too small for a full pack")]
    InvalidPoolCount,
    #[msg("Wrong treasury account")]
    InvalidTreasury,
}

/// Truncates a string to at most `max` BYTES on a char boundary, so a
/// multi-byte char (emoji in chat) never overflows a fixed-size account field.
fn cap_bytes(s: String, max: usize) -> String {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
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
        player.loadout = String::new();
        player.expression = String::new();
        player.expression_at = 0;
        player.last_message = String::new();
        player.message_at = 0;
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

    /// Records a mini-game result via session key — no wallet popup, routes
    /// through the Magic Router to the ephemeral rollup if the PDA is delegated.
    ///
    /// success=true  → score += score_delta, bounty_count += 1
    /// success=false → last_active updated only (loss is recorded, no penalty)
    pub fn record_mini_game_session(
        ctx: Context<UpdatePlayerSession>,
        success: bool,
        score_delta: u32,
    ) -> Result<()> {
        let player = &mut ctx.accounts.player;
        if success {
            player.score = player.score.saturating_add(score_delta);
            player.bounty_count = player.bounty_count.saturating_add(1);
        }
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn change_outfit(ctx: Context<UpdatePlayer>, outfit_id: u8) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.outfit_id = outfit_id;
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    // ── Shared-world signals on the ER (replace the base-layer Memo channel) ──
    // All session-signed (seamless), all written to the delegated PDA on the
    // rollup, and read by everyone off the same position poll — no base RPC,
    // near-zero fee.

    /// Broadcasts the full paper-doll loadout (pipe-encoded, e.g.
    /// "skin=Light|hair=Afro"). Others render the real avatar from the poll.
    pub fn update_look_session(ctx: Context<UpdatePlayerSession>, loadout: String) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.loadout = cap_bytes(loadout, 120);
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Sets the current facial expression (id/textureKey) + timestamp. Readers
    /// play it when `expression_at` advances, with the usual auto-revert.
    pub fn set_expression_session(ctx: Context<UpdatePlayerSession>, expression: String) -> Result<()> {
        let player = &mut ctx.accounts.player;
        let now = Clock::get()?.unix_timestamp;
        player.expression = cap_bytes(expression, 24);
        player.expression_at = now;
        player.last_active = now;
        Ok(())
    }

    /// Stores the latest chat message + timestamp — a bubble/last-message
    /// channel on the ER, replacing the base-layer memo.
    pub fn send_chat_session(ctx: Context<UpdatePlayerSession>, message: String) -> Result<()> {
        let player = &mut ctx.accounts.player;
        let now = Clock::get()?.unix_timestamp;
        player.last_message = cap_bytes(message, 200);
        player.message_at = now;
        player.last_active = now;
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

    // ── "Find Someone" global hunt ─────────────────────────────────────────
    //
    // One global HuntState account is the shared source of truth for the
    // city-wide hide-and-seek: its `round` deterministically seeds the target
    // citizen (every client derives the same pedestrian from it), and its
    // `deadline` drives the countdown. Advancing the round — on a find or on
    // expiry — is the universal "next citizen + reset timer" signal every
    // client reads. All writes are signed by a session key (seamless, no
    // wallet popup) and are first-writer-wins via the `round` guard, so the
    // first player to land a claim for a given round is the sole winner.

    /// Creates the global hunt account (call once, ever, after deploy).
    pub fn initialize_hunt(ctx: Context<InitializeHunt>) -> Result<()> {
        let hunt = &mut ctx.accounts.hunt;
        let now = Clock::get()?.unix_timestamp;
        hunt.round = 0;
        hunt.winner = Pubkey::default();
        hunt.found_at = now;
        hunt.deadline = now + CITIZEN_DURATION_SECS;
        Ok(())
    }

    /// First finder of `round` wins it and advances the hunt to the next
    /// citizen. A concurrent claim for the same round fails the guard once
    /// the round has moved on, so exactly one winner is recorded per round.
    pub fn claim_find(ctx: Context<ClaimFind>, round: u32) -> Result<()> {
        let hunt = &mut ctx.accounts.hunt;
        require!(hunt.round == round, SolCityError::HuntRoundStale);
        let now = Clock::get()?.unix_timestamp;
        hunt.winner = ctx.accounts.finder.key(); // session key of the finder
        hunt.round = hunt.round.wrapping_add(1);
        hunt.found_at = now;
        hunt.deadline = now + CITIZEN_DURATION_SECS;
        Ok(())
    }

    /// Rolls a citizen nobody found once its deadline has passed. Any client
    /// can crank it; first-writer-wins keeps it to a single advance.
    pub fn expire_round(ctx: Context<ExpireRound>, round: u32) -> Result<()> {
        let hunt = &mut ctx.accounts.hunt;
        require!(hunt.round == round, SolCityError::HuntRoundStale);
        let now = Clock::get()?.unix_timestamp;
        require!(now >= hunt.deadline, SolCityError::HuntNotExpired);
        hunt.winner = Pubkey::default(); // expired — no winner this round
        hunt.round = hunt.round.wrapping_add(1);
        hunt.found_at = now;
        hunt.deadline = now + CITIZEN_DURATION_SECS;
        Ok(())
    }

    // ── Outfit booster (VRF) ───────────────────────────────────────────────
    //
    // open_booster: wallet pays BOOSTER_PRICE_LAMPORTS to the treasury and
    // requests verifiable randomness from MagicBlock VRF, naming
    // callback_open_booster as the consumer. `pool_count` is the client's
    // current getBoosterPool() length (the index space to draw from); it's
    // stored on the unlock account so the async callback can use it.
    //
    // callback_open_booster: invoked by the VRF oracle (signed by the VRF
    // program identity). Derives BOOSTER_PACK_SIZE distinct indices in
    // [0, pool_count) from the verified randomness, sets those bits in the
    // wallet's UnlockState, and emits BoosterOpened so the client reveals them.

    pub fn open_booster(
        ctx: Context<OpenBooster>,
        pool_count: u16,
        client_seed: [u8; 32],
    ) -> Result<()> {
        require!(pool_count as usize >= BOOSTER_PACK_SIZE, SolCityError::InvalidPoolCount);
        require_keys_eq!(ctx.accounts.treasury.key(), TREASURY, SolCityError::InvalidTreasury);

        {
            let unlocks = &mut ctx.accounts.unlock_state;
            require!(!unlocks.pending, SolCityError::BoosterPending);
            if unlocks.authority == Pubkey::default() {
                unlocks.authority = ctx.accounts.payer.key();
            }
            unlocks.pending = true;
            unlocks.pending_pool_count = pool_count;
        }

        // Payment → treasury (wallet is the signer/fee payer).
        invoke(
            &system_instruction::transfer(
                ctx.accounts.payer.key,
                ctx.accounts.treasury.key,
                BOOSTER_PRICE_LAMPORTS,
            ),
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.treasury.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Request randomness; the callback grants into this UnlockState.
        let ix = create_request_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: ID,
            callback_discriminator: instruction::CallbackOpenBooster::DISCRIMINATOR.to_vec(),
            caller_seed: client_seed,
            accounts_metas: Some(vec![SerializableAccountMeta {
                pubkey: ctx.accounts.unlock_state.key(),
                is_signer: false,
                is_writable: true,
            }]),
            ..Default::default()
        });
        ctx.accounts.invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
        Ok(())
    }

    pub fn callback_open_booster(
        ctx: Context<CallbackOpenBooster>,
        randomness: [u8; 32],
    ) -> Result<()> {
        let unlocks = &mut ctx.accounts.unlock_state;
        let n = unlocks.pending_pool_count.max(1);

        let mut picks: Vec<u16> = Vec::with_capacity(BOOSTER_PACK_SIZE);
        let mut cursor: usize = 0;
        // 32 bytes → up to 31 index candidates; plenty to find 5 distinct.
        while picks.len() < BOOSTER_PACK_SIZE && cursor < 31 {
            let hi = randomness[cursor] as u16;
            let lo = randomness[cursor + 1] as u16;
            let idx = ((hi << 8) | lo) % n;
            if !picks.contains(&idx) {
                picks.push(idx);
                let byte = (idx / 8) as usize;
                if byte < UNLOCK_BITS {
                    unlocks.bits[byte] |= 1u8 << (idx % 8) as u8;
                }
            }
            cursor += 1;
        }

        unlocks.pending = false;
        emit!(BoosterOpened { authority: unlocks.authority, indices: picks });
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

#[derive(Accounts)]
pub struct InitializeHunt<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + HuntState::INIT_SPACE,
        seeds = [HUNT_SEED],
        bump,
    )]
    pub hunt: Account<'info, HuntState>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimFind<'info> {
    #[account(mut, seeds = [HUNT_SEED], bump)]
    pub hunt: Account<'info, HuntState>,
    /// Session key — seamless, no wallet popup. Recorded as the round winner.
    pub finder: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExpireRound<'info> {
    #[account(mut, seeds = [HUNT_SEED], bump)]
    pub hunt: Account<'info, HuntState>,
    /// Any session key may crank an expired round forward.
    pub cranker: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct HuntState {
    /// Increments on every find or expiry — deterministically seeds the target.
    pub round: u32,
    /// Session key of the current round's finder (default = expired/unfound).
    pub winner: Pubkey,
    /// Unix ts of the last round advance.
    pub found_at: i64,
    /// Unix ts the current citizen rotates if still unfound.
    pub deadline: i64,
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
    // ── Shared-world signals (read off the same ER poll as position) ──────
    /// Pipe-encoded paper-doll loadout ("skin=Light|hair=Afro|..."). "" = none.
    #[max_len(120)]
    pub loadout: String,
    /// Current facial expression id/textureKey. "" = none.
    #[max_len(24)]
    pub expression: String,
    /// Unix ts the expression was set — drives newness + auto-revert on readers.
    pub expression_at: i64,
    /// Latest chat message.
    #[max_len(200)]
    pub last_message: String,
    /// Unix ts the last message was sent.
    pub message_at: i64,
}

// ── Outfit booster accounts ────────────────────────────────────────────────

#[vrf]
#[derive(Accounts)]
pub struct OpenBooster<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + UnlockState::INIT_SPACE,
        seeds = [UNLOCKS_SEED, payer.key().as_ref()],
        bump,
    )]
    pub unlock_state: Account<'info, UnlockState>,
    /// CHECK: address-checked against TREASURY in the instruction body.
    #[account(mut)]
    pub treasury: AccountInfo<'info>,
    /// CHECK: MagicBlock VRF oracle queue (base devnet).
    #[account(mut, address = ephemeral_vrf_sdk::consts::DEFAULT_QUEUE)]
    pub oracle_queue: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CallbackOpenBooster<'info> {
    /// Only the MagicBlock VRF program identity may invoke the callback.
    #[account(address = VRF_PROGRAM_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,
    /// Re-derived from the authority stored on the account (the wallet doesn't
    /// sign the callback — the oracle does), so the grant lands on the right PDA.
    #[account(
        mut,
        seeds = [UNLOCKS_SEED, unlock_state.authority.as_ref()],
        bump,
    )]
    pub unlock_state: Account<'info, UnlockState>,
}

#[account]
#[derive(InitSpace)]
pub struct UnlockState {
    /// Wallet that owns these unlocks.
    pub authority: Pubkey,
    /// Bitset of unlocked booster-pool indices (1 bit per index).
    pub bits: [u8; UNLOCK_BITS],
    /// A pack has been paid for and is awaiting the VRF callback.
    pub pending: bool,
    /// Index space for the pending draw (client getBoosterPool length).
    pub pending_pool_count: u16,
}

/// Emitted when a pack resolves — the client reveals these pool indices.
#[event]
pub struct BoosterOpened {
    pub authority: Pubkey,
    pub indices: Vec<u16>,
}
