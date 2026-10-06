use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    pubkey,
    program::{invoke, invoke_signed},
    system_instruction,
    program_memory::sol_memset,
    rent::Rent as SolanaRent,
    sysvar::Sysvar as SolanaSysvar,
    instruction::{AccountMeta as SolAccountMeta, Instruction as SolInstruction},
};

// ── MagicBlock ephemeral VRF (outfit booster) ──────────────────────────────
// Hand-rolled CPI, same approach as delegation: Solana Playground only builds a
// fixed crate list and `ephemeral-vrf-sdk` is not on it. Layout mirrors
// ephemeral-vrf-sdk 0.17.0 (`create_request_randomness_ix` + `#[vrf]` +
// `#[vrf_callback]`): a SCOPED request, so the oracle signs our callback with
// the per-program identity PDA ["identity", our program id] under the VRF program.

declare_id!("HPvDFVnruSXHwKKP44eUvRh8oYqBaHCeQbK1sKWT1aU2");

// Bumped to "player_v3" when PlayerState gained `unlocked` (the on-chain snapshot
// that update_look_session enforces against) and `loadout` became index-based.
// New PDAs are fresh at the new size; existing v2 accounts are ignored — every
// wallet re-inits on next connect (same as v1→v2). Unlocks live in the separate
// UnlockState PDA, so they're NOT lost by the re-init. Client derivePlayerPDA
// uses the same seed.
pub const PLAYER_SEED: &[u8] = b"player_v3";

/// Global cosmetic catalog split: indices [0, FREE_ITEM_COUNT) are free (skin,
/// faces, starter basics); [FREE_ITEM_COUNT, N) are lockable (bit = idx - F in
/// UnlockState/PlayerState.unlocked). MUST match the client's global table and
/// POOL_VERSION. Free additions bump this (+ POOL_VERSION); lockable additions
/// just append and are safe.
pub const FREE_ITEM_COUNT: u16 = 20;
pub const POOL_VERSION: u16 = 1;
/// Reserved block (in the lockable space) for quest/NPC-collection reward
/// outfits — claimed free, once per wallet, via claim_free_outfit. Booster
/// items start AFTER this block, so quest and booster bit indices never shift
/// each other as either grows. Lockable bit layout:
///   [0, QUEST_FREE_SLOTS)  → quest-free items
///   [QUEST_FREE_SLOTS, …)  → booster items
pub const QUEST_FREE_SLOTS: u16 = 16;
pub const BUFFER_SEED: &[u8] = b"buffer";
/// Global "Find Someone" hunt state — one account for the whole city.
///
/// Bumped to "hunt_v2" when the round stopped needing a transaction to advance
/// (see the hunt block below). The v1 account is a different shape and is left
/// where it is; the new one is created once by `initialize_hunt` after deploy.
pub const HUNT_SEED: &[u8] = b"hunt_v2";
/// How long a citizen sticks around before it rotates unfound (seconds).
pub const CITIZEN_DURATION_SECS: i64 = 300;

// ── Social: a profile other players can read, and friends ──────────────────
/// Achievement bitset capacity in bytes -> 256 achievements. The CLIENT owns
/// the index->achievement table (achievementRegistry order): append-only,
/// never reorder, or every published profile reads as the wrong badges.
pub const ACHIEVEMENT_BITS: usize = 32;
/// Mini-game slots on `PlayerState`: one best score per game.
///
/// Indexed by the CLIENT's mini-game table, which is append-only and must
/// never be reordered — the same discipline as `ACHIEVEMENT_BITS`, and for the
/// same reason: the index is the only thing that says which game a number
/// belongs to, so moving one re-labels every score already on chain.
///
///   0 food-cart   1 kite-clash   2 sol-mechs   3 hair-specialist
///
/// Sixteen leaves room to append twelve more without touching the layout.
pub const GAME_SLOTS: usize = 16;
/// What a won mini-game adds to the city score, decided here rather than sent
/// by the client: raw mini-game scores differ by orders of magnitude between
/// games (a kite run scores thousands, a haircut scores tens), so letting the
/// run's own number into the shared score would rank players by which game
/// they played. The best run per game is kept separately, unscaled.
pub const MINI_GAME_WIN_POINTS: u32 = 100;

/// One account per friendship. The seeds are the pair SORTED, so (a,b) and
/// (b,a) derive the same PDA and a friendship can never exist twice.
pub const FRIENDSHIP_SEED: &[u8] = b"friendship";
/// One account per pending invite, from -> to. Being a PDA of the pair is what
/// makes a duplicate invite impossible: `init` fails the second time.
pub const FRIEND_REQUEST_SEED: &[u8] = b"friend_req";

// ── Outfit booster ─────────────────────────────────────────────────────────
/// Per-wallet unlock store (bitset of booster-pool item indices).
pub const UNLOCKS_SEED: &[u8] = b"unlocks";
/// Bitset capacity in bytes → 256 possible item indices. The CLIENT owns the
/// index→item table (getBoosterPool order); the pool count per draw is passed
/// per request and stored on the account, so the pool can grow without a
/// redeploy (append-only, never reorder).
pub const UNLOCK_BITS: usize = 32;
/// Pieces granted per pack.
pub const BOOSTER_PACK_SIZE: usize = 5;
/// Price to open an outfit box (0.025 SOL, about $2.50 at $100/SOL).
pub const BOOSTER_PRICE_LAMPORTS: u64 = 25_000_000;
/// Treasury that receives pack payments (the game wallet).
pub const TREASURY: Pubkey = pubkey!("9592QS34mPUwqA7sPAkug1kcuFddjn59QPQMzzCgKhEp");

/// MagicBlock VRF program.
pub const VRF_PROGRAM_ID: Pubkey = pubkey!("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");
/// Default base-layer oracle queue.
pub const VRF_DEFAULT_QUEUE: Pubkey = pubkey!("Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh");
/// Seed of both identity PDAs: ours ["identity"] signs the request; the VRF
/// program's ["identity", our id] signs the callback.
pub const VRF_IDENTITY_SEED: &[u8] = b"identity";
/// Request variant: scoped identity, regular priority.
const VRF_REQUEST_SCOPED: u8 = 10;

/// Borsh payload of the VRF program's request instruction.
#[derive(AnchorSerialize)]
struct VrfRequest {
    caller_seed: [u8; 32],
    callback_program_id: Pubkey,
    callback_discriminator: Vec<u8>,
    callback_accounts_metas: Vec<VrfCallbackMeta>,
    callback_args: Vec<u8>,
}

#[derive(AnchorSerialize)]
struct VrfCallbackMeta {
    pubkey: Pubkey,
    is_signer: bool,
    is_writable: bool,
}

/// The only key allowed to sign callback_open_booster.
fn vrf_callback_identity() -> Pubkey {
    Pubkey::find_program_address(&[VRF_IDENTITY_SEED, crate::ID.as_ref()], &VRF_PROGRAM_ID).0
}

// ── The beach football ─────────────────────────────────────────────────────
//
// One account for the ball on the ST Brasil sand, delegated to the rollup so
// a kick is a free, sub-second write everybody reads off the same poll.
//
// Only the KICK is stored, never the roll: position, the speed it left at,
// and when. Every client runs the same fixed-step physics from that snapshot
// (apps/web/src/game/world/BeachBall.ts), so a ball that rolls for two
// seconds costs one write instead of a hundred.
//
// A singleton, like the hunt. A second ball would need another seed and
// another deploy, which is the same bargain HUNT_SEED already takes.
pub const BALL_SEED: &[u8] = b"ball";

/// How far a player may be from the ball and still kick it, in world pixels,
/// SQUARED.
///
/// Deliberately loose. A player's on-chain position is rewritten every 200ms,
/// so at a walk it is routinely a tile and a half behind where they really
/// are, and further under a speed buff. This is here to stop a modified
/// client putting the ball on the other side of the city, not to referee the
/// tackle — a check tight enough to be "accurate" would throw out real kicks
/// all day.
pub const BALL_REACH_SQ: i64 = 96 * 96;

/// The fastest a kick may leave, px/s. The game kicks at 190.
pub const BALL_MAX_SPEED: i16 = 400;

/// The ST Brasil beach, as a bounding box in world pixels (tiles 5..68 by
/// 56..104 of a 24px grid).
///
/// The real boundary is the painted sand, which the client carries as a tile
/// mask built from the map at load — far too much detail for a program to
/// hold, and it would have to be re-deployed every time the artist moved the
/// shoreline. So the chain keeps the ball in the right QUARTER of the city
/// and the clients agree on the exact edge between them.
pub const BALL_MIN_X: u32 = 5 * 24;
pub const BALL_MAX_X: u32 = 68 * 24;
pub const BALL_MIN_Y: u32 = 56 * 24;
pub const BALL_MAX_Y: u32 = 104 * 24;

