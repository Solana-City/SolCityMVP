# Sol City — Next Program Redeploy Checklist

Deploy via **Solana Playground / beta.solpg.io**. Program ID
`HPvDFVnruSXHwKKP44eUvRh8oYqBaHCeQbK1sKWT1aU2`, upgrade authority = game wallet
`9592QS34mPUwqA7sPAkug1kcuFddjn59QPQMzzCgKhEp`. See `apps/web/DEPLOY_ANCHOR.md`
for the Playground procedure.

## FINAL SCOPE (decided 2026-09-18, "option A")

The Rust is **already applied** in `programs/sol-city/src/lib.rs`, not staged
here. One deploy ships:

| # | Item | Status |
|---|------|--------|
| 2 | `record_swap_session` / `record_transfer_session` (bounty variant dropped 2026-09-21: nothing records bounties) | in lib.rs |
| 5 | Outfit boxes: `open_booster` + `callback_open_booster` (MagicBlock VRF) | in lib.rs |
| 5 | `claim_free_outfit` (quest / NPC reward items, free, once per wallet) | in lib.rs |
| 5 | Wardrobe enforcement: `player_v3` + `unlocked` snapshot + `sync_unlocks` + enforcing `update_look_session` | in lib.rs |
| 6 | Beach football: `BallState` PDA + `initialize_ball` / `kick_ball_session` / `delegate_ball` (added 2026-09-30) | in lib.rs |
| 7 | Public profile: `achievements: [u8; 32]` + `streak_current` / `streak_best` on `PlayerState` + `publish_profile_session` (added 2026-10-01) | in lib.rs |
| 8 | Friends: `FriendRequest` + `Friendship` PDAs + `send` / `accept` / `decline` / `cancel` / `remove` (added 2026-10-01) | in lib.rs |
| 9 | Mini-game bests on chain: `game_bests: [u32; 16]` on `PlayerState` + `record_game_score_session` (added 2026-10-02) | in lib.rs |
| 1 | HuntScore PDA | **deferred** (the KV leaderboard covers the player-facing part) |
| 3 | `delegate_hunt` | **skipped** |
| 4 | On-chain display names | **dropped** (the off-chain nickname registry replaced them) |

**Reset accepted:** the `player_v3` seed means every wallet re-inits its
player PDA on next connect and on-chain scores start from zero (devnet test
phase). Unlocks live in `UnlockState`, which does not reset.

**Build notes:**
- `Cargo.toml` needs only `anchor-lang` (`init-if-needed`). Playground builds a
  fixed crate list and `ephemeral-vrf-sdk` is NOT on it, so the VRF request is a
  hand-rolled CPI (same approach as `delegate`), laid out from
  ephemeral-vrf-sdk 0.17.0.
- The request is the **scoped** variant (discriminator 10). The oracle signs the
  callback with `PDA(["identity", our program id], VRF program)`, which
  `callback_open_booster` checks. The legacy global `VRF_PROGRAM_IDENTITY` is
  deprecated and is NOT accepted.
- Nothing could be compiled locally (no SBF/MSVC toolchain); Playground's build
  is the first compile. Fix whatever it names and keep the account order.

Sections for items 1, 3 and 4 below are kept for reference only.

---

## Why we're redeploying (the accumulated items)

1. **Dedicated on-chain Find Someone leaderboard.** The leaderboard today is
   `localStorage` (per-browser, not shared). We want a global, on-chain,
   per-wallet find count. Interim hack currently live: a find does `+1` to the
   player's `score`/`bounty_count` via `recordScoreSession(true, 1, ...)` in
   `OnChainMultiplayer.claimFind` — replace with the dedicated counter below.
2. **Seamless (ER, no-popup) NPC interaction records.** `record_swap` /
   `record_transfer` / `record_bounty` are `Context<UpdatePlayer>` = wallet-signed
   (a 2nd popup after the DeFi action). Add session variants so they log via the ER.
