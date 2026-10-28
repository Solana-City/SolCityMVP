//! Sol City collectibles: packs, seasons, unlocks and the mint.
//!
//! Split out of `sol-city` on 2026-10-29. Everything that issues or holds
//! VALUE lives here, and nothing else does.
//!
//! Upgrade cadence, not features, is why this is its own program. The city's
//! core (a player, their position, the rollup delegation) wants to go still
//! and eventually be trusted; this half changes every season, when a season
//! opens or closes, when an event item is added, when odds are tuned. In one
//! binary, changing the price of a pack redeployed the code that moves every
//! player, so a mistake in the shop could stop the city.
//!
//! It also buys something that could not be had otherwise: this program's
//! upgrade authority can be frozen, or moved to a multisig, on its own. The
//! city's cannot, because the game has to keep evolving, and until now a
//! holder of a collectible had to trust that the key which can change
//! movement would not change the mint rules.
//!
//! `UnlockState`, `PackConfig`, `SeasonDrops` and `MintConfig` are owned
//! here. The city program reads `UnlockState` and nothing else, read-only, to
//! copy it into the player's wardrobe snapshot. That is the single seam, and
//! it goes one way: nothing in this program touches `PlayerState`.
//!
//! The catalog block boundaries are DEFINED here and imported by the city, so
//! there is one definition rather than two that have to agree.

use anchor_lang::prelude::*;
use mpl_bubblegum::instructions::MintToCollectionV1Cpi;
use mpl_bubblegum::instructions::MintToCollectionV1InstructionArgs;
use mpl_bubblegum::types::{
    Collection as BubblegumCollection, Creator as BubblegumCreator, LeafSchema, MetadataArgs,
    TokenProgramVersion, TokenStandard,
};
use mpl_bubblegum::hash::{hash_creators, hash_metadata};
use mpl_bubblegum::utils::get_asset_id;
use anchor_lang::solana_program::{
    pubkey,
    program::{invoke, invoke_signed},
    system_instruction,
    hash::hashv,
    rent::Rent as SolanaRent,
    sysvar::Sysvar as SolanaSysvar,
    instruction::{AccountMeta as SolAccountMeta, Instruction as SolInstruction},
};

declare_id!("EptRxVBysFzJEz52r58c2yCkpDGvF55aBPj1eCkWaphz");

// The shared vocabulary, defined in a crate that is NOT a program. That is
// what keeps any program from depending on another program, so the
// `no-entrypoint` feature never enters this build graph at all. See the note
// at the top of sol-city-catalog.
pub use sol_city_catalog::{
    UnlockState, PendingDraw,
    FREE_ITEM_COUNT, QUEST_FREE_SLOTS, ENFORCED_FROM, UNLOCKS_SEED, RARITY_COUNT,
};

// ── Outfit booster ─────────────────────────────────────────────────────────
/// Pack configuration, seed ["pack_config"]. One account for the whole city.
pub const PACK_CONFIG_SEED: &[u8] = b"pack_config";
/// Packs the config can hold. Three exist; the rest is room to tune.
pub const MAX_PACKS: usize = 8;
/// Seasons the config can hold. At two to four a year this is a decade.
/// Seed of a season's drop table: ["season_drops", season as u16 LE].
pub const SEASON_DROPS_SEED: &[u8] = b"season_drops";
/// Seed of the one MintConfig: where a cosmetic becomes an asset.
///
/// A separate account from PackConfig on purpose. PackConfig is a fixed-size
/// account created by a one-shot `init`, so it can never grow a field, and
/// minting needs several it does not have. Keeping them apart means the pack
/// table never has to be torn down and re-seeded to add one.
pub const MINT_CONFIG_SEED: &[u8] = b"mint_config";

/// Seed of the PDA that signs for the tree and the collection.
///
/// It is the Bubblegum tree's DELEGATE and the collection's authority, which
/// is what makes the mint trustless: only this program can sign, so only a
/// wallet whose UnlockState actually holds the index can get an asset. A tree
/// anyone could mint from would be a tree anyone could mint anything from.
pub const MINT_AUTHORITY_SEED: &[u8] = b"mint_authority";

/// Most assets one wallet can mint. Two bytes each, same as `owned`.
pub const PLAYER_MINT_CAP: usize = 256;

/// Most indices one rarity of one season may hold. Generous on purpose: a
/// season is expected to run past three hundred items across all four, and the
/// table is appended to as the art lands rather than written in one go.
pub const MAX_SEASON_DROPS: usize = 2048;
/// Basis points, so 0.5% legendary is expressible. Weights must sum to this.
pub const WEIGHT_TOTAL: u16 = 10_000;

/// Pieces granted per pack.
pub const BOOSTER_PACK_SIZE: usize = 5;
/// Price to open an outfit box (0.025 SOL, about $2.50 at $100/SOL).
/// SPL Account Compression, where the Bubblegum tree lives.
///
/// Called by hand-rolled CPI rather than taking the crate: version 1.0.0 wants
/// anchor-lang 0.31 and solana-program 2, and 0.4.2 wants anchor 0.29, so
/// either would put a second anchor-lang in the tree beside our 0.30.1.
/// `verify_leaf` is a discriminator, a root, a leaf and an index, which is
/// less to get wrong than two Anchors in one build.
pub const ACCOUNT_COMPRESSION_ID: Pubkey =
    pubkey!("cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK");

/// Anchor discriminator for the compression program's `verify_leaf`:
/// the first 8 bytes of sha256("global:verify_leaf").
pub const VERIFY_LEAF_DISCRIMINATOR: [u8; 8] = [124, 220, 22, 223, 104, 10, 250, 224];

/// SPL Token. The payment CPI is hand-rolled against it, like the delegation
/// and VRF ones above, so this program still depends on `anchor-lang` alone.
pub const TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/// How far the draw walks a rarity bucket looking for something the wallet
/// does not already own before it settles for a duplicate.
///
/// A cap rather than the whole bucket because the callback runs on the
/// oracle's compute budget, and a season holds a few hundred indices per
/// rarity. The behaviour it gives up is invisible: a wallet that owns
/// thirty-two consecutive indices of one rarity owns nearly all of it, and
/// a duplicate is the honest answer there anyway.
pub const MAX_BUCKET_PROBES: usize = 32;
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
#[error_code]
pub enum CollectiblesError {
    #[msg("A booster pack is already being opened for this wallet")]
    BoosterPending,
    #[msg("Booster pool count too small for a full pack")]
    InvalidPoolCount,
    #[msg("Wrong treasury account")]
    InvalidTreasury,
    #[msg("This unlock account belongs to another wallet")]
    WrongUnlockOwner,
    #[msg("Callback not signed by the VRF program identity")]
    InvalidVrfIdentity,
    #[msg("Only the pack config admin may do that")]
    NotPackAdmin,
    #[msg("No room left in the pack table")]
    PackTableFull,
    #[msg("That season has already opened and its drop table is frozen")]
    SeasonOpened,
    #[msg("No such rarity")]
    BadRarity,
    #[msg("That rarity already holds as many indices as it can")]
    DropsTooMany,
    #[msg("That drop table does not belong to the season being drawn")]
    WrongDropTable,
    #[msg("Rarity weights must add up to 10000 basis points")]
    BadWeights,
    #[msg("No pack with that id")]
    UnknownPack,
    #[msg("That pack is not on sale")]
    PackClosed,
    #[msg("That pack belongs to a season that is not the open one")]
    WrongSeason,
    #[msg("That season has no rarity ranges")]
    UnknownSeason,
    #[msg("This wallet does not own that cosmetic")]
    ItemNotOwned,
    #[msg("An asset for that cosmetic has already been minted to this wallet")]
    AlreadyMinted,
    #[msg("That is not the tree or collection this program mints into")]
    WrongMintTarget,
    #[msg("This wallet has minted as many assets as it can hold")]
    MintCapReached,
    #[msg("That asset is not the cosmetic being claimed")]
    AssetIsNotThatItem,
    #[msg("This wallet already owns that cosmetic")]
    AlreadyOwned,
    #[msg("Only a quest or event cosmetic can be granted this way")]
    NotAnEventItem,
    // Appended, never inserted. Anchor numbers these by POSITION, so a
    // variant added in the middle silently renumbers every one after it
    // and any client matching on a code starts reporting the wrong thing.
}

