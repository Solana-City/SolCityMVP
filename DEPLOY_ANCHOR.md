# Anchor Program Deploy — Solana Playground

## Why this is needed

While the Program ID is `111111...`, multiplayer runs via **BroadcastChannel** (multiple tabs in the same browser). For real **cross-browser and cross-device** multiplayer via MagicBlock ephemeral rollups, the program must be deployed to devnet.

## Method: Solana Playground (no local toolchain required)

Takes ~10 minutes in the browser. No installation needed.

### Step 1 — Open the Playground

Go to: https://beta.solpg.io

Create an account or sign in with GitHub.

### Step 2 — Create an Anchor project

1. Click **"Create a new project"**
2. Select **"Anchor (Rust)"**
3. Name: `sol-city`

### Step 3 — Update Cargo.toml

In the Playground, open `Cargo.toml` and add the dependencies:

```toml
[dependencies]
anchor-lang = "0.30.1"
ephemeral-rollups-sdk = "0.4"
```

### Step 4 — Replace src/lib.rs

In the Playground editor, open `src/lib.rs` and **replace everything** with the content below.
This is the full program with session keys + MagicBlock delegation:

```rust
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::cpi::{delegate_account, commit_and_undelegate_accounts};
use ephemeral_rollups_sdk::consts::DELEGATION_PROGRAM_ID;

declare_id!("WILL_BE_GENERATED_BY_PLAYGROUND");

pub const PLAYER_SEED: &[u8] = b"player";

#[error_code]
pub enum SolCityError {
    #[msg("Invalid session key — call authorize_session first")]
    InvalidSessionKey,
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

    /// One-time popup: authorizes an ephemeral session key.
    /// After this, update_position_session runs with no popup.
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

    /// Delegates the player PDA to a MagicBlock Ephemeral Rollup.
    /// After delegation, position updates run gasless at sub-50ms via Magic Router.
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

    /// Commits state back to base layer and undelegates.
    /// Called automatically on disconnect (session key signs, no popup).
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
    #[account(
        mut,
        seeds = [PLAYER_SEED, authority.key().as_ref()],
        bump,
    )]
    pub player: Account<'info, PlayerState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: must be this program's own ID
    #[account(address = crate::ID)]
    pub owner_program: AccountInfo<'info>,
    /// CHECK: buffer PDA — validated inside the delegation CPI
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
```

### Step 5 — Build and Deploy

1. Click **"Build"** (~30s — the Playground downloads crates automatically)
2. If it compiles without errors, click **"Deploy"**
3. Select **Devnet**
4. The Playground will show the generated **Program ID** (e.g. `AbCd...xyz`)

### Step 6 — Update the frontend

Create the file `apps/web/.env.local`:

```
NEXT_PUBLIC_SOL_CITY_PROGRAM_ID=YOUR_PROGRAM_ID_HERE
```

Restart the dev server. The game automatically detects the deployed program (`isProgramDeployed()` returns `true`) and:

1. **First wallet connection:**
   - `initialize_player` — creates PDA on base layer (popup #1)
   - `authorize_session` — registers session key in the PDA (popup #2)
   - `delegate` — delegates PDA to the ephemeral rollup (popup #3)

2. **Subsequent reconnections:**
   - PDA already exists + already delegated
   - `authorize_session` via Magic Router with new session key (popup #1)

3. **During gameplay:**
   - Positions sent via session key → Magic Router → ephemeral validator
   - Sub-50ms, no popups, no gas

4. **On disconnect:**
   - `commitAndUndelegate` via session key → ephemeral RPC (no popup)
   - Final state committed back to devnet

## Verification

After connecting your wallet in the game, check:
https://explorer.solana.com/?cluster=devnet

Search for transactions from your program ID. You should see:
- `initialize_player`
- `authorize_session`
- `delegate`

To watch positions in real time on the rollup:
https://devnet.magicblock.app (ephemeral RPC explorer)