3. **(Optional) Hunt state on the ER.** `claim_find` / `expire_round` / the hunt
   read currently run on BASE (the hunt PDA isn't delegated). Moving the hunt
   itself onto the ER needs a `delegate_hunt` instruction. Low value (the hunt is
   ~1 write per 5-min round city-wide → negligible base cost) vs real complexity
   (a shared delegated account). Evaluate before doing.
5. **Outfit booster (VRF).** Paid pack → 5 random wardrobe pieces via MagicBlock
   ephemeral VRF → granted to an on-chain `UnlockState` PDA (bitset). Full spec
   in **`BOOSTER_SPEC.md`**. Client preview already ships (gacha economy +
   `BoosterOverlay`); only the entropy source (Math.random → VRF) and grant
   (localStorage → PDA) change. Decisions to lock first: price/treasury, dupe
   handling, and whether quest/NPC unlocks also move on-chain this redeploy.
4. **Player names: changeable + first-come ownership.** Today the on-chain
   `display_name` is written ONCE at `initialize_player`, defaulting to the wallet
   short-form (`ProfileManager.setWallet` sets `displayName = "7NXk...uqbA"`), and
   `setDisplayName` only touches localStorage — so peers always render the WALLET
   above heads, never a chosen name. Need (a) `set_display_name_session` to change
   the name post-init and propagate it via the ER, and (b) a `NameClaim` registry
   PDA so a name is owned first-come (a second wallet can't take it).

9. **Mini-game scores on chain.** The pitch says the mini-game scores are
   on-chain via the ER, and half of that is already true: every run calls
   `record_mini_game_session`, which adds to the player's `score` and
   `bounty_count` on the rollup. What is NOT on chain is the thing players
   actually look at — the per-game board ("best kite-clash run in the city"),
   which lives only in the key-value store under `ev:minigame:<id>:best`. So the
   claim is defensible for the city score and wrong for the leaderboard. Item 9
   closes the gap.

6. **The beach football gets its own account.** The ball currently rides the
   KICKER's `last_message` chat field as a `§ball:` tag — it works, and the
   latency is hidden by client-side prediction (`world/BeachBall.ts`), but it
   is a message pretending to be a world object. See Item 6 for what a real
   account buys.

5. **Sol Mechs season ladder.** A ranked PvP ladder with an on-chain
   matchmaking queue, per-season Elo, energy and a prize pool. Does NOT belong
   in `sol-city` — see the dedicated section below for why, the account
   layouts, and the traps found while writing the TypeScript reference
   implementation. Staged on branch `feature/sol-mechs`.

---

## PROGRAM changes — `programs/sol-city/src/lib.rs` (paste-ready)

### Item 1 — Dedicated Find Someone leaderboard (DEFERRED, not in this deploy)

Rationale for a separate account over adding a field to `PlayerState`:
- **No `PlayerState` layout change → no `player_v3` seed bump → no forced re-init**
  of every existing player. Adding a field to `PlayerState` changes its size, which
  breaks Anchor deserialization of existing `player_v2` accounts, forcing a seed
  bump + re-init for everyone (the v1→v2 pattern). A separate account avoids all that.
- **`HuntScore` stays on base (never delegated) → always fresh for EVERY wallet**,
  online or not. (A delegated player PDA's base copy is frozen; reading wins from it
  would be stale. Reading wins from the ER would only show currently-online players.)
  So a base `HuntScore` is the correct home for a persistent global leaderboard.

Enable `init_if_needed` (add the feature in `Cargo.toml`):
```toml
[dependencies]
anchor-lang = { version = "0.30.1", features = ["init-if-needed"] }
```

Add the seed + account + instruction:
```rust
pub const HUNT_SCORE_SEED: &[u8] = b"hunt_score";

#[account]
#[derive(InitSpace)]
pub struct HuntScore {
    pub authority: Pubkey, // the player's wallet
    pub wins: u32,         // total Find Someone finds, all-time
}

/// +1 to the caller's all-time find count. Session-signed (seamless) and written
/// on BASE so it's fresh for everyone on the leaderboard. Called by the client
/// only when its claim_find landed first (so it mirrors the on-chain winner).
pub fn record_hunt_find(ctx: Context<RecordHuntFind>) -> Result<()> {
    let hs = &mut ctx.accounts.hunt_score;
    hs.authority = ctx.accounts.player.authority; // idempotent set (fine on re-init)
    hs.wins = hs.wins.saturating_add(1);
    Ok(())
}

#[derive(Accounts)]
pub struct RecordHuntFind<'info> {
    /// The player PDA — read to validate the session key and to key HuntScore by wallet.
    #[account(
        seeds = [PLAYER_SEED, player.authority.as_ref()],
        bump,
        constraint = player.session_authority == Some(session_authority.key())
            @ SolCityError::InvalidSessionKey,
    )]
    pub player: Account<'info, PlayerState>,
    #[account(
        init_if_needed,
        payer = session_authority,
        space = 8 + HuntScore::INIT_SPACE,
        seeds = [HUNT_SCORE_SEED, player.authority.as_ref()],
        bump,
    )]
    pub hunt_score: Account<'info, HuntScore>,
    #[account(mut)]
    pub session_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
```
> NOTE: `player` here is the (possibly delegated) player PDA — Anchor only READS it
> (no `mut`), so this works whether or not it's delegated, as long as this tx runs
> on the cluster where the player PDA currently lives. Since `hunt_score` is a
> fresh base account, run `record_hunt_find` on **base** (session-signed). If the
> player PDA is delegated (owned by the delegation program on base), the `seeds`/
> deserialize check may fail on base — if so, drop the `player` account entirely and
> instead pass the wallet as an arg + have the client sign with the wallet-authorized
> session key (simpler: `record_hunt_find(authority: Pubkey)` with `hunt_score` seeded
> by that arg, and trust the session key). Decide at implementation time; the base
> HuntScore is the key idea.

### Item 2 — Session variants of the NPC interaction records (APPLIED in lib.rs, except the bounty one)

```rust
pub fn record_swap_session(ctx: Context<UpdatePlayerSession>) -> Result<()> {
    let player = &mut ctx.accounts.player;
    player.swap_count = player.swap_count.saturating_add(1);
    player.score = player.score.saturating_add(50);
    player.last_active = Clock::get()?.unix_timestamp;
    Ok(())
}
pub fn record_transfer_session(ctx: Context<UpdatePlayerSession>) -> Result<()> {
    let player = &mut ctx.accounts.player;
    player.transfer_count = player.transfer_count.saturating_add(1);
    player.score = player.score.saturating_add(25);
    player.last_active = Clock::get()?.unix_timestamp;
    Ok(())
}
pub fn record_bounty_session(ctx: Context<UpdatePlayerSession>) -> Result<()> {
    let player = &mut ctx.accounts.player;
    player.bounty_count = player.bounty_count.saturating_add(1);
    player.score = player.score.saturating_add(30);
    player.last_active = Clock::get()?.unix_timestamp;
    Ok(())
}
```
(`UpdatePlayerSession` already exists and validates the session key — no new struct.)

### Item 3 — Hunt state on the ER — `delegate_hunt` (SKIPPED)

Mirror the existing `delegate` (see `pub fn delegate` + `struct DelegatePlayer`)
but for the hunt PDA: seeds `[HUNT_SEED]`, NO `authority` (it's a global account —
sign with any funded session key as payer), buffer seed `["buffer", hunt.key()]`,
and the same buffer→zero→assign→CPI→close dance. Then `claim_find`/`expire_round`
run on the ER and reads come off the ER poll. **Evaluate whether it's worth the
complexity** (shared delegated account, who delegates it once, never undelegate).
If skipped, the hunt simply stays on base — which works fine today.

### Item 4 — Player names (DROPPED: the off-chain nickname registry replaced this)

Two pieces. The name change writes to the EXISTING `display_name` field on
`PlayerState` (no size change → no seed bump — the field is already there, we're
just making it writable post-init). The ownership guarantee is a separate small
account seeded by the normalized name.

```rust
// Lowercase + trim the name client-side BEFORE seeding so "Alice"/"alice" collide.
// Max 20 bytes to match PlayerState.display_name's cap.
pub const NAME_CLAIM_SEED: &[u8] = b"name_claim";

#[account]
#[derive(InitSpace)]
pub struct NameClaim {
    pub owner: Pubkey,        // wallet that first claimed this name
    #[max_len(20)]
    pub name: String,         // the normalized name (for display / audit)
}

/// Claim a name (first-come) AND set it on the player PDA in one tx.
/// `init` (NOT init_if_needed) on name_claim → the tx FAILS if the name PDA
/// already exists (someone owns it), which is exactly the first-come guarantee.
/// Session-signed + written on the ER (player PDA is delegated there).
pub fn set_display_name_session(ctx: Context<SetDisplayNameSession>, name: String) -> Result<()> {
    require!(name.len() <= 20 && !name.is_empty(), SolCityError::InvalidName);
    let player = &mut ctx.accounts.player;
    player.display_name = name.clone();
    player.last_active = Clock::get()?.unix_timestamp;
    let claim = &mut ctx.accounts.name_claim;
    claim.owner = player.authority;
    claim.name = name;
    Ok(())
}

#[derive(Accounts)]
#[instruction(name: String)]
pub struct SetDisplayNameSession<'info> {
    #[account(
        mut,
        seeds = [PLAYER_SEED, player.authority.as_ref()],
        bump,
        constraint = player.session_authority == Some(session_authority.key())
            @ SolCityError::InvalidSessionKey,
    )]
    pub player: Account<'info, PlayerState>,
    // init → fails if the name is already claimed = first-come ownership.
    #[account(
        init,
        payer = session_authority,
        space = 8 + NameClaim::INIT_SPACE,
        seeds = [NAME_CLAIM_SEED, name.as_bytes()],
        bump,
    )]
    pub name_claim: Account<'info, NameClaim>,
    #[account(mut)]
    pub session_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
```
> CAVEAT — `name_claim` is a fresh account, so this tx must run where it can be
> CREATED. If the player PDA is delegated (its ER copy is authoritative), a tx
> that BOTH mutates `player` (ER) and inits `name_claim` (base) can't span two
> clusters. Two clean options, decide at impl time: (a) run the whole ix on the
> ER and let `name_claim` be an ER account too (then the registry is only visible
> to ER readers — fine for uniqueness among online players, weaker as a global
> registry); or (b) split into `claim_name` (base, inits NameClaim, wallet- or
> session-signed) + `set_display_name_session` (ER, just sets `player.display_name`).
> (b) is more robust: the base NameClaim is the global source of truth, and the
> ER name is cosmetic. Prefer (b) unless the extra tx is a problem.
> Also add `InvalidName` to `SolCityError`.

**Do NOT change `PLAYER_SEED`** unless you deliberately add a field to `PlayerState`
(none of the recommended items above do — Item 4 reuses the existing `display_name`
field, so no seed bump either).

### Item 6 — Beach football `BallState` (APPLIED in lib.rs, 2026-09-30)

`BALL_SEED = b"ball"`, one singleton account, delegated to the ER forever.
Stores the last KICK and never the roll — position, the speed it left at,
`kicked_at` (chain clock), `seq` — because every client replays the same
fixed-step physics from that snapshot (`world/BeachBall.ts`). A two-second
roll is one write.

**What it buys over the `§ball:` chat tag that ships today:**
- **One account everyone subscribes to at session start.** Today a kick lands
  on the KICKER's player PDA, so you only hear it if you have already
  discovered that player and their subscription is up.
- **`kicked_at` written by the program.** The client currently sends no
  timestamp at all (two phones do not agree on the time) and compensates with
  a hardcoded `REMOTE_LAG_MS = 400`. A chain-written stamp replaces the guess
  with a measurement, and lets two clients order two kicks identically.
- **No contention with the position stream.** A kick currently queues behind
  the position writes hitting the same PDA every 200ms.
- **A real check on who may kick.** `kick_ball_session` takes the kicker's
  player account and requires them to be within `BALL_REACH_SQ` (96px, loose
  on purpose — an on-chain position is up to 200ms stale) of where the kick
  claims the ball was. Today a modified client can put the ball anywhere.
- **The ball exists without players.** Today its position is the last tag
  stuck on somebody's PDA, which ages out with the 2-minute idle filter.

**What it does NOT buy: latency.** Same rollup, same block time, same push.
The responsiveness came from prediction, not from this.

**THE ONE THING TO VERIFY FIRST.** `kick_ball_session` touches TWO delegated
accounts — the ball and the kicker's player PDA. That only works if MagicBlock
put them on the same ER validator. Both delegate with no validator preference
(`None`), and devnet is effectively a single validator, so it should hold — but
check it before anything else. **Fallback if it does not:** drop `player` from
`KickBallSession` and keep only `session_authority`. The proximity check goes
with it, and the ball is back to trusting the client (bounded by the beach
box), which is exactly where it is today. One struct field and four lines.

**Post-deploy, once each, in order:**
1. `initialize_ball(x, y)` — the resting spot, tile (46, 81) = `1116, 1956`.
2. `delegate_ball` — any funded wallet pays. Never undelegated: the ball is a
   fixture, not a session.

Both are one-off admin calls with no UI, same as `initialize_hunt`. The
`BALL_MIN/MAX_X/Y` box (tiles 5..68 x 56..104) is a backstop only; the real
boundary is the painted-sand tile mask the client builds from the map, which
is far too much detail for a program and would need a redeploy every time the
artist moved the shoreline.

**Known limit:** singleton, like the hunt. A second ball needs another seed and
another deploy.

---

### Items 7 and 8 — the public profile and friends (APPLIED in lib.rs, 2026-10-01)

Why they are in this deploy rather than a later one: both touch `PlayerState`,
and `player_v3` already re-inits every wallet. Adding fields during a reset that
is happening anyway costs nothing; adding them afterwards costs another reset.

**Item 7, the profile other players can read.** Achievements and streaks were
`localStorage` only, which is exactly why nobody could see anybody else's. Three
fields at the END of `PlayerState` (after `unlocked`), and one session-signed
instruction that writes them:

- `achievements: [u8; ACHIEVEMENT_BITS]` (32 bytes, 256 rungs)
- `streak_current: u16`, `streak_best: u16`
- `publish_profile_session(achievements: [u8; 32], streak_current: u16, streak_best: u16)`

It costs nothing on either side. The write is session-signed (no popup, no fee
on the rollup) and happens only when the summary changes, a handful of times a
session. The read is free: these fields ride the 500ms position poll every
client already makes for every citizen, so no new request and no KV command.

Monotonic on purpose: bits only turn ON and `streak_best` only rises, so a
second device or a client with a cold profile cannot erase what was published
elsewhere.

Self-reported, also on purpose. Most achievements count things only the client
sees (balls kicked, dogs petted), so there is no on-chain tally to check them
against. Same trust level as the KV boards they sit beside, and nothing is gated
on them. The doc comment in lib.rs says so.

**The bit layout is a wire format.** Achievements are one track per action with
levels, and each track owns a FIXED block of `BITS_PER_TRACK` (8) bits. Bits are
NOT handed out in sequence across tracks: if they were, adding one rung to the
dog track would shift every track after it and relabel every profile already on
chain, showing players levels they never reached. Appending a rung takes a free
bit inside its own block; appending a track takes a fresh block. A track may not
exceed 8 levels, and `achievementRegistry.test.ts` holds all of this.

**Item 8, friends.** Two small accounts, 80 bytes each, both on BASE (not
delegated: they are written twice in their life, so a rollup buys nothing and
costs two extra txs per friendship).

- `FriendRequest`, seeds `["friend_req", from, to]`. Being a PDA of the pair is
  what makes a duplicate invite impossible, since `init` fails the second time.
- `Friendship`, seeds `["friendship", a, b]` with the pair SORTED, so one
  account per pair and no cap on how many friends anyone has.
- `send_friend_request`, `accept_friend_request(a, b)`, `decline_friend_request`,
  `cancel_friend_request`, `remove_friend`.

Offline delivery needs no server and no TTL. An invite is an account that sits
on-chain until it is answered, so "they get it next time they log in" is just
what happens. The DM inbox could not have done this: it expires in 24 hours.

Rent is refunded on every exit, including declining. A declined invite leaves no
trace at all, so nobody can read who refused them.

Wallet-signed, not session-signed, because these create accounts and the session
key holds no lamports (`fundLamports` exists but is never used with a value).
One prompt per deliberate act.

Two things to know before testing:
- **A wallet with no player PDA cannot be invited.** `send_friend_request` reads
  the recipient's key off their `PlayerState`, which also proves they are a
  citizen. After the `player_v3` reset that means both players must enter the
  city once. The client already words this as "they need to visit the city
  first" rather than surfacing a constraint failure.
- **Invite spam costs the sender.** `init` on the pair blocks duplicates to the
  same person, but a spammer could invite many different people, paying ~0.0015
  SOL of refundable rent each time. Watch it in testing; a per-sender counter
  would need another account, so it is deliberately not in this deploy.

**Discovery is `getProgramAccounts` with memcmp filters**, which is the one read
that has rate-limited us before, so nothing here polls. `game/social/friends.ts`
reads at login and on panel-open and caches, invalidating on mutation.

Both account kinds are the same 80 bytes, so **every filter must also match the
8-byte discriminator at offset 0** or the two come back mixed together. And the
discriminator must encode as 8 bytes: a memcmp filter compares exactly as many
bytes as its comparand decodes to, so padding it into a 32-byte PublicKey to
borrow its base58 widens the comparison over the next field and matches nothing.
`friends.test.ts` holds both traps.

Listing friends is TWO queries, because the pair is stored sorted: a player is
in slot `a` for about half their friendships and in slot `b` for the rest.

---

### Item 9 — Mini-game bests on chain (APPLIED in lib.rs, 2026-10-02)

Why it is in this deploy: the pitch says the mini-game scores are on-chain via
the ER, and the leaderboard players look at is the one place that is not true.
It also touches `PlayerState`, which `player_v3` re-inits anyway — the same
argument that put items 7 and 8 here.

**What is already true before this deploy.** Every finished run calls
`record_mini_game_session(success, score_delta)`, which adds to `score` and
`bounty_count` on the rollup. So a run does reach the chain, seamlessly, with no
popup. What never reached it is WHICH game and HOW WELL: the per-game board is
`ev:minigame:<id>:best` in the key-value store, which is also why it silently
froze when the analytics gate closed (fixed 2026-10-02, commit 3f7032f).

**One field and one instruction:**

- `game_bests: [u32; GAME_SLOTS]` appended to `PlayerState` (`GAME_SLOTS = 16`,
  64 bytes). The index is the client's mini-game table, append-only and never
  reordered, exactly like `achievements`: `0 food-cart`, `1 kite-clash`,
  `2 sol-mechs`, `3 hair-specialist`. Reordering re-labels every score already
  written.
- `record_game_score_session(game: u8, score: u32, success: bool)`,
  session-signed on `UpdatePlayerSession`. Keeps `max(best, score)` per slot, so
  a replayed old number cannot walk a best backwards. `success` adds a flat
  `MINI_GAME_WIN_POINTS` (100) to the city score and counts the run.

**Why the flat 100 instead of the run's own score.** Raw scores differ by orders
of magnitude between games — a kite run scores thousands, a haircut scores tens.
Letting the run's number into the shared `score` would rank the city by which
game people happened to play. The unscaled number is kept per game, where
comparing it means something.

**Why no new account.** The board is read with the `getProgramAccounts` scan
over `PlayerState` that `game/solana/leaderboard.ts` already makes, so the whole
city's bests arrive in one call and a player's own arrive on the position poll
they are already making. A shared top-N account would add contention and a
`delegate_*` dance to buy nothing. The delegation commits every 3000 ms
(`commit_frequency_ms` in `delegate`), so the base scan trails the rollup by
about three seconds, which a leaderboard does not notice.

**It is not verification.** The score still comes from the client, exactly as it
does for the key-value board it replaces and for `achievements`. On chain makes
it shared, permanent and readable by anything; it does not make it true, and
nothing is granted on the strength of it. Say it that way in the pitch too: the
honest claim is "scores and bests are written to the player's own on-chain
account through the ER, with no popup and no fee", not "scores are verified
on-chain".

**Open question, deliberately left open:** whether the KV board stays as the
fast read and the chain as the record, or the panel/board switches to the chain
scan once it is live. Keeping both for a while costs one `zincrby` and tells us
whether the two ever disagree, which is the cheapest audit available.

---

## CLIENT changes (post-deploy — apply ONLY after the new program is live)

Order: deploy program → verify → then push these together. Booster and
free-outfit wiring stays behind `NEXT_PUBLIC_BOOSTER_ONCHAIN` until verified.

1. **`game/solana/program.ts`**: `PLAYER_SEED` → `"player_v3"`. Add
   `unlocked: Uint8Array(32)` at the END of the `PlayerState` decoder (after
   `message_at`).
   - The friend derivations, decoders and `toBase58` are ALREADY in this file
     (2026-10-01) and are inert until the seed flips.
   - `OnChainMultiplayer.decodeAndUpdatePlayer` ALREADY reads the profile fields
     after `unlocked`, defensively, so a v2 account decodes as a citizen with no
     achievements. Nothing to change there.
2. **`game/solana/instructions.ts`**: `DISC` + builders for
   `recordSwapSession`, `recordTransferSession`,
   `syncUnlocks`, `claimFreeOutfit(index: u16)`, `openBooster(poolCount: u16,
   clientSeed: [u8;32])`, taking the discriminators from the new IDL.
   `open_booster` accounts, in order: `payer` (w, signer), `unlock_state` (w),
   `treasury` (w), `oracle_queue` (w, `Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh`),
   `program_identity` (PDA `["identity"]` of OUR program), `vrf_program`
   (`Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz`), `slot_hashes` (sysvar),
   `system_program`.
3. **`multiplayer/OnChainMultiplayer.ts`**
   - `recordAction("swap"|"transfer")`: wallet popup on base →
     `record_*_session` on the ER, mirroring `recordScoreSession`.
   - Before `delegate`: if the wallet's `UnlockState` exists, send
     `sync_unlocks` (session-signed, base). Skip it when the account is
     missing: the snapshot stays zero and only free items are wearable.
   - Loadout broadcast: encode as `slot=<global catalog index>|...` and decode
     the same way on read. A name-based loadout is now REJECTED by the program.
4. **Booster / free outfits** (behind the flag): `open_booster` → poll
   `UnlockState.pending` until false / read `BoosterOpened` → reveal.
   `track("purchase", "outfit-box", { value: 25_000_000, wallet })` on success.
   Quest rewards call `claim_free_outfit(index)`. Needs an APPEND-ONLY
   quest-item index table (< 16 slots): today `unlockVia: "quest"` covers
   STB_cap, STB_shirt, Brazilian_shirt, Jetpack and Cap_Sol (7-day streak;
   moved out of the booster pool on 2026-09-21, before the pool indices were
   ever deployed, so nothing shifts).
5. **Beach football** (`world/BeachBall.ts` + `multiplayer/OnChainMultiplayer.ts`):
   - `deriveBallPDA()` (seed `["ball"]`) in `program.ts`, and a `BallState`
     decoder: `x u32, y u32, vx i16, vy i16, kicker Pubkey, kicked_at i64,
     seq u32`.
   - `sendBallKick` → `kick_ball_session(x, y, vx, vy)` on the ER instead of
     `send_chat_session` with a `§ball:` tag. Accounts: `ball` (w),
     `player` (ro), `session_authority` (signer).
   - Subscribe to the ball PDA on the ER at session start, and add it to the
     500ms poll as the fallback. Drop the `§ball:`/`_ballTag` branch in
     `decodeAndUpdatePlayer` and the `BALL_TAG` encode/decode.
   - Replace `REMOTE_LAG_MS` with the real thing: `Date.now() - kicked_at*1000`
     (minus the learned clock skew the transport already tracks), clamped to
     something sane. Keep the eased correction as is — with prediction doing
     the work, this is about accuracy, not feel.
   - `seq` replaces the per-sender sequence number already on the wire; the
     dedupe becomes "seq changed".
6. **Mini-game bests (item 9)**:
   - `game/solana/instructions.ts`: `recordGameScoreSession(game: u8, score: u32,
     success: bool)` builder, discriminator from the new IDL. Same accounts as
     the other session writes: `player` (w), `session_authority` (signer).
   - A canonical index table in ONE place — `game/minigames/onChainIndex.ts`,
     `{ "food-cart": 0, "kite-clash": 1, "sol-mechs": 2, "hair-specialist": 3 }`,
     append-only, with a comment saying a reorder re-labels every score on chain.
     The registry Map is import-ordered, so it must NOT be the source of this.
   - `page.tsx` where `track("minigame", id, ...)` already fires at the end of a
     run: call the new ix with the run's score instead of
     `recordMiniGame(success)`, which sends the flat +100 twice over otherwise.
     Keep the `track` call: the KV board is the fast read.
   - Decoders: append `game_bests` (16 × u32) AFTER `streak_best` in both
     `leaderboard.ts` and `decodeAndUpdatePlayer`, read defensively so an account
     written by an older client still decodes.
   - A game with no slot yet (a fifth mini-game) must NOT send: `UnknownMiniGame`
     is a failed tx, not a no-op.
7. **Verify layouts** before pushing: `npx tsc --noEmit` + `simulateTransaction`
   of every new ix against the deployed program.

---

## Post-deploy verification

- [ ] Program `last_deploy_slot` advanced; upgrade authority still the game wallet.
- [ ] Fresh connect creates a `player_v3` PDA; delegation + movement work on 2 devices.
- [ ] Simulate the two `record_*_session` ixs on the ER → succeed; NPC actions
      show no second wallet popup.
- [ ] Wearing a free item broadcasts; wearing a locked item is rejected
      (`ItemNotUnlocked`), an unlocked one (after `sync_unlocks`) is accepted.
- [ ] Open a box: one payment popup, `pending` flips back, 5 bits set, same 5
      items revealed on both devices; 0.025 SOL landed in the treasury; the
      purchase shows in the dev panel Money section.
- [ ] `claim_free_outfit` twice with the same index → no error, one bit.
- [ ] **Ball, before the client work:** `simulateTransaction` a
      `kick_ball_session` on the ER touching BOTH the ball and a delegated
      player PDA. If it fails on account locations, take the Item 6 fallback.
- [ ] Ball: a kick from a player standing on it succeeds; the same kick with
      coordinates across the map is rejected (`BallOutOfReach`).
- [ ] Ball: `seq` advances on every kick, including three inside one second.
- [ ] Full cross-device multiplayer still green (compare to Parabéns 2.0).

**Mini-game bests (item 9)**:
- [ ] Play a run: `simulateTransaction` first, then a real one. `game_bests[i]`
      holds the run's score and `score` moved by exactly 100 on a win.
- [ ] Play a WORSE run on the same game: the best does not move, `score` still
      gets its 100.
- [ ] `game: 16` (out of range) is rejected with `UnknownMiniGame`.
- [ ] The base `getProgramAccounts` scan shows the new best within ~3 seconds of
      the ER write (the commit frequency), on a second device.
- [ ] The KV board and the chain agree for the same run.

**Profile (item 7)** — needs two devices:
- [ ] Earn something on A; B opens A's card and sees the badge and the level,
      with no extra request (watch the network tab: it should ride the poll).
- [ ] Check in on A; B sees the streak on A's card.
- [ ] Publish from A, then open the city on a SECOND device with a cold profile
      and let it publish: the first device's badges are still there (the OR is
      what protects this).
- [ ] The publish shows ONCE per change in the onchain log under `profile`, not
      per frame.

**Friends (item 8)** — two devices, two wallets:
- [ ] A invites B while B is OFFLINE. B opens the city later and the invite is
      waiting in the FRIENDS tab. This is the whole feature: do not skip it.
- [ ] B accepts: both see each other in FRIENDS, and A got the invite's rent
      back.
- [ ] A invites B twice → the second is refused and the card says so, not a raw
      error.
- [ ] Invite a wallet that has never entered the city since the reset → "they
      need to visit the city first".
- [ ] Decline leaves nothing behind: nothing in either list, rent back to the
      sender.
- [ ] `remove_friend` from EITHER side alone closes the friendship.
- [ ] A friend walking in toasts once, and does NOT toast again when they walk
      out of range and back.
- [ ] Friend list survives a reload (it is on chain, not in localStorage).

---

## Sol Mechs — casual PvP (program `sol-mechs`) — deploy this first

Branch `feature/sol-mechs`. A separate program from `sol-city`: its own
program id and upgrade authority, and nothing in `sol-city` changes.

**What it does.** One lobby slot pairs two players. Each step, both commit
`sha256(match_id ‖ step ‖ action ‖ salt)` and only then reveal, so neither
can answer the other's choice. Both clients resolve the battle with the
TypeScript engine; the program simulates no combat and records no result.
Verified results are the season ladder, below.

**Source.** `programs/sol-mechs/src/lib.rs` — anchor-lang 0.30.1, with the
same hand-rolled delegation CPI `sol-city::delegate` uses in production, so
no SDK dependency. **Not compiled on this machine** (no Rust toolchain here):
the first build is in Playground, and any compile error surfaces there.

### Deploy (Solana Playground)

1. beta.solpg.io → new Anchor project `sol-mechs`.
2. Paste `programs/sol-mechs/src/lib.rs` over `src/lib.rs`; dependency
   `anchor-lang = "0.30.1"` (same as `sol-city`).
3. Build. Playground rewrites `declare_id!` with its own program id.
4. Deploy to devnet. The Playground wallet needs devnet SOL for the program
   account — estimate 2–4 SOL for a program this size.
5. Put the program id into `declare_id!` in the repo copy and commit it.
6. Set `NEXT_PUBLIC_SOLMECHS_PROGRAM=<program id>` in Vercel (and
   `apps/web/.env.local` for local runs), then redeploy the site.

There is no init step to run by hand: the first player to search creates and
delegates the Lobby in the same wallet transaction as their own Duelist.

### Client (already in the branch)

- `game/solmechs/pvp/chain/mechProgram.ts` — PDAs, instruction builders,
  account decoders. Byte offsets mirror the struct field order in lib.rs.
- `game/solmechs/pvp/chain/ChainTransport.ts` — setup, lobby, commit/reveal,
  opponent watching. Uses Solana City's session key; rollup transactions are
  session-signed, no popups.
- Without the env var, PvP runs on `LocalTransport` (two tabs of one
  browser). `?pvp=local` forces that even when the program is configured.

### Post-deploy verification

- [ ] Wallet A: PvP → FIND MATCH → one wallet approval, then "Searching".
- [ ] Wallet B, another device: FIND MATCH → one approval → both screens show
      "Opponent found" with the other's squad.
- [ ] A round shows the same HP numbers on both screens; no "desync" line in
      either log.
- [ ] Identical squads on both sides (a speed tie every round) still agree.
- [ ] A KO where only one side owes a substitution, and one where both do.
- [ ] Closing one side mid-match: the other sees "left the match" and wins.
- [ ] After a match, both can FIND MATCH again with no new approval.
- [ ] Same wallet on a second device: one `set_session` approval, then plays.

### Known limits (fine for casual play, not for stakes)

- Results are neither verified nor recorded. A modified client can misreport
  its own board; the desync warning catches honest divergence, not cheating.
- The speed-tie seed derives from the match id, so it is predictable.
- One lobby slot, first come first served. The season queue replaces it.
- Accounts stay delegated; there is no undelegate/close instruction yet.
- Disconnects are detected by the other client (leave / heartbeat), not by a
  program timeout.

---

## Sol Mechs — season ladder (extends `sol-mechs`, after casual PvP)

Staged, not applied. Branch `feature/sol-mechs`. Nothing here touches
`sol-city`; see "Why a separate program" below.

The TypeScript in `apps/web/src/game/solmechs/` is the **reference
implementation** — it is deliberately pure (no clock, storage or network) so
the Rust can be transcribed from it. Run
`npx tsx apps/web/src/game/solmechs/season/simulate.ts` to exercise the whole
season model before writing any Rust.

### Why a separate program

- `PlayerState` must not change size. The checklist above already warns that
  adding a field forces a `player_v3` seed bump and re-init for every existing
  player. A battle state machine, a queue and a ladder are far more state than
  `sol-city` should carry.
- A bug in an untested battle program must not be able to take multiplayer
  down. Separate program = separate upgrade authority, separate blast radius.
- Cost: a second ER delegation setup, and a second deploy through Playground.

### What the alpha needs on-chain

1. **Battle rooms on the ER**, per `apps/web/src/game/solmechs/ONCHAIN.md` —
   that design is unchanged and is the source for the room/action layout.
   Simultaneous rounds mean **commit-reveal is mandatory**: without it the
   second submitter reads the first's action off the chain.
2. **A matchmaking queue.** The player never names an opponent; the program
   picks one. This is the whole anti-collusion story — measured in the
   simulator, buying feeder wallets is a net loss at every count once opponents
   are assigned rather than chosen.
3. **A season ladder** (rating per wallet per season).
4. **Energy** (daily grant + capped paid packs), gating queue entry.
5. **A prize pool PDA** funded by a share of purchases.

### Account layouts

Constants come from `season/config.ts`. **The program and the client must be
built against the same values** — same warning as `BALANCE` in
`BattleEngine.ts`: a mismatch does not error, it rejects honest results.

```rust
pub const SEASON_SEED: &[u8]  = b"mech_season";
pub const LADDER_SEED: &[u8]  = b"mech_entry";
pub const QUEUE_SEED: &[u8]   = b"mech_queue";
pub const POOL_SEED: &[u8]    = b"mech_pool";

/// Ring buffer length. MUST equal MATCHMAKING.RECENT_OPPONENTS (16).
pub const RECENT: usize = 16;
/// Queue capacity. Sized so pairing fits one transaction's compute budget.
pub const QUEUE_CAP: usize = 64;

#[account]
pub struct Season {
    pub id: u16,
    pub starts_at: i64,
    pub ends_at: i64,
    pub entrants: u32,
}

#[account]
pub struct LadderEntry {
    pub authority: Pubkey,
    pub season: u16,
    pub rating: i32,
    pub wins: u16,
    pub losses: u16,
    pub distinct_opponents: u16,
    /// Ring buffer, newest first. Feeds the matchmaking rematch penalty AND
    /// the repeat-pairing rating decay.
    pub recent: [Pubkey; RECENT],
    pub recent_len: u8,
    // energy
    pub energy: u8,
    pub energy_day: u32,   // unix_timestamp / 86400
    pub packs_today: u8,
}

#[account]
pub struct MatchQueue {
    pub season: u16,
    pub len: u8,
    pub tickets: [Ticket; QUEUE_CAP],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct Ticket {
    pub authority: Pubkey,
    pub rating: i32,
    pub enqueued_at: i64,
    /// Copied from LadderEntry at enqueue. See "the ticket must be
    /// self-contained" below.
    pub recent: [Pubkey; RECENT],
    pub recent_len: u8,
}
```

### The traps (found while building the TS)

**The ticket must be self-contained.** Pairing cannot read every queued
player's `LadderEntry` — a transaction cannot carry 64 accounts. So the recent
opponents are COPIED into the ticket at enqueue. This is why
`season/matchmaking.ts` takes a bounded `recent: string[]` rather than a full
meeting history; an earlier draft used an unbounded map and would not have
ported.

**Tie-breaking needs on-chain randomness.** `pairQueue` takes an injected
`rand()` so that among equally-good candidates the choice is unpredictable —
otherwise a client selects its opponent by timing its entry. In Rust this is
the `SlotHashes` sysvar, not a client-supplied seed.

**Energy day comes from `Clock`, not the client.** `season/energy.ts` uses
`floor(now / 86_400_000)`; the program uses
`Clock::get()?.unix_timestamp / 86_400`. A client-supplied timestamp is a
client-controlled daily reset.

**Rating math does NOT need to be bit-identical to the TS.** The program is
authoritative: it computes and stores the rating, and the client READS it.
The TS rating module exists for the simulator and for UI previews
("you'll gain ~12"), where a rounding difference is invisible. This is the
opposite of `calculateDamage`, where both sides compute and must agree — see
the Balance note in `ONCHAIN.md`.

Do NOT re-add a per-opponent gain ceiling. It was tried and reverted; see the
comment in `season/config.ts`.

### Instructions

```
init_season(id, starts_at, ends_at)
init_ladder_entry()                      // init_if_needed, per wallet per season

join_queue()                             // program pairs; see below
cancel_queue()

// battle: per ONCHAIN.md, on the ER
open_room / join_room / commit_action / reveal_action / settle

buy_energy_pack()                        // enforces PACKS_PER_DAY, sweeps to pool
sweep_to_pool(lamports)                  // called by the pass sale + energy buys
claim_prize(place)                       // claim-based, after season close
```

`join_queue` is where the design lives. It:

1. rolls the daily energy grant from `Clock` and requires `energy >= 1`;
2. requires a current-season pass in the caller's wallet (checking only at
   settlement would let an expired account play a whole season and place);
