# Playtest feedback backlog

Every open item from player feedback, ranked. Newest rounds: **playtest of
2026-09-20** and **mentor notes of 2026-09-21** (the Direction section).
Items that shipped are marked DONE until the next cleanup.

Priority means: **P0** hurts everyone right now, **P1** is the next real
improvement, **P2** is wanted but can wait, **P3** is an idea we like.
Effort is a rough size: **S** under a day, **M** a few days, **L** more.

---

## Direction: a daily reason to come back (mentor notes, 2026-09-21)

The vision, in the user's words: a place people are driven to log into every
day, to see what is up, get news, make friends, show their on-chain
accomplishments, inspire others, meet builders and gather communities.

The mentor's warning sits next to it: **learn to say no.** Small team, little
time, so pick one loop and make it good before adding the next. Everything in
this section is judged against one question: *does it give someone a reason
to open the city tomorrow?*

### Which part of the day is Solana City? (the user's call, still open)
Leaning, as of 2026-09-21: **the social part of the day.** And news belongs
to that slot: a player opens the city to see **what is happening on Solana**,
the way one opens a feed, and stays for the people. So news is not a side
panel; it is the reason to come in, and the check-in rewards the habit.
Revisit if the answer changes: "study" would move Solana School up, "work"
would favour builders and bounties.

### What already exists to build on
- Daily quests: 3 fixed ones (`game/quests/QuestManager.ts`), progress saved
  per wallet on the server, points on a city-wide board.
- Find Someone: a city-wide hunt with a leaderboard.
- Superteam Earn bounties through Pratik: real, curated, live content.
- Protocol micro-tutorials (Jupiter, Steve, Pratik, Magic Man): the seed of a
  school.
- Chat, DMs, nicknames, player cards: the social layer.
- Analytics already record sessions per device, so a return rate can be
  measured once there is something to return for.

Missing entirely: check-in, streaks, anything that changes day to day on its
own, news, collectibles, events.

### R1. Daily check-in with a streak — FIRST VERSION 2026-09-21 ("Today in Solana City")
The cheapest "come back tomorrow". A small card on first entry of the day:
day N of your streak, what today's reward is, what tomorrow's will be. Missing
a day resets it. Stored per wallet on the server like the quests. Measure it
in the dev panel: players with a streak of 2, 3, 7.

### Shipped 2026-09-21: profile = you, calendar = the city
- **Profile:** streak + week strip first, wallet one line with copy, numbers
  that move (score, swaps, transfers, finds, best kite, quest points), today's
  quests with CLAIM, achievements as an icon grid. Removed: the dead Bounties
  counter, the duplicated on-chain block, the ranking.
- **City calendar** (was "Today"): calendar, city leaders, Online / All Time
  ranking. Opens once a day and from the calendar button on the map card.