/// MagicBlock delegation program on devnet.
pub const DELEGATION_PROGRAM_ID: Pubkey =
    pubkey!("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

/// `commit_frequency_ms` for every delegation this program opens: never commit
/// on a timer. u32::MAX is the value MagicBlock's own SDK defaults to.
///
/// A real frequency (this used to be 3_000) is the expensive way to delegate.
/// An account gets ten commits before the eleventh fails with 0xA0000000, and
/// every commit after the first bills 0.001 SOL against the delegation deposit,
/// which for a player PDA is only ~0.0023 SOL of the player's own money. At
/// three seconds that allowance is gone in half a minute.
///
/// Nothing here needs it. Every client reads live state off the rollup, never
/// off the base copy, and the base copy only has to be right when the session
/// ends, which `commit_and_undelegate` already guarantees. The validator has
/// the timer path disabled today (magicblock-validator#625), so this changes
/// nothing until they turn it back on, and then it keeps it turned off for us.
const NO_PERIODIC_COMMIT: u32 = u32::MAX;

/// MagicBlock's magic program, and the context account it keeps the scheduled
/// work in. Both live on the rollup; neither exists on the base layer.
pub const MAGIC_PROGRAM_ID: Pubkey =
    pubkey!("Magic11111111111111111111111111111111111111");
pub const MAGIC_CONTEXT_ID: Pubkey =
    pubkey!("MagicContext1111111111111111111111111111111");

/// Magic program instruction tags, a bare u32 rather than an 8-byte Anchor
/// discriminator (that program is not an Anchor program).
const MAGIC_IX_COMMIT: u32 = 1;
const MAGIC_IX_COMMIT_AND_UNDELEGATE: u32 = 2;

/// Seeds of the buffer the delegation program fills with the committed state
/// and hands to `process_undelegation`. Derived under the DELEGATION program,
/// not under ours, which is what makes it unforgeable.
pub const UNDELEGATE_BUFFER_SEED: &[u8] = b"undelegate-buffer";

/// Offset of `session_authority` inside a serialized PlayerState: 8 bytes of
/// Anchor discriminator, 32 of `authority`, then the Option tag at 40 and the
/// key at 41..73. Read by hand because the accounts below take the PDA as an
/// UncheckedAccount (see the note on CommitPlayerSession).
const SESSION_AUTHORITY_TAG_OFFSET: usize = 8 + 32;

#[error_code]
pub enum SolCityError {
    #[msg("Invalid session key — call authorize_session first")]
    InvalidSessionKey,
    #[msg("Authority mismatch — wrong wallet for this player")]
    InvalidAuthority,
    #[msg("Hunt round is stale — the citizen has moved on")]
    HuntRoundStale,
    #[msg("A booster pack is already being opened for this wallet")]
    BoosterPending,
    #[msg("Booster pool count too small for a full pack")]
    InvalidPoolCount,
    #[msg("Wrong treasury account")]
    InvalidTreasury,
    #[msg("Loadout contains an item this wallet hasn't unlocked")]
    ItemNotUnlocked,
    #[msg("Not a claimable quest-reward item")]
    InvalidQuestItem,
    #[msg("Callback not signed by the VRF program identity")]
    InvalidVrfIdentity,
    #[msg("Too far from the ball to kick it")]
    BallOutOfReach,
    #[msg("You can't befriend yourself")]
    FriendSelf,
    #[msg("This invite is not addressed to you")]
    FriendNotRecipient,
    #[msg("Friendship accounts must be seeded with the pair sorted")]
    FriendPairUnsorted,
    #[msg("Those two keys are not the pair on this invite")]
    FriendPairMismatch,
    #[msg("No such mini-game slot")]
    UnknownMiniGame,
    #[msg("Undelegation buffer is not the canonical one for this account")]
    InvalidUndelegationBuffer,
    #[msg("Those seeds do not derive the account being undelegated")]
    InvalidUndelegationSeeds,
}

/// Truncates a string to at most `max` BYTES on a char boundary, so a
/// multi-byte char (emoji in chat) never overflows a fixed-size account field.
fn cap_bytes(s: String, max: usize) -> String {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

/// Checks a delegated PlayerState’s stored `session_authority` by reading the
/// bytes, for the instructions that take the account unchecked.
///
/// Same move `delegate` makes for `authority`: when Anchor must not own the
/// account, the constraint has to be done by hand. Layout: 8 discriminator,
/// 32 `authority`, then the Option tag and the key.
fn require_stored_session_authority(
    player: &UncheckedAccount,
    signer: &Pubkey,
) -> Result<()> {
    let data = player.data.borrow();
    require!(
        data.len() >= SESSION_AUTHORITY_TAG_OFFSET + 1 + 32,
        SolCityError::InvalidSessionKey
    );
    require!(
        data[SESSION_AUTHORITY_TAG_OFFSET] == 1,
        SolCityError::InvalidSessionKey
    );
    let start = SESSION_AUTHORITY_TAG_OFFSET + 1;
    let stored: [u8; 32] = data[start..start + 32]
        .try_into()
        .map_err(|_| error!(SolCityError::InvalidSessionKey))?;
    require_keys_eq!(
        Pubkey::from(stored),
        *signer,
        SolCityError::InvalidSessionKey
    );
    Ok(())
}

/// CPIs the magic program to schedule a commit of one account.
///
/// Instruction data is a bare u32 tag (that program is not an Anchor program),
/// and the accounts are payer, magic context, then the account to commit. The
/// account is writable only for the undelegating variant, which is what the
/// validator requires to lock it against further writes. Plain `invoke`, not
/// `invoke_signed`: the magic program authorises this by seeing OUR program id
/// as the CPI parent, so no PDA signature is needed.
fn schedule_magic_commit<'info>(
    tag: u32,
    payer: &AccountInfo<'info>,
    magic_context: &AccountInfo<'info>,
    magic_program: &AccountInfo<'info>,
    committee: &AccountInfo<'info>,
    undelegate: bool,
) -> Result<()> {
    let committee_meta = if undelegate {
        SolAccountMeta::new(*committee.key, false)
    } else {
        SolAccountMeta::new_readonly(*committee.key, false)
    };

    let ix = SolInstruction {
        program_id: MAGIC_PROGRAM_ID,
        accounts: vec![
            SolAccountMeta::new(*payer.key, true),
            SolAccountMeta::new(*magic_context.key, false),
            committee_meta,
        ],
        data: tag.to_le_bytes().to_vec(),
    };

    invoke(
        &ix,
        &[
            payer.clone(),
            magic_context.clone(),
            committee.clone(),
            magic_program.clone(),
        ],
    )?;
    Ok(())
}

#[program]
pub mod sol_city {
    use super::*;

    pub fn initialize_player(ctx: Context<InitializePlayer>, display_name: String) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.authority = ctx.accounts.authority.key();
        player.session_authority = None;
        player.display_name = display_name;
        player.x = 512;
        player.y = 288;
        player.direction = 0;
        player.outfit_id = 0;
        player.score = 0;
        player.swap_count = 0;
        player.transfer_count = 0;
        player.bounty_count = 0;
        player.loadout = String::new();
        player.expression = String::new();
        player.expression_at = 0;
        player.last_message = String::new();
        player.message_at = 0;
        player.unlocked = [0u8; 32];
        player.last_active = Clock::get()?.unix_timestamp;
        player.created_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn authorize_session(ctx: Context<AuthorizeSession>, session_key: Pubkey) -> Result<()> {
        ctx.accounts.player.session_authority = Some(session_key);
        Ok(())
    }

    pub fn revoke_session(ctx: Context<UpdatePlayer>) -> Result<()> {
        ctx.accounts.player.session_authority = None;
        Ok(())
    }

    pub fn update_position(ctx: Context<UpdatePlayer>, x: u32, y: u32, direction: u8) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.x = x;
        player.y = y;
        player.direction = direction;
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Hot path: signed by session key, zero popups. Sub-50ms in rollup.
    pub fn update_position_session(
        ctx: Context<UpdatePlayerSession>,
        x: u32,
        y: u32,
        direction: u8,
    ) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.x = x;
        player.y = y;
        player.direction = direction;
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn record_swap(ctx: Context<UpdatePlayer>) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.swap_count = player.swap_count.saturating_add(1);
        player.score = player.score.saturating_add(50);
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn record_transfer(ctx: Context<UpdatePlayer>) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.transfer_count = player.transfer_count.saturating_add(1);
        player.score = player.score.saturating_add(25);
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn record_bounty(ctx: Context<UpdatePlayer>) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.bounty_count = player.bounty_count.saturating_add(1);
        player.score = player.score.saturating_add(30);
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    // Session-key variants of record_swap / record_transfer. (No bounty
    // variant: nothing in the game records Superteam bounties.) Once the player PDA is
    // delegated, the wallet-signed versions can't be routed to the rollup
    // seamlessly; these run on the ER with no wallet popup. Same points.

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

    /// Records a mini-game result via session key — no wallet popup, routes
    /// through the Magic Router to the ephemeral rollup if the PDA is delegated.
    ///
    /// success=true  → score += score_delta, bounty_count += 1
    /// success=false → last_active updated only (loss is recorded, no penalty)
    pub fn record_mini_game_session(
        ctx: Context<UpdatePlayerSession>,
        success: bool,
        score_delta: u32,
    ) -> Result<()> {
        let player = &mut ctx.accounts.player;
        if success {
            player.score = player.score.saturating_add(score_delta);
            player.bounty_count = player.bounty_count.saturating_add(1);
        }
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Records one mini-game run: the best score per game, on chain.
    ///
    /// Session-signed, so it lands on the ephemeral rollup with no wallet popup
    /// and no fee, and the delegation commits to base every 3 seconds — which is
    /// where the city-wide read scans it from, the same `getProgramAccounts` over
    /// `PlayerState` the score leaderboard already makes. No new account, no
    /// shared account to contend on, and a player's own bests arrive on the
    /// position poll they are already making.
    ///
    /// Monotonic: a worse run never lowers a best, so a client replaying an old
    /// number cannot walk one backwards. `success` adds the flat city-score
    /// credit and counts the run; a loss records the attempt and the score it
    /// reached, which is what a leaderboard of bests wants anyway.
    ///
    /// Use this for mini-games. `record_mini_game_session` stays for the callers
    /// that only move the city score by a fixed amount (a Find Someone claim).
    ///
    /// HONEST ABOUT TRUST: the number comes from the client, exactly as it does
    /// for the key-value board this replaces and for `achievements`. Being on
    /// chain makes a score shared, permanent and readable by anything — it does
    /// not make it verified, and nothing is ever granted on the strength of it.
    pub fn record_game_score_session(
        ctx: Context<UpdatePlayerSession>,
        game: u8,
        score: u32,
        success: bool,
    ) -> Result<()> {
        let slot = game as usize;
        require!(slot < GAME_SLOTS, SolCityError::UnknownMiniGame);
        let player = &mut ctx.accounts.player;
        if score > player.game_bests[slot] {
            player.game_bests[slot] = score;
        }
        if success {
            player.score = player.score.saturating_add(MINI_GAME_WIN_POINTS);
            player.bounty_count = player.bounty_count.saturating_add(1);
        }
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn change_outfit(ctx: Context<UpdatePlayer>, outfit_id: u8) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.outfit_id = outfit_id;
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    // ── Shared-world signals on the ER (replace the base-layer Memo channel) ──
    // All session-signed (seamless), all written to the delegated PDA on the
    // rollup, and read by everyone off the same position poll — no base RPC,
    // near-zero fee.

    /// Broadcasts the full paper-doll loadout (pipe-encoded, e.g.
    /// "skin=Light|hair=Afro"). Others render the real avatar from the poll.
    pub fn update_look_session(ctx: Context<UpdatePlayerSession>, loadout: String) -> Result<()> {
        let player = &mut ctx.accounts.player;
        // ENFORCE: the loadout is "slot=index|..." where each value is a global
        // catalog index. A referenced item must be free (index < FREE_ITEM_COUNT)
        // or set in the player's unlock snapshot — otherwise the write is
        // rejected, so peers can never see a cosmetic this wallet never earned.
        for part in loadout.split('|') {
            let val = match part.split('=').nth(1) {
                Some(v) if !v.is_empty() => v,
                _ => continue, // empty slot / no value = nothing worn there
            };
            let idx: u16 = val.parse().map_err(|_| error!(SolCityError::ItemNotUnlocked))?;
            if idx < FREE_ITEM_COUNT {
                continue;
            }
            let lockable = (idx - FREE_ITEM_COUNT) as usize;
            let byte = lockable / 8;
            require!(
                byte < 32 && (player.unlocked[byte] & (1u8 << (lockable % 8) as u8)) != 0,
                SolCityError::ItemNotUnlocked
            );
        }
        player.loadout = cap_bytes(loadout, 120);
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Copies the authoritative UnlockState bitset into the player's snapshot.
    /// Session-signed (seamless) and run on BASE before delegating — that's why
    /// unlocks earned this session apply on the next delegation, not instantly.
    pub fn sync_unlocks(ctx: Context<SyncUnlocks>) -> Result<()> {
        ctx.accounts.player.unlocked = ctx.accounts.unlock_state.bits;
        Ok(())
    }

    /// Sets the current facial expression (id/textureKey) + timestamp. Readers
    /// play it when `expression_at` advances, with the usual auto-revert.
    pub fn set_expression_session(ctx: Context<UpdatePlayerSession>, expression: String) -> Result<()> {
        let player = &mut ctx.accounts.player;
        let now = Clock::get()?.unix_timestamp;
        player.expression = cap_bytes(expression, 24);
        player.expression_at = now;
        player.last_active = now;
        Ok(())
    }

    /// Stores the latest chat message + timestamp — a bubble/last-message
    /// channel on the ER, replacing the base-layer memo.
    pub fn send_chat_session(ctx: Context<UpdatePlayerSession>, message: String) -> Result<()> {
        let player = &mut ctx.accounts.player;
        let now = Clock::get()?.unix_timestamp;
        player.last_message = cap_bytes(message, 200);
        player.message_at = now;
        player.last_active = now;
        Ok(())
    }

    /// Delegates the player PDA to the MagicBlock Ephemeral Rollup.
    ///
    /// The wallet only needs to sign as fee payer. PDA signing happens inside
    /// this instruction via invoke_signed with the PDA's canonical seeds.
    ///
    /// Steps:
    ///   1. Verify caller owns this player account
    ///   2. Create a buffer PDA with a copy of the player state
    ///   3. Zero the player PDA data
    ///   4. Reassign the player PDA to the delegation program
    ///   5. CPI to the delegation program (it sets up ephemeral rollup records)
    ///   6. Close the buffer (return rent to payer)
    ///
    /// Takes one OPTIONAL remaining account: the rollup validator this player
    /// should be delegated to. Pass the identity of the ER the client reads
    /// from and that rollup is the one the delegation record names, instead of
    /// whichever validator happens to see the PDA first. Omit it and the
    /// record stays open, which is what every session did before.
    pub fn delegate(ctx: Context<DelegatePlayer>) -> Result<()> {
        let authority_key = ctx.accounts.authority.key();
        let player_key    = ctx.accounts.player.key();

        // Verify the stored authority matches the signer
        {
            let data = ctx.accounts.player.data.borrow();
            require!(data.len() >= 8 + 32, SolCityError::InvalidAuthority);
            let stored: [u8; 32] = data[8..40].try_into().unwrap();
            require_keys_eq!(
                Pubkey::from(stored),
                authority_key,
                SolCityError::InvalidAuthority
            );
        }

        let player_bump = ctx.bumps.player;

        // Signer seeds for the player PDA (WITH bump, for invoke_signed)
        let player_signer_seeds: &[&[u8]] = &[
            PLAYER_SEED,
            authority_key.as_ref(),
            &[player_bump],
        ];

        // Derive the buffer PDA
        let (_, buffer_bump) = Pubkey::find_program_address(
            &[BUFFER_SEED, player_key.as_ref()],
            &crate::ID,
        );
        let buffer_signer_seeds: &[&[u8]] = &[
            BUFFER_SEED,
            player_key.as_ref(),
            &[buffer_bump],
        ];

        let data_len = ctx.accounts.player.data_len();
        let rent = SolanaRent::get()?;

        // ── 1. Create the buffer PDA ───────────────────────────────────────
        invoke_signed(
            &system_instruction::create_account(
                ctx.accounts.authority.key,
                ctx.accounts.delegate_buffer.key,
                rent.minimum_balance(data_len),
                data_len as u64,
                &crate::ID,
            ),
            &[
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.delegate_buffer.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[buffer_signer_seeds],
        )?;

        // ── 2. Copy player data → buffer ───────────────────────────────────
        {
            let player_data = ctx.accounts.player.data.borrow();
            let mut buffer_data = ctx.accounts.delegate_buffer.data.borrow_mut();
            buffer_data.copy_from_slice(&player_data);
        }

        // ── 3. Zero the player PDA data ────────────────────────────────────
        {
            let mut player_data = ctx.accounts.player.data.borrow_mut();
            sol_memset(&mut player_data, 0, data_len);
        }

        // ── 4. Reassign player PDA → delegation program ────────────────────
        // First move ownership to system program so assign CPI can proceed
        ctx.accounts.player.assign(&anchor_lang::solana_program::system_program::id());
        invoke_signed(
            &system_instruction::assign(
                ctx.accounts.player.key,
                &DELEGATION_PROGRAM_ID,
            ),
            &[
                ctx.accounts.player.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[player_signer_seeds],
        )?;

        // ── 5. CPI → delegation program ────────────────────────────────────
        // Instruction discriminator: [0,0,0,0,0,0,0,0]
        // Data layout (Borsh after discriminator):
        //   u32  commit_frequency_ms
        //   u32  seeds.len()
        //   [u32 len + bytes] for each seed
        //   u8   option tag + 32 bytes when a validator is named
        //
        // The validator is DATA, not an account: the delegation program only
        // writes the key into the delegation record. The client names one by
        // appending its pubkey as the single remaining account, and omitting
        // it leaves the record open to whichever rollup claims the PDA first,
        // which is what every session did before this was here.
        let preferred_validator: Option<Pubkey> =
            ctx.remaining_accounts.first().map(|acc| *acc.key);
        let seeds_vec: [Vec<u8>; 2] = [
            PLAYER_SEED.to_vec(),
            authority_key.to_bytes().to_vec(),
        ];
        let mut ix_data: Vec<u8> = Vec::with_capacity(96);
        ix_data.extend_from_slice(&[0u8; 8]);                          // discriminator
        ix_data.extend_from_slice(&NO_PERIODIC_COMMIT.to_le_bytes());  // commit_frequency_ms
        ix_data.extend_from_slice(&(seeds_vec.len() as u32).to_le_bytes()); // seeds.len()
        for seed in &seeds_vec {
            ix_data.extend_from_slice(&(seed.len() as u32).to_le_bytes());
            ix_data.extend_from_slice(seed);
        }
        match preferred_validator {
            Some(validator) => {
                ix_data.push(1u8);
                ix_data.extend_from_slice(validator.as_ref());
            }
            None => ix_data.push(0u8),
        }

        let delegate_ix = SolInstruction {
            program_id: DELEGATION_PROGRAM_ID,
            accounts: vec![
                SolAccountMeta::new(*ctx.accounts.authority.key, true),
                SolAccountMeta::new(*ctx.accounts.player.key, true),
                SolAccountMeta::new_readonly(crate::ID, false),
                SolAccountMeta::new(*ctx.accounts.delegate_buffer.key, false),
                SolAccountMeta::new(*ctx.accounts.delegation_record.key, false),
                SolAccountMeta::new(*ctx.accounts.delegation_metadata.key, false),
                SolAccountMeta::new_readonly(*ctx.accounts.system_program.key, false),
            ],
            data: ix_data,
        };

        invoke_signed(
            &delegate_ix,
            &[
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.player.to_account_info(),
                ctx.accounts.owner_program.to_account_info(),
                ctx.accounts.delegate_buffer.to_account_info(),
                ctx.accounts.delegation_record.to_account_info(),
                ctx.accounts.delegation_metadata.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[player_signer_seeds],
        )?;

        // ── 6. Close buffer PDA (return rent to authority) ─────────────────
        {
            let buffer_lamports = ctx.accounts.delegate_buffer.lamports();
            **ctx.accounts.delegate_buffer.try_borrow_mut_lamports()? -= buffer_lamports;
            **ctx.accounts.authority.try_borrow_mut_lamports()? += buffer_lamports;
        }

        Ok(())
    }

    // ── "Find Someone" global hunt ─────────────────────────────────
    //
    // One global HuntState account is the shared source of truth for the
    // city-wide hide-and-seek: the round deterministically seeds the target
    // citizen, so every client hunts the same one, and the deadline drives the
    // countdown everybody sees.
    //
    // THE ROUND ADVANCES BY ITSELF. It used to be a stored counter that only
    // moved when somebody sent a transaction — a find, or a crank once the five
    // minutes were up. Nothing on Solana runs on its own, so that made the
    // city-wide hunt only as alive as whoever happened to be standing in it:
    // with nobody connected, or nobody able to sign, the deadline slid into the
    // past and the same citizen stayed hunted. Round 952 sat expired for over
    // an hour on 2026-10-02 for exactly that reason.
    //
    // So the round is now DERIVED: an anchor (a round number and the moment it
    // started) plus however many whole citizen durations have passed since.
    // Every reader computes the same current round from the same account with
    // no transaction at all, and an unfound citizen rotates on time whether
    // anybody is playing or not. A transaction is only needed to say somebody
    // WON, which is the one thing a clock cannot know.
    //
    // `claim_find` stays first-writer-wins: it re-anchors to the next round, so
    // a second claim for the same round no longer matches the derived current
    // round and fails the guard. Exactly one winner per round, as before.

    /// Creates the global hunt account (call once, ever, after deploy).
    pub fn initialize_hunt(ctx: Context<InitializeHunt>) -> Result<()> {
        let hunt = &mut ctx.accounts.hunt;
        hunt.anchor_round = 0;
        hunt.anchor_at = Clock::get()?.unix_timestamp;
        hunt.winner = Pubkey::default();
        Ok(())
    }

    /// First finder of `round` wins it and starts the next citizen immediately.
    ///
    /// Re-anchoring to `now` is what gives the next citizen a FULL five minutes
    /// instead of the remainder of a wall-clock slot, which is the same thing
    /// the client's per-citizen timer was written to guarantee.
    pub fn claim_find(ctx: Context<ClaimFind>, round: u32) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let hunt = &mut ctx.accounts.hunt;
        require!(hunt.current_round(now) == round, SolCityError::HuntRoundStale);
        hunt.winner = ctx.accounts.finder.key(); // session key of the finder
        hunt.anchor_round = round.wrapping_add(1);
        hunt.anchor_at = now;
        Ok(())
    }

    // ── The beach football ─────────────────────────────────────────────────
    //
    // initialize_ball: once, ever, after deploy. Then delegate_ball, once,
    // ever, and from there the ball lives on the rollup and every kick is a
    // session-signed write with no popup and no fee.

    /// Creates the ball and puts it on the sand. Call once, ever, after deploy.
    pub fn initialize_ball(ctx: Context<InitializeBall>, x: u32, y: u32) -> Result<()> {
        let ball = &mut ctx.accounts.ball;
        ball.x = x.clamp(BALL_MIN_X, BALL_MAX_X);
        ball.y = y.clamp(BALL_MIN_Y, BALL_MAX_Y);
        ball.vx = 0;
        ball.vy = 0;
        ball.kicker = Pubkey::default();
        ball.kicked_at = Clock::get()?.unix_timestamp;
        ball.seq = 0;
        Ok(())
    }

    /// Kicks the ball: stores where it was, how fast it left, and when.
    ///
    /// The kicker's own player account comes along, which proves two things
    /// with one read: the signer really is a session key somebody authorized,
    /// and that somebody is standing next to the ball. Without it any session
    /// key in the city could put the ball anywhere.
    ///
    /// Session-signed, so no wallet popup, and on the rollup, so no fee.
    pub fn kick_ball_session(
        ctx: Context<KickBallSession>,
        x: u32,
        y: u32,
        vx: i16,
        vy: i16,
    ) -> Result<()> {
        // Everything read off `ctx.accounts` up front, so the mutable borrow
        // of `ball` below is the only borrow alive by the time it is taken.
        let px = ctx.accounts.player.x as i64;
        let py = ctx.accounts.player.y as i64;
        let kicker = ctx.accounts.session_authority.key();
        let now = Clock::get()?.unix_timestamp;

        // Measured against the position the kick CLAIMS, not against where the
        // ball was last stored: the ball has been rolling since that snapshot,
        // and the client that caught up with it is the one telling us where it
        // got to.
        let dx = px - x as i64;
        let dy = py - y as i64;
        require!(dx * dx + dy * dy <= BALL_REACH_SQ, SolCityError::BallOutOfReach);

        let ball = &mut ctx.accounts.ball;
        ball.x = x.clamp(BALL_MIN_X, BALL_MAX_X);
        ball.y = y.clamp(BALL_MIN_Y, BALL_MAX_Y);
        ball.vx = vx.clamp(-BALL_MAX_SPEED, BALL_MAX_SPEED);
        ball.vy = vy.clamp(-BALL_MAX_SPEED, BALL_MAX_SPEED);
        ball.kicker = kicker;
        ball.kicked_at = now;
        // Wrapping, not saturating: this counts kicks, and a ball that has
        // been kicked four billion times should keep going, not freeze on
        // u32::MAX and stop looking like a new kick to anybody.
        ball.seq = ball.seq.wrapping_add(1);
        Ok(())
    }

    /// Delegates the ball to the MagicBlock Ephemeral Rollup. Once, ever,
    /// right after initialize_ball.
    ///
    /// The same six steps `delegate` runs for a player PDA, against a PDA
    /// with one seed and no owner. It is written out rather than shared with
    /// `delegate` on purpose: nothing in this repo can build an SBF binary
    /// (see REDEPLOY_CHECKLIST), Playground is the only compiler, and pulling
    /// a generic helper out of the one delegation path that has already
    /// shipped would put it at risk to save a screen of code.
    ///
    /// Takes the same OPTIONAL validator remaining account as `delegate`.
    ///
    /// Nothing ever undelegates it. The ball is a fixture of the city, not a
    /// session: it belongs on the rollup for as long as the rollup is there.
    pub fn delegate_ball(ctx: Context<DelegateBall>) -> Result<()> {
        let ball_key = ctx.accounts.ball.key();
        let ball_bump = ctx.bumps.ball;

        // Signer seeds for the ball PDA (WITH bump, for invoke_signed)
        let ball_signer_seeds: &[&[u8]] = &[BALL_SEED, &[ball_bump]];

        let (_, buffer_bump) = Pubkey::find_program_address(
            &[BUFFER_SEED, ball_key.as_ref()],
            &crate::ID,
        );
        let buffer_signer_seeds: &[&[u8]] = &[
            BUFFER_SEED,
            ball_key.as_ref(),
            &[buffer_bump],
        ];

        let data_len = ctx.accounts.ball.data_len();
        let rent = SolanaRent::get()?;

        // ── 1. Create the buffer PDA ───────────────────────────────────────
        invoke_signed(
            &system_instruction::create_account(
                ctx.accounts.payer.key,
                ctx.accounts.delegate_buffer.key,
                rent.minimum_balance(data_len),
                data_len as u64,
                &crate::ID,
            ),
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.delegate_buffer.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[buffer_signer_seeds],
        )?;

        // ── 2. Copy ball data → buffer ─────────────────────────────────────
        {
            let ball_data = ctx.accounts.ball.data.borrow();
            let mut buffer_data = ctx.accounts.delegate_buffer.data.borrow_mut();
            buffer_data.copy_from_slice(&ball_data);
        }

        // ── 3. Zero the ball PDA data ──────────────────────────────────────
        {
            let mut ball_data = ctx.accounts.ball.data.borrow_mut();
            sol_memset(&mut ball_data, 0, data_len);
        }

        // ── 4. Reassign ball PDA → delegation program ──────────────────────
        ctx.accounts.ball.assign(&anchor_lang::solana_program::system_program::id());
        invoke_signed(
            &system_instruction::assign(
                ctx.accounts.ball.key,
                &DELEGATION_PROGRAM_ID,
            ),
            &[
                ctx.accounts.ball.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[ball_signer_seeds],
        )?;

        // ── 5. CPI → delegation program ────────────────────────────────────
        // Same layout as `delegate`, with ONE seed instead of two, and the
        // same optional validator as the single remaining account.
        let preferred_validator: Option<Pubkey> =
            ctx.remaining_accounts.first().map(|acc| *acc.key);
        let seeds_vec: [Vec<u8>; 1] = [BALL_SEED.to_vec()];
        let mut ix_data: Vec<u8> = Vec::with_capacity(96);
        ix_data.extend_from_slice(&[0u8; 8]);                               // discriminator
        ix_data.extend_from_slice(&NO_PERIODIC_COMMIT.to_le_bytes());       // commit_frequency_ms
        ix_data.extend_from_slice(&(seeds_vec.len() as u32).to_le_bytes()); // seeds.len()
        for seed in &seeds_vec {
            ix_data.extend_from_slice(&(seed.len() as u32).to_le_bytes());
            ix_data.extend_from_slice(seed);
        }
        match preferred_validator {
            Some(validator) => {
                ix_data.push(1u8);
                ix_data.extend_from_slice(validator.as_ref());
            }
            None => ix_data.push(0u8),
        }

        let delegate_ix = SolInstruction {
            program_id: DELEGATION_PROGRAM_ID,
            accounts: vec![
                SolAccountMeta::new(*ctx.accounts.payer.key, true),
                SolAccountMeta::new(*ctx.accounts.ball.key, true),
                SolAccountMeta::new_readonly(crate::ID, false),
                SolAccountMeta::new(*ctx.accounts.delegate_buffer.key, false),
                SolAccountMeta::new(*ctx.accounts.delegation_record.key, false),
                SolAccountMeta::new(*ctx.accounts.delegation_metadata.key, false),
                SolAccountMeta::new_readonly(*ctx.accounts.system_program.key, false),
            ],
            data: ix_data,
        };

        invoke_signed(
            &delegate_ix,
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.ball.to_account_info(),
                ctx.accounts.owner_program.to_account_info(),
                ctx.accounts.delegate_buffer.to_account_info(),
                ctx.accounts.delegation_record.to_account_info(),
                ctx.accounts.delegation_metadata.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[ball_signer_seeds],
        )?;

        // ── 6. Close buffer PDA (return rent to payer) ─────────────────────
        {
            let buffer_lamports = ctx.accounts.delegate_buffer.lamports();
            **ctx.accounts.delegate_buffer.try_borrow_mut_lamports()? -= buffer_lamports;
            **ctx.accounts.payer.try_borrow_mut_lamports()? += buffer_lamports;
        }

        Ok(())
    }

    // ── Carrying rollup state back to the base layer ───────────────────
    //
    // A delegated account is only ever read on the rollup, and its base copy
    // stays frozen at whatever it held when `delegate` ran. Two things move it:
    // a commit, which copies the live state down while the account stays
    // delegated, and a commit-and-undelegate, which does that and then hands
    // ownership back to this program.
    //
    // BOTH MUST LIVE HERE. The magic program refuses to schedule a commit
    // unless the program that OWNS the account invoked it by CPI
    // (validate_commit_schedule_permissions: the parent program id must equal
    // the account’s owner, or the account itself must sign, or the validator
    // must). A client calling the magic program straight, which is what the
    // SDK’s `createCommitInstruction` builds, is a top-level instruction with
    // no parent and fails with "failed to find parent program id" no matter
    // who signed it. That is why the client-side commit_and_undelegate never
    // landed, and why PDAs pile up delegated forever.
    //
    // Budget: an account gets TEN commits before the eleventh fails with
    // 0xA0000000. Commit on milestones (a find, an unlock, a best), never on
    // movement. A final commit-and-undelegate is still allowed at the limit.

    /// Copies the player’s live rollup state onto the base layer, keeping the
    /// account delegated. Session-signed, so no wallet popup, and free: a
    /// rollup transaction costs nothing, and the commit charge is capped by a
    /// delegation deposit the session fee already exceeds.
    pub fn commit_player_session(ctx: Context<CommitPlayerSession>) -> Result<()> {
        require_stored_session_authority(
            &ctx.accounts.player,
            &ctx.accounts.session_authority.key(),
        )?;
        schedule_magic_commit(
            MAGIC_IX_COMMIT,
            &ctx.accounts.session_authority.to_account_info(),
            &ctx.accounts.magic_context.to_account_info(),
            &ctx.accounts.magic_program.to_account_info(),
            &ctx.accounts.player.to_account_info(),
            false,
        )
    }

    /// Ends the session: commits the live state and gives the PDA back to this
    /// program. This is the rollup half; the base-layer half is
    /// `process_undelegation`, which the delegation program calls back.
    pub fn commit_and_undelegate_player_session(
        ctx: Context<CommitAndUndelegatePlayerSession>,
    ) -> Result<()> {
        require_stored_session_authority(
            &ctx.accounts.player,
            &ctx.accounts.session_authority.key(),
        )?;
        schedule_magic_commit(
            MAGIC_IX_COMMIT_AND_UNDELEGATE,
            &ctx.accounts.session_authority.to_account_info(),
            &ctx.accounts.magic_context.to_account_info(),
            &ctx.accounts.magic_program.to_account_info(),
            &ctx.accounts.player.to_account_info(),
            true,
        )
    }

    /// The undelegation callback. Never called by us.
    ///
    /// Once an undelegation settles, the delegation program CPIs into this
    /// program with discriminator [196, 28, 41, 206, 48, 37, 51, 167] and the
    /// account’s seeds. THE NAME IS LOAD-BEARING: Anchor derives exactly that
    /// discriminator from sha256("global:process_undelegation"), and any other
    /// name produces a different one, which means the callback finds no handler
    /// and the account never comes home. Checked against the delegation
    /// program, 2026-10-06. Do not rename.
    ///
    /// It re-creates the PDA under this program at the buffer’s size and copies
    /// the committed state in. Generic on purpose: the seeds arrive as an
    /// argument, so it serves the player PDA and the ball alike.
    ///
    /// Anyone may call it. What makes that safe is the buffer: it has to sign,
    /// it has to be owned by the delegation program, and it has to be the
    /// canonical undelegate-buffer PDA for this account. Only the delegation
    /// program can produce a signature for it.
    pub fn process_undelegation(
        ctx: Context<InitializeAfterUndelegation>,
        account_seeds: Vec<Vec<u8>>,
    ) -> Result<()> {
        let base_account = &ctx.accounts.base_account;
        let buffer = &ctx.accounts.buffer;

        require!(buffer.is_signer, SolCityError::InvalidUndelegationBuffer);
        require_keys_eq!(
            *buffer.owner,
            DELEGATION_PROGRAM_ID,
            SolCityError::InvalidUndelegationBuffer
        );
        let (canonical_buffer, _) = Pubkey::find_program_address(
            &[UNDELEGATE_BUFFER_SEED, base_account.key().as_ref()],
            &DELEGATION_PROGRAM_ID,
        );
        require_keys_eq!(
            buffer.key(),
            canonical_buffer,
            SolCityError::InvalidUndelegationBuffer
        );

        // The seeds must derive the very account being handed back, or the
        // invoke_signed below would be signing for somebody else’s PDA.
        let seeds: Vec<&[u8]> = account_seeds.iter().map(|s| s.as_slice()).collect();
        let (derived, bump) = Pubkey::find_program_address(&seeds, &crate::ID);
        require_keys_eq!(
            derived,
            base_account.key(),
            SolCityError::InvalidUndelegationSeeds
        );

        let bump_slice: &[u8] = &[bump];
        let mut signer_seeds: Vec<&[u8]> = seeds.clone();
        signer_seeds.push(bump_slice);
        // Spelled out in two steps rather than &[&signer_seeds]: Playground is
        // the first compiler to see this file, so nothing here leans on a
        // coercion being inferred.
        let signer_slice: &[&[u8]] = &signer_seeds;
        let signer: &[&[&[u8]]] = &[signer_slice];

        let space = buffer.data_len();
        let rent = SolanaRent::get()?;

        if base_account.lamports() == 0 {
            invoke_signed(
                &system_instruction::create_account(
                    ctx.accounts.payer.key,
                    base_account.key,
                    rent.minimum_balance(space),
                    space as u64,
                    &crate::ID,
                ),
                &[
                    ctx.accounts.payer.to_account_info(),
                    base_account.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                signer,
            )?;
        } else {
            // It still holds lamports, so it cannot be created: top it up to
            // rent exemption, give it its space back, and take ownership.
            let shortfall = rent
                .minimum_balance(space)
                .saturating_sub(base_account.lamports());
            if shortfall > 0 {
                invoke(
                    &system_instruction::transfer(
                        ctx.accounts.payer.key,
                        base_account.key,
                        shortfall,
                    ),
                    &[
                        ctx.accounts.payer.to_account_info(),
                        base_account.to_account_info(),
                        ctx.accounts.system_program.to_account_info(),
                    ],
                )?;
            }
            invoke_signed(
                &system_instruction::allocate(base_account.key, space as u64),
                &[
                    base_account.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                signer,
            )?;
            invoke_signed(
                &system_instruction::assign(base_account.key, &crate::ID),
                &[
                    base_account.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                signer,
            )?;
        }

        let mut target = base_account.try_borrow_mut_data()?;
        let source = buffer.try_borrow_data()?;
        target.copy_from_slice(&source);

        Ok(())
    }

    // ── Outfit booster (VRF) ───────────────────────────────────────────────
    //
    // open_booster: wallet pays BOOSTER_PRICE_LAMPORTS to the treasury and
    // requests verifiable randomness from MagicBlock VRF, naming
    // callback_open_booster as the consumer. `pool_count` is the client's
    // current getBoosterPool() length (the index space to draw from); it's
    // stored on the unlock account so the async callback can use it.
    //
    // callback_open_booster: invoked by the VRF oracle (signed by the VRF
    // program identity). Derives BOOSTER_PACK_SIZE distinct indices in
    // [0, pool_count) from the verified randomness, sets those bits in the
    // wallet's UnlockState, and emits BoosterOpened so the client reveals them.

    pub fn open_booster(
        ctx: Context<OpenBooster>,
        pool_count: u16,
        client_seed: [u8; 32],
    ) -> Result<()> {
        require!(pool_count as usize >= BOOSTER_PACK_SIZE, SolCityError::InvalidPoolCount);
        // Every drawable bit must fit the bitset, or a draw would be silently lost.
        require!(
            QUEST_FREE_SLOTS as usize + pool_count as usize <= UNLOCK_BITS * 8,
            SolCityError::InvalidPoolCount
        );
        require_keys_eq!(ctx.accounts.treasury.key(), TREASURY, SolCityError::InvalidTreasury);

        {
            let unlocks = &mut ctx.accounts.unlock_state;
            require!(!unlocks.pending, SolCityError::BoosterPending);
            if unlocks.authority == Pubkey::default() {
                unlocks.authority = ctx.accounts.payer.key();
            }
            unlocks.pending = true;
            unlocks.pending_pool_count = pool_count;
        }

        // Payment → treasury (wallet is the signer/fee payer).
        invoke(
            &system_instruction::transfer(
                ctx.accounts.payer.key,
                ctx.accounts.treasury.key,
                BOOSTER_PRICE_LAMPORTS,
            ),
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.treasury.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Request randomness; the callback grants into this UnlockState.
        let mut data = vec![VRF_REQUEST_SCOPED, 0, 0, 0, 0, 0, 0, 0];
        VrfRequest {
            caller_seed: client_seed,
            callback_program_id: crate::ID,
            callback_discriminator: instruction::CallbackOpenBooster::DISCRIMINATOR.to_vec(),
            callback_accounts_metas: vec![VrfCallbackMeta {
                pubkey: ctx.accounts.unlock_state.key(),
                is_signer: false,
                is_writable: true,
            }],
            callback_args: vec![],
        }
        .serialize(&mut data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;
        let ix = SolInstruction {
            program_id: VRF_PROGRAM_ID,
            accounts: vec![
                SolAccountMeta::new(ctx.accounts.payer.key(), true),
                SolAccountMeta::new_readonly(ctx.accounts.program_identity.key(), true),
                SolAccountMeta::new(ctx.accounts.oracle_queue.key(), false),
                SolAccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
                SolAccountMeta::new_readonly(ctx.accounts.slot_hashes.key(), false),
            ],
            data,
        };
        invoke_signed(
            &ix,
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.program_identity.to_account_info(),
                ctx.accounts.oracle_queue.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.slot_hashes.to_account_info(),
                ctx.accounts.vrf_program.to_account_info(),
            ],
            &[&[VRF_IDENTITY_SEED, &[ctx.bumps.program_identity]]],
        )?;
        Ok(())
    }

    pub fn callback_open_booster(
        ctx: Context<CallbackOpenBooster>,
        randomness: [u8; 32],
    ) -> Result<()> {
        let unlocks = &mut ctx.accounts.unlock_state;
        let n = unlocks.pending_pool_count.max(1);

        let mut picks: Vec<u16> = Vec::with_capacity(BOOSTER_PACK_SIZE);
        let mut cursor: usize = 0;
        // 32 bytes → up to 31 index candidates; plenty to find 5 distinct.
        while picks.len() < BOOSTER_PACK_SIZE && cursor < 31 {
            let hi = randomness[cursor] as u16;
            let lo = randomness[cursor + 1] as u16;
            // Draw a booster-subset index in [0, n); its lockable bit sits after
            // the reserved quest-free block so quest bits never shift.
            let bit = QUEST_FREE_SLOTS + ((hi << 8) | lo) % n;
            if !picks.contains(&bit) {
                picks.push(bit);
                let byte = (bit / 8) as usize;
                if byte < UNLOCK_BITS {
                    unlocks.bits[byte] |= 1u8 << (bit % 8) as u8;
                }
            }
            cursor += 1;
        }

        unlocks.pending = false;
        emit!(BoosterOpened { authority: unlocks.authority, indices: picks });
        Ok(())
    }

    /// Grants a quest / NPC-collection reward outfit — free, once per wallet
    /// (the bit is idempotent, so re-claiming is a no-op). Wallet-signed (one
    /// prompt on completion). `index` must be in the reserved quest-free block;
    /// booster items are out of range, so this can't mint paid items for free.
    /// The client gates which index behind which completed quest.
    pub fn claim_free_outfit(ctx: Context<ClaimFreeOutfit>, index: u16) -> Result<()> {
        require!(index < QUEST_FREE_SLOTS, SolCityError::InvalidQuestItem);
        let unlocks = &mut ctx.accounts.unlock_state;
        if unlocks.authority == Pubkey::default() {
            unlocks.authority = ctx.accounts.authority.key();
        }
        unlocks.bits[(index / 8) as usize] |= 1u8 << (index % 8) as u8;
        Ok(())
    }

    // -- The public profile ------------------------------------------------

    /// Publishes the achievements + streak a visitor sees on this player's
    /// card. Session-signed, so it costs no popup and no fee on the rollup,
    /// and it is called only when the numbers actually change (never per
    /// frame): the reader pays nothing either, because these fields ride the
    /// position poll that is already running.
    ///
    /// Achievement bits only ever turn ON and `streak_best` only ever rises.
    /// Both are monotonic for the same reason: a second device, or a client
    /// that reconnects with a cold profile, must not be able to erase what the
    /// player already published from somewhere else.
    pub fn publish_profile_session(
        ctx: Context<UpdatePlayerSession>,
        achievements: [u8; 32],
        streak_current: u16,
        streak_best: u16,
    ) -> Result<()> {
        let player = &mut ctx.accounts.player;
        for i in 0..ACHIEVEMENT_BITS {
            player.achievements[i] |= achievements[i];
        }
        player.streak_current = streak_current;
        player.streak_best = player.streak_best.max(streak_best);
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    // -- Friends -----------------------------------------------------------

    /// Invites another citizen. The invite is its own account, so it waits
    /// on-chain for however long it takes: there is nothing to deliver and no
    /// inbox to expire, which is what makes "they get it next time they log
    /// in" fall out for free rather than needing a server.
    ///
    /// Wallet-signed, because the invite account needs rent and session keys
    /// are not funded. One prompt per invite sent, which is the right shape for
    /// a deliberate act. The rent comes back when the invite is closed,
    /// whichever way it goes.
    pub fn send_friend_request(ctx: Context<SendFriendRequest>) -> Result<()> {
        let to = ctx.accounts.to_player.authority;
        require!(ctx.accounts.from.key() != to, SolCityError::FriendSelf);
        let req = &mut ctx.accounts.request;
        req.from = ctx.accounts.from.key();
        req.to = to;
        req.created_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Accepts an invite: the invite account closes (its rent going back to the
    /// sender) and one Friendship account takes its place.
    ///
    /// `a` and `b` are the pair sorted, which the caller passes because a seed
    /// cannot sort its own inputs. Both are checked here against the invite, so
    /// a caller cannot point this at some unrelated pair.
    pub fn accept_friend_request(
        ctx: Context<AcceptFriendRequest>,
        a: Pubkey,
        b: Pubkey,
    ) -> Result<()> {
        require!(a < b, SolCityError::FriendPairUnsorted);
        let req = &ctx.accounts.request;
        require!(
            (a == req.from && b == req.to) || (a == req.to && b == req.from),
            SolCityError::FriendPairMismatch
        );
        let f = &mut ctx.accounts.friendship;
        f.a = a;
        f.b = b;
        f.since = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Turns an invite down. Nothing is recorded: the account closes and the
    /// sender gets their rent back, same as accepting. A declined invite
    /// leaving no trace is deliberate, so nobody can read who refused them.
    pub fn decline_friend_request(_ctx: Context<DeclineFriendRequest>) -> Result<()> {
        Ok(())
    }

    /// Takes back an invite you sent and were not answered on.
    pub fn cancel_friend_request(_ctx: Context<CancelFriendRequest>) -> Result<()> {
        Ok(())
    }

    /// Unfriends. Either side can do it alone, and the rent goes to whoever
    /// closes it.
    pub fn remove_friend(_ctx: Context<RemoveFriend>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializePlayer<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + PlayerState::INIT_SPACE,
        seeds = [PLAYER_SEED, authority.key().as_ref()],
        bump,
    )]
    pub player: Account<'info, PlayerState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AuthorizeSession<'info> {
    #[account(
        mut,
        seeds = [PLAYER_SEED, authority.key().as_ref()],
        bump,
        has_one = authority,
    )]
    pub player: Account<'info, PlayerState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdatePlayer<'info> {
    #[account(
        mut,
        seeds = [PLAYER_SEED, authority.key().as_ref()],
        bump,
        has_one = authority,
    )]
    pub player: Account<'info, PlayerState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdatePlayerSession<'info> {
    #[account(
        mut,
        seeds = [PLAYER_SEED, player.authority.as_ref()],
        bump,
        constraint = player.session_authority == Some(session_authority.key())
            @ SolCityError::InvalidSessionKey,
    )]
    pub player: Account<'info, PlayerState>,
    pub session_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SyncUnlocks<'info> {
    #[account(
        mut,
        seeds = [PLAYER_SEED, player.authority.as_ref()],
        bump,
        constraint = player.session_authority == Some(session_authority.key())
            @ SolCityError::InvalidSessionKey,
    )]
    pub player: Account<'info, PlayerState>,
    #[account(seeds = [UNLOCKS_SEED, player.authority.as_ref()], bump)]
    pub unlock_state: Account<'info, UnlockState>,
    pub session_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct DelegatePlayer<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: PDA verified via seeds; authority ownership verified in instruction body
    #[account(
        mut,
        seeds = [PLAYER_SEED, authority.key().as_ref()],
        bump,
    )]
    pub player: UncheckedAccount<'info>,
    /// CHECK: our own program ID, used by the delegation CPI to verify PDA ownership
    pub owner_program: UncheckedAccount<'info>,
    /// CHECK: delegate buffer PDA — seeds ["buffer", player.key()], owned by this program
    #[account(mut)]
    pub delegate_buffer: UncheckedAccount<'info>,
    /// CHECK: delegation record PDA — ["delegation", player.key()], owned by delegation program
    #[account(mut)]
    pub delegation_record: UncheckedAccount<'info>,
    /// CHECK: delegation metadata PDA — ["delegation-metadata", player.key()], owned by delegation program
    #[account(mut)]
    pub delegation_metadata: UncheckedAccount<'info>,
    /// CHECK: MagicBlock delegation program
    pub delegation_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeHunt<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + HuntState::INIT_SPACE,
        seeds = [HUNT_SEED],
        bump,
    )]
    pub hunt: Account<'info, HuntState>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimFind<'info> {
    #[account(mut, seeds = [HUNT_SEED], bump)]
    pub hunt: Account<'info, HuntState>,
    /// Session key — seamless, no wallet popup. Recorded as the round winner.
    pub finder: Signer<'info>,
}


#[derive(Accounts)]
pub struct InitializeBall<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + BallState::INIT_SPACE,
        seeds = [BALL_SEED],
        bump,
    )]
    pub ball: Account<'info, BallState>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct KickBallSession<'info> {
    #[account(mut, seeds = [BALL_SEED], bump)]
    pub ball: Account<'info, BallState>,
    /// The kicker's own player account. Read-only, and read for two reasons:
    /// the session-key constraint proves the signer is somebody's authorized
    /// key, and `player.x`/`player.y` prove that somebody is at the ball.
    #[account(
        seeds = [PLAYER_SEED, player.authority.as_ref()],
        bump,
        constraint = player.session_authority == Some(session_authority.key())
            @ SolCityError::InvalidSessionKey,
    )]
    pub player: Account<'info, PlayerState>,
    /// Session key — seamless, no wallet popup.
    pub session_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct DelegateBall<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: PDA verified via seeds; zeroed and reassigned in the instruction body
    #[account(mut, seeds = [BALL_SEED], bump)]
    pub ball: UncheckedAccount<'info>,
    /// CHECK: our own program ID, used by the delegation CPI to verify PDA ownership
    pub owner_program: UncheckedAccount<'info>,
    /// CHECK: delegate buffer PDA — seeds ["buffer", ball.key()], owned by this program
    #[account(mut)]
    pub delegate_buffer: UncheckedAccount<'info>,
    /// CHECK: delegation record PDA — ["delegation", ball.key()], owned by delegation program
    #[account(mut)]
    pub delegation_record: UncheckedAccount<'info>,
    /// CHECK: delegation metadata PDA — ["delegation-metadata", ball.key()], owned by delegation program
    #[account(mut)]
    pub delegation_metadata: UncheckedAccount<'info>,
    /// CHECK: MagicBlock delegation program
    pub delegation_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Committing a delegated player, with the PDA taken UNCHECKED on purpose.
///
/// The magic program touches the account during the CPI: commit-and-undelegate
/// reassigns its owner so nothing can write to it while the undelegation is in
/// flight. An `Account<PlayerState>` would have Anchor serialise its own copy
/// back over that when the instruction ends, which is the stale-write the
/// MagicBlock docs warn about. So the account comes in raw, the seeds tie it to
/// `authority`, and the session key is checked against the stored bytes.
#[derive(Accounts)]
pub struct CommitPlayerSession<'info> {
    /// CHECK: seeds tie it to `authority`; the session key is verified in the body.
    #[account(seeds = [PLAYER_SEED, authority.key().as_ref()], bump)]
    pub player: UncheckedAccount<'info>,
    /// CHECK: never read, never written. It is only the PDA’s second seed.
    pub authority: UncheckedAccount<'info>,
    /// Session key ─ seamless, no wallet popup. Pays the (zero) rollup fee.
    pub session_authority: Signer<'info>,
    /// CHECK: MagicBlock’s scheduling context, pinned by address.
    #[account(mut, address = MAGIC_CONTEXT_ID)]
    pub magic_context: UncheckedAccount<'info>,
    /// CHECK: MagicBlock’s magic program, pinned by address.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

/// As above, but the PDA is writable: the validator refuses to undelegate an
/// account it cannot lock.
#[derive(Accounts)]
pub struct CommitAndUndelegatePlayerSession<'info> {
    /// CHECK: seeds tie it to `authority`; the session key is verified in the body.
    #[account(mut, seeds = [PLAYER_SEED, authority.key().as_ref()], bump)]
    pub player: UncheckedAccount<'info>,
    /// CHECK: never read, never written. It is only the PDA’s second seed.
    pub authority: UncheckedAccount<'info>,
    /// Session key ─ seamless, no wallet popup.
    pub session_authority: Signer<'info>,
    /// CHECK: MagicBlock’s scheduling context, pinned by address.
    #[account(mut, address = MAGIC_CONTEXT_ID)]
    pub magic_context: UncheckedAccount<'info>,
    /// CHECK: MagicBlock’s magic program, pinned by address.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

/// Accounts for the undelegation callback, in the order the delegation program
/// passes them. Nothing here is seeds-checked by Anchor: the account is
/// whatever came home (player PDA or ball), and every guard is in the body.
#[derive(Accounts)]
pub struct InitializeAfterUndelegation<'info> {
    /// CHECK: the account coming home. Its seeds are validated in the body
    /// against the ones the delegation program passed as an argument.
    #[account(mut)]
    pub base_account: UncheckedAccount<'info>,
    /// CHECK: the delegation program’s buffer holding the committed state.
    /// Validated in the body: must sign, must be owned by the delegation
    /// program, and must be the canonical ["undelegate-buffer", account] PDA.
    /// That signature is the whole security boundary of this instruction.
    pub buffer: UncheckedAccount<'info>,
    /// CHECK: whoever the delegation program names to cover the rent.
    #[account(mut)]
    pub payer: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// The beach football: the last KICK, never the roll.
///
/// Every client replays the same physics from this snapshot, so the account
/// only changes when somebody touches the ball — a roll costs nothing.
#[account]
#[derive(InitSpace)]
pub struct BallState {
    /// Where the ball was when it was last kicked, in world pixels.
    pub x: u32,
    pub y: u32,
    /// How fast it left, px/s. Signed: a ball goes in every direction.
    pub vx: i16,
    pub vy: i16,
    /// Session key of whoever kicked it last.
    pub kicker: Pubkey,
    /// When, by the CHAIN's clock — which is the point of this account. It is
    /// the one clock every device agrees on, so a client can measure how old
    /// a kick is instead of guessing a constant for the trip, and two clients
    /// can order two kicks the same way.
    pub kicked_at: i64,
    /// Bumped on every kick. `kicked_at` is whole seconds and a dribble puts
    /// three kicks inside one of them, so this is what tells two apart.
    pub seq: u32,
}

#[account]
#[derive(InitSpace)]
pub struct HuntState {
    /// The round this anchor starts. The round actually being hunted is this
    /// plus the whole citizen durations elapsed since `anchor_at` — never read
    /// it as the current round, use `current_round`.
    pub anchor_round: u32,
    /// When the anchor round started. A claim moves it to the moment of the
    /// find, which is what gives the next citizen a full countdown.
    pub anchor_at: i64,
    /// Session key that claimed round `anchor_round - 1`.
    ///
    /// Meaningful only while no round has rolled past unclaimed, which is to
    /// say while `current_round == anchor_round`. Once the clock has carried
    /// the hunt further than the last claim, this is simply the last person who
    /// ever won, and the rounds in between had no winner. There is no longer an
    /// instruction to clear it, because there is no longer a transaction at the
    /// end of an unfound round to clear it from.
    pub winner: Pubkey,
}

impl HuntState {
    /// Whole citizen durations between the anchor and `now`.
    ///
    /// Saturating and floored at zero: a validator clock that steps backwards
    /// must leave the hunt where it is, never wind it back to an older citizen.
    pub fn rounds_passed(&self, now: i64) -> u32 {
        let elapsed = now.saturating_sub(self.anchor_at).max(0);
        (elapsed / CITIZEN_DURATION_SECS) as u32
    }

    /// The round being hunted right now. This is the number every client seeds
    /// the target citizen from, and the only one `claim_find` accepts.
    pub fn current_round(&self, now: i64) -> u32 {
        self.anchor_round.wrapping_add(self.rounds_passed(now))
    }

    /// When the current citizen rotates if nobody finds it.
    pub fn current_deadline(&self, now: i64) -> i64 {
        self.anchor_at + (self.rounds_passed(now) as i64 + 1) * CITIZEN_DURATION_SECS
    }
}

#[account]
#[derive(InitSpace)]
pub struct PlayerState {
    pub authority: Pubkey,
    pub session_authority: Option<Pubkey>,
    #[max_len(20)]
    pub display_name: String,
    pub x: u32,
    pub y: u32,
    pub direction: u8,
    pub outfit_id: u8,
    pub score: u32,
    pub swap_count: u16,
    pub transfer_count: u16,
    pub bounty_count: u16,
    pub last_active: i64,
    pub created_at: i64,
    // ── Shared-world signals (read off the same ER poll as position) ──────
    /// Pipe-encoded paper-doll loadout ("skin=Light|hair=Afro|..."). "" = none.
    #[max_len(120)]
    pub loadout: String,
    /// Current facial expression id/textureKey. "" = none.
    #[max_len(24)]
    pub expression: String,
    /// Unix ts the expression was set — drives newness + auto-revert on readers.
    pub expression_at: i64,
    /// Latest chat message.
    #[max_len(200)]
    pub last_message: String,
    /// Unix ts the last message was sent.
    pub message_at: i64,
    /// Snapshot of UnlockState.bits, copied in at delegate/sync time so the ER's
    /// update_look_session can enforce cosmetics without a cross-cluster read.
    pub unlocked: [u8; 32],
    // ── The public profile (read off the same ER poll as position) ─────────
    /// Unlocked achievements, one bit per client registry index.
    ///
    /// SELF-REPORTED, on purpose. Most achievements count things only the
    /// client sees (balls kicked, dogs petted, mini-game runs), so there is no
    /// on-chain tally to check them against. That makes this exactly as
    /// trustworthy as the KV boards it is shown beside, and nothing is ever
    /// gated on it: it is a display of what someone says they did. The things
    /// that must be true (score, unlocked cosmetics, ranked rating) live in
    /// fields the program itself writes.
    pub achievements: [u8; ACHIEVEMENT_BITS],
    /// Daily check-in streak, mirrored here so a visitor reads it off the poll
    /// they already make instead of costing a key-value read per card opened.
    /// `lb:streak` stays the city-wide ranking and the server computes the day
    /// rollover; this is the copy other players see.
    pub streak_current: u16,
    /// Best streak ever. Monotonic in the program, so a stale client that
    /// reconnects with an old number cannot walk it backwards.
    pub streak_best: u16,
    // ── Mini-game bests (read off the same ER poll, and off the base scan) ──
    /// Best score per mini-game, indexed by the client's mini-game table (see
    /// GAME_SLOTS). Zero means never played.
    ///
    /// LAST FIELD ON PURPOSE: every client decoder reads this account by walking
    /// offsets from the front (leaderboard.ts, decodeAndUpdatePlayer), so a field
    /// appended here is invisible to the ones that do not know about it yet,
    /// while a field inserted anywhere above would silently shift every number
    /// after it. Anything added later goes below this, for the same reason.
    pub game_bests: [u32; GAME_SLOTS],
}

// ── Outfit booster accounts ────────────────────────────────────────────────

#[derive(Accounts)]
pub struct OpenBooster<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + UnlockState::INIT_SPACE,
        seeds = [UNLOCKS_SEED, payer.key().as_ref()],
        bump,
    )]
    pub unlock_state: Account<'info, UnlockState>,
    /// CHECK: address-checked against TREASURY in the instruction body.
    #[account(mut)]
    pub treasury: AccountInfo<'info>,
    /// CHECK: MagicBlock VRF oracle queue (base devnet).
    #[account(mut, address = VRF_DEFAULT_QUEUE)]
    pub oracle_queue: AccountInfo<'info>,
    /// CHECK: this program's identity PDA; signs the VRF request.
    #[account(seeds = [VRF_IDENTITY_SEED], bump)]
    pub program_identity: UncheckedAccount<'info>,
    /// CHECK: MagicBlock VRF program.
    #[account(address = VRF_PROGRAM_ID)]
    pub vrf_program: UncheckedAccount<'info>,
    /// CHECK: SlotHashes sysvar, read by the VRF program.
    #[account(address = anchor_lang::solana_program::sysvar::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CallbackOpenBooster<'info> {
    /// Only the VRF program's scoped identity for THIS program may invoke the callback.
    #[account(address = vrf_callback_identity() @ SolCityError::InvalidVrfIdentity)]
    pub vrf_program_identity: Signer<'info>,
    /// Re-derived from the authority stored on the account (the wallet doesn't
    /// sign the callback — the oracle does), so the grant lands on the right PDA.
    #[account(
        mut,
        seeds = [UNLOCKS_SEED, unlock_state.authority.as_ref()],
        bump,
    )]
    pub unlock_state: Account<'info, UnlockState>,
}

