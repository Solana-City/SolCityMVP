# Playtest feedback backlog

Every open item from player feedback, ranked. Newest rounds: **playtest of
2026-09-20**, **mentor notes of 2026-09-21** (the Direction section), the
**mentor session of 2026-09-24** (Round of 2026-09-24) and the **playtest of
2026-09-27** (Round of 2026-09-27).
Items that shipped are marked DONE until the next cleanup.

Nothing is thrown away here. An idea nobody plans to build still gets written
down, in the Ideas bank at the bottom, because the same idea arriving twice
from two different playtests is itself a signal.

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

## Round of 2026-09-27 (playtest): the game on other people's screens

Every line below was checked against the code, so each says what is actually
there rather than what it might be.

### P0 — people could not play, or could not trust their eyes

#### P1a. iPad and tablets: unplayable
*"In iPad/tablet the game doesn't work. Can't control. The control pads are
not in a reachable place."*

The controls appear correctly (`MobileControls` shows on `pointer: coarse`,
which a tablet reports), but the layout was drawn for a phone: the stick and
the buttons sit in the far bottom corners, which on a 1024x1366 screen is
nowhere near either thumb. Needs a tablet layout — pads anchored to where
hands actually hold the device, not to the corners of the glass.

#### P1b. The same zoom shows a different city on every screen
*"Zoom looks different in different devices. In one PC 0.5x shows more of the
city than other ones. Zoom also looks very different on mobile: even 0.5x
can't see that far."*

Both are the same root cause, and it is by design in `zoomConfig`: the zoom
steps are a PIXEL SIZE ("view scale": how big one game pixel is in CSS
pixels), not a field of view. At 0.5x every device draws the same size
pixels, so how much city fits depends only on how wide the window is: a
2560px monitor sees twice the city of a 1280px laptop, and a 390px phone
sees a sixth of it.

The fix is to make the steps mean "how much city you see" and let the pixel
size follow. That collides head on with the next item, so the two have to be
decided together.

#### P1c. Pixels crack
*"Fix pixel size proportion. It is cracking."* and *"Zoom doesn't need to be
that zoomed in, but more options in between."*

Only EVEN camera zooms land one game pixel on a whole number of device
pixels; anything else samples pixel art off the grid, which is the cracking.
That is why the steps are coarse (0.5x, 1.0x, 1.5x with nothing between) —
the in-between steps are exactly the ones that crack.

So it is a choice, not a bug to fix twice:
- **Keep crisp, add steps by resolution**: change the backing-store scale per
  step instead of the camera zoom. More steps, all crisp, costs fill rate at
  the wide end.
- **Free zoom, one blur**: render the world at an integer scale into a
  texture and scale that texture smoothly. Any zoom, uniformly soft rather
  than cracked.
The first keeps the look; the second gives the mentor's "more options in
between". Worth deciding before anyone writes code.

#### P1d. Pink squares in the dialogue portraits — DONE 2026-09-27
*"Pink background in the previews, when the character is used as an icon in
the dialogue."*

Found it. The game keys the pink (215,123,186) out at LOAD time, inside
Phaser. Every preview drawn by the DOM — the dialogue highlight cards, the
tutorial flow nodes, the city guide, the pixel icons — loads the raw PNG
instead, so whatever pink is still in the FILE shows up. Checked every sheet:
`Kuka`, `Sol`, `Mr. Bananas` and `main_char` were exported transparent and
are fine, while `BK` (70% pink), `Raffx` (69%), `Crash` (65%), `Cloak` (64%)
and `Kite Pro` (54%) still carry it.

Fixed by keying the files themselves: scripts/key-sprite-sheets.mjs applies
the same rules BootScene does (flood fill for paperdoll skin, where the key
colour can equal a pink skin tone; flat everywhere else, which also clears
pockets the art encloses). 67 sheets, including the whole paperdoll, which
would have shown the same pink anywhere the DOM previews an outfit. The
runtime pass now skips a sheet whose corner is already transparent, so boot
does ~67 fewer canvas passes and new art still gets keyed if it arrives
pink.

#### P1e. Kite Clash breaks sometimes
*"Check kite game breaking sometimes."* No repro yet: which screen, what was
on it, and whether it was a round already running. Worth catching once with
the console open, since nothing in the code obviously explains it.

### P1 — the next real improvements

#### P2a. Clicking a character should talk to them
*"Click on the character/NPC to trigger interaction as well, not just
E/space."*

The hit zone that does this exists already — `NPCSprite` builds it only when
`scene.sys.game.device.input.touch` is true, so desktop never gets one.
Removing that condition is most of the work; the rest is making the cursor
change over an NPC so it reads as clickable.

