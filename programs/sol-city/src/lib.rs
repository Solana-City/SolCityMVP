use anchor_lang::prelude::*;
// The one seam with the collectibles program, and it is read-only: the
// city copies UnlockState into the player's wardrobe snapshot and never
// writes it. Imported rather than redeclared so the catalog boundaries
// have ONE definition, because two copies that must agree is how they
// stop agreeing.
use sol_city_catalog::{UnlockState, ENFORCED_FROM, UNLOCKS_SEED};
use anchor_lang::solana_program::{
    pubkey,
    program::{invoke, invoke_signed},
    system_instruction,
    program_memory::sol_memset,
    hash::hashv,
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
pub const PLAYER_SEED: &[u8] = b"player_v4";

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

/// Bitset capacity in bytes → 256 possible item indices. The CLIENT owns the
/// index→item table (getBoosterPool order); the pool count per draw is passed
/// per request and stored on the account, so the pool can grow without a
/// redeploy (append-only, never reorder).
/// How many owned catalog indices the rollup snapshot on PlayerState holds.
///
/// 256 entries, 512 bytes, fixed. It is fixed because PlayerState is delegated
/// and a delegated account cannot be realloc'd; UnlockState on the base layer
/// grows instead. 256 covers all but a determined collector, and the escape
/// beyond it is undelegate, realloc, re-delegate on the next login.
///
/// This replaced a 128-byte bitset on 2026-10-24. A bitset cost
/// `catalog / 8` bytes for every wallet whether it owned one cosmetic or all
/// of them, so growing the catalog taxed every player up front and capped the
/// catalog at whatever was budgeted. A list costs two bytes per item actually
/// owned, and the catalog size appears in per-player storage nowhere at all:
/// a u16 index addresses 65,535 items, which at four seasons of 300 is more
/// than fifty years.
pub const PLAYER_UNLOCK_CAP: usize = 256;


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
/// Friends a player can hold, counting people invited and people turned
/// down. Sixteen costs 528 bytes, which is 0.0027 SOL on top of an account
/// every player already creates.
///
/// Fixed, because this account spends its life delegated to a rollup and a
/// delegated account cannot be realloc'd.
pub const FRIEND_LINK_CAP: usize = 16;

/// "I want this person as a friend." An invite and an acceptance are the SAME
/// state, which is what lets one instruction serve both: a friendship is
/// simply both sides holding it about each other, and the client derives that
/// from two accounts it already reads twice a second.
pub const LINK_WANT: u8 = 1;

/// "I said no." Kept so the sender sees an answer instead of a pending invite
/// forever. It cannot be written on the sender's account, because nobody
/// writes anybody else's account, so it lives here and their client reads it.
pub const LINK_DECLINED: u8 = 2;

pub const UNDELEGATE_BUFFER_SEED: &[u8] = b"undelegate-buffer";

/// Offset of `session_authority` inside a serialized PlayerState: 8 bytes of
/// Anchor discriminator, 32 of `authority`, then the Option tag at 40 and the
/// key at 41..73. Read by hand because the accounts below take the PDA as an
/// UncheckedAccount (see the note on CommitPlayerSession).
const SESSION_AUTHORITY_TAG_OFFSET: usize = 8 + 32;


/// Truncates a string to at most `max` BYTES on a char boundary, so a
/// multi-byte char (emoji in chat) never overflows a fixed-size account field.
fn cap_bytes(s: String, max: usize) -> String {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end = end.saturating_sub(1);
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


/// Hands a PDA this program owns to the delegation program.
///
/// Written once and called by every delegate instruction, because the hand
/// rolled CPI below is ninety lines of byte layout that has to match
/// `dlp-api::DelegateArgs` exactly. Two copies of it would be two things to
/// keep matching, and the second copy is always the one that does not get the
/// fix.
///
/// `seeds` are the PDA's seeds WITHOUT the bump; the bump is appended here.
#[allow(clippy::too_many_arguments)]
fn delegate_pda<'info>(
    authority: &Signer<'info>,
    pda: &UncheckedAccount<'info>,
    delegate_buffer: &UncheckedAccount<'info>,
    delegation_record: &UncheckedAccount<'info>,
    delegation_metadata: &UncheckedAccount<'info>,
    system_program: &Program<'info, System>,
    seeds: &[&[u8]],
    bump: u8,
    preferred_validator: Option<Pubkey>,
) -> Result<()> {
    let pda_key = pda.key();
    let bump_arr = [bump];
    let mut signer_seeds: Vec<&[u8]> = seeds.to_vec();
    signer_seeds.push(&bump_arr);

    let (_, buffer_bump) =
        Pubkey::find_program_address(&[BUFFER_SEED, pda_key.as_ref()], &crate::ID);
    let buffer_bump_arr = [buffer_bump];
    let buffer_signer_seeds: &[&[u8]] = &[BUFFER_SEED, pda_key.as_ref(), &buffer_bump_arr];

    let data_len = pda.data_len();
    let rent = SolanaRent::get()?;

    invoke_signed(
        &system_instruction::create_account(
            authority.key,
            delegate_buffer.key,
            rent.minimum_balance(data_len),
            data_len as u64,
            &crate::ID,
        ),
        &[
            authority.to_account_info(),
            delegate_buffer.to_account_info(),
            system_program.to_account_info(),
        ],
        &[buffer_signer_seeds],
    )?;

    {
        let src = pda.data.borrow();
        let mut dst = delegate_buffer.data.borrow_mut();
        dst.copy_from_slice(&src);
    }
    {
        let mut data = pda.data.borrow_mut();
        sol_memset(&mut data, 0, data_len);
    }

    pda.assign(&anchor_lang::solana_program::system_program::id());
    invoke_signed(
        &system_instruction::assign(pda.key, &DELEGATION_PROGRAM_ID),
        &[pda.to_account_info(), system_program.to_account_info()],
        &[&signer_seeds],
    )?;

    let mut ix_data: Vec<u8> = Vec::with_capacity(128);
    ix_data.extend_from_slice(&[0u8; 8]);
    ix_data.extend_from_slice(&NO_PERIODIC_COMMIT.to_le_bytes());
    ix_data.extend_from_slice(&(seeds.len() as u32).to_le_bytes());
    for seed in seeds {
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

    invoke_signed(
        &SolInstruction {
            program_id: DELEGATION_PROGRAM_ID,
            accounts: vec![
                SolAccountMeta::new(*authority.key, true),
                SolAccountMeta::new(pda_key, true),
                SolAccountMeta::new_readonly(crate::ID, false),
                SolAccountMeta::new(*delegate_buffer.key, false),
                SolAccountMeta::new(*delegation_record.key, false),
                SolAccountMeta::new(*delegation_metadata.key, false),
                SolAccountMeta::new_readonly(*system_program.key, false),
            ],
            data: ix_data,
        },
        &[
            authority.to_account_info(),
            pda.to_account_info(),
            delegate_buffer.to_account_info(),
            delegation_record.to_account_info(),
            delegation_metadata.to_account_info(),
            system_program.to_account_info(),
        ],
        &[&signer_seeds],
    )?;

    // The buffer was scratch space for the copy. Closing it hands its rent
    // back to whoever funded it, which is why delegating costs a fee and not
    // a deposit.
    {
        let lamports = delegate_buffer.lamports();
        **delegate_buffer.try_borrow_mut_lamports()? -= lamports;
        **authority.try_borrow_mut_lamports()? += lamports;
    }
    Ok(())
}

#[error_code]
pub enum SolCityError {
    #[msg("Invalid session key — call authorize_session first")]
    InvalidSessionKey,
    #[msg("Authority mismatch — wrong wallet for this player")]
    InvalidAuthority,
    #[msg("Hunt round is stale — the citizen has moved on")]
    HuntRoundStale,
    #[msg("Loadout contains an item this wallet hasn't unlocked")]
    ItemNotUnlocked,
    #[msg("No such mini-game slot")]
    UnknownMiniGame,
    #[msg("Undelegation buffer is not the canonical one for this account")]
    InvalidUndelegationBuffer,
    #[msg("Those seeds do not derive the account being undelegated")]
    InvalidUndelegationSeeds,
    #[msg("This player's friend list is full")]
    FriendListFull,
    #[msg("That is not a link state this program knows")]
    BadLinkState,
    // Appended, never inserted. Anchor numbers these by POSITION, so a
    // variant added in the middle silently renumbers every one after it
    // and any client matching on a code starts reporting the wrong thing.
}

#[program]
pub mod sol_city {
    use super::*;
    // `DISCRIMINATOR` on the generated `instruction::*` types comes from this
    // trait, and the prelude does not bring it in. `open_booster` reads it to
    // tell the VRF oracle which instruction to call back.
    use anchor_lang::Discriminator;

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
        player.unlocked = [0u16; PLAYER_UNLOCK_CAP];
        player.unlocked_len = 0;
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
        // ENFORCE, over the one range a forged unlock could monetise: the
        // loadout is "slot=index|...", each value a global catalog index, and a
        // BOOSTER item must be set in the player's unlock snapshot or the write
        // is rejected. Peers can then never see a pack cosmetic this wallet
        // never drew.
        //
        // TWO DELIBERATE HOLES, and together they mean this currently enforces
        // NOTHING. Read both before "fixing" either.
        //
        //   1. A value that does not parse as a number is SKIPPED, not
        //      rejected. The client still sends variant ids ("sk=Light"):
        //      the global index table that WARDROBE_ONCHAIN.md Phase 2
        //      specifies was never built. Rejecting a non-number would reject
        //      every outfit from every player, so until that table ships this
        //      loop sees nothing it can check.
        //   2. The quest block, [FREE_ITEM_COUNT, ENFORCED_FROM), is skipped
        //      outright. No instruction grants a quest bit on chain now that
        //      claim_free_outfit is out, so enforcing it would make all ten
        //      quest outfits unwearable.
        //
        // Both close by themselves, which is the whole reason this ships as a
        // no-op instead of waiting: when the client sends indices, (1) stops
        // matching and booster enforcement turns on with NO further deploy;
        // when something grants quest bits, (2) is a one-line change.
        for part in loadout.split('|') {
            let key = part.split('=').next().unwrap_or("");
            // "c" is the hair colour swatch, not a catalog item. Every swatch
            // is free to everyone, so there is nothing to check against the
            // unlock snapshot — and its value is a palette id, not an index,
            // so parsing it as one would reject the whole outfit.
            if key == "c" || key == "hairColor" {
                continue;
            }
            let val = match part.split('=').nth(1) {
                Some(v) if !v.is_empty() => v,
                _ => continue, // empty slot / no value = nothing worn there
            };
            // Hole (1): not a catalog index, so there is nothing to check.
            let idx: u16 = match val.parse() {
                Ok(i) => i,
                Err(_) => continue,
            };
            // Free items, and hole (2), the quest block.
            if idx < ENFORCED_FROM {
                continue;
            }
            // The snapshot is sorted, so this is a binary search rather than
            // a bit test: eight comparisons at most over 256 entries, which
            // is cheaper than it looks and buys a catalog with no ceiling.
            let len = (player.unlocked_len as usize).min(PLAYER_UNLOCK_CAP);
            require!(
                player.unlocked[..len].binary_search(&idx).is_ok(),
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
        // A wallet past the snapshot's capacity keeps the first
        // PLAYER_UNLOCK_CAP it owns rather than failing the sync: being unable
        // to wear the tail of a very large collection beats being unable to
        // sync at all. Sorted ascending on both sides, so the kept prefix
        // stays searchable.
        //
        // Built into a local first, so this never holds a borrow of one
        // account while writing another.
        let take = ctx.accounts.unlock_state.owned.len().min(PLAYER_UNLOCK_CAP);
        let mut snapshot = [0u16; PLAYER_UNLOCK_CAP];
        snapshot[..take].copy_from_slice(&ctx.accounts.unlock_state.owned[..take]);

        let player = &mut ctx.accounts.player;
        player.unlocked = snapshot;
        player.unlocked_len = take as u16;
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

        // The stored authority has to match the signer. Read from the raw
        // bytes because this account is an UncheckedAccount: the delegation
        // CPI reassigns its owner halfway through, and Anchor would write a
        // stale copy back over it.
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

        // The validator is DATA, not an account: the delegation program only
        // writes the key into the delegation record. Naming none leaves the
        // record open to whichever rollup claims the PDA first, which is what
        // every session did before this was here.
        delegate_pda(
            &ctx.accounts.authority,
            &ctx.accounts.player,
            &ctx.accounts.delegate_buffer,
            &ctx.accounts.delegation_record,
            &ctx.accounts.delegation_metadata,
            &ctx.accounts.system_program,
            &[PLAYER_SEED, authority_key.as_ref()],
            ctx.bumps.player,
            ctx.remaining_accounts.first().map(|acc| *acc.key),
        )
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

    // ── Friends ───────────────────────────────────────────────────────────
    //
    // No account of their own, and that is the whole point. A friend list is
    // durable state, so it needs bytes somewhere, and the cheapest bytes a
    // player can have are the ones in the account they already create and
    // already pay for. That is also exactly why chat costs nothing: it writes
    // a field of this same account, already delegated, with the session key.
    //
    // So a player signs NOTHING, ever, to use friends. There is no setup
    // transaction, no second account, no second delegation.

    /// Sets what this player thinks of another one, on their OWN account.
    ///
    /// The one instruction behind every friend action there is:
    ///
    ///   invite / accept  -> LINK_WANT     (they are the same thing)
    ///   decline          -> LINK_DECLINED
    ///   cancel / unfriend-> 0, which removes the link
    ///
    /// Invite and accept being one state is not a shortcut. A friendship IS
    /// both sides wanting it, so there is no separate "accepted" fact to
    /// store, nothing can get out of step between two accounts, and unfriend
    /// needs no cooperation from the other side: you drop your half.
    ///
    /// Nothing here checks that `peer` is a real citizen. It cannot without
    /// reading their account, which may be delegated to another rollup, and
    /// it does not need to: this is the player's own list, and the client only
    /// ever surfaces links for people it can actually see in the city.
    ///
    /// Session-signed, so no popup and no fee.
    pub fn set_link_session(
        ctx: Context<UpdatePlayerSession>,
        peer: Pubkey,
        state: u8,
    ) -> Result<()> {
        require!(
            state == 0 || state == LINK_WANT || state == LINK_DECLINED,
            SolCityError::BadLinkState
        );
        let player = &mut ctx.accounts.player;
        let len = (player.links_len as usize).min(FRIEND_LINK_CAP);
        let found = player.links[..len].iter().position(|l| l.peer == peer);

        match (found, state) {
            // Dropping a link that is not there is not an error: cancelling an
            // invite you already cancelled should be a no-op, not a failure.
            (None, 0) => {}
            // Swap-remove. Order carries no meaning here, so the cheap removal
            // is also the correct one.
            (Some(at), 0) => {
                player.links[at] = player.links[len - 1];
                player.links[len - 1] = Link::default();
                player.links_len -= 1;
            }
            (Some(at), _) => player.links[at].state = state,
            (None, _) => {
                require!(len < FRIEND_LINK_CAP, SolCityError::FriendListFull);
                player.links[len] = Link { peer, state };
                player.links_len += 1;
            }
        }
        player.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }


    /// Puts the global hunt on a rollup, so claiming a find is instant.
    ///
    /// Safe in a way the beach ball was not, and the difference is the whole
    /// reason this one can exist: `claim_find` touches ONE delegated account,
    /// the hunt itself. The finder is a plain signature, not an account that
    /// has to live anywhere. So a player delegated to any of the three rollups
    /// can still claim a find on the rollup that holds the hunt.
    ///
    /// `kick_ball_session` needed two delegated accounts at once, the ball and
    /// the kicker, and those are never on the same rollup for everybody.
    ///
    /// Admin-run, once. Nothing undelegates it: the hunt is a fixture.
    pub fn delegate_hunt(ctx: Context<DelegateHunt>) -> Result<()> {
        delegate_pda(
            &ctx.accounts.payer,
            &ctx.accounts.hunt,
            &ctx.accounts.delegate_buffer,
            &ctx.accounts.delegation_record,
            &ctx.accounts.delegation_metadata,
            &ctx.accounts.system_program,
            &[HUNT_SEED],
            ctx.bumps.hunt,
            ctx.remaining_accounts.first().map(|acc| *acc.key),
        )
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
    /// argument, so it serves any PDA this program delegates: the player today,
    /// the hunt once it is delegated.
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
    /// The one account this program reads that another program owns.
    ///
    /// `seeds::program` is not optional here and leaving it off is not a
    /// style slip: without it Anchor derives this PDA under OUR id, which is
    /// a different address from the one the collectibles program created. The
    /// instruction then fails on every player, and the symptom is a wardrobe
    /// snapshot that silently never updates, so a pack item is bought and
    /// never becomes wearable.
    ///
    /// The owner check comes free from the type: `UnlockState` is defined in
    /// sol-city-catalog with an `Owner` impl naming the collectibles program,
    /// so Anchor refuses an account that program does not own.
    #[account(
        seeds = [UNLOCKS_SEED, player.authority.as_ref()],
        bump,
        seeds::program = sol_city_catalog::COLLECTIBLES_PROGRAM_ID,
    )]
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
    /// CHECK: our own program ID, used by the delegation CPI to verify PDA
    /// ownership. Pinned by address: the CPI below names `crate::ID` in the
    /// account metas, so anything else here could only fail deeper in.
    #[account(address = crate::ID)]
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
    /// CHECK: MagicBlock delegation program, pinned by address. Never read
    /// here: the CPI target is the `DELEGATION_PROGRAM_ID` constant. It is in
    /// this struct so the transaction carries the account.
    #[account(address = DELEGATION_PROGRAM_ID)]
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


/// Committing a delegated player, with the PDA taken UNCHECKED on purpose.
///
/// The magic program touches the account during the CPI: commit-and-undelegate
/// reassigns its owner so nothing can write to it while the undelegation is in
/// flight. An `Account<PlayerState>` would have Anchor serialise its own copy
/// back over that when the instruction ends, which is the stale-write the
/// MagicBlock docs warn about. So the account comes in raw, the seeds tie it to
/// `authority`, and the session key is checked against the stored bytes.
#[derive(Accounts)]
pub struct DelegateHunt<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: PDA by seeds. Unchecked because the delegation CPI reassigns its
    /// owner midway, and Anchor would write a stale copy back over it.
    #[account(mut, seeds = [HUNT_SEED], bump)]
    pub hunt: UncheckedAccount<'info>,
    /// CHECK: our own program id, pinned; the CPI names crate::ID in its metas.
    #[account(address = crate::ID)]
    pub owner_program: UncheckedAccount<'info>,
    /// CHECK: delegate buffer PDA, seeds ["buffer", hunt.key()].
    #[account(mut)]
    pub delegate_buffer: UncheckedAccount<'info>,
    /// CHECK: delegation record PDA, owned by the delegation program.
    #[account(mut)]
    pub delegation_record: UncheckedAccount<'info>,
    /// CHECK: delegation metadata PDA, owned by the delegation program.
    #[account(mut)]
    pub delegation_metadata: UncheckedAccount<'info>,
    /// CHECK: MagicBlock delegation program, pinned by address.
    #[account(address = DELEGATION_PROGRAM_ID)]
    pub delegation_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

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
/// whatever came home (a player PDA, or the hunt), and every guard is in the
/// body.
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
    // ── The unlock snapshot, deliberately LAST ─────────────────────────────
    /// Catalog indices this wallet may wear, sorted ascending, the first
    /// `unlocked_len` entries valid. A snapshot of UnlockState.owned, copied
    /// at sync time so `update_look_session` can enforce on the rollup without
    /// a cross-cluster read.
    ///
    /// LAST, and that position is the point. Every client reads this account
    /// by walking offsets from the front, and the discovery sweep pulls one
    /// per online player every five seconds. Sitting last, it can be left out
    /// of the sweep entirely with a `dataSlice`, so the mask costs no
    /// bandwidth at all and the field is free to be generous.
    ///
    /// A LIST rather than a bitset, for the same reason as UnlockState.owned:
    /// its size follows what a player owns, not how big the catalog grew.
    ///
    /// FIXED, unlike UnlockState.owned, because this account is delegated to
    /// the rollup and a delegated account cannot be realloc'd. 256 covers all
    /// but a determined collector; beyond that the escape is undelegate,
    /// realloc, re-delegate on the next login.
    pub unlocked: [u16; PLAYER_UNLOCK_CAP],
    /// Valid entries in `unlocked`.
    pub unlocked_len: u16,
    /// Who this player wants as a friend, and who they turned down.
    ///
    /// Here rather than in an account of its own, for the reason chat is free:
    /// this account already exists, is already paid for and is already
    /// delegated, so writing a field of it costs a session signature and
    /// nothing else. A separate account would have meant a wallet prompt and
    /// a rent deposit before the other side had even answered.
    ///
    /// Appended LAST, after the unlock snapshot, so the offsets of everything
    /// a client already decodes stay where they were.
    pub links: [Link; FRIEND_LINK_CAP],
    /// How many of `links` are in use. The rest are zeroed and meaningless.
    pub links_len: u8,
}

/// What one player thinks of another. 33 bytes.
///
/// A friendship is both sides holding LINK_WANT about each other, which the
/// client works out from two accounts it already reads. There is no separate
/// "accepted" fact, so nothing can get out of step between two accounts, and
/// unfriending needs no cooperation: you drop your half.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, Default)]
pub struct Link {
    pub peer: Pubkey,
    /// LINK_WANT or LINK_DECLINED. Never 0 within `links_len`.
    pub state: u8,
}
