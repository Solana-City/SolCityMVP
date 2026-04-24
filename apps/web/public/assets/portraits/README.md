# NPC Portraits

Drop PNG portraits here. The filename must match the NPC `id` from
`apps/web/src/game/config/npcRegistry.ts`.

## Expected files

| File              | NPC            | Theme color |
| ----------------- | -------------- | ----------- |
| `sol-guide.png`   | Sol            | `#14F195`   |
| `swap-npc.png`    | Jupiter Joe    | `#FFD700`   |
| `send-npc.png`    | Postmaster Ana | `#00D1FF`   |
| `st-maya.png`     | Maya           | `#9945FF`   |

## Specs

- **Resolution:** 256×256 px (or any square multiple of 64 — pixel art
  scales cleanly up via `image-rendering: pixelated`).
- **Format:** PNG with transparent background.
- **Composition:** Bust / head-and-shoulders, character facing slightly
  toward the dialog bubble (i.e. to the **right**). Keep a few pixels
  of padding so the art doesn't touch the frame edges.
- **Style:** Pixel art consistent with the city's late-90s JRPG +
  cyberpunk palette. Use the NPC's theme color as a visual accent
  (hat, clothing, lighting).

## Fallback

Any NPC without a portrait file — or with a broken path — automatically
renders a colored tile with the first letter of the NPC's name. No code
changes needed when adding or removing portraits.

## Adding a new NPC

1. Add a `portrait: "/assets/portraits/{id}.png"` field to the NPC in
   `npcRegistry.ts`.
2. Drop the PNG here with the matching filename.
3. Done.