#[program]
pub mod sol_city_collectibles {
    use super::*;

    // ── Outfit booster (VRF) ───────────────────────────────────────────────
    //
    // open_booster: the wallet names a pack, pays that pack's price in the
    // config's currency, and requests verifiable randomness from MagicBlock
    // VRF naming callback_open_booster as the consumer. The pack's odds and
    // its season's rarity ranges are copied onto the unlock account, because
    // the callback arrives later and must not be able to fail.
    //
    // callback_open_booster: invoked by the VRF oracle (signed by the VRF
    // program identity). Rolls a rarity per item against the snapshotted
    // weights, picks an index inside that rarity's range, grants them into the
    // wallet's UnlockState, and emits BoosterOpened so the client reveals
    // them. Same shape as the client's rollPack, deliberately: rarity first,
    // item second, down the ladder when a bucket is empty.

    pub fn open_booster(
        ctx: Context<OpenBooster>,
        pack_id: u8,
        client_seed: [u8; 32],
    ) -> Result<()> {
        let cfg = &ctx.accounts.config;
        let def = *cfg.pack(pack_id).ok_or(CollectiblesError::UnknownPack)?;
        require!(def.enabled, CollectiblesError::PackClosed);
        // A pack of a retired season cannot be bought. It can still be OPENED,
        // which is the point of carrying the season on the snapshot: what
        // closes is the sale, not the pack somebody already owns.
        require!(def.season == cfg.current_season, CollectiblesError::WrongSeason);
        require!(def.size as usize <= BOOSTER_PACK_SIZE, CollectiblesError::InvalidPoolCount);
        require!(def.size > 0, CollectiblesError::InvalidPoolCount);

        // The drop table has to be the one for this pack's season. Derived and
        // compared rather than constrained in the Accounts struct, because the
        // season is read off the config at runtime and a seeds constraint
        // cannot see it.
        let (expected, _) = Pubkey::find_program_address(
            &[SEASON_DROPS_SEED, &def.season.to_le_bytes()],
            &crate::ID,
        );
        require_keys_eq!(
            ctx.accounts.drops.key(),
            expected,
            CollectiblesError::WrongDropTable
        );
        // The season has to hold enough to fill the pack. Without this a pack
        // against an empty season would take the money and reveal nothing.
        require!(ctx.accounts.drops.total() >= def.size as usize, CollectiblesError::UnknownSeason);

        require_keys_eq!(
            ctx.accounts.treasury_token_account.key(),
            cfg.treasury_token_account,
            CollectiblesError::InvalidTreasury
        );

        {
            let unlocks = &mut ctx.accounts.unlock_state;
            require!(!unlocks.pending, CollectiblesError::BoosterPending);
            unlocks.pending = true;
            unlocks.draw = PendingDraw {
                pack_id,
                size: def.size,
                weights: def.weights,
                season: def.season,
            };
        }

        // ── Make room for the pack before the draw ────────────────────────
        //
        // The VRF callback grants into `owned`, and it cannot grow the account
        // itself: the oracle signs it, and there is nobody there willing to
        // fund bytes. So the buyer pays for the space here, in the same
        // transaction that takes their money, which is also the only moment
        // the cost is fair to charge.
        //
        // Grown by a whole pack whether or not the draw turns out to hold
        // duplicates. A few spare entries cost two bytes each and save a
        // second realloc.
        {
            let info = ctx.accounts.unlock_state.to_account_info();
            let needed = UnlockState::size_for(
                ctx.accounts.unlock_state.owned.len() + def.size as usize,
                ctx.accounts.unlock_state.minted.len(),
            );
            if info.data_len() < needed {
                let rent = SolanaRent::get()?;
                let topup = rent
                    .minimum_balance(needed)
                    .saturating_sub(info.lamports());
                if topup > 0 {
                    invoke(
                        &system_instruction::transfer(ctx.accounts.payer.key, info.key, topup),
                        &[
                            ctx.accounts.payer.to_account_info(),
                            info.clone(),
                            ctx.accounts.system_program.to_account_info(),
                        ],
                    )?;
                }
                info.realloc(needed, false)?;
            }
        }

        // Payment → treasury, in the config's currency.
        //
        // Hand-rolled like the delegation and VRF CPIs above, so the program
        // still depends on `anchor-lang` alone: SPL Token's Transfer is
        // instruction 3 followed by a little-endian amount, nine bytes in all.
        //
        // Checking the DESTINATION against the config is enough to pin the
        // currency, and that is worth saying out loud: Transfer refuses a
        // source whose mint differs from the destination's, so a buyer cannot
        // pay for USDC packs in some token of their own making.
        let mut pay = Vec::with_capacity(9);
        pay.push(3u8);
        pay.extend_from_slice(&def.price.to_le_bytes());
        invoke(
            &SolInstruction {
                program_id: TOKEN_PROGRAM_ID,
                accounts: vec![
                    SolAccountMeta::new(ctx.accounts.buyer_token_account.key(), false),
                    SolAccountMeta::new(ctx.accounts.treasury_token_account.key(), false),
                    SolAccountMeta::new_readonly(ctx.accounts.payer.key(), true),
                ],
                data: pay,
            },
            &[
                ctx.accounts.buyer_token_account.to_account_info(),
                ctx.accounts.treasury_token_account.to_account_info(),
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
        )?;

        // Request randomness; the callback grants into this UnlockState.
        let mut data = vec![VRF_REQUEST_SCOPED, 0, 0, 0, 0, 0, 0, 0];
        VrfRequest {
            caller_seed: client_seed,
            callback_program_id: crate::ID,
            // Spelled out rather than `Type::DISCRIMINATOR`: the trait is not
            // in the anchor-lang 0.30.1 prelude, so the short form does not
            // resolve. Same fix as the one PlayerState needed.
            callback_discriminator:
                <instruction::CallbackOpenBooster as anchor_lang::Discriminator>::DISCRIMINATOR
                    .to_vec(),
            callback_accounts_metas: vec![
                VrfCallbackMeta {
                    pubkey: ctx.accounts.unlock_state.key(),
                    is_signer: false,
                    is_writable: true,
                },
                // The season's drop table, read only. Named here so the
                // callback gets the table that was in force at payment, and
                // frozen by then because its season has opened.
                VrfCallbackMeta {
                    pubkey: ctx.accounts.drops.key(),
                    is_signer: false,
                    is_writable: false,
                },
            ],
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
        // The table must be the one this pack was paid against. The oracle
        // passes the accounts we named at request time, so this is a check on
        // the oracle rather than on the buyer, and it is cheap enough to make
        // anyway.
        let (expected, _) = Pubkey::find_program_address(
            &[SEASON_DROPS_SEED, &ctx.accounts.unlock_state.draw.season.to_le_bytes()],
            &crate::ID,
        );
        require_keys_eq!(
            ctx.accounts.drops.key(),
            expected,
            CollectiblesError::WrongDropTable
        );

        let drops = &ctx.accounts.drops;
        let unlocks = &mut ctx.accounts.unlock_state;
        let draw = unlocks.draw;
        let total: u32 = draw.weights.iter().map(|w| *w as u32).sum();

        let mut picks: Vec<u16> = Vec::with_capacity(draw.size as usize);
        for item in 0..draw.size {
            // Fresh randomness per item, hashed from the verified value and the
            // item's position. One draw per 32 bytes rather than a cursor
            // walking the original: the ladder can consume several rolls for a
            // single item, and running off the end of a fixed 32 bytes is how
            // the last item of a pack would quietly stop being random.
            let bytes = hashv(&[&randomness, &[item]]).to_bytes();
            let roll = |k: usize| -> u16 {
                let i = (k * 2) % 32;
                ((bytes[i] as u16) << 8) | bytes[(i + 1) % 32] as u16
            };

            // 1. The rarity, against the pack's weights. Walking the
            //    cumulative weight in RARITY_ORDER, so common is tried first
            //    and a zero weight is simply never selected.
            let mut wanted = RARITY_COUNT - 1;
            let mut ticket = (roll(0) as u32) % total.max(1);
            for r in 0..RARITY_COUNT {
                let w = draw.weights[r] as u32;
                if ticket < w { wanted = r; break; }
                ticket -= w;
            }

            // 2. The ladder: the rolled rarity, then DOWN toward common, and
            //    only if there is nothing at all below it, up as a last
            //    resort. The direction is the whole point and it matches
            //    rollPack in the client: a rarity that has run out must not
            //    pay out something scarcer, which is the opposite of
            //    scarcity. Going up at all is a last resort because a pack
            //    that hands over four pieces instead of five reads as broken.
            let mut ladder = [0usize; RARITY_COUNT];
            let mut rungs = 0usize;
            ladder[rungs] = wanted;
            rungs += 1;
            let mut down = wanted;
            while down > 0 {
                down -= 1;
                ladder[rungs] = down;
                rungs += 1;
            }
            for up in (wanted + 1)..RARITY_COUNT {
                ladder[rungs] = up;
                rungs += 1;
            }

            // 3. An index inside the first rung that has one to give. Something
            //    the wallet does not own beats a duplicate at the same rarity,
            //    and a duplicate beats nothing at all.
            let mut picked: Option<u16> = None;
            for rung in 0..rungs {
                let r = ladder[rung];
                let list = &drops.drops[r];
                if list.is_empty() { continue; }
                let offset = (roll(1 + rung) as usize) % list.len();
                let probes = list.len().min(MAX_BUCKET_PROBES);
                let mut duplicate: Option<u16> = None;
                for step in 0..probes {
                    let index = list[(offset + step) % list.len()];
                    // No item twice in the same pack.
                    if picks.contains(&index) { continue; }
                    if duplicate.is_none() { duplicate = Some(index); }
                    if !unlocks.owns(index) { picked = Some(index); break; }
                }
                if picked.is_none() { picked = duplicate; }
                if picked.is_some() { break; }
            }

            // Nothing left anywhere: the whole season is already in this pack.
            // open_booster checks the supply, so this is the duplicate-free
            // edge, not a funded pack paying out nothing.
            let Some(index) = picked else { break };
            picks.push(index);
            // Sorted insert, and an index the wallet already owned is a no-op:
            // owning something twice is not a thing the list can express.
            unlocks.insert_owned(index);
        }

        unlocks.pending = false;
        emit!(BoosterOpened { authority: unlocks.authority, indices: picks });
        Ok(())
    }

    // `claim_free_outfit` was here, and is deliberately NOT in this deploy.
    //
    // It granted any index inside the quest block to whoever called it: the
    // condition ("talked to Kuka", "won a round") was checked in the client.
    // There is no honest way to gate it on chain today. Those facts reach the
    // chain through session-signed writes the client authors, and the project
    // runs no server that could attest to them instead.
    //
    // So the instruction waits for that decision rather than shipping a hole
    // into a program that gets read. Quest rewards keep working exactly as
    // they do now, as local unlocks; nothing regressed, because nothing called
    // this. QUEST_FREE_SLOTS stays reserved so the bitset layout does not move
    // when it returns. See COLLECTIBLES_SPEC.md.

    /// Creates the caller's UnlockState. Called once per wallet, before the
    /// first pack or quest reward; a second call fails, which is the point.
    pub fn init_unlock_state(ctx: Context<InitUnlockState>) -> Result<()> {
        let unlocks = &mut ctx.accounts.unlock_state;
        unlocks.authority = ctx.accounts.authority.key();
        unlocks.owned = Vec::new();
        unlocks.minted = Vec::new();
        unlocks.draw = PendingDraw::default();
        unlocks.pending = false;
        Ok(())
    }

    // Pack configuration -----------------------------------------------------
    //
    // What the city sells lives in an account rather than in the bytecode, so
    // opening a season, retiring one, correcting a price or tuning odds that
    // read wrong in the wild is a transaction instead of a redeploy. The cost
    // is an admin key that can change payouts; see the note on PackConfig.

    /// Creates the config. Once, ever: a second call fails, which is the point.
    pub fn init_pack_config(
        ctx: Context<InitPackConfig>,
        currency_mint: Pubkey,
        treasury_token_account: Pubkey,
    ) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        cfg.admin = ctx.accounts.admin.key();
        cfg.currency_mint = currency_mint;
        cfg.treasury_token_account = treasury_token_account;
        // Zero, meaning no season is open yet, and that is not a placeholder.
        //
        // A season's drop table may only be edited while `season >
        // current_season`, which is what freezes it on opening. Starting at 1
        // would make season 1's table unwritable from the moment the config
        // existed: nothing could ever be seeded, because the first season
        // would already count as open. Zero leaves room for season 1 to be
        // filled and then opened with `set_current_season`.
        //
        // Nothing sells at zero, because `upsert_pack` refuses season 0 and
        // a pack only sells when its season is the current one.
        cfg.current_season = 0;
        cfg.packs = [PackDef::default(); MAX_PACKS];
        cfg.pack_count = 0;
        Ok(())
    }

    /// Adds a pack, or replaces the one with the same id.
    ///
    /// Replacing is the point: a price or a weight that reads wrong after a
    /// week of real players is a write, not a deploy. The id is what
    /// `open_booster` is called with, so in practice it is append-only.
    pub fn upsert_pack(ctx: Context<AdminPackConfig>, def: PackDef) -> Result<()> {
        let total: u32 = def.weights.iter().map(|w| *w as u32).sum();
        require!(total == WEIGHT_TOTAL as u32, CollectiblesError::BadWeights);
        require!(def.size as usize <= BOOSTER_PACK_SIZE, CollectiblesError::InvalidPoolCount);
        // Season 0 is "nothing open". A pack claiming it would sell while the
        // config was still being set up.
        require!(def.season > 0, CollectiblesError::WrongSeason);

        let cfg = &mut ctx.accounts.config;
        let count = cfg.pack_count as usize;
        if let Some(slot) = cfg.packs[..count].iter_mut().find(|p| p.id == def.id) {
            *slot = def;
            return Ok(());
        }
        require!(count < MAX_PACKS, CollectiblesError::PackTableFull);
        cfg.packs[count] = def;
        cfg.pack_count = (count + 1) as u8;
        Ok(())
    }

    /// Creates an empty drop table for a season that has not opened.
    ///
    /// Empty, because the table is filled by `append_season_drops` as the art
    /// lands. Nobody has to know how many of each rarity a season will hold
    /// before it is started, which is the whole reason this is a list and not
    /// a range.
    pub fn init_season_drops(ctx: Context<InitSeasonDrops>, season: u16) -> Result<()> {
        require!(season > ctx.accounts.config.current_season, CollectiblesError::SeasonOpened);
        let drops = &mut ctx.accounts.drops;
        drops.season = season;
        drops.drops = [Vec::new(), Vec::new(), Vec::new(), Vec::new()];
        Ok(())
    }

    /// Adds catalog indices to one rarity of a season that has not opened.
    ///
    /// Append, and callable as often as needed: a transaction holds a few
    /// hundred indices, a season holds more, and in practice the list is built
    /// over weeks as items are drawn and named. The admin funds the bytes.
    ///
    /// The gate is `season > current_season`, which is what freezes a table
    /// rather than a flag somebody has to remember to set. `set_current_season`
    /// only moves forward, so a season that has opened can never be edited
    /// again, and the pending pack pointing at it cannot be rewritten under.
    pub fn append_season_drops(
        ctx: Context<EditSeasonDrops>,
        rarity: u8,
        indices: Vec<u16>,
    ) -> Result<()> {
        require!(
            ctx.accounts.drops.season > ctx.accounts.config.current_season,
            CollectiblesError::SeasonOpened
        );
        let r = rarity as usize;
        require!(r < RARITY_COUNT, CollectiblesError::BadRarity);

        // Every index must name a slot the program actually enforces. Checked
        // here because the callback cannot afford to: this is the last moment
        // there is somebody to return an error to.
        for index in indices.iter() {
            require!(*index >= ENFORCED_FROM, CollectiblesError::InvalidPoolCount);
        }

        {
            let drops = &ctx.accounts.drops;
            require!(
                drops.drops[r].len() + indices.len() <= MAX_SEASON_DROPS,
                CollectiblesError::DropsTooMany
            );
        }

        // Grow first, funded by the admin, then write.
        let needed = {
            let drops = &ctx.accounts.drops;
            let mut counts = [0usize; RARITY_COUNT];
            for i in 0..RARITY_COUNT { counts[i] = drops.drops[i].len(); }
            counts[r] += indices.len();
            SeasonDrops::size_for(counts)
        };
        let info = ctx.accounts.drops.to_account_info();
        if info.data_len() < needed {
            let rent = SolanaRent::get()?;
            let topup = rent.minimum_balance(needed).saturating_sub(info.lamports());
            if topup > 0 {
                invoke(
                    &system_instruction::transfer(ctx.accounts.admin.key, info.key, topup),
                    &[
                        ctx.accounts.admin.to_account_info(),
                        info.clone(),
                        ctx.accounts.system_program.to_account_info(),
                    ],
                )?;
            }
            info.realloc(needed, false)?;
        }

        // Sorted and deduplicated, so the same index cannot be added twice and
        // the list reads the same however it was built up.
        let drops = &mut ctx.accounts.drops;
        for index in indices {
            if let Err(at) = drops.drops[r].binary_search(&index) {
                drops.drops[r].insert(at, index);
            }
        }
        Ok(())
    }

    /// Empties one rarity of a season that has not opened.
    ///
    /// Here because the rarities are still being decided: an item that turns
    /// out to be rare rather than uncommon has to be able to move, and an
    /// append-only list cannot move anything. The account keeps its size,
    /// which costs nothing and saves funding the bytes again.
    pub fn clear_season_drops(ctx: Context<EditSeasonDrops>, rarity: u8) -> Result<()> {
        require!(
            ctx.accounts.drops.season > ctx.accounts.config.current_season,
            CollectiblesError::SeasonOpened
        );
        let r = rarity as usize;
        require!(r < RARITY_COUNT, CollectiblesError::BadRarity);
        ctx.accounts.drops.drops[r].clear();
        Ok(())
    }

    /// Creates the mint configuration. Once.
    pub fn init_mint_config(
        ctx: Context<InitMintConfig>,
        merkle_tree: Pubkey,
        collection_mint: Pubkey,
        royalty_recipient: Pubkey,
        seller_fee_basis_points: u16,
        symbol: String,
        base_uri: String,
    ) -> Result<()> {
        require!(symbol.len() <= 8, CollectiblesError::WrongMintTarget);
        require!(base_uri.len() <= 160, CollectiblesError::WrongMintTarget);
        let cfg = &mut ctx.accounts.mint_config;
        cfg.admin = ctx.accounts.admin.key();
        cfg.merkle_tree = merkle_tree;
        cfg.collection_mint = collection_mint;
        cfg.royalty_recipient = royalty_recipient;
        cfg.seller_fee_basis_points = seller_fee_basis_points;
        cfg.symbol = symbol;
        cfg.base_uri = base_uri;
        Ok(())
    }

    /// Points minting at a different tree, for when the current one fills.
    ///
    /// The collection does NOT move with it. Assets already minted keep
    /// pointing at the tree that holds them, which is where they live; a tree
    /// is storage, and the collection is identity.
    pub fn set_mint_tree(ctx: Context<AdminMintConfig>, merkle_tree: Pubkey) -> Result<()> {
        ctx.accounts.mint_config.merkle_tree = merkle_tree;
        Ok(())
    }

    /// Turns a cosmetic this wallet owns into a compressed NFT it holds.
    ///
    /// ── What makes this safe ─────────────────────────────────────────────
    ///
    /// The tree's delegate and the collection's authority are both a PDA of
    /// this program, so Bubblegum will not mint without our signature, and we
    /// only sign for an index the caller's own UnlockState already holds. A
    /// tree anyone could mint from would be a tree anyone could mint anything
    /// from.
    ///
    /// `minted` is what makes it once. It is a separate list from `owned`
    /// because the two answer different questions: owning is permission and
    /// survives a sale, while this records that an asset for this index has
    /// been handed to this wallet. Without it a player could mint, sell, and
    /// mint again from the same unlock, forever, and the scarcity the whole
    /// season table exists to create would be worth nothing.
    ///
    /// ── What this deliberately does NOT do ───────────────────────────────
    ///
    /// It does not remove the index from `owned`. Selling the asset therefore
    /// leaves the seller able to keep WEARING the cosmetic, which the owner
    /// accepted on 2026-10-26 as the price of not checking possession on every
    /// outfit change. The buyer gets their own grant through
    /// `claim_owned_from_asset`.
    pub fn mint_unlock(ctx: Context<MintUnlock>, index: u16) -> Result<()> {
        let cfg = &ctx.accounts.mint_config;
        require_keys_eq!(
            ctx.accounts.merkle_tree.key(), cfg.merkle_tree, CollectiblesError::WrongMintTarget
        );
        require_keys_eq!(
            ctx.accounts.collection_mint.key(), cfg.collection_mint, CollectiblesError::WrongMintTarget
        );

        {
            let unlocks = &ctx.accounts.unlock_state;
            require!(unlocks.owns(index), CollectiblesError::ItemNotOwned);
            require!(
                unlocks.minted.binary_search(&index).is_err(),
                CollectiblesError::AlreadyMinted
            );
            require!(unlocks.minted.len() < PLAYER_MINT_CAP, CollectiblesError::MintCapReached);
        }

        // Room for the new entry, funded by the player, before anything is
        // minted. Growing after the CPI would leave an asset in their wallet
        // that `minted` does not record, which is the one state that lets the
        // same index be minted twice.
        {
            let info = ctx.accounts.unlock_state.to_account_info();
            let needed = UnlockState::size_for(
                ctx.accounts.unlock_state.owned.len(),
                ctx.accounts.unlock_state.minted.len() + 1,
            );
            if info.data_len() < needed {
                let rent = SolanaRent::get()?;
                let topup = rent.minimum_balance(needed).saturating_sub(info.lamports());
                if topup > 0 {
                    invoke(
                        &system_instruction::transfer(ctx.accounts.payer.key, info.key, topup),
                        &[
                            ctx.accounts.payer.to_account_info(),
                            info.clone(),
                            ctx.accounts.system_program.to_account_info(),
                        ],
                    )?;
                }
                info.realloc(needed, false)?;
            }
        }

        // The metadata URI is built, not stored: one immutable base and the
        // catalog index. Holding a string per cosmetic on chain would cost
        // more than every other field of this program put together.
        let uri = format!("{}{}.json", cfg.base_uri, index);
        let name = format!("Sol City #{}", index);

        let metadata = MetadataArgs {
            name,
            symbol: cfg.symbol.clone(),
            uri,
            seller_fee_basis_points: cfg.seller_fee_basis_points,
            primary_sale_happened: true,
            is_mutable: false,
            edition_nonce: None,
            token_standard: Some(TokenStandard::NonFungible),
            // Unverified here and verified BY the CPI: passing the collection
            // with our PDA as its authority is what tells Bubblegum to set the
            // verified flag itself.
            collection: Some(BubblegumCollection {
                verified: false,
                key: cfg.collection_mint,
            }),
            uses: None,
            token_program_version: TokenProgramVersion::Original,
            // One creator, unverified, holding the whole share, so a
            // marketplace honouring royalties has an address to send them to.
            creators: vec![BubblegumCreator {
                address: cfg.royalty_recipient,
                verified: false,
                share: 100,
            }],
        };

        let bump = ctx.bumps.mint_authority;
        let seeds: &[&[u8]] = &[MINT_AUTHORITY_SEED, &[bump]];
        MintToCollectionV1Cpi {
            __program: &ctx.accounts.bubblegum_program,
            tree_config: &ctx.accounts.tree_config,
            leaf_owner: &ctx.accounts.payer,
            leaf_delegate: &ctx.accounts.payer,
            merkle_tree: &ctx.accounts.merkle_tree,
            payer: &ctx.accounts.payer,
            tree_creator_or_delegate: &ctx.accounts.mint_authority,
            collection_authority: &ctx.accounts.mint_authority,
            collection_authority_record_pda: None,
            collection_mint: &ctx.accounts.collection_mint,
            collection_metadata: &ctx.accounts.collection_metadata,
            collection_edition: &ctx.accounts.collection_edition,
            bubblegum_signer: &ctx.accounts.bubblegum_signer,
            log_wrapper: &ctx.accounts.log_wrapper,
            compression_program: &ctx.accounts.compression_program,
            token_metadata_program: &ctx.accounts.token_metadata_program,
            system_program: &ctx.accounts.system_program,
            __args: MintToCollectionV1InstructionArgs { metadata },
        }
        .invoke_signed(&[seeds])?;

        // Recorded only once the asset exists.
        let unlocks = &mut ctx.accounts.unlock_state;
        if let Err(at) = unlocks.minted.binary_search(&index) {
            unlocks.minted.insert(at, index);
        }
        emit!(UnlockMinted { authority: unlocks.authority, index });
        Ok(())
    }

    /// Grants a cosmetic to the wallet that can prove it holds the asset.
    ///
    /// ── Why this has to exist ────────────────────────────────────────────
    ///
    /// `mint_unlock` leaves the seller's grant in place, so a sold cosmetic
    /// stays wearable by the person who sold it. That is a deliberate and
    /// accepted leak. What is NOT acceptable is the other half: without this,
    /// the BUYER holds an asset the wardrobe has never heard of, and a
    /// tradable item that the game refuses to put on your head is a JPEG.
    ///
    /// ── What it proves, and what it does not ─────────────────────────────
    ///
    /// Three things have to be true together, and none of them is taken on
    /// trust:
    ///
    ///   1. The metadata passed in really is this catalog index. Checked by
    ///      rebuilding the URI from the config's immutable base and comparing.
    ///      Without this, somebody holding ANY asset in the tree could claim
    ///      ANY cosmetic.
    ///   2. The leaf built from that metadata, owned by the CALLER, is in the
    ///      tree. Checked by the compression program against the proof.
    ///   3. The tree is ours. Checked against the config.
    ///
    /// The caller passes the metadata rather than the program storing it,
    /// because the leaf only commits to a HASH of it: the chain cannot tell
    /// which cosmetic an asset is without being shown the preimage.
    ///
    /// It is a snapshot, not a subscription. A later sale does not take the
    /// grant back, for the same reason the seller keeps theirs: there is no
    /// moment at which this program hears about it.
    pub fn claim_owned_from_asset<'info>(
        // One named lifetime, because this instruction mixes the proof from
        // `remaining_accounts` with accounts from the struct, and
        // UncheckedAccount is invariant over 'info: without it the two are
        // different lifetimes that cannot be put in the same Vec.
        ctx: Context<'_, '_, '_, 'info, ClaimOwnedFromAsset<'info>>,
        index: u16,
        root: [u8; 32],
        nonce: u64,
        leaf_index: u32,
        metadata: MetadataArgs,
    ) -> Result<()> {
        let cfg = &ctx.accounts.mint_config;
        require_keys_eq!(
            ctx.accounts.merkle_tree.key(), cfg.merkle_tree, CollectiblesError::WrongMintTarget
        );
        require!(
            !ctx.accounts.unlock_state.owns(index),
            CollectiblesError::AlreadyOwned
        );

        // (1) This metadata is that cosmetic. The URI is built the same way
        // mint_unlock built it, from a base that cannot change.
        let expected_uri = format!("{}{}.json", cfg.base_uri, index);
        require!(metadata.uri == expected_uri, CollectiblesError::AssetIsNotThatItem);

        // (2) A leaf owned by the caller, carrying that metadata, is in the
        // tree. Both hashes come from the metadata itself, so a caller cannot
        // name an asset they do not hold without also forging the proof.
        let data_hash = hash_metadata(&metadata)?;
        let creator_hash = hash_creators(&metadata.creators);
        let tree = ctx.accounts.merkle_tree.key();
        let leaf = LeafSchema::V1 {
            id: get_asset_id(&tree, nonce),
            owner: ctx.accounts.claimer.key(),
            delegate: ctx.accounts.claimer.key(),
            nonce,
            data_hash,
            creator_hash,
        }
        .hash();

        let mut data = Vec::with_capacity(8 + 32 + 32 + 4);
        data.extend_from_slice(&VERIFY_LEAF_DISCRIMINATOR);
        data.extend_from_slice(&root);
        data.extend_from_slice(&leaf);
        data.extend_from_slice(&leaf_index.to_le_bytes());

        // The proof arrives as remaining accounts: one node per tree level
        // that the canopy does not already hold.
        let mut metas = vec![SolAccountMeta::new_readonly(tree, false)];
        let mut infos = vec![ctx.accounts.merkle_tree.to_account_info()];
        for node in ctx.remaining_accounts.iter() {
            metas.push(SolAccountMeta::new_readonly(node.key(), false));
            infos.push(node.clone());
        }
        infos.push(ctx.accounts.compression_program.to_account_info());
        invoke(
            &SolInstruction { program_id: ACCOUNT_COMPRESSION_ID, accounts: metas, data },
            &infos,
        )?;

        // Room first, funded by the claimer, then the grant.
        {
            let info = ctx.accounts.unlock_state.to_account_info();
            let needed = UnlockState::size_for(
                ctx.accounts.unlock_state.owned.len() + 1,
                ctx.accounts.unlock_state.minted.len(),
            );
            if info.data_len() < needed {
                let rent = SolanaRent::get()?;
                let topup = rent.minimum_balance(needed).saturating_sub(info.lamports());
                if topup > 0 {
                    invoke(
                        &system_instruction::transfer(ctx.accounts.claimer.key, info.key, topup),
                        &[
                            ctx.accounts.claimer.to_account_info(),
                            info.clone(),
                            ctx.accounts.system_program.to_account_info(),
                        ],
                    )?;
                }
                info.realloc(needed, false)?;
            }
        }
        let unlocks = &mut ctx.accounts.unlock_state;
        unlocks.insert_owned(index);
        Ok(())
    }
    /// Moves the open season. This is how a season opens, and how the one
    /// before it closes: one number, and every earlier season stops selling.
    ///
    /// It is also the point of no return for that season's drop table, which
    /// can no longer be edited once its season is current. Check the table
    /// before calling this.
    ///
    /// Forward only. Reopening a closed season would put items back on sale
    /// whose scarcity was the window shutting.
    pub fn set_current_season(ctx: Context<AdminPackConfig>, season: u16) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require!(season >= cfg.current_season, CollectiblesError::WrongSeason);
        cfg.current_season = season;
        Ok(())
    }
    /// Hands a wallet an event or quest cosmetic it earned somewhere this
    /// program cannot see.
    ///
    /// ── Why an admin signs this ──────────────────────────────────────────
    ///
    /// `claim_free_outfit` was pulled because the condition it checked was
    /// authored by the client, so any wallet could claim every quest index.
    /// This is the other answer to the same problem: the condition is still
    /// checked off chain, but the signature that acts on it is the admin's,
    /// not the claimant's. Nobody can grant themselves anything.
    ///
    /// The Halloween Pumpkin Head is the first customer. It is won by carving
    /// one on devnet, the winners are a list the city keeps off chain, and
    /// the hat is meant to reach the same wallets on mainnet. The admin walks
    /// a FROZEN snapshot of that list; see scripts/freeze-winners.ts for why
    /// the snapshot has to exist before the event closes.
    ///
    /// ── The range guard is the point ─────────────────────────────────────
    ///
    /// Only the quest and event block, never the booster block. A grant path
    /// that reached pack items would be a button that mints the shop's own
    /// inventory out of nothing, and the scarcity those items are sold on is
    /// the only thing they have. The admin cannot reach them here, and that
    /// is deliberate rather than an oversight to be "fixed" later.
    ///
    /// The free block is excluded too, for a duller reason: an item below
    /// FREE_ITEM_COUNT is already wearable by everybody, so granting one
    /// would spend rent to say nothing.
    ///
    /// Idempotence is NOT silent. Running the admin's script twice over the
    /// same snapshot fails on the second pass rather than quietly doing
    /// nothing, because "already granted" and "granted just now" are facts an
    /// operator handing out collectibles needs told apart.
    pub fn admin_grant_event_item(
        ctx: Context<AdminGrantEventItem>,
        index: u16,
    ) -> Result<()> {
        require!(
            index >= FREE_ITEM_COUNT && index < ENFORCED_FROM,
            CollectiblesError::NotAnEventItem
        );

        // Room first, funded by the admin, then the write. Same order as
        // mint_unlock and for the same reason: growing the account after the
        // state change can leave the two disagreeing.
        {
            let info = ctx.accounts.unlock_state.to_account_info();
            let needed = UnlockState::size_for(
                ctx.accounts.unlock_state.owned.len() + 1,
                ctx.accounts.unlock_state.minted.len(),
            );
            if info.data_len() < needed {
                let rent = SolanaRent::get()?;
                let topup = rent.minimum_balance(needed).saturating_sub(info.lamports());
                if topup > 0 {
                    invoke(
                        &system_instruction::transfer(ctx.accounts.admin.key, info.key, topup),
                        &[
                            ctx.accounts.admin.to_account_info(),
                            info.clone(),
                            ctx.accounts.system_program.to_account_info(),
                        ],
                    )?;
                }
                info.realloc(needed, false)?;
            }
        }

        let unlocks = &mut ctx.accounts.unlock_state;
        require!(unlocks.insert_owned(index), CollectiblesError::AlreadyOwned);
        Ok(())
    }
}

