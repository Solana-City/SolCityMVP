# Deploy do Anchor Program — Solana Playground

## Por que precisa disso

Enquanto o Program ID for `111111...`, o multiplayer funciona via **BroadcastChannel** (múltiplas abas no mesmo navegador). Para multiplayer **cross-browser e cross-device real** via MagicBlock ephemeral rollups, o programa precisa estar deployado em devnet.

## Método: Solana Playground (sem toolchain local)

Leva ~10 minutos no navegador. Nenhuma instalação necessária.

### Passo 1 — Abrir o Playground

Acesse: https://beta.solpg.io

Crie uma conta ou entre com GitHub.

### Passo 2 — Criar projeto Anchor

1. Clique em **"Create a new project"**
2. Selecione **"Anchor (Rust)"**
3. Nome: `sol-city`

### Passo 3 — Atualizar Cargo.toml

No Playground, abra `Cargo.toml` e adicione as dependências:

```toml
[dependencies]
anchor-lang = "0.30.1"
ephemeral-rollups-sdk = "0.4"
```

### Passo 4 — Substituir src/lib.rs

No editor do Playground, abra `src/lib.rs` e **substitua tudo** pelo conteúdo abaixo.
Este é o programa completo com session keys + delegação MagicBlock:

```rust
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::cpi::{delegate_account, commit_and_undelegate_accounts};
use ephemeral_rollups_sdk::consts::DELEGATION_PROGRAM_ID;

declare_id!("SERÁ_GERADO_PELO_PLAYGROUND");

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

### Passo 5 — Build e Deploy

1. Clique em **"Build"** (leva ~30s — o Playground baixa os crates automaticamente)
2. Se compilar sem erros, clique em **"Deploy"**
3. Selecione **Devnet**
4. O Playground vai mostrar o **Program ID** gerado (algo como `AbCd...xyz`)

### Passo 6 — Atualizar o frontend

Crie o arquivo `apps/web/.env.local`:

```
NEXT_PUBLIC_SOL_CITY_PROGRAM_ID=SEU_PROGRAM_ID_AQUI
```

Reinicie o dev server. O jogo detecta automaticamente que o programa está deployado (`isProgramDeployed()` retorna `true`) e:

1. **Primeira conexão de wallet:**
   - `initialize_player` — cria PDA na base layer (popup #1)
   - `authorize_session` — registra session key no PDA (popup #2)
   - `delegate` — delega PDA para o ephemeral rollup (popup #3)

2. **Reconexões subsequentes:**
   - PDA já existe + já delegado
   - `authorize_session` via Magic Router com nova session key (popup #1)

3. **Durante o jogo:**
   - Posições enviadas via session key → Magic Router → ephemeral validator
   - Sub-50ms, sem popups, sem gas

4. **Ao desconectar:**
   - `commitAndUndelegate` via session key → ephemeral RPC (sem popup)
   - Estado final commitado de volta para devnet

## Verificação

Após conectar a wallet no jogo, verifique em:
https://explorer.solana.com/?cluster=devnet

Procure por transações do seu program ID. Você deve ver:
- `initialize_player`
- `authorize_session`
- `delegate`

Para ver posições em tempo real no rollup:
https://devnet.magicblock.app (ephemeral RPC explorer)
