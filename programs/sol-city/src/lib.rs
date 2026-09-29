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
pub const HUNT_SEED: &[u8] = b"hunt";
/// How long a citizen sticks around before it rotates unfound (seconds).
pub const CITIZEN_DURATION_SECS: i64 = 300;

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

#[error_code]
pub enum SolCityError {
    #[msg("Invalid session key — call authorize_session first")]
    InvalidSessionKey,
    #[msg("Authority mismatch — wrong wallet for this player")]
    InvalidAuthority,
    #[msg("Hunt round is stale — someone already advanced it")]
    HuntRoundStale,
    #[msg("Hunt citizen has not expired yet")]
    HuntNotExpired,
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
        //   u8   option tag (0 = no validator preference)
        let seeds_vec: [Vec<u8>; 2] = [
            PLAYER_SEED.to_vec(),
            authority_key.to_bytes().to_vec(),
        ];
        let mut ix_data: Vec<u8> = Vec::with_capacity(64);
        ix_data.extend_from_slice(&[0u8; 8]);                          // discriminator
        ix_data.extend_from_slice(&3_000u32.to_le_bytes());            // commit_frequency_ms
        ix_data.extend_from_slice(&(seeds_vec.len() as u32).to_le_bytes()); // seeds.len()
        for seed in &seeds_vec {
            ix_data.extend_from_slice(&(seed.len() as u32).to_le_bytes());
            ix_data.extend_from_slice(seed);
        }
        ix_data.push(0u8);                                              // None validator

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

    // ── "Find Someone" global hunt ─────────────────────────────────────────
    //
    // One global HuntState account is the shared source of truth for the
    // city-wide hide-and-seek: its `round` deterministically seeds the target
    // citizen (every client derives the same pedestrian from it), and its
    // `deadline` drives the countdown. Advancing the round — on a find or on
    // expiry — is the universal "next citizen + reset timer" signal every
    // client reads. All writes are signed by a session key (seamless, no
    // wallet popup) and are first-writer-wins via the `round` guard, so the
    // first player to land a claim for a given round is the sole winner.

    /// Creates the global hunt account (call once, ever, after deploy).
    pub fn initialize_hunt(ctx: Context<InitializeHunt>) -> Result<()> {
        let hunt = &mut ctx.accounts.hunt;
        let now = Clock::get()?.unix_timestamp;
        hunt.round = 0;
        hunt.winner = Pubkey::default();
        hunt.found_at = now;
        hunt.deadline = now + CITIZEN_DURATION_SECS;
        Ok(())
    }

    /// First finder of `round` wins it and advances the hunt to the next
    /// citizen. A concurrent claim for the same round fails the guard once
    /// the round has moved on, so exactly one winner is recorded per round.
    pub fn claim_find(ctx: Context<ClaimFind>, round: u32) -> Result<()> {
        let hunt = &mut ctx.accounts.hunt;
        require!(hunt.round == round, SolCityError::HuntRoundStale);
        let now = Clock::get()?.unix_timestamp;
        hunt.winner = ctx.accounts.finder.key(); // session key of the finder
        hunt.round = hunt.round.wrapping_add(1);
        hunt.found_at = now;
        hunt.deadline = now + CITIZEN_DURATION_SECS;
        Ok(())
    }

    /// Rolls a citizen nobody found once its deadline has passed. Any client
    /// can crank it; first-writer-wins keeps it to a single advance.
    pub fn expire_round(ctx: Context<ExpireRound>, round: u32) -> Result<()> {
        let hunt = &mut ctx.accounts.hunt;
        require!(hunt.round == round, SolCityError::HuntRoundStale);
        let now = Clock::get()?.unix_timestamp;
        require!(now >= hunt.deadline, SolCityError::HuntNotExpired);
        hunt.winner = Pubkey::default(); // expired — no winner this round
        hunt.round = hunt.round.wrapping_add(1);
        hunt.found_at = now;
        hunt.deadline = now + CITIZEN_DURATION_SECS;
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
        // Same layout as `delegate`, with ONE seed instead of two.
        let seeds_vec: [Vec<u8>; 1] = [BALL_SEED.to_vec()];
        let mut ix_data: Vec<u8> = Vec::with_capacity(64);
        ix_data.extend_from_slice(&[0u8; 8]);                               // discriminator
        ix_data.extend_from_slice(&3_000u32.to_le_bytes());                 // commit_frequency_ms
        ix_data.extend_from_slice(&(seeds_vec.len() as u32).to_le_bytes()); // seeds.len()
        for seed in &seeds_vec {
            ix_data.extend_from_slice(&(seed.len() as u32).to_le_bytes());
            ix_data.extend_from_slice(seed);
        }
        ix_data.push(0u8);                                                   // None validator

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
pub struct ExpireRound<'info> {
    #[account(mut, seeds = [HUNT_SEED], bump)]
    pub hunt: Account<'info, HuntState>,
    /// Any session key may crank an expired round forward.
    pub cranker: Signer<'info>,
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
    /// Increments on every find or expiry — deterministically seeds the target.
    pub round: u32,
    /// Session key of the current round's finder (default = expired/unfound).
    pub winner: Pubkey,
    /// Unix ts of the last round advance.
    pub found_at: i64,
    /// Unix ts the current citizen rotates if still unfound.
    pub deadline: i64,
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