// ── Outfit booster accounts ────────────────────────────────────────────────

#[derive(Accounts)]
pub struct OpenBooster<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    // Must already exist: `init_unlock_state` creates it. Nothing is created
    // conditionally here, so this instruction can never create or re-create an
    // account; the one place that can is a single explicit `init`.
    #[account(
        mut,
        seeds = [UNLOCKS_SEED, payer.key().as_ref()],
        bump,
        constraint = unlock_state.authority == payer.key() @ CollectiblesError::WrongUnlockOwner,
    )]
    pub unlock_state: Account<'info, UnlockState>,
    /// What this pack costs and what it draws from. Read only: a purchase
    /// never writes the table.
    #[account(seeds = [PACK_CONFIG_SEED], bump)]
    pub config: Account<'info, PackConfig>,
    /// The season's drop table. Address-checked against the pack's season in
    /// the instruction body, since a seeds constraint cannot read the config.
    pub drops: Account<'info, SeasonDrops>,
    /// CHECK: the buyer's token account. Its mint is pinned by the Token
    /// program, which refuses a Transfer whose source and destination mints
    /// differ, and the destination is the one named in the config.
    #[account(mut)]
    pub buyer_token_account: AccountInfo<'info>,
    /// CHECK: address-checked against config.treasury_token_account.
    #[account(mut)]
    pub treasury_token_account: AccountInfo<'info>,
    /// CHECK: SPL Token program.
    #[account(address = TOKEN_PROGRAM_ID)]
    pub token_program: UncheckedAccount<'info>,
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
    #[account(address = vrf_callback_identity() @ CollectiblesError::InvalidVrfIdentity)]
    pub vrf_program_identity: Signer<'info>,
    /// Re-derived from the authority stored on the account (the wallet doesn't
    /// sign the callback — the oracle does), so the grant lands on the right PDA.
    #[account(
        mut,
        seeds = [UNLOCKS_SEED, unlock_state.authority.as_ref()],
        bump,
    )]
    pub unlock_state: Account<'info, UnlockState>,
    /// The table the pack was paid against, named at request time and frozen
    /// since its season opened. Address-checked in the body.
    pub drops: Account<'info, SeasonDrops>,
}