- The daily quest list left the HUD; quests live in the profile.
- The two bounty achievements (never reachable) became 3-day and 7-day streak
  achievements. Achievement outfit rewards removed: they belonged to a retired
  outfit system (placeholder art, never wearable). **Open:** reward real
  wardrobe items for achievements? (user's call)

### R2. Hidden items, a few per day, in random places — P1, M (third)
*"X items daily in random places."* Same seed for everyone each day (like the
hunt), so players can compare and help each other in chat. Found items go to
a collection, which is also the first **collectible**. Reuses the hunt's
"deterministic target from a daily seed" approach. Needs a small set of item
sprites (ask before drawing new ones).

### R3. City news, curated daily — P3 (user, 2026-09-21: must not depend on daily posts; interesting, not a priority)
One screen (a newspaper stand or a board near spawn) with a few items a day:
Solana news, ecosystem launches, the day's Superteam bounties, and what
happened in the city (top kite score, who found the most citizens). Start
**hand-curated from the dev panel** (a "post today's news" form) rather than
scraped: curation is the value, and it needs no moderation pipeline.

### R4. Onboarding questline by interest — P2, M
Ask on first login what they came for (DeFi, games, collectibles, RWA, DePIN,
building) and lead them to the matching citizens first. Improves the first
session, not the daily return, so it follows R1 to R3. Reuses the quest
system and the city guide.

### R5. Seasonal events and a calendar — P2, M (content heavy)
Not everything at once: a visible calendar of what is coming creates
anticipation, and a record of who took part ("was there for X") recognises
early players. The code is small; the real cost is producing an event every
few weeks. Worth doing once R1 to R3 show people return.

### R6. Solana School — P2, M
Grow the protocol micro-tutorials into short lessons with a completion mark.
Moves up if the answer to "which part of the day" is study.

### R7. Rewards layer — decide per item, not in general
- **Cosmetics:** the natural reward for streaks and collections. The on-chain
  path is already written (`claim_free_outfit`, ships with the redeploy).
- **In-game currency:** the quest points and score already act like one, but
  nothing spends them. Either give points a use (a cosmetic shop) or keep
  them as score; a second currency would be confusing.
- **Real money:** only through things that already pay (Superteam bounties,
  season prize pool). Paying players directly has cost, fraud and legal
  weight; not now.

### R8. Show on-chain accomplishments — P2, M
Part of the vision (inspire others). The player card could show what a wallet
has done in the city and on Solana. Needs a decision on what counts, and it
must stay factual (no invented ranks or badges).

### Saying no (a mental note for prioritising, not a cut list)
Until R1 to R3 exist and the return rate is measured, these wait even though
they are good ideas: Kite PvP, kick a ball, player-owned houses, influencer
parties, trustless ranked settlement, companion pet. Each adds depth to a
session; none gives a reason to come back tomorrow.

---

## P0 — Broken or hurting every session

### 1. Memory, lag and multiplayer delay — DONE 2026-09-22
Confirmed by the user on desktop ("the experience is very good, the
optimisation caused no harm"). Tab memory went from 1.1GB+ (1.6GB spike on
load) to ~400MB steady; the map parse went from 1.8M Tile objects to ~96k;
render work from 46% of the frame to a small share. What did it, in order:
merged collision layer, map layers cropped before parsing (`cropMap.ts`),
sparse layers as Blitters (`sparseLayer.ts`), static ground baked into chunk
textures (`groundBake.ts`), off-camera characters culled, Stocklana ticker
not repainted off camera. `?tiles=legacy` turns the map work off to compare.

Multiplayer delay went from ~2s to a small residual: rollup websocket push
(poll as fallback), 200ms sends, and remote avatars that walk to a predicted
position (see memory note on the direction byte). Each player always sees
themselves win a side-by-side race; that is inherent.

Left for later, none urgent:
- pause animations of off-camera pedestrians (~2-4% CPU)
- find the React HUD component re-rendering every tick (~5% CPU)
- atlas only the used tiles of the 1800px tilesets (-80 to -120MB)
- character canvas textures kept twice, pedestrian shadows rebuilt every 90s
- chroma-key the paper-doll sheets at build time (faster load on phones)
- send a position as soon as a phone returns from background
- the page sometimes reloads by itself: `[reload] the page reloaded itself:
  <reason>` in the console names the trigger; waiting for a sighting.
- a playtest in Brazil should use the US rollup validator (the default one
  is in Asia); needs a test of whether a validator-less delegation follows
  the endpoint, else a program change.

### 2. Stocks cannot be sold on devnet — DONE 2026-09-20
The devnet venue is a mock: a buy pays SOL into a treasury and mints the
stock, a sell burns the stock and the **treasury pays SOL back**
(`devnetStocks.ts`). That treasury is
`B7g2euoDoD5ewVMZUgSoPGuctZXCjhn1jtZM8ZYrsK4e` and currently holds
**0.07 SOL**, so any sell worth more than that fails for lack of funds.

Fixed: funded with 2 SOL from the game wallet (treasury now 2.07 SOL, game
wallet 5.68). The client already says "The devnet exchange is low on SOL" when
it cannot cover a sell, so no code was needed there; the dev panel now shows
both balances with a "top up" mark. **Needs a retest on devnet.**

### 3. sol-city program redeploy — waiting on the user
Everything is written and committed; the build and deploy happen in Solana
Playground. See REDEPLOY_CHECKLIST.md "FINAL SCOPE". Blocks: wardrobe
enforcement, outfit boxes, quest reward outfits, and the last wallet popups
after DeFi actions.

---

## P1 — Next real improvements

### 4. Minimap shows too little — DONE 2026-09-20 (needs a look)
*"Zoom out on the minimap. Should show 30-50% of the map at least."*
The corner map shows 1100 world pixels across, out of a 3240 wide city, so
about a third, and less on mobile (800). Now 1650 on desktop and 1300 on
mobile, about half the city, with slightly smaller citizen pins so they do not
cover the streets. Check it on both screen sizes.

### 5. Kite: the circle, and why it stalls — DONE 2026-09-20 (needs playtest)
Both complaints had the same root: the rules were invisible.
- The player's own cut was a hidden dice roll every 0.5s (15-50%), which is
  why the same cut took one second or ten. It is now a **gold ring that fills
  while you hold**, faster against a rival flying on a loose line (1.1s) than
  a tight one (3.2s). Full ring = the line is cut. Letting go empties it.
- The gamble is kept but rolled **once**, when the ring completes, and the
  ring's colour warns about it first: green safe, gold middling, orange risky,
  driven by how much line YOU have out.
- A crossing between kites at very different line lengths never counted, with
  nothing saying so. It now draws a dashed ring with an arrow and says
  "TOO FAR APART, LET LINE OUT / REEL IN TO REACH THEM".
- Two new tutorial cards: SAME HEIGHT and RING COLOUR.

Balance numbers are in `constants.ts` (`PLAYER_CUT_TIGHT_MS`,
`PLAYER_CUT_LOOSE_MS`), covered by tests. Tune after a playtest.

### 10b. Kite scores never reached the board — DONE 2026-09-20
The run only reported its score if the player pressed LEAVE; RELAUNCH threw it
away. It now reports when the run ends, once per run.

### 6. General UI and UX pass — M
*"General Solana City UI/UX needs improvement."* Too vague to act on as is.
Turn it into a list by watching one session and writing down every moment
someone hesitates. Known candidates already: the HUD corners are crowded, the
panels do not share one visual language, and font sizes jump between screens.
Worth asking the tester for their three worst moments.

### 7. Sol Mechs: too many clicks — CLOSED 2026-09-23
Dropped by the user: nothing to do here. The turn flow stays as it is.

### 8. Sol Mechs: legs have no purpose — DONE 2026-09-23 (needs playtest)
Each self-buff moved to its own matrix and firing it costs the round; legs got
a plain attack (the chassis' primary type, the weaker arm's damage, no
debuff). Every mech now has four options, and the action strip keeps its
height so the arena never resizes. **Balance needs a playtest:** every mech
gained a third source of damage.

---

## P2 — Wanted, not urgent

### 9. Kite Fight PvP — L
Player versus player kite duels. The rival is a bot today. Real PvP needs the
same transport as Sol Mechs duels (session keys on the rollup) plus
interpolation of the rival's line.

### 10. Kite Fight leaderboard — DONE 2026-09-20 (needs playtest)
The end screen shows the city's top five with nicknames, your own line
highlighted, plus your best and your place. Reads `/api/leaderboard`
(`game:kite-clash`), which was already collecting the scores.

### 11. Kick a ball, player to player — M
Suggested as a first "we are both here" interaction. Needs a shared object
with an owner: whoever last touched the ball owns its physics and broadcasts
its position, the same trick the city already uses for players.

### 12. Rabbit Royale building — M
Another Indies on Solana game. Needs a building on the map, a door, and
whatever the two teams agree the door does (a link, an NPC, a portal). Needs
art and a conversation with them before any code.

### 13. Sol Mechs ranked upgrade — M
Built and committed, not deployed; the RANKED row is hidden. Deploy path is
the fast one now: build in Playground, export the `.so`, deploy from here.

---

## P3 — Ideas we like

- **Trustless ranked settlement** (no self-reported results). Parked: needs the
  battle rules ported to Rust with fixed-point math on both sides.
- Kite beach background NPCs and decorative kites (needs an art decision).
- Companion pet or drone as a moving HUD (events, news, directions).
- Invisible walls become visual limits (roadworks, bridges out, train lines).
- World quests: combined city actions unlock areas (e.g. 1,000 interactions
  open the beach).
- Player-owned houses, influencer parties, per-project metrics.

---

## Housekeeping (small, do when nearby)

- **Analytics are off** (2026-09-23): the dev panel shows old data until
  someone sets `NEXT_PUBLIC_ANALYTICS=1` for a measured session. Decide later
  whether to keep them off, sample them, or pay for the store.

- **Re-lock the hats** when testing is done: `TEST_UNLOCK_ALL_HATS = false` in
  `game/config/paperDoll.ts` (Black Hat stays free).
- Dev panel on mobile: the layout does not fit.
- MagicBlock questline endpoint, once their spec arrives.
- Battle pass candy machine (`scripts/solmechs-pass-setup.ts`) before passes
  can sell.
- Outfit box price: 0.025 SOL now; the user was weighing 0.05.

---

## Confirmed good, do not change

- "Press E to open external links".
- The HUD with map and player card merged into one card. A version with the
  buttons in a row above the map was tried and rejected.
- No rank tiers or badges in ranked: rating and position only.
