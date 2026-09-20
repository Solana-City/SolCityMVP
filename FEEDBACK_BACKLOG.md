# Playtest feedback backlog

Every open item from player feedback, ranked. Newest round: **playtest of
2026-09-20**. Items that shipped are not listed; see git history.

Priority means: **P0** hurts everyone right now, **P1** is the next real
improvement, **P2** is wanted but can wait, **P3** is an idea we like.
Effort is a rough size: **S** under a day, **M** a few days, **L** more.

---

## P0 — Broken or hurting every session

### 1. Memory and lag (Chrome at 1.1GB+) — TRACKED ELSEWHERE
Being worked on in a separate chat (2026-09-20). Left here as a pointer only,
so nobody picks it up twice.

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

### 7. Sol Mechs: too many clicks — M
*"Study how to make it less; maybe there is nothing much we can do."*
Concrete candidates, each removing one click per turn:
- Pre-select a default target, so attacking is one click, not two.
- Remember the last action per mech and offer it as the default.
- Skip the confirmation step when nothing is ambiguous.
- Auto-end the turn once no action is possible.

Needs a decision on which of these to try; they change how the game feels.

### 8. Sol Mechs: legs have no purpose — M
*"No point attacking/using legs."* The user's own proposal: give legs one
attack, and move the buffs that belong to the legs onto the Matrix. That is a
balance change across `BattleEngine` and the catalog, so it wants the exact
numbers decided first, then the tests updated.

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