/// Creates a wallet's UnlockState, once. Separate from the instructions that
/// write to it, so none of them can create an account: this explicit `init` is
/// the only path that can, and it fails loudly if one already exists.
#[derive(Accounts)]
pub struct InitUnlockState<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        // Born empty. The two vectors carry only their 4-byte length prefix,
        // and open_booster grows the account when it grants, funded by the
        // buyer. A player who never opens a pack never pays for space they
        // were never going to use. InitSpace cannot size a Vec, which is the
        // whole reason this is spelled out.
        space = UnlockState::size_for(0, 0),
        seeds = [UNLOCKS_SEED, authority.key().as_ref()],
        bump,
    )]
    pub unlock_state: Account<'info, UnlockState>,
    pub system_program: Program<'info, System>,
}

/// Emitted when a cosmetic becomes an asset, so the client can show it.
#[event]
pub struct UnlockMinted {
    pub authority: Pubkey,
    pub index: u16,
}

/// Emitted when a pack resolves — the client reveals these pool indices.
#[event]
pub struct BoosterOpened {
    pub authority: Pubkey,
    pub indices: Vec<u16>,
}
/// One pack the city sells.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, Default)]
pub struct PackDef {
    /// Stable, and what `open_booster` is called with. Append-only.
    pub id: u8,
    /// The season this pack draws from. A pack bought in season 1 and opened
    /// in season 3 is still a season 1 pack, which is why the season lives on
    /// the pack and not on the clock.
    pub season: u16,
    /// Price in the config's currency, in its smallest unit. USDC has six
    /// decimals, so 30_000 is three cents short of a dollar at 0.03.
    pub price: u64,
    /// Items drawn per pack.
    pub size: u8,
    /// Weight per rarity for EACH item drawn, in basis points, summing to
    /// WEIGHT_TOTAL. Basis points rather than percent because half a percent
    /// legendary is a number somebody will want.
    pub weights: [u16; RARITY_COUNT],
    /// A pack that is off sells nothing. This is how a season is retired
    /// without deleting anything.
    pub enabled: bool,
}

