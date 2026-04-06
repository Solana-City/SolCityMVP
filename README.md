# The Solana City

A multiplayer 2D city where users access Solana ecosystem services by walking up to buildings and talking to NPCs. Every interaction is a real transaction. Your avatar reflects your on-chain history.

## Stack

- **World Engine:** Phaser 3 + Tiled + Aseprite
- **App Shell:** Next.js 14 + TypeScript + Tailwind
- **Multiplayer:** Colyseus (WebSocket rooms)
- **Solana:** Wallet Adapter + Jupiter API + Helius DAS
- **Persistence:** Supabase + Redis

## Getting started

```bash
cd apps/web
npm install
npm run dev
```

Open http://localhost:3000

## Project structure

```
sol-city/
  apps/
    web/          # Next.js + Phaser client
    server/       # Colyseus multiplayer server
  packages/
    shared/       # Shared types and constants
  assets/
    tiled/        # Tiled map source files (.tmx)
    aseprite/     # Aseprite sprite sources (.ase)
```

## License

Proprietary. All rights reserved.