3. scans `MatchQueue.tickets` for the minimum
   `|rating_gap| + REMATCH_PENALTY * recent_meetings`, accepting only while
   that cost is under `tolerance(now - enqueued_at)`;
4. on a match: spends 1 energy from both, removes both tickets, opens a room,
   delegates both to the ER. On no match: appends the caller's ticket.

### CLIENT changes (post-deploy)

1. **`game/solmechs/season/*`** — already written and pure. After deploy these
   stop being the source of truth for live state and become (a) the simulator,
   (b) UI preview math, (c) the spec the Rust was transcribed from. Keep the
   constants in lockstep with the program.
2. **`game/solmechs/hangar.ts`** — `owned` is currently hardcoded to the full
   roster with a comment saying to restore gating "once unlocking is real".
   Replace with a pass-ownership read. Loadouts key by pass mint, not by
   wallet + mechId, or a transferred pass loses its builds.
3. **New `game/solana/mechProgram.ts`** — mirrors `program.ts`: program id,
   seeds, PDA derivations, account decoders for `Season` / `LadderEntry` /
   `MatchQueue`.
4. **New `game/solana/mechInstructions.ts`** — `DISC` entries + builders,
   mirroring `instructions.ts`.
5. **`minigames/sol-mechs/index.tsx`** — the ranked entry point reads energy
   from `LadderEntry`, calls `join_queue`, and waits for the room rather than
   constructing a `LocalAIOpponent`. PvE stays local and unranked.
