# Art requests — Solana City + Sol Mechs

Everything the game still draws with placeholders, CSS or borrowed sprites,
ranked. Updated 2026-09-22. Screens already work without the art; each line
says what it replaces.

## Formats

- **Characters and outfits** (NPCs, wardrobe pieces): PNG 256x256, a 4x4 grid of
  64x64 frames. Rows: down, up, right, left. Four walk frames per row.
  Transparent background, or the usual magenta key.
- **Mech parts**: 128x128 per part, zero offset. Layer order far arm, matrix,
  legs, front arm (the front arm is `handL`).
- **UI**: PNG at 1x, transparent, crisp pixel grid (rendered with
  `image-rendering: pixelated`, so no anti-aliasing and no baked shadows).
  Palette: teal `#21dda0` / `#14F195`, cyan `#3fe0ff`, purple `#9a46fe` /
  `#9945FF`, gold `#FFD700`, warn `#ffa726`, bad `#ff5468`, ink `#0b0616`.
- **Map buildings in Tiled**: erase the empty tiles around a building before
  saving. A building sliced into a full rectangle paints invisible tiles over
  the sidewalk; the game now copes with it, but it costs draw calls and made
  whole buildings fade when someone walked past their empty corner.

---

## 1. NPCs (highest priority: players meet them first)

| NPC | Today | Needs |
| --- | --- | --- |
| **Mech Builder** (Sol Mechs hangar door) | default avatar | own character sheet; mechanic / engineer look |
| **Stocks Broker** (Stocklana, Sunrise Stock Exchange) | default avatar | own character sheet; trader look |
| **Hair Specialist** (Superteam Turkey) | dressed from the wardrobe (red mohawk, white tee) | optional own sheet; Turkey red `#E30A17` accent |
| **8-10 ST Brasil builders** | 3 delivered and in the city (Raffx / Pegana, Crash / SolSentry, Mole / Dungeons & Moles), the rest not drawn yet | one sheet each, same format as the three delivered: one row of 6 frames at 64x64, idle in place, pink `215,123,186` background. Meeting all of them earns the Brazil shirt, so the list closes only when every builder is in |

## 2. Outfits: a Solana set

Only one wardrobe item carries the Solana logo today (Cap Sol, now the
reward for a 7-day check-in streak). Ideas, final choices are the team's:

- Solana tee (white or black, gradient logo on the chest)
- Solana hoodie
- Solana backpack (gradient, logo on the back)
- Solana shorts or pants (gradient side stripe)
- Solana bracelet or ring (accessory slot)
- Solana jetpack (gradient version of the current jetpack)
- Solana visor or beanie

More pieces in general also feed the **outfit boxes** (0.025 SOL, 5 pieces per
box), so the pool can keep growing.

## 3. Sol Mechs

**Ranked** (built, hidden until the program upgrade). Files go in
`apps/web/public/assets/minigames/sol-mechs/ui/ranked/`.

1. Energy pips, `energy-on.png` / `energy-off.png`, 18x10 (replaces CSS bars)
2. Energy pack icon, `energy-pack.png`, 24x24 ("+5 ENERGY" button)
3. Queue search animation, `scan.png`, strip of 4-6 frames at 64x64 (radar sweep
   or a mech scanning the horizon; today a static icon)
4. Placement trophies, `trophy-1/2/3.png`, 32x32 (gold, silver, bronze; today
   one trophy at falling opacity)
5. Season plate, `season-banner.png`, about 320x64 ("SEASON 1")
6. VS plate, `vs.png`, about 128x64 ("opponent found")
7. Rating arrows, `up.png` / `down.png`, 12x12
8. Empty ladder illustration, about 200x120 (nice to have)

**City duels**

9. Duel invite badge, `ui/duel-invite.png`, 32x32 (a challenge: crossed fists,
   a gauntlet, a thrown glove; today it borrows a mech bust)
10. Challenge icon, `ui/duel-16.png`, 16x16, inside the MECH BATTLE button

**Battle Pass**

11. **Pass artwork for the NFT**, square, at least 512x512. The Season 1 pass
    currently uses the Sol Mechs logo as its image.

**Pending a design decision** (do not draw yet): a leg attack is being
discussed. If it lands, legs need an attack VFX like the arm ones.

## 4. Interface icons (today CSS-drawn or borrowed)

- **Calendar icon** for the map card shortcut (today a CSS page-a-day showing
  the date; the art should leave room for the day number, or we keep drawing
  the number on top)
- **Streak icon** (a flame or a chain of days) for the profile and the two streak
  achievements, which borrow the yellow "!" today
- **Achievement icons**, 28x28, one per achievement (most borrow NPC faces or
  generic icons): First Swap, First Transfer, New in Town, Regular (3-day
  streak), Social Butterfly, Active Trader, Week in the City (7-day streak),
  Citizen of the Year
- **Direct message icon** for the chat tab and the MESSAGE button on player cards
- **Outfit box**: closed box, and an opening animation (4-6 frames); the box
  screen shows the wardrobe icon today

## 5. Coming next (not in the game yet)