/// Where a cosmetic becomes a compressed NFT.
///
/// cNFT rather than a Core asset, and the reason is the price of the decision
/// the owner made: a pack mints its contents the moment it is opened. Core
/// costs about 0.0029 SOL an asset, so five items would be 0.0145 SOL - half
/// the price of the cheapest pack. Compressed assets cost the tree once and
/// almost nothing per mint.
///
/// The cost is paid elsewhere, and honestly: proving a wallet holds a cNFT
/// needs a merkle proof fetched from an indexer, which is why the wardrobe
/// does NOT check possession per outfit change. See `claim_owned_from_asset`.
#[account]
#[derive(InitSpace)]
pub struct MintConfig {
    /// May point this at a different tree when the current one fills.
    pub admin: Pubkey,
    /// The Bubblegum tree assets are minted into.
    pub merkle_tree: Pubkey,
    /// The collection they all belong to. Event items and pack items share it:
    /// a collection is a grouping, and what an item IS lives in its metadata.
    pub collection_mint: Pubkey,
    /// Where royalties are meant to go. The sole creator on every asset, so a
    /// marketplace has somewhere to send them.
    pub royalty_recipient: Pubkey,
    pub seller_fee_basis_points: u16,
    #[max_len(8)]
    pub symbol: String,
    /// Immutable base for every item's metadata, e.g.
    /// `https://arweave.net/<id>/`. The catalog index and `.json` are appended.
    ///
    /// NOT a domain this project controls: a metadata URI cannot be changed
    /// after the mint, so an item pointing at our own host dies the day that
    /// host does.
    #[max_len(160)]
    pub base_uri: String,
}