6. **Leaderboard UI** — `getProgramAccounts(LadderEntry)` filtered by season,
   sorted by rating, with the eligibility floors from `season/config.ts`
   applied client-side for display.
7. **Verify layouts** before pushing — same `simulateTransaction` technique as
   item 6 above.

### Post-deploy verification

- [ ] `init_season` + `init_ladder_entry` succeed; entry defaults to rating 1000.
- [ ] `join_queue` with 0 energy is rejected; after the daily roll it succeeds.
- [ ] Two wallets queueing get paired into one room; **neither could name the
      other**.
- [ ] Queue a wallet against one it just played: the rematch penalty pushes the
      pairing elsewhere when a third wallet is available.
- [ ] Commit-reveal: a client that commits and never reveals forfeits.
- [ ] A settled match updates BOTH ladder entries, and the ratings match what
      `season/rating.ts` predicts to within rounding.
- [ ] `buy_energy_pack` twice in one UTC day: the second is rejected.
- [ ] Pool PDA balance equals the swept share of the recorded purchases.
- [ ] Playing without a current-season pass is rejected at `join_queue`.

### Open decisions (block writing the Rust)

- **`QUEUE_CAP` vs compute budget.** Pairing is O(n) over the queue with a
  32-byte-compare inner loop. 64 tickets may or may not fit; measure before
  committing to the account size, since changing it later is a realloc.
