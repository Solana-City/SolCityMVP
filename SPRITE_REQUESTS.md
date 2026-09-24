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
