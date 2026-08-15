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
  wager_lamports: u64
```

`PackedAction` is 3 bytes — `sourceSlot` (2 bits), `moveIndex` (2 bits),
`targetSlot` (2 bits), `side` (1 bit). A full battle is a handful of these,
which is what makes committing every action affordable.

### Flow

1. **Open** (base layer) — p1 creates the room with their build and wager.
2. **Join** (base layer) — p2 matches the wager. Both accounts are delegated
   to the ER.
3. **Play** (ER) — each `submit_action` appends one action and flips `turn`.
   The program re-runs the same rules the client does, so an illegal action
   (wrong turn, broken limb, matrix still sealed) is rejected on-chain rather
   than trusted. This is the part that needs ER: at ~10 actions per match,
   base-layer latency would make it unplayable.
4. **Settle** (commit + undelegate) — when a matrix reaches 0 the program
   sets `winner` and pays out.

### Rules the program must enforce

These are the three that a cheating client would target, all already in
`BattleEngine.ts`:

- a limb at 0 HP can neither act nor be targeted;
- the matrix is only targetable once an **arm** is destroyed — not legs;
- stat stages clamp to [-6, +6], and damage floors at 0.1× the ratio.

Porting `calculateDamage` to Rust is mechanical — it is integer math plus a
13-entry multiplier table. The table must be transcribed exactly: the
positive half climbs linearly (1.5, 2, 2.5, …4), which is *not* the Pokémon
ratio it otherwise resembles, and getting it wrong would make every client
disagree with the program.

### Open questions

- **Who moves first.** `createBattle` currently always opens on p1, inherited
  from Unity's local-PvP scene where it didn't matter. With a wager it does.
  This should come from a commit-reveal seed at join time, not from build
  SPD — otherwise the first-move advantage is buyable.
- **Timeouts.** A player who stops submitting actions currently stalls the
  room forever. Needs a per-turn deadline with a claim-by-forfeit path.
- **Wager custody.** Escrow in the room PDA vs. a separate vault.
- **`MAX_ACTIONS`.** Battles observed in testing settle in 5–12 actions, but
  a stall-heavy build pairing (two self-buff loadouts) runs longer. Size the
  array against the worst case or the room can deadlock at the cap.

## Balance note

The ported Unity numbers make for very short fights — a Titan/Arclight match
settles in about five actions, because damage scales on chassis base stats
while part HP stays flat. That is faithful to the source, not a porting bug.
If matches should last longer, the lever is the `Dmg` values, and that is a
design decision rather than a port decision — so nothing here was retuned.