- **Where the pass sale lives.** Metaplex Candy Machine is already deployed on
  devnet and needs no program of ours, so the sale can ship BEFORE this program
  exists. Only `join_queue`'s pass check depends on the collection address.
- **One `MatchQueue` or several by rating band.** One is simpler and correct;
  several reduce contention if the queue is hot. Start with one.

---

## Candidates found 2026-09-21/22 (latency and performance pass) — NOT decided yet

The user's rule (2026-09-22): **one redeploy, only once everything that touches
the program is prepared** — no incremental upgrades. These came up while
tuning multiplayer and are listed so they are weighed before that deploy.

1. **Choose the rollup validator on delegation.** `delegate_pda` passes
   `None` as the validator (the `ix_data.push(0u8)` "None validator" line).
   Today everyone lands on the default endpoint `devnet.magicblock.app`, which
   is the **Asia** validator `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57`
   for every country (checked via DNS from BR/US/DE/VN/SG). Players in Brazil
   measured ~300ms+ to it; the US validator `MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd`
   (`devnet-us`) would be far closer for them. All players of one session must
   share a validator (an account is served by one). **First test without a
   redeploy:** point the client at `devnet-us` and see whether a `None`
   delegation is picked up there. Only if it is not, add an
   `Option<Pubkey>` validator argument to `delegate_pda` and write it into
   the CPI instead of `0u8`.

