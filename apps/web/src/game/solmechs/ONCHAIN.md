# Sol Mechs — on-chain design

Status as of this branch:

| Piece | State |
| --- | --- |
| Single-player battle result → on-chain score | **Working today**, no program change |
| Paired PvP battles on an Ephemeral Rollup | **Designed, not built** — needs a program redeploy |

## What already works

A finished battle emits `minigame:result`, which `CityScene` forwards to
`recordMiniGame(success)` → `record_mini_game_session`. That instruction is
signed by the session key and routes to the ER while the player PDA is
delegated, so a win scores with no wallet popup and no new instruction.

Nothing in this branch needed to change for that: Sol Mechs registered as a
mini-game and inherited the existing settlement path.

## Why paired PvP needs more

`record_mini_game_session` records *one* player's self-reported outcome. That
is fine for a solo run against the AI, where the only thing at stake is the
player's own score. It is not fine for a paired match: two clients would each
report themselves the winner, and the program has no way to tell which is
lying.

The engine was built for this. `resolveAction` is a pure reducer — no clock,
no RNG, no DOM — and `replay(p1Build, p2Build, actions)` reconstructs a
battle from its action list. Two builds plus an ordered action list therefore
determine exactly one winner, and anyone can check it.

## Proposed shape

### `BattleRoom` PDA

```
seeds: ["battle", room_id]

  p1: Pubkey
  p2: Pubkey
  p1_build: [u8; 4]      // matrix + 3 part codes, as catalog indices
  p2_build: [u8; 4]
  turn: u8               // 0 = p1, 1 = p2
  action_count: u16
  actions: [PackedAction; MAX_ACTIONS]
  status: u8             // 0 open, 1 active, 2 settled
  winner: Option<Pubkey>
  season: u16            // which ladder this result counts toward
```

`PackedAction` is 3 bytes — `sourceSlot` (2 bits), `moveIndex` (2 bits),
`targetSlot` (2 bits), `side` (1 bit). A full battle is a handful of these,
which is what makes committing every action affordable.

### Flow

1. **Open** (base layer) — p1 creates the room with their build. Both players
   must hold a valid pass for the current season.
2. **Join** (base layer) — p2 enters. Both accounts are delegated to the ER.
3. **Play** (ER) — each `submit_action` appends one action and flips `turn`.
   The program re-runs the same rules the client does, so an illegal action
   (wrong turn, broken limb, matrix still sealed) is rejected on-chain rather
   than trusted. This is the part that needs ER: at ~10 actions per match,
   base-layer latency would make it unplayable.
4. **Settle** (commit + undelegate) — when the loss condition is met the
   program sets `winner` and credits the ladder.

## The Arena is a season ladder, not a wager

There is **no per-match stake**. Players buy a season pass, which grants an
exclusive mech and entry to the ranked ladder; USDC pays out by final
placement when the season closes.

That changes the threat model in a way worth being explicit about, because
the obvious defences are aimed at the wrong thing.

**What no longer matters.** Escrow, per-match payout, and the first-move
concern below. No single match moves money, so a lost or disputed match is
cheap.

**What matters much more: collusion.** With a wager, a rigged match only
moves value between the two people who agreed to it. On a ladder, two
accounts trading wins manufacture rating out of nothing and displace honest
players from paying places. This is the central problem to design against —
not cheating within a match, which the replay already catches.

The season pass is the natural defence, and a good one: every extra account
costs a pass, so farming is only profitable when the prize for the place
gained exceeds the passes burned to reach it. That bounds the attack in
money rather than in cleverness. It does not eliminate it, so the ladder
still wants:

- **repeat-pairing decay** — the Nth match between the same two accounts in a
  season counts for progressively less;
- **rating, not raw wins** — a win over a much weaker opponent should be worth
  near nothing, which makes feeding accounts pointless;
- **a placement floor** — a minimum number of distinct opponents before an
  account is eligible for a prize place.

None of that needs the battle program; it belongs in how the ladder account
aggregates results.

### `SeasonLadder` PDA

```
seeds: ["ladder", season]

  season: u16
  ends_at: i64
  prize_pool: u64        // USDC, funded by pass sales
  entrants: u32
```

with one `LadderEntry` per player:

```
seeds: ["entry", season, player]

  rating: i32
  wins: u16
  losses: u16
  distinct_opponents: u16
  last_opponents: [Pubkey; N]   // ring buffer, feeds repeat-pairing decay
```

Settlement writes the result into both entries. The final snapshot at
`ends_at` is what the payout reads.

### Rules the program must enforce

These are the three that a cheating client would target, all already in
`BattleEngine.ts`:

- a limb at 0 HP can neither act nor be targeted;
- the matrix is only targetable once an **arm** is destroyed — not legs;
- stat stages clamp to [-6, +6], and damage floors at 0.1× the ratio.

Porting `calculateDamage` to Rust is mechanical, but two details bite. The
stage table must be transcribed exactly — its positive half climbs linearly
(1.5, 2, 2.5, …4), which is *not* the Pokémon ratio it otherwise resembles.
And the formula is float-valued before its final `floor`, so the Rust side
must reproduce the same rounding rather than working in integers throughout;
fixed-point with an explicit scale is the safer route.

### Open questions

- **Who moves first — keep `"speed"`.** An earlier draft of this file said a
  ranked match *must* derive the opener from a commit-reveal seed, because
  under `"speed"` the first-move advantage is "buyable at build time". That
  reasoning was written for a wagered match and does not survive the move to a
  season ladder. Both players build freely under identical rules, so the
  advantage is symmetric, not bought — and SPD's **only** job in this engine is
  deciding the opener, so randomising it would strip the legs slot of its
  purpose all over again. Whatever is chosen, `replay()` must be given the
  value the battle actually opened with or it desyncs on action one.
- **Timeouts.** A player who stops submitting actions currently stalls the
  room forever. Needs a per-turn deadline with a claim-by-forfeit path. On a
  ladder this is also an exploit surface: stalling a losing match to deny an
  opponent rating has to cost the staller the loss.
- **Pass verification.** Both players must hold a current-season pass at
  `open`/`join`. Checking it only at settlement would let an expired account
  play out a season and place.
- **Prize custody and payout.** Where the USDC pool lives, and whether payout
  is claim-based (each winner claims their place) or pushed. Claim-based is
  cheaper and avoids a loop over a long leaderboard.
- **`MAX_ACTIONS`.** Battles observed in testing settle in 5–12 actions, but
  a stall-heavy build pairing (two self-buff loadouts) runs longer. Size the
  array against the worst case or the room can deadlock at the cap.

## Balance note

The engine has since diverged from Unity's damage formula on purpose. Unity
read ATK/DEF/ENG/SYS from the *chassis base stats*, which left every part's
combat stats inert and made the build editor cosmetic, and it used an
unbounded `atk / def` quotient that let stat stages swing damage 16x and
settled fights in about five actions.

Current formula, in `BattleEngine.calculateDamage`:

```
atk = totalStats[ATK|ENG] * stageMult(firing limb)
def = totalStats[DEF|SYS] * stageMult(struck limb)
damage = floor(movePower * clamp(2*atk/(atk+def), 0.35, 1.75) * 0.65)
```

Measured across all 20 preset matchups: 13–19 actions, median 16. Total SPD
now decides the opening turn (`FirstMoveRule`), which the opener won 12/20 —
an advantage, not a decider.

**Every constant above lives in the `BALANCE` block in `BattleEngine.ts`, and
the program must be built against the same values.** A mismatch between
client and program does not fail loudly — it produces a verifier that
rejects honest results.