#[derive(Accounts)]
pub struct ClaimFreeOutfit<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + UnlockState::INIT_SPACE,
        seeds = [UNLOCKS_SEED, authority.key().as_ref()],
        bump,
    )]
    pub unlock_state: Account<'info, UnlockState>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct UnlockState {
    /// Wallet that owns these unlocks.
    pub authority: Pubkey,
    /// Bitset of unlocked booster-pool indices (1 bit per index).
    pub bits: [u8; UNLOCK_BITS],
    /// A pack has been paid for and is awaiting the VRF callback.
    pub pending: bool,
    /// Index space for the pending draw (client getBoosterPool length).
    pub pending_pool_count: u16,
}

/// Emitted when a pack resolves — the client reveals these pool indices.
#[event]
pub struct BoosterOpened {
    pub authority: Pubkey,
    pub indices: Vec<u16>,
}
// -- Friends ----------------------------------------------------------------
//
// Two small accounts rather than a list on PlayerState, and that is the whole
// design decision. A `[Pubkey; 32]` on PlayerState would add 1024 bytes to the
// one account every client re-reads for every citizen every 500ms, so the
// friend list of people standing near you would be paid for continuously by
// everyone. These sit off that path: read once at login and once when the panel
// opens, they cap nothing, and the rent is refunded when a friendship or an
// invite goes away.
//
// Discovery is by `getProgramAccounts` with a memcmp filter:
//   my friends     -> filter a == me, then b == me (two calls)
//   invites to me  -> filter to == me
//   invites I sent -> filter from == me
// Both types are the same size, so a filter MUST also match the 8-byte
// discriminator at offset 0 or the two come back mixed together.

