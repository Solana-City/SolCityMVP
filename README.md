# The Solana City

A multiplayer 2D city where users access Solana ecosystem services by walking up to buildings and talking to NPCs. Every interaction is a real transaction. Your avatar reflects your on-chain history.

## Architecture

Fully on-chain multiplayer via MagicBlock Ephemeral Rollups. No centralized game server.

```
Player connects wallet
  └─> Session key created (one-time Phantom approval)
      └─> Player PDA delegated to Ephemeral Rollup
          └─> Position updates: sub-50ms, gasless, auto-signed
          └─> Swap/Transfer: real Solana transactions via Jupiter/web3.js
          └─> Other players: subscribe to PDA changes in real-time
              └─> Session end: state committed to Solana L1
```

## Stack

- **World Engine:** Phaser 3 + programmatic tilemap
- **App Shell:** Next.js 14 + TypeScript + Tailwind
- **Multiplayer:** MagicBlock Ephemeral Rollups (fully on-chain)
- **Solana:** Wallet Adapter + Jupiter Swap V2 + SPL Token transfers
- **Smart Contract:** Anchor (Rust) with MagicBlock delegation hooks
- **Sprites:** SimpleSprite system (48x48, 4x4 grid sprite sheets)

## Getting started

```bash
cd apps/web
npm install
npm run dev
```

Open http://localhost:3000

## Deploy

```bash
# Vercel (frontend)
vercel --prod

# Anchor program (on-chain)
anchor build
anchor deploy --provider.cluster devnet
```

## Project structure

```
sol-city/
  apps/web/               # Next.js + Phaser client
    src/
      app/                # Next.js pages
      game/               # Phaser game engine
        entities/         # SimpleSprite, NPCSprite
        scenes/           # BootScene, CityScene
        multiplayer/      # OnChainMultiplayer (MagicBlock)
        solana/           # Jupiter, transfers, session keys, MagicBlock
        chat/             # ChatManager, ChatBubble, EmojiSystem
        config/           # NPC registry, map config, profile
      ui/                 # React overlays (chat, dialogs, panels)
    public/assets/        # Sprites, maps, tilesets
  programs/sol-city/      # Anchor program (Rust)
  packages/shared/        # Shared TypeScript types
```

## License

Proprietary. All rights reserved.
