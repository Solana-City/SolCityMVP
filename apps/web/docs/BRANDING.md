# SolanaCity Branding Guide

Source of truth for colors, type, and UI chrome for the **main SolanaCity app**
(`apps/web`). Does not cover Sol Mechs, which has its own design system at
[`src/game/minigames/sol-mechs/theme.ts`](../src/game/minigames/sol-mechs/theme.ts)
and will be reconciled with this guide in a later pass.

## Logo

Assets: [`Branding/`](../../../Branding) (app icons, banners, Twitter assets) and
[`public/assets/branding/`](../public/assets/branding) (in-app icon/banner).

The wordmark is "Solana" in brand teal + "City" in brand lime, on the navy
background — never recolor the wordmark or place it on a light background.

## Color system

### Brand core (from the logo)

| Role | Token | Hex |
|---|---|---|
| Teal (Solana wordmark, primary accent) | `sol.cyan` | `#00D1FF` |
| Lime (City wordmark, primary action) | `sol.green` | `#14F195` |
| Background (navy) | `sol.dark` | `#0E0E2C` |

### Supporting brand accents

Already the dominant secondary colors across the UI (38 and 32 uses
respectively in `src/ui/*.tsx`) — keep as official.

| Role | Token | Hex |
|---|---|---|
| Purple (secondary accent) | `sol.purple` | `#9945FF` |
| Gold (premium / highlight) | `sol.gold` | `#FFD700` |

### Category / wayfinding colors

A **separate, intentional palette** used only for minimap categories and the
map legend ([`src/game/minimap/categories.ts`](../src/game/minimap/categories.ts)).
Softer than the brand accents on purpose so category markers don't compete
with action buttons. Already good — do not change without updating both the
legend and every marker that reads `CATEGORY_META`.

| Category | Hex |
|---|---|
| Guide | `#facc15` |
| Protocols | `#14F195` |
| Mini-games | `#FFA94D` |
| Community | `#38bdf8` |
| Places | `#c084fc` |
| Players | `#f8fafc` |

### Neutral scale

Codifies the grays already in de-facto use across `src/ui/*.tsx` (previously
ad-hoc, repeated with slight variations file to file). New components should
use these five steps instead of inventing another gray.

| Step | Hex | Use |
|---|---|---|
| `neutral.bg` | `#12122A` | panel / card background |
| `neutral.raised` | `#1A1A3A` | raised surface within a panel |
| `neutral.border` | `#333344` | borders, dividers, disabled button bg |
| `neutral.muted` | `#666677` | secondary/disabled text |
| `neutral.dim` | `#8B8BA7` | placeholder / de-emphasized text |

### Semantic / error colors

Two reds are already live and **both stay** — they mean different things, not
a duplicate:

| Role | Hex | Where |
|---|---|---|
| General error / danger | `#FF4444` | inline validation, generic failure states |
| Transaction failed | `#F72585` | `TransactionLogPanel` — tx status specifically |
| Warning / rival / CTA accent | `#FF6B35` | opponent markers, alert CTAs (kite-clash, food-cart) |
| Success | `#14F195` | reuses brand green |

## Typography

Single face across the entire app: **Press Start 2P**, self-hosted at
[`public/fonts/PressStart2P-Regular.woff2`](../public/fonts/PressStart2P-Regular.woff2),
set globally in [`globals.css`](../src/app/globals.css). Do not introduce a
second display face for the main app. Because Press Start 2P's glyphs are
wide/heavy, keep body copy at 12px minimum — nothing reads reliably below
that at this font's weight.

## UI chrome (in progress)

**Problem:** the game world renders as crisp, un-blurred pixel art
(`image-rendering: pixelated`), but UI panels (chat, quests, minimap) use
`backdropFilter: blur(...)`, soft `boxShadow`, and large `borderRadius` — a
glassmorphism treatment that clashes with the pixel-art world underneath.

**Direction:** replace panel chrome with a hand-drawn 9-slice pixel frame,
the same technique Sol Mechs already uses
(see `frame()` in [`sol-mechs/theme.ts`](../src/game/minigames/sol-mechs/theme.ts)) —
solid pixel border, opaque panel background, no blur, no soft shadow.

**Status:** art asset pending (owner: user). Spec below.

### Frame art spec

- File: `public/assets/branding/ui/frame.png`
- Canvas: 128×128px (square, easy pixel grid; CSS `border-image` stretches it, so exact size isn't load-bearing as long as it's square)
- Style: pixel-art border ring, chamfered or straight corners, drawn in the brand core colors (teal `#00D1FF` / lime `#14F195`) rather than Sol Mechs' cyan/purple mech theme
- **Interior must be transparent** — only the border ring renders; the panel supplies its own background color/grid behind it (same trick Sol Mechs uses: flood-fill the center to transparent)
- Export: PNG, no anti-aliasing across the pixel edges (nearest-neighbor / index color)
- Slice: once delivered, wired as `border-image: url(frame.png) <slice> / <width>px / 0 stretch` — exact slice number depends on final chamfer size, set when the asset lands

Once the asset exists, this becomes a `PixelFrame` pattern applied to
`ChatPanel`, `QuestPanel`, `Minimap`, and other panels currently using the
blur/shadow treatment (see `src/ui/QuestPanel.tsx:160-165`,
`src/ui/ChatPanel.tsx:165-170`, `src/ui/Minimap.tsx:356-358` for the current
state to replace).

## Buttons & cards (baseline, v1)

Interim baseline until the pixel-frame system lands — describes the current
consistent pattern already used across `src/ui/*.tsx`, so new components stay
aligned rather than inventing another variant:

- Background: `neutral.bg` (`#12122A`) for cards/panels, `neutral.border` (`#333344`) for secondary/disabled buttons
- Primary action button: brand green (`#14F195`) background, dark text
- Border: `1px solid` at ~20-30% opacity of the relevant brand/semantic color (e.g. `rgba(20,241,149,0.25)`) rather than a neutral gray border
- Radius: 6-16px depending on component size (small controls ~6-8px, panels ~14-16px) — superseded by the pixel-frame system once it lands, since that system uses square/chamfered corners instead