#[derive(Accounts)]
pub struct SendFriendRequest<'info> {
    #[account(
        init,
        payer = from,
        space = 8 + FriendRequest::INIT_SPACE,
        seeds = [FRIEND_REQUEST_SEED, from.key().as_ref(), to_player.authority.as_ref()],
        bump,
    )]
    pub request: Account<'info, FriendRequest>,
    /// The recipient's player account: being a citizen is what makes someone
    /// invitable, and reading `authority` off it is also how we learn the
    /// recipient's key without trusting an argument for it.
    ///
    /// Consequence of the player_v3 reset: a wallet that has not entered the
    /// city since the redeploy has no PDA at this seed yet and cannot be
    /// invited. The client should say "they need to visit the city first"
    /// rather than surface a raw constraint failure.
    #[account(
        seeds = [PLAYER_SEED, to_player.authority.as_ref()],
        bump,
    )]
    pub to_player: Account<'info, PlayerState>,
    #[account(mut)]
    pub from: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(a: Pubkey, b: Pubkey)]
pub struct AcceptFriendRequest<'info> {
    #[account(
        mut,
        close = from,
        seeds = [FRIEND_REQUEST_SEED, request.from.as_ref(), to.key().as_ref()],
        bump,
        constraint = request.to == to.key() @ SolCityError::FriendNotRecipient,
    )]
    pub request: Account<'info, FriendRequest>,
    #[account(
        init,
        payer = to,
        space = 8 + Friendship::INIT_SPACE,
        seeds = [FRIENDSHIP_SEED, a.as_ref(), b.as_ref()],
        bump,
    )]
    pub friendship: Account<'info, Friendship>,
    /// Gets the invite's rent back. Pinned to the sender, so the refund cannot
    /// be redirected.
    #[account(mut, address = request.from)]
    pub from: SystemAccount<'info>,
    #[account(mut)]
    pub to: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DeclineFriendRequest<'info> {
    #[account(
        mut,
        close = from,
        seeds = [FRIEND_REQUEST_SEED, request.from.as_ref(), to.key().as_ref()],
        bump,
        constraint = request.to == to.key() @ SolCityError::FriendNotRecipient,
    )]
    pub request: Account<'info, FriendRequest>,
    #[account(mut, address = request.from)]
    pub from: SystemAccount<'info>,
    pub to: Signer<'info>,
}

#[derive(Accounts)]
pub struct CancelFriendRequest<'info> {
    #[account(
        mut,
        close = from,
        seeds = [FRIEND_REQUEST_SEED, from.key().as_ref(), request.to.as_ref()],
        bump,
        has_one = from,
    )]
    pub request: Account<'info, FriendRequest>,
    #[account(mut)]
    pub from: Signer<'info>,
}

#[derive(Accounts)]
pub struct RemoveFriend<'info> {
    #[account(
        mut,
        close = closer,
        seeds = [FRIENDSHIP_SEED, friendship.a.as_ref(), friendship.b.as_ref()],
        bump,
        constraint = friendship.a == closer.key() || friendship.b == closer.key()
            @ SolCityError::InvalidAuthority,
    )]
    pub friendship: Account<'info, Friendship>,
    /// Either half of the pair. Gets the rent.
    #[account(mut)]
    pub closer: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct FriendRequest {
    pub from: Pubkey,
    pub to: Pubkey,
    pub created_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct Friendship {
    /// The lower of the two keys. Seeds are sorted, so one account per pair.
    pub a: Pubkey,
    /// The higher of the two keys.
    pub b: Pubkey,
    pub since: i64,
}