/// What one season can drop, by rarity.
///
/// ── Why a list per rarity and not a rarity per index ─────────────────────
///
/// The first shape of this was four `(start, len)` pairs, which only works if
/// every item of a rarity occupies a contiguous run of catalog indices. The
/// pool is not ordered that way and, more to the point, it cannot be: the
/// items are still being drawn and named, and nobody knows yet how many of
/// each rarity a season will hold. A range demands the partition up front and
/// then demands it stay sorted forever.
///
/// The obvious alternative, a rarity byte per catalog index, answers the wrong
/// question. The draw never asks "what rarity is index 203", it asks "give me
/// a rare one", and a byte array makes that a scan with a counting pass to
/// stay uniform. Inverted into a list per rarity it is one modulo: constant
/// time, exactly uniform, and any index can be any rarity in any order.
///
/// ── Why one account per season ──────────────────────────────────────────
///
/// Because the VRF callback must not be able to fail. It arrives after the
/// money is taken, and it needs the table that was in force when the pack was
/// paid for. A table living in `PackConfig` could be rewritten in between, so
/// the callback would be reading whatever the admin last wrote.
///
/// A per-season account is immutable the moment its season opens, which is
/// enforced below rather than promised: a pack can only be bought in the
/// current season, and only a season still in the future can be edited. So
/// the table a pending pack points at can no longer change by the time the
/// pack exists.
///
/// It also makes each season's contents provable on chain for as long as the
/// season matters, and puts the rent on whoever opens the season instead of
/// growing one account without bound.
#[account]
pub struct SeasonDrops {
    pub season: u16,
    /// Catalog indices this season can drop, one list per rarity in
    /// RARITY_ORDER. An empty list means the draw falls past that rarity.
    pub drops: [Vec<u16>; RARITY_COUNT],
}