2. **Do NOT validate `direction` in `update_position` / the session variant.**
   The client packs two extra bits into that byte (bit 2 = walking, bit 3 =
   "this sender sets the walking bit"); receivers mask with `& 3`. A
   `require!(direction < 4)` would reject every move from current clients.
   If `player_v3` is the moment to make it explicit, add a separate
   `walking: bool` field instead and keep accepting the packed byte.

3. **Ghost PDAs after the `player_v3` reset.** Every `player_v2` account still
   delegated on the ER stays there with an old `last_active`, and
   `getProgramAccounts` keeps returning it. The client already drops them by
   the 2-minute freshness gate (and learns clock skew only from accounts it
   sees advance), so this is safe — but plan a one-off commit+undelegate of
   the known test wallets' v2 PDAs, or discovery keeps paying for them.

---

## NOT a redeploy item (separate deferred CLIENT task)

**"NPCs in exactly the same positions for everyone" (true-MMO world sync).** Pure
client work, no program change. Current NPCs use per-client random movement, so
positions diverge (only appearance + hunt target are shared). The robust approach
is **deterministic time-seeded routes**: each pedestrian's position becomes a pure
function of `(index, wall-clock)` with no randomness, so every client computes the
same positions. This changes movement from "random wander" to "scripted routes" and
requires reworking `PedestrianSprite`/`PedestrianManager` movement + collision.
Full physics lockstep across devices is fragile — prefer the pure-function routes.
Tackle as its own focused task, independent of the redeploy.