#### P2b. Nobody knows the hotkeys
*"One hotkey to hide the UI. Scroll to zoom on desktop. Explain the hotkeys
somewhere — reactions have hotkeys but no one uses them because they don't
know."*

Three things in one: the keys that exist are undiscoverable, scroll-to-zoom
is missing, and hide-UI does not exist. A single key list (on the pause or
profile panel, and printed once on first load) plus the two new bindings.

#### P2c. The NPC dialogue icons look like buttons
*"When interacting with an NPC, remove the frames of the icons. It appears to
be buttons and people try to click."*

The highlight cards have a border and a filled background, which is button
grammar. They are captions. Drop the frame, keep the picture and the word.

#### P2d. Cloak should open on the action, not the home page
*"Go directly to the interaction 'shield' when clicking the link."*

Today the panel links to cloak.ag. Needs their deep link for the shield flow
(ask Victor for the URL) so the player lands where the action is.

#### P2e. Sol Mechs: rules, and the workshop
*"Game rules for Sol Mechs: tutorial and how to strategize."* and *"Change
the workshop. Stats: instead of bars, icons (click to see what they
mean/do)."*

There is a rules screen, but nothing that teaches STRATEGY — what a matrix
buff is for, why legs matter now, when to substitute. And the workshop shows
stats as bars, which say "bigger is better" and nothing else. Icons that
explain themselves on click would say what the stat DOES.

#### P2f. The minimap should say what is around you
*"Minimap showing what is around."* It shows the city and the landmarks;
what it does not show is what is near you right now — an NPC two streets
over, a player, a stand worth visiting. Distinct from "Fix map", which was
listed separately and needs one sentence from the room about what was wrong.

#### P2g. Achievements in tiers, and one for Find Someone
*"Levels of achievements: Social Butterfly, speak to 1/5/10/20."*, *"An
achievement for Find Someone."*, *"As many achievements as possible — they
give dopamine."*

The achievements list exists and is flat: each one fires once. Tiers are the
same data with thresholds, and Find Someone already tracks scores, so it is
mostly wiring rather than new systems.

#### P2h. Water that moves
*"Visual feedbacks: water moving on the beach and also under the bridge."*

Already speced: the brief for the artist is in SPRITE_REQUESTS.md (four
frames per tile, declared as Tiled tile animations, map untouched), and the
engine side is ~2-3 hours — read the animations, keep the frames through the
tileset packer, repaint the animated cells inside the baked ground about 8
times a second so the per-frame cost stays at zero.

### P2 — wanted, needs a decision or art first

#### P3a. Interiors, starting with the Solana City building
*"Make the interior of Solana City as a test for interiors. Inside, the
builders of each season get together and show their projects."*

The first interior is the expensive one: a second scene, doors that mean
something, and a rule for what happens to multiplayer inside. If it lands,
"the season's builders showing their projects" is a reason to go in, which
most interiors in most games never have.

#### P3b. Packs need more weight in the wardrobe
*"Wardrobe: give more prominence to packs."* The outfit boxes are the
revenue item hiding behind the free clothes.

#### P3c. An NFT marketplace inside the city
*"A marketplace for NFTs inside the city (dedicated building AND a button in
the wardrobe). Outfits and mechs negotiable between players; we take a fee
from the sales."*

This is a product decision before it is a build: it needs outfits and mechs
to be real assets a player owns and can transfer, which is a program change
(and the redeploy is already waiting). The fee is the first revenue line
that does not depend on us selling anything, which is worth its own
conversation.

#### P3d. Billboards and ads
*"Extra monetisation: digital billboards in the city, ads on them, click to
open."*

The city already has billboard art (`DecorBilboard`). What it does not have
is an inventory, a price, a filter for what may be advertised, and someone to
sell it. Cheap to build, needs a policy before it exists.

### P3 — ideas bank (kept on purpose, not planned)

- **Vehicles and speed**: a skateboard, a scooter, a motorbike to sell; a
  helicopter; a rocket. Listed by the room as "future additions, not a
  priority at all" — but movement speed is the one thing every player feels
  every second, so a cheap version (a speed item) may be worth more than the
  vehicles.
- **Animations in buildings without extra layers**: *"Figure out the best way
  to put small animations in buildings without a separate layer. Maybe
  directly via the tilemap software."* Same answer as the water: Tiled tile
  animations, repainted inside the bake. Whoever asks next should be pointed
  at SPRITE_REQUESTS.md.

---

## Round of 2026-09-24 (mentor session): mobile, performance, money, go to market

Sorted by what it costs us and what it buys. Everything here was checked
against the code, so each line says what is actually there today.

### M1. The ACT button opens the wrong NPC — P0, S
*"Act button fails on Steve (every NPC)"* and *"two events at the same time"*.