- **Daily hidden items**: 4-6 small collectibles (24x24 or 32x32) hidden
  around the city each day, shown in a collection in the profile
- **Kite beach**: background NPCs and decorative kites along the ST Brasil beach
- **Visible city limits** instead of invisible walls: roadworks, a bridge under
  repair, train lines
- **Rabbit Royale building** (another Indies on Solana game), once the two
  teams agree what its door does

---

## Animated water at the shoreline (how to make it cheap)

The foam line on the beach can move, and it can cost the game almost nothing
— but only if it is authored as ANIMATED TILES, not as a sprite per tile.

The difference is not small. As sprites, every foam tile on screen is another
thing drawn 60 times a second: 60 to 200 extra draws per frame, on phones
that already draw everything on the CPU. As animated tiles, the engine repaints
them inside the baked ground a few times a second and the frame itself draws
nothing extra at all.

### What to do

1. **Work in the sheet the map already uses**: `ScTileBeach.png`
   (1024x1024, 24x24 tiles, 42 per row). It has 1764 slots and the map uses
   60, so there is room for every frame in the same file.
2. **Draw 3 extra frames for each tile you want to move**, in any free slots
   of that same sheet. Four frames in total is plenty for water.
3. **Declare the loop in Tiled**, on the tile that is ALREADY painted on the
   map: right-click the tile in the tileset panel, Tile Animation Editor, drop
   the four frames in, 120-160 ms each. The loop must be seamless (frame 4
   flows back into frame 1).
4. **Do not repaint the map.** The map keeps using the base tile; the
   animation rides on it. Nothing about the map changes, so nothing breaks.
5. **Do not animate the flat fills** — the open water and the open sand are
   four tiles covering most of the beach, and moving them would animate the
   whole sea. Only the EDGE: foam, wet sand, the corners where water meets
   land.
6. **Keep the palette and the grid**: same colours as the static tile, frames
   aligned to the 24x24 grid, no margin or spacing, transparent background
   (the beach sheet uses real transparency, not the pink key that character
   sheets use).

### Where to start: the 16 tiles that cover 73% of the shoreline

The beach edge is 56 different tiles across 875 cells, and they are not used
evenly. These sixteen carry three quarters of it — animating just these
already makes the whole coast move. Row and column are positions in
`ScTileBeach.png` (row 0 is the top row, column 0 the left one).

| # | row, col | cells | running total |
| - | -------- | ----- | ------------- |
| 1 | 1, 5 | 124 | 14% |
| 2 | 22, 22 | 108 | 26% |
| 3 | 1, 1 | 52 | 32% |
| 4 | 8, 4 | 52 | 38% |
| 5 | 25, 26 | 50 | 44% |
| 6 | 25, 22 | 46 | 49% |
| 7 | 2, 2 | 40 | 53% |
| 8 | 1, 3 | 29 | 57% |
| 9 | 6, 3 | 27 | 60% |
| 10 | 2, 1 | 19 | 62% |
| 11 | 3, 5 | 19 | 64% |
| 12 | 4, 3 | 17 | 66% |
| 13 | 5, 3 | 17 | 68% |
| 14 | 22, 26 | 16 | 70% |
| 15 | 3, 4 | 16 | 72% |
| 16 | 5, 2 | 15 | 73% |

### One thing that makes it cheaper still

If a foam frame can include the sand or water UNDER it — an opaque tile
rather than transparent foam over a separate ground tile — the engine
repaints one tile per cell instead of the whole stack. Transparent frames
work too, so this is a preference, not a requirement.

### Budget

Sixteen tiles at four frames is 64 tiles of art, about 150 KB in memory. Even
all 56 edge tiles animated would be 224 tiles, half a megabyte, against the
16.7 MB the whole city's tilesets cost today. The art is not the expensive
part — how it is wired is, which is why it has to be tile animations.

## Recently added to the game, for context

- **City**: nicknames everywhere; one city chat with links blocked; direct
  messages; a round minimap that shows half the city; daily check-in streak;
  a city calendar (bounty and hackathon deadlines, city events); a profile
  with your streak, numbers, quests and achievements; objects fade only when
  they really hide you.
- **NPCs**: Sol as city guide with an illustrated tour; Stocks Broker and the
  Stocklana exchange (63 tokenized stocks, live screens on the building); Magic
  Man's MagicBlock panel; Hair Specialist (Superteam Turkey) with a hair timing
  game; Caramel Dog on the ST Brasil beach.
- **Mini-games**: Kite Clash with a visible cut ring, depth hints and a city
  leaderboard; Food Cart; Find Someone city-wide hunt.
- **Sol Mechs**: the 128px part set, friendly 3v3 duels from a player's card,
  ranked screens (hidden for now), Battle Pass setup.
- **Wardrobe**: all bases, hairs and hats free while testing; the Superteam
  Brasil set (cap for a Kite Clash win, shirt for Kuka, Brazil shirt for the
  ST Brasil crew); Cap Sol for a 7-day streak; outfit boxes waiting on the
  program upgrade.
