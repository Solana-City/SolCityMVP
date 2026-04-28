# Deploy do Anchor Program — Solana Playground

## Por que precisa disso

Enquanto o Program ID for `111111...`, o multiplayer funciona via **BroadcastChannel** (múltiplas abas no mesmo navegador). Para multiplayer **cross-browser e cross-device real** via MagicBlock, o programa precisa estar deployado em devnet.

## Método: Solana Playground (sem toolchain local)

Leva ~10 minutos no navegador. Nenhuma instalação necessária.

### Passo 1 — Abrir o Playground

Acesse: https://beta.solpg.io

Crie uma conta ou entre com GitHub.

### Passo 2 — Criar projeto Anchor

1. Clique em **"Create a new project"**
2. Selecione **"Anchor (Rust)"**
3. Nome: `sol-city`

### Passo 3 — Substituir o código

No editor do Playground, abra `src/lib.rs` e **substitua tudo** pelo conteúdo de:

```
/workspaces/SolCityMVP/programs/sol-city/src/lib.rs
```

**Atenção**: remover as linhas que importam `ephemeral_rollups_sdk` por enquanto, pois o Playground pode não ter esse crate. Use esta versão simplificada:

```rust
use anchor_lang::prelude::*;

declare_id!("SERÁ_GERADO_PELO_PLAYGROUND");

pub const PLAYER_SEED: &[u8] = b"player";

#[program]
pub mod sol_city {
    use super::*;

    pub fn initialize_player(ctx: Context<InitializePlayer>, display_name: String) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.authority = ctx.accounts.authority.key();
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

    pub fn update_position(ctx: Context<UpdatePlayer>, x: u32, y: u32, direction: u8) -> Result<()> {
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
```

### Passo 4 — Build e Deploy

1. Clique em **"Build"** (leva ~30s)
2. Se compilar sem erros, clique em **"Deploy"**
3. Selecione **Devnet**
4. O Playground vai mostrar o **Program ID** gerado (algo como `AbCd...xyz`)

### Passo 5 — Atualizar o frontend

Abra `/workspaces/SolCityMVP/apps/web/src/game/solana/program.ts` e substitua:

```typescript
const ENV_PROGRAM_ID =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_SOL_CITY_PROGRAM_ID
    : undefined;

export const SOL_CITY_PROGRAM_ID = new PublicKey(
  ENV_PROGRAM_ID && ENV_PROGRAM_ID.length >= 32
    ? ENV_PROGRAM_ID
    : "11111111111111111111111111111111"  // ← substituir aqui
);
```

**Opção A** — criar `.env.local` em `apps/web/`:
```
NEXT_PUBLIC_SOL_CITY_PROGRAM_ID=SEU_PROGRAM_ID_AQUI
```

**Opção B** — editar diretamente o fallback em `program.ts`.

Reinicie o dev server. O jogo vai detectar automaticamente que o programa está deployado (`isProgramDeployed()` retorna `true`) e:
- `initialize_player` será chamado na primeira conexão de wallet
- Posições serão enviadas via Magic Router para o ephemeral rollup
- Outros jogadores serão descobertos via `getProgramAccounts`

## Verificação

Após conectar a wallet no jogo, verifique em:
https://explorer.solana.com/?cluster=devnet

Procure por transações do seu program ID. Você deve ver o `initialize_player` registrado.

## MagicBlock — próximo passo

Depois do deploy básico funcionar, adicionar a delegação para o ephemeral rollup:
- O TypeScript SDK do MagicBlock está em desenvolvimento
- A instrução `delegate` requer os accounts da delegation program
- Por enquanto, o position tracking vai via Solana base layer (300ms)
- Quando o TS SDK estiver disponível: atualizar `startMagicBlockMultiplayer()` em `OnChainMultiplayer.ts`
