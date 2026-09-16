# Sprite requests — Sol Mechs ranked + city duels

What the new screens use today, and what is still drawn with CSS because the
art does not exist yet. Everything below is optional in the sense that the
screens work without it; each line says what it would replace.

**Format for all of them**
- PNG, transparent background, pixel art at 1x (the UI renders with
  `image-rendering: pixelated`, so no anti-aliased edges and no baked shadows).
- Palette already in use (`theme.ts`): teal `#21dda0`, cyan `#3fe0ff`, purple
  `#9a46fe`, warn `#ffa726`, bad `#ff5468`, ink `#0b0616`, panel `#150c2b`.
- Drop files in `apps/web/public/assets/minigames/sol-mechs/ui/` (a `ranked/`
  subfolder for the ranked-only ones).

## Already reused, nothing needed
| Sprite | Where |
| --- | --- |
| `ui/menu/ranked.png` | ranked hub header |
| `ui/icon-ranking.png` | leaderboard button, queue screen |
| `ui/win-trophy.png` | top 3 on the leaderboard, victory card |
| `ui/lose-rip.png` | defeat card |
| `ui/frame.png`, `ui/btn-action.png` | panels and buttons, through the theme |

## Missing — ranked

2. **Energy pip**, `ranked/energy-on.png` and `ranked/energy-off.png`, 18x10.
   Replaces the CSS bars. One pip = one match the player can still start.

3. **Energy pack icon**, `ranked/energy-pack.png`, 24x24, for the "+5 ENERGY"
   purchase button.

4. **Queue search animation**, `ranked/scan.png`, a horizontal strip of 4 to 6
   frames at 64x64 each. A radar sweep or a mech scanning the horizon. Today
   the queue screen shows a static icon plus a timer.

5. **Placement trophies**, `ranked/trophy-1.png`, `-2`, `-3`, 32x32. The
   existing `win-trophy.png` is currently reused for all three with falling
   opacity, which reads as "faded", not as silver and bronze.

6. **Season plate**, `ranked/season-banner.png`, about 320x64, a frame for the
   words "SEASON 1" in the hub header.

7. **VS plate**, `ranked/vs.png`, about 128x64, for the "opponent found" moment
   in the queue and at the top of a ranked battle.

8. **Rating arrows**, `ranked/up.png` and `ranked/down.png`, 12x12, shown next
   to the rating change on the result card.

## Missing — city duels

9. **Duel invite badge**, `ui/duel-invite.png`, 32x32. The invite card in the
   city currently borrows a mech bust. Something that reads as a challenge
   (crossed mech fists, a gauntlet, a thrown glove) would separate it from the
   game's own art.

10. **Challenge button icon**, `ui/duel-16.png`, 16x16, to sit inside the
    MECH BATTLE button on the player card.

## Nice to have

11. **Empty ladder illustration**, about 200x120, for "nobody has played a
    ranked match yet".

Send them at whatever size is convenient above 1x and they get scaled down;
what matters is that the pixel grid is clean at the listed size.
