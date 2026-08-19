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

### Item 4 — Player names: `set_display_name_session` + `NameClaim` first-come registry

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

5. **Player names (Item 4).**
   - `program.ts`: `NAME_CLAIM_SEED = "name_claim"` + `deriveNameClaimPDA(normalizedName)`
     + `interface NameClaim { owner: PublicKey; name: string }` + `decodeNameClaim`.
   - `instructions.ts`: `DISC.setDisplayNameSession` (+ `DISC.claimName` if using
     the split option b) + `buildSetDisplayNameSessionIx(player, sessionKey, name)`.
   - `ProfileManager.setDisplayName`: after saving locally, fire the on-chain set
     via `OnChainMultiplayer` (session-signed, no popup) so peers re-render the name
     from their next poll. STOP defaulting `displayName` to the wallet in `setWallet`
     — keep `"Citizen"` (or an empty sentinel) until the player picks a name, so the
     nameplate shows a real name, not the address.
   - Login/name UI: a name field (on the ConnectScreen gate or first-run ProfilePanel)
     that calls `claim_name`; surface "name taken" when the `init` fails (the PDA
     already exists) so the player picks another. First claimer wins.
   - `CityScene.addRemotePlayer`: already uses `player.displayName ?? shortAddr` — once
     names propagate it will show the real name automatically; keep `shortAddr` as the
     fallback for players who never set one.

6. **Verify layouts match** the deployed program before pushing (this is what broke
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
- [ ] Set a name → it shows above YOUR head on the OTHER device (not the wallet).
- [ ] A 2nd wallet trying to claim the SAME name is rejected ("name taken").
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