Found it: `CityScene` picks the interaction target with
`npcSprites.find((n) => n.isInRange)`, which is the first NPC in **array
order**, not the closest one. Where two citizens stand near each other (Steve
and Sol at the plaza steps) the button opens whichever was registered first,
so it reads as "ACT fails on Steve", and walking between them can hand two
different NPCs the same press. Fix: pick the NEAREST in-range NPC.

If "two events at the same time" turns out to be two PANELS opening at once
(a dialog plus a protocol screen), that is a second bug and needs the repro:
which NPC, and what was on screen.

### M2. The camera has no smoothing at all — P0, S
`startFollow(container, true, 1.0, 1.0)`: a lerp of 1.0 means the camera is
pinned to the player every frame, which is why it feels snappy/jittery on a
phone. The mentor's "around 200ms of damping" is a lerp near 0.15. One line,
and the most visible comfort win in this round.

### M3. Mobile frame budget — P1, M (measure first)
*"Change the frame rate, Android target 45, check frame rate"*.

There is no `fps` config today, so Phaser asks for 60 and the phone burns
battery trying. A 45 target is plausible, but Phaser only honours it through
`forceSetTimeOut`, which can make pacing WORSE than free-running rAF. So:
measure a real phone first (frame time, battery drain over 10 minutes), then
choose between a 45 target, a 30 target while idle, or leaving it at 60.

### M4. Draw calls and texture merging — P1, M, but NOT what it looks like
*"Set pass code, send to GPU to render. Merge texture/occlusion calling."*

**Mobile does not use the GPU at all**: `PhaserGame.tsx` forces Canvas2D on
touch devices on purpose, because WebGL uploaded 16 tilesets + 22 paperdoll
sheets + 13 NPC sheets to VRAM and the tab was killed. So atlas merging and
batching, which are WebGL wins, buy nothing on mobile as it stands.

Two honest options, in order:
1. **Retry WebGL on mobile now.** The reason it died was texture memory, and
   since then the map work removed 1.8M tile objects and bakes the ground.
   Worth one measured experiment behind a flag.
2. If WebGL stays off, the mobile win is fewer `drawImage` calls per frame
   (more culling, more baking), not atlases.

### M5. Stocklana keeps calling the API off screen — P1, S
`stockMarket` polls every 15s whenever anything is subscribed and the tab is
visible, whether or not the exchange is on camera or its panel is open.
Should pause when the building is culled and nothing is open.

### M6. Memory and battery on mobile — P1, M
Measure before changing: heap after 10 minutes, battery drain, and where the
frame time goes. The desktop memory work is done (~400MB steady); nobody has
measured a phone yet.

### M7. A donation building — P2, M (needs a decision and art)
Donations to the team, with a leaderboard. Ideas from the session: top donors
get special actions, the top one becomes a "superhero" of the city, 1/1
outfits for high-ticket donors, "donate to debuff" someone, sketchy NPCs.

What it needs: a building and a door (art), a transfer to the treasury
(simple, no program change), a board (the KV boards already exist), and a
decision on perks. **Note:** the revenue plan so far was exactly three things
(energy packs, outfit boxes, battle passes). Donations are a fourth, and a
different kind (no goods delivered), so it is a product decision, not just a
build.

### M8. Solana School, basics only — P2, M
The protocol micro-tutorials are the seed. Scope it to basics and talk to
**Solana Turbine** about educating devs (partner dependency, not code).

### M9. Find Someone: only the target NPC on chain — P2, S (needs clarifying)
Read as: keep the shared round/target on chain and drop the rest. Today the
round IS on chain and the scores are in KV. Worth one sentence from the
mentor before touching it.

### M10. RPC through our backend — P1, M
Both RPCs proxied server side: the keys stop shipping in the bundle, failover
and rate limiting become ours, and mainnet costs become measurable. Also the
prerequisite for a sane mainnet move.

### M11. Move to mainnet — P2, L (plan first)
Not a switch: a program deploy with a mainnet upgrade authority, real SOL for
rent and fees, the stock venue stops being a mock, MagicBlock rollup
availability on mainnet, and a wallet that pays for it. Wants its own written
plan before any code.

### M12. Go to market — P2, not code
A GTM timeline, KPIs, and who steps in and when: Solflare/Miracle, Solana
Gaming, games.gg. A document and a calendar, which the city's own calendar
can then show.

### M14. Send tokens from a player's card — DONE 2026-09-24 (needs a test)
Tapping a player now offers SEND TOKENS next to MESSAGE and MECH BATTLE: it
opens the same transfer panel Steve opens, with that player already in the
recipient box (their nickname on the label, the address still editable).

### M13. A test session with everyone — scheduling
Worth doing right after M1 and M2 land, since those are what testers feel.

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
