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

## Android, on Seeker

`apps/android/` is the Solana Mobile dApp Store build: a Kotlin app around the
live web client, built from Solana Mobile's official web-shell template, which
their docs recommend in place of Bubblewrap.

The web client at [solanacity.io](https://www.solanacity.io) stays the primary
client for desktop and mobile browsers. Both run the same build against the same
program, so a player on the app and a player in a browser walk the same streets,
see each other move and compete in the same hunt, with no lobby and no server to
federate: the shared world is the chain.

The shell is not a plain WebView. What the Kotlin layer adds, with the reasoning
in `apps/android/README.md`:

- Mobile Wallet Adapter hand-off to Seed Vault, with the session key derived
  once so nothing interrupts play afterwards
- Landscape lock, immersive fullscreen, screen kept on
- Back button closes the open panel instead of leaving the game
- JS timers pause in the background to spare the battery, but never during a
  wallet hand-off, which would kill the MWA session
- Keyboard handling that keeps chat usable in landscape, without Android's
  fullscreen text editor
- A `window.SolCityNative` bridge for native features, absent in browsers

### Hackathon context

This project started on 2026-04-06, months before CLOCK IN opened on 2026-09-08,
and enters under the rule for pre-existing projects. The entire Android layer,
and the mobile work in the web client that supports it, were built during the
hackathon. Every commit for it carries an `(android)` or mobile-fix scope:

```bash
git log --grep="(android)" --since=2026-09-08 --oneline
```

Scope and status: `MOBILE_HACKATHON_SCOPE.md` and `HACKATHON_SUBMISSION.md`.

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
