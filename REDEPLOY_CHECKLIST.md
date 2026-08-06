# Sol City — Next Program Redeploy Checklist

Target: **week of 2026-08-11** (deferred from 2026-08-07). Deploy via **Solana
Playground / beta.solpg.io**. Program ID `HPvDFVnruSXHwKKP44eUvRh8oYqBaHCeQbK1sKWT1aU2`,
upgrade authority = game wallet `9592QS34mPUwqA7sPAkug1kcuFddjn59QPQMzzCgKhEp`.
See `apps/web/DEPLOY_ANCHOR.md` for the Playground procedure (expect ~1h through
rate limits; iterate on any Rust build errors — e.g. a missing `pubkey` import).

This file is the single source of truth so nothing is forgotten. Everything below
is **staged, NOT applied** — the live site (the "Parabéns 2.0" build, commit
`b495a04`) still runs against the CURRENTLY deployed program. **Client changes
marked "(post-deploy)" MUST NOT be pushed before the new program is live**, or the
client/program layouts diverge and multiplayer breaks.

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

---

## PROGRAM changes — `programs/sol-city/src/lib.rs` (paste-ready)

### Item 1 — Dedicated Find Someone leaderboard (recommended: a `HuntScore` PDA on BASE)

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

### Item 2 — Session variants of the NPC interaction records

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

### Item 3 — (OPTIONAL) Hunt state on the ER — `delegate_hunt`

Mirror the existing `delegate` (see `pub fn delegate` + `struct DelegatePlayer`)
but for the hunt PDA: seeds `[HUNT_SEED]`, NO `authority` (it's a global account —
sign with any funded session key as payer), buffer seed `["buffer", hunt.key()]`,
and the same buffer→zero→assign→CPI→close dance. Then `claim_find`/`expire_round`
run on the ER and reads come off the ER poll. **Evaluate whether it's worth the
complexity** (shared delegated account, who delegates it once, never undelegate).
If skipped, the hunt simply stays on base — which works fine today.

**Do NOT change `PLAYER_SEED`** unless you deliberately add a field to `PlayerState`
(none of the recommended items above do — that's the whole point of `HuntScore`).

---

## CLIENT changes (post-deploy — apply ONLY after the new program is live)

Order: deploy program → verify → then push these together.

1. **`apps/web/src/game/solana/program.ts`**
   - Add `HUNT_SCORE_SEED = "hunt_score"` + `deriveHuntScorePDA(wallet)`.
   - Add `interface HuntScore { authority: PublicKey; wins: number }` + `decodeHuntScore(data)`.
   - `PLAYER_SEED` stays `"player_v2"` (no seed bump — HuntScore avoids it).

2. **`apps/web/src/game/solana/instructions.ts`**
   - Add `DISC` entries: `recordHuntFind`, `recordSwapSession`, `recordTransferSession`,
     `recordBountySession` (+ `delegateHunt` if doing Item 3).
   - Add builders: `buildRecordHuntFindIx(player, sessionKey)`,
     `buildRecordSwapSessionIx/TransferSessionIx/BountySessionIx(player, sessionKey)`.

3. **`apps/web/src/game/multiplayer/OnChainMultiplayer.ts`**
   - `claimFind`: on a winning claim, replace
     `this.recordScoreSession(true, 1, "Find someone ★ +1")` with a call to
     `record_hunt_find` (session-signed on base) → +1 to HuntScore.wins.
   - `recordAction("swap"|"transfer"|"bounty")`: switch from `signAndSendViaWallet`
     (wallet popup, base) to the session/ER path (`record_*_session`, no popup) —
     mirror `recordScoreSession`. Keeps the DeFi action's own wallet tx; only the
     stat record becomes seamless.
   - (Item 3 only) route `ensureHuntInitialized`/`claimFind`/`expireRound`/`pollHunt`
     to the ER, and delegate the hunt once.

4. **`apps/web/src/ui/WhereIsNPCCard.tsx` + `WhereIsNPCGame.ts`**
   - Replace the `localStorage` leaderboard (`getLeaderboard`/`recordFind`/`getMyScore`)
     with an on-chain read: `getProgramAccounts(HuntScore)` on the base failover RPC,
     decode `{authority, wins}`, sort desc → global leaderboard. `myScore` = our
     wallet's HuntScore.wins.

5. **Verify layouts match** the deployed program before pushing (this is what broke
   things historically). `npx tsc --noEmit` + a quick `simulateTransaction` of the
   new ixs against the deployed program on the ephemeral node (the technique that
   cracked the init bug — see `project-multiplayer-transport` memory).

---

## Post-deploy verification

- [ ] Program `last_deploy_slot` advanced; upgrade authority still the game wallet.
- [ ] Simulate `record_hunt_find` + the `*_session` records against the deployed
      program (ephemeral node) → all succeed.
- [ ] Find a citizen → HuntScore.wins +1 (NOT score +100/+1); log shows it.
- [ ] Leaderboard shows the SAME numbers on 2 devices (truly global/on-chain).
- [ ] NPC swap/transfer/bounty records: no 2nd wallet popup; log entry appears.
- [ ] Full cross-device multiplayer still green (compare to Parabéns 2.0).

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