impl SeasonDrops {
    /// 8 discriminator + 2 season + four length-prefixed vectors.
    pub fn size_for(counts: [usize; RARITY_COUNT]) -> usize {
        8 + 2 + counts.iter().map(|c| 4 + c * 2).sum::<usize>()
    }

    pub fn current_size(&self) -> usize {
        Self::size_for([
            self.drops[0].len(), self.drops[1].len(),
            self.drops[2].len(), self.drops[3].len(),
        ])
    }

    pub fn total(&self) -> usize {
        self.drops.iter().map(|d| d.len()).sum()
    }
}

/// What the city sells, and on what terms.
///
/// An account rather than constants in the bytecode, decided 2026-10-22. The
/// alternative made every economic change a redeploy: opening a season,
/// closing one, correcting a price, tuning odds that read wrong in the wild.
/// With seasons arriving a few times a year against a program that cannot be
/// compiled locally, that is a redeploy per quarter to change a number.
///
/// The cost is honest and worth stating: `admin` is a key that can change what
/// packs pay out. It is narrower than the upgrade authority, which can replace
/// the bytecode, but it is used routinely rather than living in cold storage.
/// It belongs in a multisig or on the same hardware wallet.
///
/// Fixed arrays rather than vectors: this is one account for the whole city,
/// not one per player, so a kilobyte of slack costs a fraction of a cent once
/// and spares every instruction a realloc. What each season can DROP is the
/// one thing not here, because it has to stop changing when the season opens;
/// see SeasonDrops.
#[account]
#[derive(InitSpace)]
pub struct PackConfig {
    /// May change prices, odds, the open season, and any season's drop table
    /// up until that season opens.
    pub admin: Pubkey,
    /// The mint prices are denominated in. USDC, decided 2026-10-22, so a pack
    /// costs the same tomorrow as today. A SOL price through an oracle is the
    /// thing that would replace this, and would be a new instruction rather
    /// than a layout change.
    pub currency_mint: Pubkey,
    /// Token account that receives payment, owned by the treasury wallet.
    pub treasury_token_account: Pubkey,
    /// Only packs of this season may be bought. Moving it is how a season
    /// closes, and it is one transaction rather than one deploy.
    pub current_season: u16,
    pub packs: [PackDef; MAX_PACKS],
    pub pack_count: u8,
}

