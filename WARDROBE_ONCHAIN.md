# Sol City — Fully On-chain Wardrobe (no visual exploits)

Goal: what a player wears **to everyone else** is enforced on-chain — a hacked
client can't broadcast a cosmetic it never unlocked. Unlocks are authoritative
on-chain; the client only owns the art, never the truth.

This reworks the program (seed bump → one-time re-init of every player). Design
is locked here before writing the Rust, because a change this size shouldn't be
one-shot.

---

## Where the exploit lives, and the fix
Others render you from `PlayerState.loadout` on the ER. Today that's a free
string the client writes (`update_look_session("hat=Crown|…")`) — unchecked. Fix:
**`update_look_session` rejects any loadout item the player hasn't unlocked.** For
the program to judge, two things must be true in that one instruction:
1. the loadout is expressed as **catalog indices** (not free strings), and
2. the player's **unlock state is readable right there** (same account/cluster).

## The base/ER split (why the design is shaped this way)
- Loadout writes happen on the **ER** (delegated PlayerState, session-signed).
- Payment + VRF want the **base** (real SOL, robust, no ER-session dependency).
- One account can't be authoritative on both clusters at once.

Resolution: **unlocks are authoritative on a base `UnlockState` PDA; a snapshot
is copied into the delegated PlayerState so the ER can enforce.**

---

## Catalog: one global index table
Freeze one ordered list of EVERY selectable item (client `paperDoll` order),
`POOL_VERSION` pinned in client + program:
- indices `[0, F)` = **free** items (skin, faces, starter basics) — always allowed.
- indices `[F, N)` = **lockable** items — require an unlock bit `(i - F)`.

Rule: **append-only** within each range; never reorder/remove. Client:
`globalIndexOf(cat,id)` / `itemAtGlobalIndex(i)` / the `F` split.

## Accounts

### `UnlockState` PDA (base — authoritative)
`seeds = ["unlocks", wallet]`, `bits: [u8; 32]` (one bit per lockable index).
Written by every grant source (below). Never delegated → fresh for everyone,
cross-device.

### `PlayerState` v3 (seed bump → re-init everyone once)
- add `unlocked: [u8; 32]` — a **snapshot** of `UnlockState.bits`, copied in at
  `delegate` time (both accounts are on base then). The ER enforces against it.
- change `loadout`: from the pipe string to a compact **index list** the program
  can validate (e.g. per-slot `u16` global index, `0xFFFF` = none). Client maps
  indices ⇄ items via the catalog.
- Consequence: new unlocks earned mid-session apply **next delegation** (the
  snapshot is refreshed on re-delegate). Acceptable for cosmetics.

## Instructions

### `update_look_session(loadout_indices)` — ENFORCED
For each slot index `i` (skip `none`): allow if `i < F` (free) else require
`unlocked[(i-F)/8] & bit` set, else `err(ItemNotUnlocked)`. Then store it. This
is the anti-exploit gate — others only ever see a program-accepted loadout.

### Grants (all write `UnlockState.bits`, base, verifiable)
- **Booster** → the VRF flow already written (`open_booster` + `callback_open_booster`),
  base + MagicBlock VRF + payment. Its `UnlockState` bitset is now indexed in the
  **lockable** range. ✅ minimal change.
- **Quest (find 3)** → `claim_find` is already on-chain; have it (or a sibling ix)
  set the quest item's bit — on-chain-verified, no client assertion.
- **NPC (meet Sol, …)** → NOT trustlessly verifiable (client interaction). Options:
  (a) make NPC-reward items **free** (index `< F`), or (b) a `grant_item` signed by
  a **game authority** key (semi-trusted: the app authorizes it). **Decision needed.**

### `delegate` — now also syncs the snapshot
Before delegating, copy `UnlockState.bits → player.unlocked` (both on base). Costs
one extra account (the UnlockState PDA) on the delegate ix.

---

## Client changes (staged behind `BOOSTER_ONCHAIN` until deploy)
- Catalog: global index table + `F` split + `globalIndexOf`/`itemAtGlobalIndex`.
- Loadout: encode/decode as index lists for `update_look`; render from indices.
- `wardrobeUnlocks`: `isVariantUnlocked` reads the base `UnlockState` (already
  staged) — now the single source of truth for lockable items.
- Wardrobe gate stays (UX), but is now backed by on-chain truth; equipping a
  locked item is rejected by the program on write, so it never reaches peers.

## Migration (one-time, at deploy)
- Seed bump `player_v2 → player_v3`: every wallet re-inits its PlayerState on next
  connect (fresh at the new layout; the old v2 account is ignored — same pattern
  as v1→v2). No data reset beyond what re-init implies (position/loadout reset to
  defaults; unlocks live in the separate UnlockState, unaffected).
- Existing localStorage unlocks (preview/quest/NPC) do NOT carry to `UnlockState`
  — on-chain starts fresh. Booster/quest re-grant on-chain from here.

## Open decisions before building
1. **NPC-reward items:** free (`< F`) or `grant_item` signed by a game authority?
2. Confirm the **"new unlocks apply next delegation"** snapshot caveat is OK
   (alternative: a `refresh_unlocks` ix that re-syncs mid-session — more surface).
3. Whether to **bundle** the other redeploy items (names, hunt leaderboard) into
   this same seed-bump deploy to avoid a second re-init later.