impl PackConfig {
    pub fn pack(&self, id: u8) -> Option<&PackDef> {
        self.packs[..self.pack_count as usize].iter().find(|p| p.id == id)
    }
}
#[derive(Accounts)]
pub struct InitMintConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + MintConfig::INIT_SPACE,
        seeds = [MINT_CONFIG_SEED],
        bump,
    )]
    pub mint_config: Account<'info, MintConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminMintConfig<'info> {
    #[account(
        mut,
        seeds = [MINT_CONFIG_SEED],
        bump,
        constraint = mint_config.admin == admin.key() @ CollectiblesError::NotPackAdmin,
    )]
    pub mint_config: Account<'info, MintConfig>,
    pub admin: Signer<'info>,
}

/// Minting one owned cosmetic as a compressed NFT.
///
/// Most of these are Bubblegum's own plumbing and are checked by Bubblegum,
/// not here: passing the wrong compression program or log wrapper fails inside
/// the CPI. What this program checks are the three that decide WHO gets WHAT:
/// the unlock account belongs to the payer, and the tree and collection are
/// the ones the config names.
#[derive(Accounts)]
pub struct MintUnlock<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [UNLOCKS_SEED, payer.key().as_ref()],
        bump,
        constraint = unlock_state.authority == payer.key() @ CollectiblesError::WrongUnlockOwner,
    )]
    pub unlock_state: Account<'info, UnlockState>,
    #[account(seeds = [MINT_CONFIG_SEED], bump)]
    pub mint_config: Account<'info, MintConfig>,
    /// CHECK: the PDA that is the tree delegate and collection authority. It
    /// signs the CPI; Bubblegum checks it against the tree and collection.
    #[account(seeds = [MINT_AUTHORITY_SEED], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    /// CHECK: Bubblegum's tree config, derived from and checked against the tree.
    #[account(mut)]
    pub tree_config: UncheckedAccount<'info>,
    /// CHECK: address-checked against mint_config.merkle_tree.
    #[account(mut)]
    pub merkle_tree: UncheckedAccount<'info>,
    /// CHECK: address-checked against mint_config.collection_mint.
    pub collection_mint: UncheckedAccount<'info>,
    /// CHECK: Metaplex collection metadata, checked by Bubblegum.
    #[account(mut)]
    pub collection_metadata: UncheckedAccount<'info>,
    /// CHECK: Metaplex master edition, checked by Bubblegum.
    pub collection_edition: UncheckedAccount<'info>,
    /// CHECK: Bubblegum's own signing PDA, checked by Bubblegum.
    pub bubblegum_signer: UncheckedAccount<'info>,
    /// CHECK: SPL Noop. Checked by Bubblegum.
    pub log_wrapper: UncheckedAccount<'info>,
    /// CHECK: SPL Account Compression. Checked by Bubblegum.
    pub compression_program: UncheckedAccount<'info>,
    /// CHECK: Token Metadata. Checked by Bubblegum.
    pub token_metadata_program: UncheckedAccount<'info>,
    /// CHECK: Bubblegum itself, the program being called.
    pub bubblegum_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Claiming the grant for an asset this wallet holds.
///
/// The merkle proof arrives as remaining accounts, one node per tree level the
/// canopy does not cover, so the account list here stops at what this program
/// itself reads.
#[derive(Accounts)]
pub struct ClaimOwnedFromAsset<'info> {
    #[account(mut)]
    pub claimer: Signer<'info>,
    #[account(
        mut,
        seeds = [UNLOCKS_SEED, claimer.key().as_ref()],
        bump,
        constraint = unlock_state.authority == claimer.key() @ CollectiblesError::WrongUnlockOwner,
    )]
    pub unlock_state: Account<'info, UnlockState>,
    #[account(seeds = [MINT_CONFIG_SEED], bump)]
    pub mint_config: Account<'info, MintConfig>,
    /// CHECK: address-checked against mint_config.merkle_tree.
    pub merkle_tree: UncheckedAccount<'info>,
    /// CHECK: SPL Account Compression, pinned by address. It is what actually
    /// decides whether the proof holds.
    #[account(address = ACCOUNT_COMPRESSION_ID)]
    pub compression_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitPackConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + PackConfig::INIT_SPACE,
        seeds = [PACK_CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, PackConfig>,
    pub system_program: Program<'info, System>,
}

/// The admin grants, the wallet receives, and the wallet is identified by the
/// UnlockState's own authority rather than by an argument.
///
/// That is what makes the seeds self-checking: the account has to sit at the
/// PDA derived from the authority written inside it, so an admin handed a
/// lookalike account writes a grant into nobody rather than into the wrong
/// player.
///
/// The account must already exist. `init_unlock_state` is signed by the
/// player, so the admin cannot create one, and a winner who has never
/// connected on this cluster has nothing to grant into yet. The script skips
/// them and says so, rather than this instruction trying to be clever.
#[derive(Accounts)]
pub struct AdminGrantEventItem<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        seeds = [PACK_CONFIG_SEED],
        bump,
        constraint = config.admin == admin.key() @ CollectiblesError::NotPackAdmin,
    )]
    pub config: Account<'info, PackConfig>,
    #[account(
        mut,
        seeds = [UNLOCKS_SEED, unlock_state.authority.as_ref()],
        bump,
    )]
    pub unlock_state: Account<'info, UnlockState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(season: u16)]
pub struct InitSeasonDrops<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        seeds = [PACK_CONFIG_SEED],
        bump,
        constraint = config.admin == admin.key() @ CollectiblesError::NotPackAdmin,
    )]
    pub config: Account<'info, PackConfig>,
    #[account(
        init,
        payer = admin,
        space = 8 + 2 + 4 * 4,
        seeds = [SEASON_DROPS_SEED, &season.to_le_bytes()],
        bump,
    )]
    pub drops: Account<'info, SeasonDrops>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EditSeasonDrops<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        seeds = [PACK_CONFIG_SEED],
        bump,
        constraint = config.admin == admin.key() @ CollectiblesError::NotPackAdmin,
    )]
    pub config: Account<'info, PackConfig>,
    #[account(
        mut,
        seeds = [SEASON_DROPS_SEED, &drops.season.to_le_bytes()],
        bump,
    )]
    pub drops: Account<'info, SeasonDrops>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminPackConfig<'info> {
    #[account(
        mut,
        seeds = [PACK_CONFIG_SEED],
        bump,
        constraint = config.admin == admin.key() @ CollectiblesError::NotPackAdmin,
    )]
    pub config: Account<'info, PackConfig>,
    pub admin: Signer<'info>,
}

#[cfg(test)]
mod id_agreement {
    /// The catalog crate has to name the program that owns the accounts it
    /// defines, and it cannot read `crate::ID` to do it, so that one fact
    /// lives in two places. This is the guard that stops them drifting: if
    /// they did, `Account<UnlockState>` would check the wrong owner and
    /// accept an account belonging to somebody else.
    #[test]
    fn the_catalog_names_this_program() {
        assert_eq!(crate::ID, sol_city_catalog::COLLECTIBLES_PROGRAM_ID);
    }
}
