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

// security.txt: see the same block in sol-city. Only in the deployable binary.
#[cfg(not(feature = "no-entrypoint"))]
#[cfg_attr(target_os = "solana", link_section = ".security.txt")]
#[allow(dead_code)]
#[no_mangle]
pub static security_txt: &str = concat!(
    "=======BEGIN SECURITY.TXT V1=======\0",
    "name\0", "Solana City Collectibles\0",
    "project_url\0", "https://solanacity.io\0",
    "contacts\0", "link:https://github.com/Solana-City/SolCityMVP/security/advisories/new\0",
    "policy\0", "https://github.com/Solana-City/SolCityMVP/blob/main/SECURITY.md\0",
    "preferred_languages\0", "en,pt\0",
    "source_code\0", "https://github.com/Solana-City/SolCityMVP\0",
    "=======END SECURITY.TXT V1=======\0"
);

// The shared vocabulary, defined in a crate that is NOT a program. That is
// what keeps any program from depending on another program, so the
// `no-entrypoint` feature never enters this build graph at all. See the note
// at the top of sol-city-catalog.
pub use sol_city_catalog::{
    UnlockState, PendingDraw,
    FREE_ITEM_COUNT, QUEST_FREE_SLOTS, ENFORCED_FROM, UNLOCKS_SEED, RARITY_COUNT,
    EVENT_BLOCK_START, is_mintable, is_event_item,
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

/// Seed of the marker that says "this tree was once the mint tree", followed
/// by the tree's address. See `set_mint_tree` and `AcceptedTree`.
pub const ACCEPTED_TREE_SEED: &[u8] = b"accepted_tree";

/// Seed of a wallet's WearLog, followed by the wallet: which asset each of
/// its wear-rights came from. See `WearLog`.
pub const WEAR_LOG_SEED: &[u8] = b"wear_log";

/// Seed of an event's drop: ["event_drop", id as u16 LE]. See `EventDrop`.
pub const EVENT_DROP_SEED: &[u8] = b"event_drop";

/// Longest proof `claim_event_item` will walk: room for 2^24 winners, and a
/// bound on the hashing one claim can ask for.
pub const MAX_EVENT_PROOF: usize = 24;

/// Seed of a wallet's MintQueue, followed by the wallet: every copy it has
/// drawn or been granted and not yet received as an asset. See `MintQueue`.
pub const MINT_QUEUE_SEED: &[u8] = b"mint_queue";

/// Most copies one wallet may have WAITING to be minted at once, all items
/// together.
///
/// Not a limit on what a wallet owns or holds: there is none, and two of the
/// same item are as normal as two different ones. The queue drains right
/// after every reveal, so it normally holds a pack or less; it only fills if
/// minting keeps failing, and then the next pack is refused before anything
/// is paid, until what is waiting has been minted (owner, 2026-11-10).
///
/// It replaced PLAYER_MINT_CAP, which capped how many DIFFERENT items a wallet
/// could ever mint, for life, at 256. Nothing about owning a collection
/// should run out.
pub const MAX_OWED_COPIES: usize = 256;

/// How many cosmetics one `mint_pending` call will mint.
///
/// A compute bound and nothing else: each Bubblegum mint CPIs into Token
/// Metadata and the compression program, and a transaction has 1.4M units to
/// spend whatever it is doing. Five is one pack, which is the case that has to
/// work in a single transaction; the headroom above it is for a bundle, which
/// the client splits across several calls anyway.
pub const MINT_PENDING_CAP: usize = 8;

/// Most indices one rarity of one season may hold. Generous on purpose: a
/// season is expected to run past three hundred items across all four, and the
/// table is appended to as the art lands rather than written in one go.
pub const MAX_SEASON_DROPS: usize = 2048;
/// Basis points, so 0.5% legendary is expressible. Weights must sum to this.
pub const WEIGHT_TOTAL: u16 = 10_000;

/// Pieces granted per pack.
pub const BOOSTER_PACK_SIZE: usize = 5;

/// Items ONE draw may resolve, which is what caps a buy-and-open bundle.
///
/// Fifty is ten street packs in a single payment, a single randomness
/// request and a single reveal. The ceiling is the VRF callback: it hashes
/// and places every item in one transaction, it cannot be split, and it must
/// not be able to fail, because by the time it runs the money is gone.
///
/// SEALED packs have no such ceiling. Nothing is drawn, so a bundle of them
/// is only mints, and the client chunks those across transactions the wallet
/// signs together.
pub const MAX_BUNDLE_ITEMS: usize = 50;
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

/// Treasury that receives pack payments (the game wallet).
pub const TREASURY: Pubkey = pubkey!("9592QS34mPUwqA7sPAkug1kcuFddjn59QPQMzzCgKhEp");

/// MagicBlock VRF program.
pub const VRF_PROGRAM_ID: Pubkey = pubkey!("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");

/// Bubblegum, as an address this program names rather than accepts.
///
/// Re-exported from the crate so there is ONE spelling of it. A CPI target
/// taken from an account the caller supplies is a CPI the caller chooses,
/// and for the burn in `open_pack_from_asset` that was the whole security
/// of the instruction: "the burn is the proof" is only true if the burn
/// happened in Bubblegum.
pub const BUBBLEGUM_ID: Pubkey = mpl_bubblegum::ID;
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
/// A pack that may be SOLD right now, and the table it will resolve against.
///
/// Shared by both purchase paths rather than copied into each. They have to
/// agree about what is on sale: a pack the booster path refuses and the
/// sealed path sells would be a pack that can be bought and never opened.
///
/// `drops_total` is passed rather than the account, because the two callers
/// hold it in different structs and this only needs the number.
fn sellable_pack(
    cfg: &PackConfig,
    pack_id: u8,
    drops_key: &Pubkey,
    drops_total: usize,
    max_price: u64,
) -> Result<PackDef> {
    let def = openable_pack(cfg, pack_id, drops_key, drops_total)?;
    // The price the buyer was shown, per pack (audit R-40). A price raised
    // between the screen and the landing refuses the sale instead of
    // charging the new one.
    require!(def.price <= max_price, CollectiblesError::PriceChanged);
    // The two extra conditions that apply to a SALE and never to an opening.
    //
    // A retired season, or a pack taken off sale, must still open: somebody
    // may be holding a sealed one bought months ago, and refusing to open it
    // would be taking their money and keeping the pack. What closes is the
    // sale, which is the whole point of carrying the season on the pack.
    require!(def.enabled, CollectiblesError::PackClosed);
    require!(def.season == cfg.current_season, CollectiblesError::WrongSeason);
    Ok(def)
}

/// A pack that can be RESOLVED: it exists, has a size, and its season still
/// holds enough to fill it.
///
/// Says nothing about whether it may be bought. A sealed pack from a closed
/// season is openable and not sellable, and that asymmetry is the feature.
fn openable_pack(
    cfg: &PackConfig,
    pack_id: u8,
    drops_key: &Pubkey,
    drops_total: usize,
) -> Result<PackDef> {
    let def = *cfg.pack(pack_id).ok_or(CollectiblesError::UnknownPack)?;
    // Only a season that has opened: its drop table is frozen from that moment
    // and not before, so a pack of a later season would draw from a table the
    // admin can still rewrite (audit R-58). Never refuses a pack that was
    // sold, because packs are only sold in the current season and the season
    // only moves forward: an old pack's season is always at or below it.
    require!(def.season <= cfg.current_season, CollectiblesError::WrongSeason);
    require!(def.size > 0, CollectiblesError::InvalidPoolCount);
    require!(def.size as usize <= BOOSTER_PACK_SIZE, CollectiblesError::InvalidPoolCount);

    // The drop table must be the one for this pack's season. Derived and
    // compared here rather than constrained in the Accounts struct, because
    // the season is read off the config at runtime and a seeds constraint
    // cannot see it.
    let (expected, _) = Pubkey::find_program_address(
        &[SEASON_DROPS_SEED, &def.season.to_le_bytes()],
        &crate::ID,
    );
    require_keys_eq!(*drops_key, expected, CollectiblesError::WrongDropTable);
    // Checked when the pack is SOLD, not only when it is opened. A sealed
    // pack against an empty season would be an asset that can never resolve,
    // and the buyer would find out months later.
    require!(drops_total >= def.size as usize, CollectiblesError::UnknownSeason);
    Ok(def)
}

/// Moves `amount` of the config's currency from the buyer to the treasury.
///
/// Hand-rolled like the delegation and VRF CPIs, so this program still
/// depends on `anchor-lang` alone: SPL Token's Transfer is instruction 3
/// followed by a little-endian amount, nine bytes in all.
///
/// Checking the DESTINATION against the config is enough to pin the currency,
/// and that is worth saying out loud: Transfer refuses a source whose mint
/// differs from the destination's, so a buyer cannot pay for USDC packs in
/// some token of their own making.
fn take_payment<'info>(
    buyer_token_account: &AccountInfo<'info>,
    treasury_token_account: &AccountInfo<'info>,
    payer: &Signer<'info>,
    token_program: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    // Paying from the treasury into the treasury is no payment at all (audit
    // R-41). It only works for whoever controls the treasury, but the shop
    // should not be the place that finds out.
    require_keys_neq!(
        buyer_token_account.key(),
        treasury_token_account.key(),
        CollectiblesError::InvalidTreasury
    );
    let mut data = Vec::with_capacity(9);
    data.push(3u8);
    data.extend_from_slice(&amount.to_le_bytes());
    invoke(
        &SolInstruction {
            program_id: TOKEN_PROGRAM_ID,
            accounts: vec![
                SolAccountMeta::new(buyer_token_account.key(), false),
                SolAccountMeta::new(treasury_token_account.key(), false),
                SolAccountMeta::new_readonly(payer.key(), true),
            ],
            data,
        },
        &[
            buyer_token_account.clone(),
            treasury_token_account.clone(),
            payer.to_account_info(),
            token_program.clone(),
        ],
    )?;
    Ok(())
}

/// Bubblegum's `burn`, as `sha256("global:burn")[..8]`.
///
/// Hand-rolled like every other CPI here, and for the same reason: this
/// program builds its instruction data itself rather than taking a builder's
/// word for the layout.
pub const BURN_DISCRIMINATOR: [u8; 8] = [116, 110, 29, 56, 107, 219, 42, 93];

/// Asks MagicBlock's VRF for the randomness that resolves a pack.
///
/// Shared by both ways a pack is opened, bought-and-opened or spent from a
/// sealed asset, because the draw must be identical either way. A second copy
/// of this would be a second chance to name the wrong callback or forget an
/// account, and the failure would land on somebody who has already paid.
///
/// A SCOPED request: the oracle signs our callback with the per-program
/// identity PDA, so nothing else can impersonate the answer.
#[allow(clippy::too_many_arguments)]
fn request_draw<'info>(
    client_seed: [u8; 32],
    payer: &Signer<'info>,
    unlock_state: &AccountInfo<'info>,
    drops: &AccountInfo<'info>,
    mint_queue: &AccountInfo<'info>,
    oracle_queue: &AccountInfo<'info>,
    program_identity: &UncheckedAccount<'info>,
    vrf_program: &UncheckedAccount<'info>,
    slot_hashes: &UncheckedAccount<'info>,
    system_program: &Program<'info, System>,
    identity_bump: u8,
) -> Result<()> {
    let mut data = vec![VRF_REQUEST_SCOPED, 0, 0, 0, 0, 0, 0, 0];
    VrfRequest {
        caller_seed: client_seed,
        callback_program_id: crate::ID,
        // Spelled out rather than `Type::DISCRIMINATOR`: the trait is not in
        // the anchor-lang 0.30.1 prelude, so the short form does not resolve.
        callback_discriminator:
            <instruction::CallbackOpenBooster as anchor_lang::Discriminator>::DISCRIMINATOR
                .to_vec(),
        callback_accounts_metas: vec![
            VrfCallbackMeta { pubkey: unlock_state.key(), is_signer: false, is_writable: true },
            // The season's drop table, read only. Named here so the callback
            // gets the table that was in force when the pack was spent, and
            // frozen by then because its season has opened.
            VrfCallbackMeta { pubkey: drops.key(), is_signer: false, is_writable: false },
            // The wallet's MintQueue, where every pick is queued to become an
            // asset. The purchase already made room for the whole draw.
            VrfCallbackMeta { pubkey: mint_queue.key(), is_signer: false, is_writable: true },
        ],
        callback_args: vec![],
    }
    .serialize(&mut data)
    .map_err(|_| ProgramError::InvalidInstructionData)?;

    invoke_signed(
        &SolInstruction {
            program_id: VRF_PROGRAM_ID,
            accounts: vec![
                SolAccountMeta::new(payer.key(), true),
                SolAccountMeta::new_readonly(program_identity.key(), true),
                SolAccountMeta::new(oracle_queue.key(), false),
                SolAccountMeta::new_readonly(system_program.key(), false),
                SolAccountMeta::new_readonly(slot_hashes.key(), false),
            ],
            data,
        },
        &[
            payer.to_account_info(),
            program_identity.to_account_info(),
            oracle_queue.clone(),
            system_program.to_account_info(),
            slot_hashes.to_account_info(),
            vrf_program.to_account_info(),
        ],
        &[&[VRF_IDENTITY_SEED, &[identity_bump]]],
    )?;
    Ok(())
}

/// The metadata of a COSMETIC asset.
///
/// Shared by `mint_unlock` and `mint_pending` rather than copied into each,
/// and the reason is not tidiness: these bytes are what the leaf hashes to.
/// Two builders that drifted by one field would mint assets that
/// `claim_owned_from_asset` could no longer recognise, and nothing would say
/// so until a buyer found their cosmetic unwearable.
///
/// The URI is built, not stored: one immutable base and the catalog index.
/// Holding a string per cosmetic on chain would cost more than every other
/// field of this program put together.
fn cosmetic_metadata(cfg: &MintConfig, index: u16) -> MetadataArgs {
    MetadataArgs {
        name: format!("SolanaCity #{}", index),
        symbol: cfg.symbol.clone(),
        uri: format!("{}{}.json", cfg.base_uri, index),
        seller_fee_basis_points: cfg.seller_fee_basis_points,
        primary_sale_happened: true,
        is_mutable: false,
        edition_nonce: None,
        token_standard: Some(TokenStandard::NonFungible),
        // Unverified here and verified BY the CPI: passing the collection with
        // our PDA as its authority is what tells Bubblegum to set the flag.
        collection: Some(BubblegumCollection { verified: false, key: cfg.collection_mint }),
        uses: None,
        token_program_version: TokenProgramVersion::Original,
        // One creator, unverified, holding the whole share, so a marketplace
        // honouring royalties has an address to send them to.
        creators: vec![BubblegumCreator {
            address: cfg.royalty_recipient,
            verified: false,
            share: 100,
        }],
    }
}

/// The metadata of a SEALED pack asset.
///
/// A pack and a cosmetic are told apart by their URI and nothing else, which
/// is what lets both live under one immutable base: a cosmetic is
/// `<base><index>.json` and a pack is `<base>pack-<id>.json`. Nothing on
/// chain stores either name.
fn sealed_pack_metadata(cfg: &MintConfig, pack_id: u8) -> MetadataArgs {
    MetadataArgs {
        name: format!("SolanaCity Pack #{}", pack_id),
        symbol: cfg.symbol.clone(),
        uri: format!("{}pack-{}.json", cfg.base_uri, pack_id),
        seller_fee_basis_points: cfg.seller_fee_basis_points,
        primary_sale_happened: true,
        is_mutable: false,
        edition_nonce: None,
        token_standard: Some(TokenStandard::NonFungible),
        collection: Some(BubblegumCollection { verified: false, key: cfg.collection_mint }),
        uses: None,
        token_program_version: TokenProgramVersion::Original,
        creators: vec![BubblegumCreator {
            address: cfg.royalty_recipient,
            verified: false,
            share: 100,
        }],
    }
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
    #[msg("Only an event cosmetic can be granted this way")]
    NotAnEventItem,
    #[msg("A pack's season, size and odds cannot change once it exists")]
    PackTermsFrozen,
    #[msg("That many packs cannot be opened as one draw")]
    BadBundleCount,
    #[msg("Quest and event cosmetics cannot be minted as assets")]
    ItemNotMintable,
    #[msg("This wallet has nothing left to mint")]
    NothingToMint,
    #[msg("This wallet has no pack waiting to be drawn")]
    NoDrawPending,
    #[msg("That is not the wallet this asset's wear-right came from")]
    WrongPreviousHolder,
    #[msg("The shop is paused")]
    Paused,
    #[msg("Only the pack admin or the pauser may pause, and only the admin may resume")]
    NotPauser,
    #[msg("The pack config already has the current layout")]
    AlreadyMigrated,
    #[msg("The pack costs more than the price shown")]
    PriceChanged,
    #[msg("This wallet is not on that event's list")]
    NotOnEventList,
    #[msg("That proof is longer than any event list")]
    EventProofTooLong,
    #[msg("That is not this wallet's mint queue")]
    WrongMintQueue,
    #[msg("Too many items are waiting to be minted; mint them before opening another pack")]
    MintQueueFull,
    #[msg("No copy of that cosmetic is waiting to be minted")]
    NoCopyOwed,
    #[msg("That asset is already claimed by this wallet")]
    AssetAlreadyClaimed,
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

    /// Buys `count` packs of one kind and opens them as ONE draw.
    ///
    /// `count` exists so that buying ten packs is one payment, one randomness
    /// request and one reveal rather than ten of each. The items are rolled
    /// independently, exactly as ten separate packs would have been: nothing
    /// about the odds changes, only the number of prompts.
    ///
    /// It cannot scale forever. `UnlockState.pending` is one slot per wallet,
    /// so a second draw cannot be in flight while this one is, and the
    /// callback resolves the whole bundle in a single transaction that is not
    /// allowed to fail. MAX_BUNDLE_ITEMS is where those two meet.
    pub fn open_booster(
        ctx: Context<OpenBooster>,
        pack_id: u8,
        client_seed: [u8; 32],
        count: u8,
        max_price: u64,
    ) -> Result<()> {
        require!(count > 0, CollectiblesError::BadBundleCount);
        // Shared with mint_pack, because the two purchase paths have to agree
        // about what is on sale: a pack one of them refuses and the other
        // sells is a pack that can be bought and never opened.
        let def = sellable_pack(
            &ctx.accounts.config,
            pack_id,
            &ctx.accounts.drops.key(),
            ctx.accounts.drops.total(),
            max_price,
        )?;
        let cfg = &ctx.accounts.config;

        // The whole bundle as one draw. Checked, not wrapped: a count that
        // overflowed would resolve into a draw of almost nothing against a
        // payment of almost everything.
        let items = (def.size as usize)
            .checked_mul(count as usize)
            .ok_or(CollectiblesError::BadBundleCount)?;
        require!(items <= MAX_BUNDLE_ITEMS, CollectiblesError::BadBundleCount);
        let price = def.price
            .checked_mul(count as u64)
            .ok_or(CollectiblesError::BadBundleCount)?;

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
                // The BUNDLE's size, not the pack's. The callback loops this
                // many times and knows nothing about how many packs it was.
                size: items as u8,
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
                ctx.accounts.unlock_state.owned.len() + items,
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

        // ── And room for every copy in the mint queue ─────────────────────
        //
        // The callback queues each pick to become an asset and, like `owned`,
        // it cannot grow the queue, so the buyer funds it here. A queue
        // already holding MAX_OWED_COPIES refuses the sale now, before the
        // payment, rather than taking the money for a draw it cannot deliver.
        {
            let queue = open_mint_queue(
                &ctx.accounts.mint_queue.to_account_info(),
                &ctx.accounts.unlock_state,
                &ctx.accounts.payer.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                items,
            )?;
            require!(queue.has_room_for(items), CollectiblesError::MintQueueFull);
            save_mint_queue(&ctx.accounts.mint_queue.to_account_info(), &queue)?;
        }

        // Shared with mint_pack: the same transfer, written once.
        take_payment(
            &ctx.accounts.buyer_token_account,
            &ctx.accounts.treasury_token_account,
            &ctx.accounts.payer,
            &ctx.accounts.token_program.to_account_info(),
            price,
        )?;

        // Shared with open_pack_from_asset: the draw has to be identical
        // however the pack was spent.
        request_draw(
            client_seed,
            &ctx.accounts.payer,
            &ctx.accounts.unlock_state.to_account_info(),
            &ctx.accounts.drops.to_account_info(),
            &ctx.accounts.mint_queue.to_account_info(),
            &ctx.accounts.oracle_queue,
            &ctx.accounts.program_identity,
            &ctx.accounts.vrf_program,
            &ctx.accounts.slot_hashes,
            &ctx.accounts.system_program,
            ctx.bumps.program_identity,
        )?;
        Ok(())
    }

    pub fn callback_open_booster(
        ctx: Context<CallbackOpenBooster>,
        randomness: [u8; 32],
    ) -> Result<()> {
        // Only a paid draw that is still waiting may be resolved. `draw` is
        // never cleared, so without this a second answer for the same request,
        // or a late answer to one already resolved, would grant the same pack
        // again. Refused rather than ignored, so a mistake shows up as a
        // failed transaction instead of as nothing (audit R-29, D-12).
        //
        // It also makes retry_draw safe: when the original answer and the
        // retried one both arrive, the first resolves the pack and the second
        // lands here.
        require!(ctx.accounts.unlock_state.pending, CollectiblesError::NoDrawPending);

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
            // FOUR bytes per roll, not two (audit R-19). A u16 taken modulo the
            // 10,000 basis points of the weights favours 0..5535, which landed
            // on common and under-delivered every other tier by about 8%
            // relative to the posted odds. Over 2^32 the same bias is below one
            // part in 400,000. Eight rolls fit the 32 bytes.
            let roll = |k: usize| -> u32 {
                let i = (k * 4) % 32;
                u32::from_le_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]])
            };

            // 1. The rarity, against the pack's weights. Walking the
            //    cumulative weight in RARITY_ORDER, so common is tried first
            //    and a zero weight is simply never selected.
            let mut wanted = RARITY_COUNT - 1;
            let mut ticket = roll(0) % total.max(1);
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

            // 3. An index inside the first rung that has one to give.
            //
            // WHAT THE WALLET ALREADY OWNS IS NOT CONSULTED, and that is a
            // decision, not an omission. This used to probe up to 32 entries
            // looking for something the buyer did not own and only then fall
            // back to a duplicate, which meant owning an item RAISED the
            // chance of drawing a different one. A pack was quietly a
            // completion engine.
            //
            // The supply of an item is not one per wallet and never was: the
            // catalog has eighty entries and the season mints many of each,
            // which is the whole reason a secondary market exists. Two of the
            // same item is a normal outcome, and a draw that avoids it is
            // taking the scarcity it is supposed to be selling.
            //
            // Owner's call, 2026-10-31.
            // EVERY ITEM IS AN INDEPENDENT DRAW. Nothing already drawn is
            // excluded, inside this pack or across a bundle.
            //
            // This used to skip anything already in `picks`, and `picks`
            // spanned the whole BUNDLE, which made ten packs bought together
            // a sample WITHOUT REPLACEMENT: fifty items that could not
            // repeat each other, where fifty bought one at a time would.
            // Buying in bulk was strictly the better product, and against a
            // small enough season table it handed over the entire set.
            //
            // Dropping it per pack as well, and not only per bundle, is the
            // owner's call of 2026-10-31 and follows from how supply works:
            // a season mints many of each item, two of the same is a normal
            // outcome, and the duplicates are what a secondary market is made
            // of. The arithmetic that follows is a duplicate somewhere in a
            // pack of five about 15% of the time, nearly all of it in common.
            //
            // It also retires the other half of the bug. There is no longer a
            // state where nothing can be picked, so no item is ever charged
            // for and left undelivered.
            let mut picked: Option<u16> = None;
            for rung in 0..rungs {
                let r = ladder[rung];
                let list = &drops.drops[r];
                if list.is_empty() { continue; }
                picked = Some(list[(roll(1 + rung) as usize) % list.len()]);
                break;
            }

            // Only an empty season table gives nothing here, and open_booster
            // and open_pack_from_asset refuse a pack against one.
            let Some(index) = picked else { break };
            picks.push(index);
        }

        // Every pick becomes wearable, and every pick, REPEATS INCLUDED, is
        // queued to become an asset. A set cannot hold the second copy, so
        // the queue is told separately (see MintQueue). The purchase made the
        // room, so neither write can fail here.
        let authority = unlocks.authority;
        let mut queue = load_mint_queue(&ctx.accounts.mint_queue.to_account_info(), &authority)?;
        record_picks(unlocks, &mut queue, &picks);
        save_mint_queue(&ctx.accounts.mint_queue.to_account_info(), &queue)?;

        unlocks.pending = false;
        emit!(BoosterOpened { authority: unlocks.authority, indices: picks });
        Ok(())
    }

    /// Asks the VRF again for a draw that was paid for and never answered.
    ///
    /// The recovery for an oracle that does not reply (audit R-06, D-4). Before
    /// this, a pack paid for and left unanswered was money taken and a wallet
    /// locked for good: `pending` only clears in the callback, and every way to
    /// buy or open another pack checks it.
    ///
    /// What it can change is nothing. The pack, its size, its odds and its
    /// season stay exactly as they were frozen at payment, nothing is charged
    /// and nothing is refunded; the only new thing is the randomness request.
    ///
    /// Why the wallet and not the admin: the admin key is on its way to a
    /// multisig, and a stuck draw should not need a proposal to be unstuck.
    ///
    /// Why there is no waiting period: the randomness does not exist until the
    /// callback applies it, so asking twice gives a player two answers they
    /// cannot see and cannot choose between. Whichever arrives first resolves
    /// the pack and the other is refused (NoDrawPending). Nothing else can
    /// touch the account while it waits, since every writer refuses a pending
    /// wallet. A timer would need a slot stored on UnlockState, which is a
    /// layout change on every wallet, to protect against nothing. The client
    /// offers the retry only after a wait, which is a matter of manners, and
    /// the VRF fee each request costs is the wallet's own.
    pub fn retry_draw(ctx: Context<RetryDraw>, client_seed: [u8; 32]) -> Result<()> {
        require!(ctx.accounts.unlock_state.pending, CollectiblesError::NoDrawPending);
        // The table the pack was paid against, re-derived from the frozen
        // draw rather than taken from the caller.
        let (expected, _) = Pubkey::find_program_address(
            &[SEASON_DROPS_SEED, &ctx.accounts.unlock_state.draw.season.to_le_bytes()],
            &crate::ID,
        );
        require_keys_eq!(
            ctx.accounts.drops.key(),
            expected,
            CollectiblesError::WrongDropTable
        );

        // Room for the draw in the mint queue, as the purchase makes it. A
        // draw paid for before the queue existed has none yet, and this is
        // what lets it resolve: its callback now names the queue too. No
        // ceiling check: refusing here would leave a paid draw stuck.
        {
            let queue = open_mint_queue(
                &ctx.accounts.mint_queue.to_account_info(),
                &ctx.accounts.unlock_state,
                &ctx.accounts.payer.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                ctx.accounts.unlock_state.draw.size as usize,
            )?;
            save_mint_queue(&ctx.accounts.mint_queue.to_account_info(), &queue)?;
        }

        request_draw(
            client_seed,
            &ctx.accounts.payer,
            &ctx.accounts.unlock_state.to_account_info(),
            &ctx.accounts.drops.to_account_info(),
            &ctx.accounts.mint_queue.to_account_info(),
            &ctx.accounts.oracle_queue,
            &ctx.accounts.program_identity,
            &ctx.accounts.vrf_program,
            &ctx.accounts.slot_hashes,
            &ctx.accounts.system_program,
            ctx.bumps.program_identity,
        )?;
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
/// Only the program's upgrade authority may call this.
///
/// It used to be whoever called first. On mainnet that is a front-run worth
/// taking: `treasury_token_account` is where every pack payment lands, and
/// nothing rotates it, so the first caller owns the pack economy and the
/// only cure is an upgrade.
///
/// The upgrade authority rather than a hard-coded key, for two reasons. It
/// grants nobody anything new, since whoever can replace the program can
/// already set any config it likes. And it travels: the same binary is
/// correct on devnet and mainnet, and moving to a different multisig is a
/// transfer of upgrade authority rather than a redeploy.
///
/// The admin is an ARGUMENT, not the signer. The deployer authorises, and
/// the key that ends up holding the config can be the multisig instead,
/// which is the separation the security pass asks for (R-05).
    pub fn init_pack_config(
        ctx: Context<InitPackConfig>,
        admin: Pubkey,
        currency_mint: Pubkey,
        treasury_token_account: Pubkey,
    ) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        cfg.admin = admin;
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
        cfg.paused = false;
        cfg.pauser = admin;
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
        // A pack is never free (audit R-41). A zero price is a typo that
        // would hand the season out to anyone who asked, and there is no
        // giveaway path that goes through the shop.
        require!(def.price > 0, CollectiblesError::BadBundleCount);

        let cfg = &mut ctx.accounts.config;
        let count = cfg.pack_count as usize;
        if let Some(slot) = cfg.packs[..count].iter_mut().find(|p| p.id == def.id) {
            // ── What a pack id promises can never be rewritten ────────────
            //
            // Only `price` and `enabled` may move on an existing pack, and
            // both of those only affect a future sale.
            //
            // Season, size and weights cannot, because a SEALED pack carries
            // nothing but its id: its URI is `pack-<id>.json` and its terms
            // are looked up here when it is opened, perhaps months later.
            // Rewriting them would re-point a pack somebody already paid for
            // at a different season or worse odds, which is the one thing
            // that would make a sealed pack worthless on the secondary
            // market, where we cannot reach it to make amends.
            //
            // The buy-and-open path never had this hole: PendingDraw freezes
            // the terms at the moment of payment. This is the same promise
            // for the pack that is paid for now and resolved later.
            //
            // New odds mean a NEW pack id. That costs a slot in a table of
            // eight and keeps every promise already made.
            require!(
                def.season == slot.season
                    && def.size == slot.size
                    && def.weights == slot.weights,
                CollectiblesError::PackTermsFrozen
            );
            slot.price = def.price;
            slot.enabled = def.enabled;
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
        // And never an event item: those are granted for having been there,
        // and a drop table that listed one would sell it.
        for index in indices.iter() {
            require!(
                *index >= ENFORCED_FROM && *index < EVENT_BLOCK_START,
                CollectiblesError::InvalidPoolCount
            );
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
    /// Only the program's upgrade authority may call this. Same reasoning as
    /// `init_pack_config`, and the same stakes: this one names the tree, the
    /// collection and the immutable base URI.
    pub fn init_mint_config(
        ctx: Context<InitMintConfig>,
        admin: Pubkey,
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
        cfg.admin = admin;
        cfg.merkle_tree = merkle_tree;
        cfg.collection_mint = collection_mint;
        cfg.royalty_recipient = royalty_recipient;
        cfg.seller_fee_basis_points = seller_fee_basis_points;
        cfg.symbol = symbol;
        cfg.base_uri = base_uri;
        cfg.paused = false;
        Ok(())
    }

    /// Hands the pack config to a different admin.
    ///
    /// Without this, a key set once at init is the key forever and the only
    /// correction is a program upgrade. That is the wrong shape even when
    /// nothing has gone wrong: the plan is for the admin to become a
    /// multisig, and moving to one should not need a redeploy.
    ///
    /// Guarded by the CURRENT admin, not by the upgrade authority, so that
    /// freezing the program later does not freeze the ability to rotate.
    ///
    /// A pauser that was just the old admin moves with it. Otherwise handing
    /// the config to the multisig would leave the deploy key able to pause.
    pub fn set_pack_admin(ctx: Context<AdminPackConfig>, new_admin: Pubkey) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        if cfg.pauser == cfg.admin {
            cfg.pauser = new_admin;
        }
        cfg.admin = new_admin;
        Ok(())
    }

    /// Hands the mint config to a different admin. See `set_pack_admin`.
    pub fn set_mint_admin(ctx: Context<AdminMintConfig>, new_admin: Pubkey) -> Result<()> {
        ctx.accounts.mint_config.admin = new_admin;
        Ok(())
    }

    /// Chooses the key that may pause. The admin itself is a valid answer and
    /// the default.
    pub fn set_pauser(ctx: Context<AdminPackConfig>, pauser: Pubkey) -> Result<()> {
        ctx.accounts.config.pauser = pauser;
        Ok(())
    }

    /// Closes or reopens the shop: both configs in one write, so packs and
    /// mints never disagree about whether it is open.
    ///
    /// Pausing takes the admin or the pauser; resuming takes the admin. The
    /// mint config is optional only because a deployment can sell packs
    /// before minting is set up; when it exists, the pause script passes it.
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        let who = ctx.accounts.authority.key();
        let allowed = who == cfg.admin || (paused && who == cfg.pauser);
        require!(allowed, CollectiblesError::NotPauser);
        cfg.paused = paused;
        if let Some(mint_config) = ctx.accounts.mint_config.as_mut() {
            mint_config.paused = paused;
        }
        Ok(())
    }

    /// Grows a pack config written before `paused` and `pauser` existed.
    ///
    /// Anchor cannot load such an account as a PackConfig (it is 33 bytes
    /// short), so this reads it raw: owner and address by constraint, the
    /// discriminator and the admin from the bytes. The new bytes come up
    /// zeroed, which is "not paused"; the pauser is set to the admin. Only an
    /// account of exactly the old size is accepted, so it runs once.
    pub fn migrate_pack_config(ctx: Context<MigratePackConfig>) -> Result<()> {
        let info = ctx.accounts.config.to_account_info();
        let new_len = 8 + PackConfig::INIT_SPACE;
        let old_len = new_len - 1 - 32;
        require!(info.data_len() == old_len, CollectiblesError::AlreadyMigrated);
        {
            let data = info.try_borrow_data()?;
            require!(
                data[..8] == <PackConfig as anchor_lang::Discriminator>::DISCRIMINATOR,
                CollectiblesError::NotPackAdmin
            );
            // `admin` is the first field.
            require!(
                data[8..40] == ctx.accounts.admin.key().to_bytes(),
                CollectiblesError::NotPackAdmin
            );
        }
        let rent = SolanaRent::get()?;
        let topup = rent.minimum_balance(new_len).saturating_sub(info.lamports());
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
        info.realloc(new_len, true)?;
        let mut data = info.try_borrow_mut_data()?;
        data[old_len + 1..new_len].copy_from_slice(&ctx.accounts.admin.key().to_bytes());
        Ok(())
    }

    /// Points minting at a different tree, for when the current one fills.
    ///
    /// The collection does NOT move with it. Assets already minted keep
    /// pointing at the tree that holds them, which is where they live; a tree
    /// is storage, and the collection is identity.
    ///
    /// And they keep WORKING (audit R-11). Before this, moving the tree
    /// stranded every sealed pack and every claimable cosmetic in the old one:
    /// opening and claiming only accepted the current tree, so a pack somebody
    /// had paid for could no longer be opened. The tree being left now gets an
    /// AcceptedTree marker, paid by the admin, and opening and claiming accept
    /// a leaf in any tree that has one. A pack opens with the terms it was
    /// sold with, whichever tree holds it.
    pub fn set_mint_tree(ctx: Context<SetMintTree>, merkle_tree: Pubkey) -> Result<()> {
        let old = ctx.accounts.mint_config.merkle_tree;
        let marker = &ctx.accounts.retired_tree_marker;

        // Nothing to retire on a first assignment or a no-op, and a tree that
        // was retired before (rotated away, back, and away again) already has
        // its marker.
        if old != Pubkey::default() && old != merkle_tree && marker.owner != &crate::ID {
            let (_, bump) = Pubkey::find_program_address(
                &[ACCEPTED_TREE_SEED, old.as_ref()],
                &crate::ID,
            );
            let bump_arr = [bump];
            let signer: &[&[u8]] = &[ACCEPTED_TREE_SEED, old.as_ref(), &bump_arr];
            let space = 8 + AcceptedTree::INIT_SPACE;
            let rent = SolanaRent::get()?;
            let admin = &ctx.accounts.admin;
            let system_program = &ctx.accounts.system_program;

            if marker.lamports() == 0 {
                invoke_signed(
                    &system_instruction::create_account(
                        admin.key, marker.key, rent.minimum_balance(space), space as u64, &crate::ID,
                    ),
                    &[admin.to_account_info(), marker.to_account_info(), system_program.to_account_info()],
                    &[signer],
                )?;
            } else {
                // The address is derivable, so it can be pre-funded, and a
                // pre-funded address refuses create_account. Same answer as the
                // delegate buffer in sol-city (audit R-04): top up, allocate,
                // assign. Otherwise one lamport would freeze the tree in place.
                let shortfall = rent.minimum_balance(space).saturating_sub(marker.lamports());
                if shortfall > 0 {
                    invoke(
                        &system_instruction::transfer(admin.key, marker.key, shortfall),
                        &[admin.to_account_info(), marker.to_account_info(), system_program.to_account_info()],
                    )?;
                }
                invoke_signed(
                    &system_instruction::allocate(marker.key, space as u64),
                    &[marker.to_account_info(), system_program.to_account_info()],
                    &[signer],
                )?;
                invoke_signed(
                    &system_instruction::assign(marker.key, &crate::ID),
                    &[marker.to_account_info(), system_program.to_account_info()],
                    &[signer],
                )?;
            }

            let mut data = marker.try_borrow_mut_data()?;
            // Discriminator then the tree, exactly as Anchor would have written
            // it, so the Option<Account<AcceptedTree>> on the open and claim
            // side reads it like any other account. Spelled with the trait's
            // path, the way catalog spells it, rather than trusting the prelude.
            anchor_lang::AccountSerialize::try_serialize(
                &AcceptedTree { tree: old },
                &mut &mut data[..],
            )?;
        }

        ctx.accounts.mint_config.merkle_tree = merkle_tree;
        Ok(())
    }

    /// Turns a cosmetic this wallet owns into a compressed NFT it holds.
    ///
    /// ── What makes this safe ─────────────────────────────────────────────
    ///
    /// The tree's delegate and the collection's authority are both a PDA of
    /// this program, so Bubblegum will not mint without our signature, and we
    /// only sign for a copy the caller's own MintQueue holds. A tree anyone
    /// could mint from would be a tree anyone could mint anything from.
    ///
    /// The queue is what makes each copy once. A copy enters it when it is
    /// drawn or granted and leaves it when it is minted, so a player cannot
    /// mint, sell, and mint again from the same draw; and a repeat drawn is a
    /// second copy, so it is a second asset. It is the MINT NOW button for a
    /// copy the sponsored mint has not delivered yet.
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
            // Not while a draw is in flight. open_booster grew this account by
            // exactly the room the callback needs, and a mint here writes into
            // that room. The callback then cannot serialize, `pending` never
            // clears, and the paid draw is lost with the wallet locked behind
            // it (audit R-06). Same rule mint_pending already has.
            require!(!unlocks.pending, CollectiblesError::BoosterPending);
            // A quest cosmetic is not a thing that can be sold, so it is not a
            // thing that can be minted. Without this a wallet could turn the
            // proof it did a quest into an asset and list it.
            require!(is_mintable(index), CollectiblesError::ItemNotMintable);
        }

        // ONE queued copy of this index is what this mints, and the only
        // thing that lets it mint at all. The queue holds what was drawn or
        // granted and not yet delivered, repeats included, so a second copy
        // drawn is a second asset, and an item minted and sold is not a
        // reason to mint it again (see MintQueue).
        let mut queue = open_mint_queue(
            &ctx.accounts.mint_queue.to_account_info(),
            &ctx.accounts.unlock_state,
            &ctx.accounts.payer.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            0,
        )?;
        require!(queue.take_one(index), CollectiblesError::NoCopyOwed);

        // Room for the records, funded by the player, before anything is
        // minted, so the asset never exists without them. An upper bound:
        // either list may already hold the index.
        {
            let info = ctx.accounts.unlock_state.to_account_info();
            let needed = UnlockState::size_for(
                ctx.accounts.unlock_state.owned.len() + 1,
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

        let metadata = cosmetic_metadata(cfg, index);

        // Where this wear-right will come from from now on: the asset about
        // to exist (audit R-21). Opened and grown before the mint, so the
        // asset is never there without its entry.
        let payer_key = ctx.accounts.payer.key();
        let mut log = open_wear_log(
            &ctx.accounts.wear_log.to_account_info(),
            &payer_key,
            &ctx.accounts.payer.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            1,
        )?;
        let nonce = next_leaf_nonce(&ctx.accounts.tree_config.to_account_info())?;
        let asset = get_asset_id(&ctx.accounts.merkle_tree.key(), nonce);

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
        log.entries.push(WearEntry { index, asset });
        save_wear_log(&ctx.accounts.wear_log.to_account_info(), &log)?;
        save_mint_queue(&ctx.accounts.mint_queue.to_account_info(), &queue)?;
        let unlocks = &mut ctx.accounts.unlock_state;
        // Wearable again if a sale had taken the right away: this asset now
        // backs it, and the wear log says so.
        unlocks.insert_owned(index);
        unlocks.insert_minted(index);
        emit!(UnlockMinted { authority: unlocks.authority, index });
        Ok(())
    }

    /// Mints every cosmetic this wallet owns and does not yet hold as an asset.
    ///
    /// ── Why this exists when `mint_unlock` already does ─────────────────
    ///
    /// Not for convenience. `mint_unlock` takes the index as an argument, so
    /// a transaction calling it cannot be BUILT until the draw is known, and
    /// the draw is only known after the oracle answers. That is what cost the
    /// player a second wallet popup: not a second transaction, but a second
    /// transaction nobody could write down in advance.
    ///
    /// This one takes no index. It reads the work out of the account at the
    /// moment it runs, so its bytes and its account list are the same before
    /// and after the draw.
    ///
    /// ── Who may send it ─────────────────────────────────────────────────
    ///
    /// Anyone. The `payer` signs and pays (fees, the account's growth, the
    /// wear log); the `owner` does not sign at all. That is what lets one
    /// approval buy a pack AND deliver it: the site's sponsor wallet sends
    /// this right after the draw lands, and the player is never asked again.
    /// The old route, having the wallet pre-sign this beside the purchase,
    /// needed the wallet to accept a batch whose second transaction fails
    /// until the oracle answers, and Phantom refused it (devnet, 2026-11-05).
    ///
    /// Opening it to any signer changes nothing about WHAT is minted or to
    /// WHOM, because the caller chooses neither:
    ///
    ///   * the items are read from the owner's UnlockState, never passed in;
    ///   * every asset's leaf owner and delegate is `owner`, which must be the
    ///     UnlockState's own authority, never the payer;
    ///   * the wear log is the owner's, addressed by the owner's key.
    ///
    /// What a stranger CAN do is mint someone's owned items for them, at the
    /// stranger's expense, sooner than they might have. That is the outcome
    /// the owner paid for when they bought the pack, so it is not a harm. The
    /// owner can still send it themselves, as both payer and owner.
    ///
    /// ── Which items it takes ────────────────────────────────────────────
    ///
    /// The oldest copies in the owner's MintQueue, up to `limit`, and nothing
    /// else. The queue is filled only by a paid draw (every pick, repeats
    /// included) and by the event grants, and never by a claim, so:
    ///
    ///   * the caller names nothing, so they cannot name something else;
    ///   * two of the same item drawn are two copies, and two assets;
    ///   * a cosmetic bought on a marketplace adds no copy, so it never turns
    ///     into a second, fresh asset.
    ///
    /// ── Why running it twice is harmless ────────────────────────────────
    ///
    /// It reads the queue every time it executes, so two calls sent together
    /// do not fight over the same five copies: they write the same account,
    /// Solana runs them one after the other, and the second takes the next
    /// ones. A call with nothing left to do fails loudly rather than reporting
    /// success for no work.
    pub fn mint_pending(ctx: Context<MintPending>, limit: u8) -> Result<()> {
        let cfg = &ctx.accounts.mint_config;
        require_keys_eq!(
            ctx.accounts.merkle_tree.key(), cfg.merkle_tree, CollectiblesError::WrongMintTarget
        );
        require_keys_eq!(
            ctx.accounts.collection_mint.key(), cfg.collection_mint, CollectiblesError::WrongMintTarget
        );

        // A draw still in flight means the items are not in `owned` yet. This
        // is the one thing that could make a pre-signed transaction mint the
        // wrong set: sent a moment too early it would find nothing and, if it
        // succeeded, would be spent. Failing leaves it valid to send again.
        require!(!ctx.accounts.unlock_state.pending, CollectiblesError::BoosterPending);

        let want = match limit as usize {
            0 => MINT_PENDING_CAP,
            n => n.min(MINT_PENDING_CAP),
        };
        // The oldest copies in the owner's queue, repeats included: two of
        // the same item drawn are two of these, and two assets. The queue is
        // the only source, so the caller still names nothing.
        let mut queue = open_mint_queue(
            &ctx.accounts.mint_queue.to_account_info(),
            &ctx.accounts.unlock_state,
            &ctx.accounts.payer.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            0,
        )?;
        let todo: Vec<u16> = queue.take_front(want);
        require!(!todo.is_empty(), CollectiblesError::NothingToMint);

        // Room for the records of all of them at once, funded by the payer,
        // before anything is minted, so no asset exists without them. An
        // upper bound: repeats and earlier mints are already in the lists.
        {
            let info = ctx.accounts.unlock_state.to_account_info();
            let needed = UnlockState::size_for(
                ctx.accounts.unlock_state.owned.len() + todo.len(),
                ctx.accounts.unlock_state.minted.len() + todo.len(),
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

        // Room for one wear-log entry per asset, before any is minted (audit
        // R-21). The OWNER's log, addressed by the owner's key; the payer
        // only funds it.
        let owner_key = ctx.accounts.owner.key();
        let mut log = open_wear_log(
            &ctx.accounts.wear_log.to_account_info(),
            &owner_key,
            &ctx.accounts.payer.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            todo.len(),
        )?;
        let tree = ctx.accounts.merkle_tree.key();

        let authority = ctx.accounts.unlock_state.authority;
        let bump = ctx.bumps.mint_authority;
        let seeds: &[&[u8]] = &[MINT_AUTHORITY_SEED, &[bump]];
        for index in todo {
            // Read fresh each time: every mint moves the tree's counter on.
            let nonce = next_leaf_nonce(&ctx.accounts.tree_config.to_account_info())?;
            MintToCollectionV1Cpi {
                __program: &ctx.accounts.bubblegum_program,
                tree_config: &ctx.accounts.tree_config,
                // The owner, never the payer: whoever sends this, the asset
                // is the owner's (see "Who may send it" above).
                leaf_owner: &ctx.accounts.owner,
                leaf_delegate: &ctx.accounts.owner,
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
                __args: MintToCollectionV1InstructionArgs {
                    metadata: cosmetic_metadata(&ctx.accounts.mint_config, index),
                },
            }
            .invoke_signed(&[seeds])?;

            // Recorded right after the asset exists. Wearable again if a sale
            // had taken the right away: this asset now backs it.
            ctx.accounts.unlock_state.insert_owned(index);
            ctx.accounts.unlock_state.insert_minted(index);
            log.entries.push(WearEntry { index, asset: get_asset_id(&tree, nonce) });
            emit!(UnlockMinted { authority, index });
        }
        save_wear_log(&ctx.accounts.wear_log.to_account_info(), &log)?;
        // What was minted leaves the queue. One transaction, so a failure
        // anywhere above reverts this with it and the copies stay owed.
        save_mint_queue(&ctx.accounts.mint_queue.to_account_info(), &queue)?;
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
        // The current tree, or one this program used to mint into: a cosmetic
        // bought second-hand from before a tree rotation is still that
        // cosmetic (audit R-11).
        require_accepted_tree(
            &ctx.accounts.merkle_tree.key(), cfg, ctx.accounts.accepted_tree.is_some(),
        )?;
        // Owning the index already is NOT a refusal: a second asset of an item
        // is normal, and claiming it is what records it in the wear log, so a
        // later sale of the first one leaves this wallet still wearing it.
        // What is refused is the same ASSET twice, below, once the log is open.
        //
        // A quest or event cosmetic never exists as an asset, so there is
        // nothing honest to claim. mint_unlock already refuses to make one;
        // this is the same rule on the way back in (audit R-60).
        require!(is_mintable(index), CollectiblesError::ItemNotMintable);
        // Not while a draw is in flight: a claim grows `owned` into the room
        // the callback was paid for. See mint_unlock (audit R-06).
        require!(!ctx.accounts.unlock_state.pending, CollectiblesError::BoosterPending);
        // No ceiling on `minted` any more (it was audit R-62's PLAYER_MINT_CAP):
        // it holds each index at most once, so it is bounded by the catalog,
        // and a collection should not run out.
        //
        // Our collection, verified (audit R-18). The leaf hashes this metadata,
        // so a leaf carrying another collection, or ours unverified, cannot be
        // presented as one of our cosmetics even if its URI happens to match.
        require!(
            metadata.collection.as_ref().map_or(false, |c| c.verified && c.key == cfg.collection_mint),
            CollectiblesError::AssetIsNotThatItem
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
                ctx.accounts.unlock_state.minted.len() + 1,
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
        // A record that an asset of this index has been in this wallet's
        // hands. It no longer gates minting: what keeps the buyer of a
        // second-hand cosmetic from minting a FRESH asset of it is that a
        // claim never adds a copy to the MintQueue.
        unlocks.insert_minted(index);

        // ── One asset, one wearer (audit R-21) ───────────────────────────
        //
        // The claimer's right now comes from THIS asset, so their log says so.
        let asset = get_asset_id(&tree, nonce);
        let claimer = ctx.accounts.claimer.key();
        let mut own_log = open_wear_log(
            &ctx.accounts.wear_log.to_account_info(),
            &claimer,
            &ctx.accounts.claimer.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            1,
        )?;
        // The same asset twice would be two entries backing one right.
        require!(
            !own_log.entries.iter().any(|e| e.asset == asset),
            CollectiblesError::AssetAlreadyClaimed
        );
        own_log.entries.push(WearEntry { index, asset });
        save_wear_log(&ctx.accounts.wear_log.to_account_info(), &own_log)?;

        // And whoever's right came from it before loses it. Both accounts are
        // checked against each other and against this asset, so a caller can
        // only ever take the index from the wallet whose log names THIS
        // asset, which is the wallet it was minted or last claimed to.
        if let (Some(prev_log), Some(prev_unlocks)) =
            (ctx.accounts.previous_log.as_mut(), ctx.accounts.previous_unlocks.as_mut())
        {
            let prev = prev_log.wallet;
            require_keys_neq!(prev, claimer, CollectiblesError::WrongPreviousHolder);
            let (log_pda, _) =
                Pubkey::find_program_address(&[WEAR_LOG_SEED, prev.as_ref()], &crate::ID);
            require_keys_eq!(prev_log.key(), log_pda, CollectiblesError::WrongPreviousHolder);
            let (unlocks_pda, _) =
                Pubkey::find_program_address(&[UNLOCKS_SEED, prev.as_ref()], &crate::ID);
            require_keys_eq!(prev_unlocks.key(), unlocks_pda, CollectiblesError::WrongPreviousHolder);

            let at = prev_log
                .entries
                .iter()
                .position(|e| e.asset == asset && e.index == index)
                .ok_or(CollectiblesError::WrongPreviousHolder)?;
            prev_log.entries.swap_remove(at);
            // The right goes only if no OTHER asset still backs it. A copy the
            // seller still has waiting in their MintQueue brings it back the
            // moment that copy is minted. Selling gives them no new copy, so
            // they cannot mint a fresh one either.
            if !prev_log.entries.iter().any(|e| e.index == index) {
                if let Ok(i) = prev_unlocks.owned.binary_search(&index) {
                    prev_unlocks.owned.remove(i);
                }
            }
        }
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
    /// Opens a sealed pack: burns the asset and asks for the draw, together.
    ///
    /// ── Why one instruction and not two ─────────────────────────────────
    ///
    /// If the burn succeeded and the request then failed, the pack would be
    /// destroyed and nothing owed to anybody. In one instruction a failure
    /// reverts both, so there is no moment where the pack is gone and the
    /// draw never happened.
    ///
    /// ── The burn IS the proof ───────────────────────────────────────────
    ///
    /// Nothing here checks separately that the caller holds the asset.
    /// Bubblegum's burn does it: it walks the proof against the tree and
    /// refuses unless the leaf owner signs. A caller who does not hold the
    /// pack cannot produce a proof that burns, so possession is established
    /// by the act of spending it rather than by a check that could disagree.
    ///
    /// What this program checks is the one thing Bubblegum cannot know:
    /// WHICH pack the asset is. That is the URI, rebuilt from the immutable
    /// base exactly as `mint_pack` built it.
    ///
    /// ── Whoever OPENS it gets the items ─────────────────────────────────
    ///
    /// The UnlockState is the opener's, not the buyer's. That is what makes
    /// gifting work, and it is the reason this instruction exists at all
    /// rather than a flag on the original purchase.
    pub fn open_pack_from_asset<'info>(
        // One named lifetime, because the proof arrives in remaining_accounts
        // and is put in the same Vec as accounts from the struct.
        ctx: Context<'_, '_, '_, 'info, OpenPackFromAsset<'info>>,
        pack_id: u8,
        client_seed: [u8; 32],
        root: [u8; 32],
        nonce: u64,
        leaf_index: u32,
        metadata: MetadataArgs,
    ) -> Result<()> {
        // Openable, NOT sellable: a sealed pack from a closed season still
        // opens. Refusing it would be keeping the money and the pack.
        let def = openable_pack(
            &ctx.accounts.config,
            pack_id,
            &ctx.accounts.drops.key(),
            ctx.accounts.drops.total(),
        )?;
        // The current tree, or one this program used to mint into. A pack sold
        // before a tree rotation still opens, and opens as itself: `def` above
        // came from its pack id, whose season, size and odds are frozen, and
        // nothing below depends on which tree holds it (audit R-11).
        require_accepted_tree(
            &ctx.accounts.merkle_tree.key(),
            &ctx.accounts.mint_config,
            ctx.accounts.accepted_tree.is_some(),
        )?;

        // (1) This metadata is THAT pack. Same string mint_pack wrote, built
        // from a base that cannot change, so naming another pack's id here
        // produces a hash that will not burn.
        let expected_uri = format!("{}pack-{}.json", ctx.accounts.mint_config.base_uri, pack_id);
        require!(metadata.uri == expected_uri, CollectiblesError::AssetIsNotThatItem);
        // And it is in our collection, verified (audit R-18): the burn proves
        // the leaf exists, this proves the leaf is one of our packs.
        require!(
            metadata.collection.as_ref().map_or(false, |c| {
                c.verified && c.key == ctx.accounts.mint_config.collection_mint
            }),
            CollectiblesError::AssetIsNotThatItem
        );

        // (2) Burn it. Both hashes come from the metadata above, so a caller
        // cannot burn one asset while claiming the contents of another.
        let data_hash = hash_metadata(&metadata)?;
        let creator_hash = hash_creators(&metadata.creators);

        let mut data = Vec::with_capacity(8 + 32 + 32 + 32 + 8 + 4);
        data.extend_from_slice(&BURN_DISCRIMINATOR);
        data.extend_from_slice(&root);
        data.extend_from_slice(&data_hash);
        data.extend_from_slice(&creator_hash);
        data.extend_from_slice(&nonce.to_le_bytes());
        data.extend_from_slice(&leaf_index.to_le_bytes());

        let opener = ctx.accounts.opener.key();
        let mut metas = vec![
            SolAccountMeta::new(ctx.accounts.tree_config.key(), false),
            SolAccountMeta::new_readonly(opener, true),
            SolAccountMeta::new_readonly(opener, true),
            SolAccountMeta::new(ctx.accounts.merkle_tree.key(), false),
            SolAccountMeta::new_readonly(ctx.accounts.log_wrapper.key(), false),
            SolAccountMeta::new_readonly(ctx.accounts.compression_program.key(), false),
            SolAccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
        ];
        let mut infos = vec![
            ctx.accounts.tree_config.to_account_info(),
            ctx.accounts.opener.to_account_info(),
            ctx.accounts.merkle_tree.to_account_info(),
            ctx.accounts.log_wrapper.to_account_info(),
            ctx.accounts.compression_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ];
        // The proof: one node per tree level the canopy does not already hold.
        for node in ctx.remaining_accounts.iter() {
            metas.push(SolAccountMeta::new_readonly(node.key(), false));
            infos.push(node.clone());
        }
        // THE CONSTANT, NOT THE ACCOUNT.
        //
        // This read `ctx.accounts.bubblegum_program.key()`, which let the
        // caller choose where the burn went. Any program that returns Ok
        // satisfied the check above, and SPL Noop is already deployed and
        // does exactly that: a draw then cost no pack and no payment, could
        // be repeated, and `mint_pending` turned the result into real
        // verified-collection cNFTs.
        //
        // The account is address-pinned as well, so the failure is a clear
        // `ConstraintAddress` before any work happens rather than a CPI into
        // the wrong place. Both, because the pin documents the requirement
        // and the constant enforces it even if the pin is ever loosened.
        invoke(
            &SolInstruction {
                program_id: BUBBLEGUM_ID,
                accounts: metas,
                data,
            },
            &infos,
        )?;

        // (3) From here it is the same as a pack bought and opened at once.
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

        // Room for the draw, funded by the opener, because the VRF callback
        // cannot grow the account: the oracle signs it and there is nobody
        // there willing to pay for bytes.
        {
            let info = ctx.accounts.unlock_state.to_account_info();
            let needed = UnlockState::size_for(
                ctx.accounts.unlock_state.owned.len() + def.size as usize,
                ctx.accounts.unlock_state.minted.len(),
            );
            if info.data_len() < needed {
                let rent = SolanaRent::get()?;
                let topup = rent.minimum_balance(needed).saturating_sub(info.lamports());
                if topup > 0 {
                    invoke(
                        &system_instruction::transfer(ctx.accounts.opener.key, info.key, topup),
                        &[
                            ctx.accounts.opener.to_account_info(),
                            info.clone(),
                            ctx.accounts.system_program.to_account_info(),
                        ],
                    )?;
                }
                info.realloc(needed, false)?;
            }
        }

        // Room for every copy in the opener's mint queue, as open_booster
        // makes it, and the same refusal when too much is already waiting:
        // nothing is lost by it, the burn reverts with the rest.
        {
            let queue = open_mint_queue(
                &ctx.accounts.mint_queue.to_account_info(),
                &ctx.accounts.unlock_state,
                &ctx.accounts.opener.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                def.size as usize,
            )?;
            require!(queue.has_room_for(def.size as usize), CollectiblesError::MintQueueFull);
            save_mint_queue(&ctx.accounts.mint_queue.to_account_info(), &queue)?;
        }

        request_draw(
            client_seed,
            &ctx.accounts.opener,
            &ctx.accounts.unlock_state.to_account_info(),
            &ctx.accounts.drops.to_account_info(),
            &ctx.accounts.mint_queue.to_account_info(),
            &ctx.accounts.oracle_queue,
            &ctx.accounts.program_identity,
            &ctx.accounts.vrf_program,
            &ctx.accounts.slot_hashes,
            &ctx.accounts.system_program,
            ctx.bumps.program_identity,
        )?;

        emit!(PackOpened { opener, pack_id, season: def.season });
        Ok(())
    }

    /// Buys a pack SEALED: pays for it and mints the pack itself as an asset.
    ///
    /// The other purchase path. `open_booster` pays and draws in one go;
    /// this pays and draws nothing, handing back a cNFT that is the unopened
    /// pack. It can be held, gifted or resold like any other asset, and the
    /// city has no further opinion about it until somebody opens it.
    ///
    /// No randomness is requested and no UnlockState is touched, which is why
    /// this instruction is so much smaller than its sibling: there is nothing
    /// to draw, nothing to grant and nothing to make room for. The buyer does
    /// not even need an UnlockState yet, and if they gift the pack away they
    /// never will.
    ///
    /// The season is checked HERE as well as at opening. A sealed pack sold
    /// against a season with nothing in it would be an asset that can never
    /// resolve, and its buyer would find that out months later.
    pub fn mint_pack(ctx: Context<MintPack>, pack_id: u8, max_price: u64) -> Result<()> {
        let def = sellable_pack(
            &ctx.accounts.config,
            pack_id,
            &ctx.accounts.drops.key(),
            ctx.accounts.drops.total(),
            max_price,
        )?;

        require_keys_eq!(
            ctx.accounts.treasury_token_account.key(),
            ctx.accounts.config.treasury_token_account,
            CollectiblesError::InvalidTreasury
        );
        require_keys_eq!(
            ctx.accounts.merkle_tree.key(),
            ctx.accounts.mint_config.merkle_tree,
            CollectiblesError::WrongMintTarget
        );
        require_keys_eq!(
            ctx.accounts.collection_mint.key(),
            ctx.accounts.mint_config.collection_mint,
            CollectiblesError::WrongMintTarget
        );

        take_payment(
            &ctx.accounts.buyer_token_account,
            &ctx.accounts.treasury_token_account,
            &ctx.accounts.payer,
            &ctx.accounts.token_program.to_account_info(),
            def.price,
        )?;

        let metadata = sealed_pack_metadata(&ctx.accounts.mint_config, pack_id);
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

        emit!(PackMinted { buyer: ctx.accounts.payer.key(), pack_id, season: def.season });
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
    /// Only the EVENT block, never the booster block. A grant path that
    /// reached pack items would be a button that mints the shop's own
    /// inventory out of nothing, and the scarcity those items are sold on is
    /// the only thing they have. The admin cannot reach them here, and that
    /// is deliberate rather than an oversight to be "fixed" later.
    ///
    /// Event items used to sit in the quest block and could therefore never
    /// be minted or sold. They have their own block now, above the booster
    /// one (owner's call, 2026-11-02): once granted, an event item is a
    /// cosmetic like any pack item, mintable, tradable, and checked by the
    /// city when worn. Quest items stay out of reach here: nothing on chain
    /// grants them, and they are never tradable.
    ///
    /// Idempotence is NOT silent. Running the admin's script twice over the
    /// same snapshot fails on the second pass rather than quietly doing
    /// nothing, because "already granted" and "granted just now" are facts an
    /// operator handing out collectibles needs told apart.
    pub fn admin_grant_event_item(
        ctx: Context<AdminGrantEventItem>,
        index: u16,
    ) -> Result<()> {
        require!(is_event_item(index), CollectiblesError::NotAnEventItem);
        // Not while that wallet's draw is in flight, even from the admin: the
        // grant would take the room the callback was paid for and lose the
        // player's draw (audit R-06). The grant script defers such wallets.
        require!(!ctx.accounts.unlock_state.pending, CollectiblesError::BoosterPending);

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

        // Queued to become an asset, like a pack item: event items are
        // tradable. Funded by the admin, like the grant itself.
        let mut queue = open_mint_queue(
            &ctx.accounts.mint_queue.to_account_info(),
            &ctx.accounts.unlock_state,
            &ctx.accounts.admin.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            1,
        )?;
        let unlocks = &mut ctx.accounts.unlock_state;
        require!(unlocks.insert_owned(index), CollectiblesError::AlreadyOwned);
        queue.owed.push(index);
        save_mint_queue(&ctx.accounts.mint_queue.to_account_info(), &queue)?;
        Ok(())
    }

    // Event drops ------------------------------------------------------------
    //
    // How a winner gets an event cosmetic: they claim it themselves. The admin
    // publishes ONE root per event, whatever the number of winners, and each
    // winner proves their place in the list when they claim. So the admin pays
    // for one small account per event, and every winner pays for their own
    // claim, the same as for their first pack.
    //
    // `admin_grant_event_item` above stays for the odd correction. It needs
    // the winner's UnlockState to exist already, which this does not.

    /// Opens an event drop: who may claim `index` is whoever is under `root`.
    pub fn init_event_drop(
        ctx: Context<InitEventDrop>,
        id: u16,
        index: u16,
        root: [u8; 32],
    ) -> Result<()> {
        require!(is_event_item(index), CollectiblesError::NotAnEventItem);
        let drop = &mut ctx.accounts.event_drop;
        drop.id = id;
        drop.index = index;
        drop.root = root;
        Ok(())
    }

    /// Replaces an event's list, for a winner left out of the first one. The
    /// cosmetic stays what it was: a drop never changes what it hands out.
    pub fn set_event_root(ctx: Context<SetEventRoot>, _id: u16, root: [u8; 32]) -> Result<()> {
        ctx.accounts.event_drop.root = root;
        Ok(())
    }

    /// A winner takes their event cosmetic.
    ///
    /// The proof is the path from this wallet's leaf to the drop's root; the
    /// site builds it from the published list. A wallet claims once, because
    /// a second claim finds the index already owned.
    pub fn claim_event_item(
        ctx: Context<ClaimEventItem>,
        _id: u16,
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        require!(proof.len() <= MAX_EVENT_PROOF, CollectiblesError::EventProofTooLong);
        let drop = &ctx.accounts.event_drop;
        let leaf = event_leaf(drop.id, &ctx.accounts.claimer.key());
        require!(on_event_list(&drop.root, leaf, &proof), CollectiblesError::NotOnEventList);
        let index = drop.index;
        // Same reason as the admin grant: writing now would take the room a
        // paid draw is waiting for (audit R-06).
        require!(!ctx.accounts.unlock_state.pending, CollectiblesError::BoosterPending);

        // Room first, funded by the claimer, then the write.
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

        // Queued to become an asset, as the admin grant does, at the
        // claimer's expense like the rest of the claim.
        let mut queue = open_mint_queue(
            &ctx.accounts.mint_queue.to_account_info(),
            &ctx.accounts.unlock_state,
            &ctx.accounts.claimer.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            1,
        )?;
        let unlocks = &mut ctx.accounts.unlock_state;
        require!(unlocks.insert_owned(index), CollectiblesError::AlreadyOwned);
        queue.owed.push(index);
        save_mint_queue(&ctx.accounts.mint_queue.to_account_info(), &queue)?;
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
    #[account(seeds = [PACK_CONFIG_SEED], bump, constraint = !config.paused @ CollectiblesError::Paused)]
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
    /// CHECK: the payer's MintQueue, created on first use and checked
    /// against its seeds in `open_mint_queue`. Last, so the accounts before
    /// it keep their positions.
    #[account(mut)]
    pub mint_queue: UncheckedAccount<'info>,
}

/// The VRF half of OpenBooster and nothing else: a retry pays for no pack and
/// writes no config, so it has no token accounts and no config to name.
#[derive(Accounts)]
pub struct RetryDraw<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    // Read only: the retry writes nothing to it. The callback it asks for is
    // what writes, and that names the account itself.
    #[account(
        seeds = [UNLOCKS_SEED, payer.key().as_ref()],
        bump,
        constraint = unlock_state.authority == payer.key() @ CollectiblesError::WrongUnlockOwner,
    )]
    pub unlock_state: Account<'info, UnlockState>,
    /// The season's drop table. Address-checked against the frozen draw in
    /// the instruction body.
    pub drops: Account<'info, SeasonDrops>,
    /// CHECK: MagicBlock VRF oracle queue.
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
    /// CHECK: the payer's MintQueue, checked against its seeds in
    /// `open_mint_queue`. Grown here for a draw paid before it existed.
    #[account(mut)]
    pub mint_queue: UncheckedAccount<'info>,
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
    /// CHECK: the wallet's MintQueue, named at request time, already sized
    /// for this draw by the purchase. Checked against the authority's seeds
    /// and this program's ownership in `load_mint_queue`.
    #[account(mut)]
    pub mint_queue: UncheckedAccount<'info>,
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

/// Emitted when a sealed pack is spent, so the client can start the reveal.
#[event]
pub struct PackOpened {
    pub opener: Pubkey,
    pub pack_id: u8,
    pub season: u16,
}

/// Emitted when a pack is bought SEALED, so the client can show it arriving.
#[event]
pub struct PackMinted {
    pub buyer: Pubkey,
    pub pack_id: u8,
    pub season: u16,
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
    /// Stops minting and claiming. Written only by `set_paused`, together
    /// with the pack config's flag; see PackConfig::pauser.
    pub paused: bool,
}

/// A tree that used to be the mint tree, and whose assets still count.
///
/// Written by `set_mint_tree` for the tree it moves away from, and by nothing
/// else, so its existence at ["accepted_tree", tree] is the proof that this
/// program once minted into that tree. A tree a caller made up has no marker
/// and cannot get one.
///
/// It exists for the sealed pack bought before a rotation (audit R-11). Its
/// leaf stays in the old tree forever, and the owner's call of 2026-10-31 is
/// that such a pack must open, and open as itself: its pack id, season, size
/// and odds were frozen when it was sold, and none of that depends on which
/// tree holds it. Without the marker it could not be opened at all, and the
/// same went for claiming a cosmetic bought second-hand from the old tree.
///
/// Minting is NOT accepted against a marker: new assets go to the current
/// tree only. A marker is for spending and proving what already exists.
#[account]
#[derive(InitSpace)]
pub struct AcceptedTree {
    pub tree: Pubkey,
}

/// Where a wallet's wear-rights came from: one entry per cosmetic it holds the
/// right to wear BECAUSE of an asset, naming that asset (audit R-21).
///
/// The problem it answers. Minting moved nothing: `owned` kept the index, and a
/// compressed NFT moves on Bubblegum without this program hearing about it. So
/// whoever sold an item could keep wearing it, as could every wallet it passed
/// through. The owner's rule, 2026-10-31: a seller loses the right when they
/// sell, and no new signature is asked of anybody for it.
///
/// How it holds without new signatures. The entry is written by the mint and
/// the claim, which the player signs anyway, and the address is fixed by the
/// wallet alone, so a mint signed before its draw still knows it. When a
/// buyer claims the asset (which they sign to be able to wear it), the claim
/// finds the entry naming THAT asset in the previous holder's log and takes
/// the index out of their `owned`. One asset, one wearer.
///
/// What it does not do: a buyer who never claims leaves the seller wearing it.
/// The client's own wardrobe already stops a seller from putting it on (it
/// asks the indexer what is held); this closes it on chain at the claim.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct WearEntry {
    pub index: u16,
    pub asset: Pubkey,
}

#[account]
pub struct WearLog {
    pub wallet: Pubkey,
    pub entries: Vec<WearEntry>,
}

impl WearLog {
    pub fn size_for(entries: usize) -> usize {
        8 + 32 + 4 + entries * WearEntry::INIT_SPACE
    }
}

/// Opens `wallet`'s WearLog with room for `extra` more entries, creating it
/// the first time, and returns what it holds.
///
/// `payer` funds the account and its growth. Creation takes the pre-funded
/// branch when the address already holds lamports, as everywhere else in the
/// security pass: the address is derivable, and one lamport sent to it must
/// not stop a player from ever minting (the R-04 shape).
fn open_wear_log<'info>(
    log: &AccountInfo<'info>,
    wallet: &Pubkey,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    extra: usize,
) -> Result<WearLog> {
    let (expected, bump) = Pubkey::find_program_address(&[WEAR_LOG_SEED, wallet.as_ref()], &crate::ID);
    require_keys_eq!(*log.key, expected, CollectiblesError::WrongPreviousHolder);
    let bump_arr = [bump];
    let signer: &[&[u8]] = &[WEAR_LOG_SEED, wallet.as_ref(), &bump_arr];
    let rent = SolanaRent::get()?;

    let current = if log.owner == &crate::ID {
        let data = log.try_borrow_data()?;
        <WearLog as anchor_lang::AccountDeserialize>::try_deserialize(&mut &data[..])?
    } else {
        let space = WearLog::size_for(extra);
        if log.lamports() == 0 {
            invoke_signed(
                &system_instruction::create_account(payer.key, log.key, rent.minimum_balance(space), space as u64, &crate::ID),
                &[payer.clone(), log.clone(), system_program.clone()],
                &[signer],
            )?;
        } else {
            let shortfall = rent.minimum_balance(space).saturating_sub(log.lamports());
            if shortfall > 0 {
                invoke(
                    &system_instruction::transfer(payer.key, log.key, shortfall),
                    &[payer.clone(), log.clone(), system_program.clone()],
                )?;
            }
            invoke_signed(
                &system_instruction::allocate(log.key, space as u64),
                &[log.clone(), system_program.clone()],
                &[signer],
            )?;
            invoke_signed(
                &system_instruction::assign(log.key, &crate::ID),
                &[log.clone(), system_program.clone()],
                &[signer],
            )?;
        }
        return Ok(WearLog { wallet: *wallet, entries: Vec::new() });
    };

    // Grown before anything is minted, funded by the payer, so a full log can
    // never be the reason an asset exists without its entry.
    let needed = WearLog::size_for(current.entries.len() + extra);
    if log.data_len() < needed {
        let topup = rent.minimum_balance(needed).saturating_sub(log.lamports());
        if topup > 0 {
            invoke(
                &system_instruction::transfer(payer.key, log.key, topup),
                &[payer.clone(), log.clone(), system_program.clone()],
            )?;
        }
        log.realloc(needed, false)?;
    }
    Ok(current)
}

/// Writes a WearLog back over its account.
fn save_wear_log(log: &AccountInfo, value: &WearLog) -> Result<()> {
    let mut data = log.try_borrow_mut_data()?;
    anchor_lang::AccountSerialize::try_serialize(value, &mut &mut data[..])
}

/// Every COPY a wallet has drawn or been granted and not yet received as an
/// asset, oldest first. Repeats are the point: two of the same item drawn are
/// two entries, and become two assets.
///
/// ── Why it exists ────────────────────────────────────────────────────
///
/// `UnlockState.owned` and `.minted` are sets. They answer "may this wallet
/// wear X" and "has an asset of X ever been in this wallet", and a set cannot
/// say "two of X are owed". Minting used to be "owned minus minted", which
/// meant at most one asset per item per wallet, ever: a repeat in a pack was
/// paid for and never delivered, and an item minted, sold and drawn again was
/// never delivered either (devnet, 2026-11-10). The owner's rules: every roll
/// is independent, repeats are normal, and EVERYTHING revealed is minted.
///
/// So what is owed is its own list, and it is the only thing a mint reads.
/// `owned` stays the wear permission and `minted` a record, and neither gates
/// a mint any more.
///
/// ── Why its own account ──────────────────────────────────────────────
///
/// UnlockState is also read by the city program, and its layout is shared
/// through sol-city-catalog. A field added there would move every wallet's
/// account under a reader that is deployed separately. A new account moves
/// nothing.
///
/// ── What fills it, and what never does ───────────────────────────────
///
/// The pack draw (every pick) and the two event grants. NEVER a claim: an
/// asset bought second-hand is that asset, not a right to mint another, or a
/// buyer could mint a fresh one, sell both, and repeat.
#[account]
pub struct MintQueue {
    pub wallet: Pubkey,
    pub owed: Vec<u16>,
}

impl MintQueue {
    pub fn size_for(entries: usize) -> usize {
        8 + 32 + 4 + entries * 2
    }

    /// What the old rule still owed when a wallet's queue is first created:
    /// owned, mintable and never minted. Before the queue existed that was
    /// exactly what `mint_pending` would have minted next, so carrying it over
    /// means nothing paid for before the upgrade is lost.
    ///
    /// Not cut at MAX_OWED_COPIES: cutting would drop copies already paid for.
    /// A wallet seeded above the ceiling just cannot open another pack until
    /// what is waiting has been minted.
    pub fn legacy_owed(unlocks: &UnlockState) -> Vec<u16> {
        unlocks
            .owned
            .iter()
            .copied()
            .filter(|i| is_mintable(*i) && !unlocks.is_minted(*i))
            .collect()
    }

    /// Whether `extra` more copies fit under MAX_OWED_COPIES.
    pub fn has_room_for(&self, extra: usize) -> bool {
        self.owed.len() + extra <= MAX_OWED_COPIES
    }

    /// Removes ONE copy of `index`, the oldest. False when none is owed.
    pub fn take_one(&mut self, index: u16) -> bool {
        match self.owed.iter().position(|i| *i == index) {
            Some(at) => { self.owed.remove(at); true }
            None => false,
        }
    }

    /// Removes and returns up to `n` copies from the front.
    pub fn take_front(&mut self, n: usize) -> Vec<u16> {
        let k = n.min(self.owed.len());
        self.owed.drain(..k).collect()
    }
}

/// What a resolved draw does to a wallet: every pick becomes wearable, and
/// every pick, repeats included, is queued to become an asset.
///
/// `insert_owned` ignores an index already there, which is right for the wear
/// permission and is exactly why the queue has to be told separately.
pub fn record_picks(unlocks: &mut UnlockState, queue: &mut MintQueue, picks: &[u16]) {
    for index in picks {
        unlocks.insert_owned(*index);
        // A drop table only lists pack items, which are all mintable. Checked
        // anyway: an unmintable entry at the front would block the queue.
        if is_mintable(*index) {
            queue.owed.push(*index);
        }
    }
}

/// Opens the MintQueue of `unlocks.authority` with room for `extra` more
/// copies, creating it the first time (seeded with what the old rule owed),
/// and returns what it holds. The caller saves it.
///
/// `payer` funds creation and growth. Same pre-funded branch as the WearLog:
/// a lamport sent to the address must not stop a wallet from ever minting.
fn open_mint_queue<'info>(
    queue: &AccountInfo<'info>,
    unlocks: &UnlockState,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    extra: usize,
) -> Result<MintQueue> {
    let wallet = unlocks.authority;
    let (expected, bump) =
        Pubkey::find_program_address(&[MINT_QUEUE_SEED, wallet.as_ref()], &crate::ID);
    require_keys_eq!(*queue.key, expected, CollectiblesError::WrongMintQueue);
    let bump_arr = [bump];
    let signer: &[&[u8]] = &[MINT_QUEUE_SEED, wallet.as_ref(), &bump_arr];
    let rent = SolanaRent::get()?;

    if queue.owner != &crate::ID {
        let seeded = MintQueue::legacy_owed(unlocks);
        let space = MintQueue::size_for(seeded.len() + extra);
        if queue.lamports() == 0 {
            invoke_signed(
                &system_instruction::create_account(payer.key, queue.key, rent.minimum_balance(space), space as u64, &crate::ID),
                &[payer.clone(), queue.clone(), system_program.clone()],
                &[signer],
            )?;
        } else {
            let shortfall = rent.minimum_balance(space).saturating_sub(queue.lamports());
            if shortfall > 0 {
                invoke(
                    &system_instruction::transfer(payer.key, queue.key, shortfall),
                    &[payer.clone(), queue.clone(), system_program.clone()],
                )?;
            }
            invoke_signed(
                &system_instruction::allocate(queue.key, space as u64),
                &[queue.clone(), system_program.clone()],
                &[signer],
            )?;
            invoke_signed(
                &system_instruction::assign(queue.key, &crate::ID),
                &[queue.clone(), system_program.clone()],
                &[signer],
            )?;
        }
        return Ok(MintQueue { wallet, owed: seeded });
    }

    let current = {
        let data = queue.try_borrow_data()?;
        <MintQueue as anchor_lang::AccountDeserialize>::try_deserialize(&mut &data[..])?
    };
    require_keys_eq!(current.wallet, wallet, CollectiblesError::WrongMintQueue);
    let needed = MintQueue::size_for(current.owed.len() + extra);
    if queue.data_len() < needed {
        let topup = rent.minimum_balance(needed).saturating_sub(queue.lamports());
        if topup > 0 {
            invoke(
                &system_instruction::transfer(payer.key, queue.key, topup),
                &[payer.clone(), queue.clone(), system_program.clone()],
            )?;
        }
        queue.realloc(needed, false)?;
    }
    Ok(current)
}

/// Reads an EXISTING MintQueue, for the VRF callback: nobody there can pay
/// to create or grow an account, so the purchase that asked for the draw
/// made the room, and this only reads it.
fn load_mint_queue(queue: &AccountInfo, wallet: &Pubkey) -> Result<MintQueue> {
    let (expected, _) =
        Pubkey::find_program_address(&[MINT_QUEUE_SEED, wallet.as_ref()], &crate::ID);
    require_keys_eq!(*queue.key, expected, CollectiblesError::WrongMintQueue);
    require_keys_eq!(*queue.owner, crate::ID, CollectiblesError::WrongMintQueue);
    let data = queue.try_borrow_data()?;
    let current = <MintQueue as anchor_lang::AccountDeserialize>::try_deserialize(&mut &data[..])?;
    require_keys_eq!(current.wallet, *wallet, CollectiblesError::WrongMintQueue);
    Ok(current)
}

/// Writes a MintQueue back over its account.
fn save_mint_queue(queue: &AccountInfo, value: &MintQueue) -> Result<()> {
    let mut data = queue.try_borrow_mut_data()?;
    anchor_lang::AccountSerialize::try_serialize(value, &mut &mut data[..])
}

/// The nonce Bubblegum will give the next leaf it mints into this tree, which
/// together with the tree is the asset's id.
///
/// Read from the tree config BEFORE the mint: Bubblegum takes `num_minted` as
/// the nonce and then increments it. TreeConfig is discriminator (8),
/// tree_creator (32), tree_delegate (32), total_mint_capacity (8), then
/// num_minted (8). A wrong tree config fails the mint CPI itself, so a forged
/// one here can only produce a transaction that reverts.
fn next_leaf_nonce(tree_config: &AccountInfo) -> Result<u64> {
    require_keys_eq!(*tree_config.owner, BUBBLEGUM_ID, CollectiblesError::WrongMintTarget);
    let data = tree_config.try_borrow_data()?;
    require!(data.len() >= 88, CollectiblesError::WrongMintTarget);
    Ok(u64::from_le_bytes(data[80..88].try_into().unwrap()))
}

/// Whether a leaf in `tree` may be spent or claimed here: the current mint
/// tree, or one this program used to mint into (a marker was passed, and the
/// account struct's seeds tie that marker to `tree`).
fn require_accepted_tree(tree: &Pubkey, cfg: &MintConfig, marker_passed: bool) -> Result<()> {
    require!(
        *tree == cfg.merkle_tree || marker_passed,
        CollectiblesError::WrongMintTarget
    );
    Ok(())
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
    // Appended so the fields above keep their offsets for the client's
    // hand-written decoder. Accounts created before these existed are grown
    // by `migrate_pack_config`.
    /// Stops buying, opening, minting, claiming and event grants (audit
    /// R-44). Draws already paid for still resolve: the VRF callback and
    /// `retry_draw` do not read it, so nobody is left holding a paid pack
    /// with nothing in it.
    pub paused: bool,
    /// May pause but not resume. Starts as the admin, so no extra key exists
    /// unless one is chosen: a key held by whoever is on call pauses in
    /// minutes when reaching a second multisig signer would take hours, and
    /// the worst it can do is close the shop until the admin reopens it.
    pub pauser: Pubkey,
}

impl PackConfig {
    pub fn pack(&self, id: u8) -> Option<&PackDef> {
        self.packs[..self.pack_count as usize].iter().find(|p| p.id == id)
    }
}
#[derive(Accounts)]
pub struct InitMintConfig<'info> {
    /// The upgrade authority, which pays and authorises. See InitPackConfig.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: this program, used only to reach its ProgramData.
    #[account(constraint = program.programdata_address()? == Some(program_data.key())
        @ CollectiblesError::NotPackAdmin)]
    pub program: Program<'info, crate::program::SolCityCollectibles>,
    /// The deployer's claim, checked rather than taken on trust.
    #[account(constraint = program_data.upgrade_authority_address == Some(payer.key())
        @ CollectiblesError::NotPackAdmin)]
    pub program_data: Account<'info, ProgramData>,
    #[account(
        init,
        payer = payer,
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
    #[account(seeds = [MINT_CONFIG_SEED], bump, constraint = !mint_config.paused @ CollectiblesError::Paused)]
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
    /// CHECK: Bubblegum itself, the program being called. Pinned rather than
    /// trusted to the generated CPI: the mint path is how a cosmetic becomes
    /// a tradable asset, and a mint into somebody else's program is a cNFT
    /// this collection never issued.
    #[account(address = BUBBLEGUM_ID)]
    pub bubblegum_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: the payer's WearLog (audit R-21), created on first use and
    /// checked against its seeds in `open_wear_log`.
    #[account(mut)]
    pub wear_log: UncheckedAccount<'info>,
    /// CHECK: the payer's MintQueue, the copy this consumes. Created on first
    /// use and checked against its seeds in `open_mint_queue`.
    #[account(mut)]
    pub mint_queue: UncheckedAccount<'info>,
}

/// `mint_pending`: MintUnlock with the payer and the owner apart.
///
/// The payer signs and pays and may be anyone (the site's sponsor wallet, or
/// the owner themselves). The owner signs nothing; what keeps this safe is
/// that the owner is pinned to the UnlockState's own authority, and every
/// asset goes to the owner (see `mint_pending`, "Who may send it").
#[derive(Accounts)]
pub struct MintPending<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the wallet whose items are minted, and the leaf owner of every
    /// asset. Not a signer. Bound to the UnlockState below, which is derived
    /// from it AND must name it as its authority.
    pub owner: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [UNLOCKS_SEED, owner.key().as_ref()],
        bump,
        constraint = unlock_state.authority == owner.key() @ CollectiblesError::WrongUnlockOwner,
    )]
    pub unlock_state: Account<'info, UnlockState>,
    #[account(seeds = [MINT_CONFIG_SEED], bump, constraint = !mint_config.paused @ CollectiblesError::Paused)]
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
    /// CHECK: Bubblegum itself, pinned for the same reason as in MintUnlock.
    #[account(address = BUBBLEGUM_ID)]
    pub bubblegum_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: the OWNER's WearLog (audit R-21), created on first use at the
    /// payer's expense and checked against the owner's seeds in `open_wear_log`.
    #[account(mut)]
    pub wear_log: UncheckedAccount<'info>,
    /// CHECK: the OWNER's MintQueue, what this mints. Checked against the
    /// UnlockState authority's seeds in `open_mint_queue`, so a payer cannot
    /// point it at anybody else's.
    #[account(mut)]
    pub mint_queue: UncheckedAccount<'info>,
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
    #[account(seeds = [MINT_CONFIG_SEED], bump, constraint = !mint_config.paused @ CollectiblesError::Paused)]
    pub mint_config: Account<'info, MintConfig>,
    /// CHECK: address-checked against mint_config.merkle_tree.
    pub merkle_tree: UncheckedAccount<'info>,
    /// CHECK: SPL Account Compression, pinned by address. It is what actually
    /// decides whether the proof holds.
    #[account(address = ACCOUNT_COMPRESSION_ID)]
    pub compression_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// The marker for `merkle_tree`, when that is a tree this program used to
    /// mint into. Absent (the program id in its slot) for the current tree.
    /// Seeded on the tree, so a marker for one tree cannot vouch for another.
    #[account(seeds = [ACCEPTED_TREE_SEED, merkle_tree.key().as_ref()], bump)]
    pub accepted_tree: Option<Account<'info, AcceptedTree>>,
    /// CHECK: the claimer's WearLog (audit R-21), created on first use and
    /// checked against its seeds in `open_wear_log`.
    #[account(mut)]
    pub wear_log: UncheckedAccount<'info>,
    /// The WearLog of whoever held this asset's wear-right before, when there
    /// was one. Its address and its entry are checked in the body. Absent (the
    /// program id) for an asset nobody has a right from yet.
    #[account(mut)]
    pub previous_log: Option<Account<'info, WearLog>>,
    /// That previous holder's UnlockState, which loses the index. Its address
    /// is checked in the body against the wallet the log names.
    #[account(mut)]
    pub previous_unlocks: Option<Account<'info, UnlockState>>,
}

/// Moving minting to a new tree, and leaving a marker for the old one.
#[derive(Accounts)]
pub struct SetMintTree<'info> {
    #[account(
        mut,
        seeds = [MINT_CONFIG_SEED],
        bump,
        constraint = mint_config.admin == admin.key() @ CollectiblesError::NotPackAdmin,
    )]
    pub mint_config: Account<'info, MintConfig>,
    /// Signs, and pays for the marker.
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: the AcceptedTree marker for the tree being LEFT, i.e. the one
    /// still in the config while constraints run. Created in the body when
    /// it does not exist yet; its address is fixed by these seeds.
    #[account(mut, seeds = [ACCEPTED_TREE_SEED, mint_config.merkle_tree.as_ref()], bump)]
    pub retired_tree_marker: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitPackConfig<'info> {
    /// The upgrade authority, which pays and authorises. NOT the admin: that
    /// is an argument, so the config can be handed to a different key.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: this program, used only to reach its ProgramData.
    #[account(constraint = program.programdata_address()? == Some(program_data.key())
        @ CollectiblesError::NotPackAdmin)]
    pub program: Program<'info, crate::program::SolCityCollectibles>,
    /// The deployer's claim, checked rather than taken on trust.
    #[account(constraint = program_data.upgrade_authority_address == Some(payer.key())
        @ CollectiblesError::NotPackAdmin)]
    pub program_data: Account<'info, ProgramData>,
    #[account(
        init,
        payer = payer,
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
/// Opening a sealed pack. The proof rides in `remaining_accounts`.
#[derive(Accounts)]
pub struct OpenPackFromAsset<'info> {
    #[account(mut)]
    pub opener: Signer<'info>,
    /// The OPENER's unlock account, not the buyer's. Gifting works because
    /// the items land here.
    #[account(
        mut,
        seeds = [UNLOCKS_SEED, opener.key().as_ref()],
        bump,
        constraint = unlock_state.authority == opener.key() @ CollectiblesError::WrongUnlockOwner,
    )]
    pub unlock_state: Account<'info, UnlockState>,
    #[account(seeds = [PACK_CONFIG_SEED], bump, constraint = !config.paused @ CollectiblesError::Paused)]
    pub config: Account<'info, PackConfig>,
    /// The season's table, checked against the pack's season in the body.
    pub drops: Account<'info, SeasonDrops>,
    #[account(seeds = [MINT_CONFIG_SEED], bump, constraint = !mint_config.paused @ CollectiblesError::Paused)]
    pub mint_config: Account<'info, MintConfig>,
    /// CHECK: Bubblegum's tree config, which Bubblegum checks against the tree.
    #[account(mut)]
    pub tree_config: UncheckedAccount<'info>,
    /// CHECK: the tree, checked against mint_config in the body.
    #[account(mut)]
    pub merkle_tree: UncheckedAccount<'info>,
    /// CHECK: SPL Noop, passed through to Bubblegum.
    pub log_wrapper: UncheckedAccount<'info>,
    /// CHECK: SPL Account Compression, passed through to Bubblegum.
    pub compression_program: UncheckedAccount<'info>,
    /// CHECK: Bubblegum itself, the burn CPI target. PINNED: the burn is
    /// what proves the caller held the pack, and a burn in a program of the
    /// caller's choosing proves nothing.
    #[account(address = BUBBLEGUM_ID)]
    pub bubblegum_program: UncheckedAccount<'info>,
    /// CHECK: the VRF oracle queue, pinned. An unpinned queue is a draw
    /// answered by a caller-chosen oracle.
    #[account(mut, address = VRF_DEFAULT_QUEUE)]
    pub oracle_queue: AccountInfo<'info>,
    /// CHECK: our own VRF identity PDA, which signs the callback.
    #[account(mut, seeds = [VRF_IDENTITY_SEED], bump)]
    pub program_identity: UncheckedAccount<'info>,
    /// CHECK: the VRF program. The CPI already names the constant; this pin
    /// makes the refusal happen before any work rather than inside it.
    #[account(address = VRF_PROGRAM_ID)]
    pub vrf_program: UncheckedAccount<'info>,
    /// CHECK: the slot hashes sysvar the VRF reads, pinned to the sysvar.
    #[account(address = anchor_lang::solana_program::sysvar::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// The marker for `merkle_tree`, when the pack lives in a tree this
    /// program used to mint into. Absent (the program id in its slot) for the
    /// current tree. Seeded on the tree, so it vouches for that tree only.
    #[account(seeds = [ACCEPTED_TREE_SEED, merkle_tree.key().as_ref()], bump)]
    pub accepted_tree: Option<Account<'info, AcceptedTree>>,
    /// CHECK: the OPENER's MintQueue, created on first use and checked
    /// against its seeds in `open_mint_queue`.
    #[account(mut)]
    pub mint_queue: UncheckedAccount<'info>,
}

/// Buying a pack sealed. No UnlockState and no VRF: nothing is drawn here.
#[derive(Accounts)]
pub struct MintPack<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [PACK_CONFIG_SEED], bump, constraint = !config.paused @ CollectiblesError::Paused)]
    pub config: Account<'info, PackConfig>,
    /// The season's table. Read only for its total: a pack cannot be sold
    /// against a season that could not fill it. Its address is checked in the
    /// body, because the season comes off the config at runtime.
    pub drops: Account<'info, SeasonDrops>,
    #[account(seeds = [MINT_CONFIG_SEED], bump, constraint = !mint_config.paused @ CollectiblesError::Paused)]
    pub mint_config: Account<'info, MintConfig>,
    /// CHECK: the PDA that is the tree delegate and collection authority.
    #[account(seeds = [MINT_AUTHORITY_SEED], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    /// CHECK: the buyer's token account in the config's currency. Pinned by
    /// the transfer itself, which refuses a mint the destination does not share.
    #[account(mut)]
    pub buyer_token_account: AccountInfo<'info>,
    /// CHECK: checked against config.treasury_token_account in the body.
    #[account(mut)]
    pub treasury_token_account: AccountInfo<'info>,
    /// CHECK: SPL Token, pinned by address in the CPI.
    pub token_program: UncheckedAccount<'info>,
    /// CHECK: Bubblegum's tree config, checked by Bubblegum against the tree.
    #[account(mut)]
    pub tree_config: UncheckedAccount<'info>,
    /// CHECK: the tree, checked against mint_config in the body.
    #[account(mut)]
    pub merkle_tree: UncheckedAccount<'info>,
    /// CHECK: the collection, checked against mint_config in the body.
    pub collection_mint: UncheckedAccount<'info>,
    /// CHECK: Token Metadata's account for the collection; Bubblegum checks it.
    #[account(mut)]
    pub collection_metadata: UncheckedAccount<'info>,
    /// CHECK: the collection's master edition; Bubblegum checks it.
    pub collection_edition: UncheckedAccount<'info>,
    /// CHECK: Bubblegum's own signing PDA.
    pub bubblegum_signer: UncheckedAccount<'info>,
    /// CHECK: SPL Noop, passed through to Bubblegum.
    pub log_wrapper: UncheckedAccount<'info>,
    /// CHECK: SPL Account Compression, passed through to Bubblegum.
    pub compression_program: UncheckedAccount<'info>,
    /// CHECK: Token Metadata, passed through to Bubblegum.
    pub token_metadata_program: UncheckedAccount<'info>,
    /// CHECK: Bubblegum itself, the CPI target. Pinned, same reason as the
    /// cosmetic mint: an unpinned target is a pack asset minted elsewhere.
    #[account(address = BUBBLEGUM_ID)]
    pub bubblegum_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminGrantEventItem<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        seeds = [PACK_CONFIG_SEED],
        bump,
        constraint = config.admin == admin.key() @ CollectiblesError::NotPackAdmin,
        constraint = !config.paused @ CollectiblesError::Paused,
    )]
    pub config: Account<'info, PackConfig>,
    #[account(
        mut,
        seeds = [UNLOCKS_SEED, unlock_state.authority.as_ref()],
        bump,
    )]
    pub unlock_state: Account<'info, UnlockState>,
    pub system_program: Program<'info, System>,
    /// CHECK: the receiving wallet's MintQueue, checked against the
    /// UnlockState authority's seeds in `open_mint_queue`.
    #[account(mut)]
    pub mint_queue: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(id: u16)]
pub struct InitEventDrop<'info> {
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
        space = 8 + EventDrop::INIT_SPACE,
        seeds = [EVENT_DROP_SEED, &id.to_le_bytes()],
        bump,
    )]
    pub event_drop: Account<'info, EventDrop>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(id: u16)]
pub struct SetEventRoot<'info> {
    pub admin: Signer<'info>,
    #[account(
        seeds = [PACK_CONFIG_SEED],
        bump,
        constraint = config.admin == admin.key() @ CollectiblesError::NotPackAdmin,
    )]
    pub config: Account<'info, PackConfig>,
    #[account(mut, seeds = [EVENT_DROP_SEED, &id.to_le_bytes()], bump)]
    pub event_drop: Account<'info, EventDrop>,
}

#[derive(Accounts)]
#[instruction(id: u16)]
pub struct ClaimEventItem<'info> {
    #[account(mut)]
    pub claimer: Signer<'info>,
    // Must already exist, as for a pack: the client sends init_unlock_state
    // in the same transaction when it does not.
    #[account(
        mut,
        seeds = [UNLOCKS_SEED, claimer.key().as_ref()],
        bump,
        constraint = unlock_state.authority == claimer.key() @ CollectiblesError::WrongUnlockOwner,
    )]
    pub unlock_state: Account<'info, UnlockState>,
    #[account(seeds = [EVENT_DROP_SEED, &id.to_le_bytes()], bump)]
    pub event_drop: Account<'info, EventDrop>,
    #[account(seeds = [PACK_CONFIG_SEED], bump, constraint = !config.paused @ CollectiblesError::Paused)]
    pub config: Account<'info, PackConfig>,
    pub system_program: Program<'info, System>,
    /// CHECK: the claimer's MintQueue, checked against its seeds in
    /// `open_mint_queue`.
    #[account(mut)]
    pub mint_queue: UncheckedAccount<'info>,
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

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(mut, seeds = [PACK_CONFIG_SEED], bump)]
    pub config: Account<'info, PackConfig>,
    #[account(mut, seeds = [MINT_CONFIG_SEED], bump)]
    pub mint_config: Option<Account<'info, MintConfig>>,
    /// Checked in the body: the admin, or the pauser when pausing.
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct MigratePackConfig<'info> {
    /// CHECK: loaded raw because Anchor cannot deserialize the old layout.
    /// Address and owner pinned here; discriminator and admin in the body.
    #[account(mut, seeds = [PACK_CONFIG_SEED], bump, owner = crate::ID)]
    pub config: UncheckedAccount<'info>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Who may claim one event cosmetic, as a single Merkle root.
///
/// The list itself is published by the site, as leaf hashes, and each winner
/// proves their own place in it. So this account is the same size for ten
/// winners or ten thousand.
#[account]
#[derive(InitSpace)]
pub struct EventDrop {
    pub id: u16,
    /// Catalog index of the cosmetic, in the event block.
    pub index: u16,
    pub root: [u8; 32],
}

/// A winner's leaf. The event id is in it, so a proof for one event is no
/// proof for another; the prefix keeps a leaf from ever passing for a node.
pub fn event_leaf(id: u16, wallet: &Pubkey) -> [u8; 32] {
    hashv(&[b"solcity:event-leaf", &id.to_le_bytes(), wallet.as_ref()]).to_bytes()
}

/// Two children, in sorted order, so a proof needs no left/right flags.
fn event_node(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
    hashv(&[b"solcity:event-node", lo, hi]).to_bytes()
}

pub fn on_event_list(root: &[u8; 32], leaf: [u8; 32], proof: &[[u8; 32]]) -> bool {
    proof.iter().fold(leaf, |acc, sibling| event_node(&acc, sibling)) == *root
}

#[cfg(test)]
mod event_drops {
    use super::*;

    fn hex32(s: &str) -> [u8; 32] {
        let mut out = [0u8; 32];
        for i in 0..32 {
            out[i] = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap();
        }
        out
    }

    // Three wallets [1;32], [2;32], [3;32] in event 1, built by
    // apps/web/src/game/solana/eventDrops.ts. The client test pins the same
    // root, so the two sides cannot drift apart.
    const ROOT: &str = "8849ed3ecd2f15719c8c3a44a51fb7732e287949e67efb8fa1e6e173c293d3f0";
    const PROOF_2: [&str; 2] = [
        "76538fc7df6737b28e382e8174d44fc86b985d016950db7eb9a55e2a6f8d24d6",
        "81be021b6a1b1af81c7a7da23ec7b41c8f71e80fdd02edffb8ff55f94105f658",
    ];

    #[test]
    fn a_winner_on_the_client_list_passes() {
        let proof: Vec<[u8; 32]> = PROOF_2.iter().map(|p| hex32(p)).collect();
        let leaf = event_leaf(1, &Pubkey::new_from_array([2; 32]));
        assert!(on_event_list(&hex32(ROOT), leaf, &proof));
    }

    #[test]
    fn another_wallet_or_event_does_not() {
        let proof: Vec<[u8; 32]> = PROOF_2.iter().map(|p| hex32(p)).collect();
        let stranger = event_leaf(1, &Pubkey::new_from_array([9; 32]));
        assert!(!on_event_list(&hex32(ROOT), stranger, &proof));
        let other_event = event_leaf(2, &Pubkey::new_from_array([2; 32]));
        assert!(!on_event_list(&hex32(ROOT), other_event, &proof));
    }

    #[test]
    fn the_drop_account_is_small_and_fixed() {
        assert_eq!(EventDrop::INIT_SPACE, 2 + 2 + 32);
    }
}

#[cfg(test)]
mod pause_layout {
    use super::*;

    /// The devnet config was written at 275 bytes; `migrate_pack_config`
    /// accepts exactly that size and grows it by the two pause fields.
    #[test]
    fn the_migration_grows_the_old_size_by_the_pause_fields() {
        assert_eq!(8 + PackConfig::INIT_SPACE, 275 + 1 + 32);
    }

    /// The migration writes the pauser into the last 32 bytes and leaves
    /// `paused` as the zero byte before them. That only holds while they are
    /// the last two fields.
    #[test]
    fn the_pause_fields_are_the_last_bytes() {
        let pauser = Pubkey::new_unique();
        let cfg = PackConfig {
            admin: Pubkey::default(),
            currency_mint: Pubkey::default(),
            treasury_token_account: Pubkey::default(),
            current_season: 0,
            packs: [PackDef::default(); MAX_PACKS],
            pack_count: 0,
            paused: true,
            pauser,
        };
        let bytes = cfg.try_to_vec().unwrap();
        assert_eq!(bytes.len(), PackConfig::INIT_SPACE);
        assert_eq!(&bytes[bytes.len() - 32..], pauser.as_ref());
        assert_eq!(bytes[bytes.len() - 33], 1);
    }
}

#[cfg(test)]
mod mint_queue {
    //! The owner's rules for packs (2026-10-31, restated 2026-11-10): every
    //! roll is independent, repeats are normal, and everything revealed is
    //! minted, repeats included. These pin the bookkeeping that delivers it.
    use super::*;

    const A: u16 = ENFORCED_FROM + 10;
    const B: u16 = ENFORCED_FROM + 11;

    fn unlocks(owned: &[u16], minted: &[u16]) -> UnlockState {
        UnlockState {
            authority: Pubkey::new_unique(),
            owned: owned.to_vec(),
            minted: minted.to_vec(),
            ..Default::default()
        }
    }

    fn queue(owed: &[u16]) -> MintQueue {
        MintQueue { wallet: Pubkey::new_unique(), owed: owed.to_vec() }
    }

    #[test]
    fn a_pack_with_repeats_queues_every_copy_and_mints_all_of_them() {
        let mut u = unlocks(&[], &[]);
        let mut q = queue(&[]);
        record_picks(&mut u, &mut q, &[A, A, B, A, B]);
        // Wearable once each, owed five times.
        assert_eq!(u.owned, vec![A, B]);
        assert_eq!(q.owed, vec![A, A, B, A, B]);
        // One mint_pending call takes the whole pack.
        assert_eq!(q.take_front(MINT_PENDING_CAP), vec![A, A, B, A, B]);
        assert!(q.owed.is_empty());
    }

    #[test]
    fn an_item_minted_and_sold_is_a_new_copy_when_drawn_again() {
        // Owned and minted before: the old rule minted nothing for it.
        let mut u = unlocks(&[A], &[A]);
        let mut q = queue(&[]);
        record_picks(&mut u, &mut q, &[A]);
        assert_eq!(q.owed, vec![A]);
    }

    #[test]
    fn mint_now_takes_one_copy_and_refuses_without_one() {
        let mut q = queue(&[A, B, A]);
        assert!(q.take_one(A));
        assert_eq!(q.owed, vec![B, A]);
        assert!(q.take_one(A));
        assert!(!q.take_one(A));
        assert_eq!(q.owed, vec![B]);
    }

    #[test]
    fn mint_pending_takes_the_oldest_first_and_at_most_its_limit() {
        let mut q = queue(&[A, B, A, B, A, B, A, B, A, B]);
        assert_eq!(q.take_front(MINT_PENDING_CAP).len(), MINT_PENDING_CAP);
        assert_eq!(q.owed, vec![A, B]);
        assert_eq!(q.take_front(MINT_PENDING_CAP), vec![A, B]);
        assert!(q.take_front(MINT_PENDING_CAP).is_empty());
    }

    #[test]
    fn the_legacy_seed_is_exactly_what_the_old_rule_still_owed() {
        let quest = FREE_ITEM_COUNT + 1; // quest block, never an asset
        let u = unlocks(&[quest, A, B], &[B]);
        assert_eq!(MintQueue::legacy_owed(&u), vec![A]);
    }

    #[test]
    fn the_legacy_seed_is_never_cut() {
        let owned: Vec<u16> = (A..A + 1000).collect();
        let u = unlocks(&owned, &[]);
        assert_eq!(MintQueue::legacy_owed(&u).len(), 1000);
    }

    #[test]
    fn the_ceiling_counts_copies_waiting_not_items_owned() {
        let q = queue(&vec![A; MAX_OWED_COPIES - 5]);
        assert!(q.has_room_for(5));
        assert!(!q.has_room_for(6));
        // Owning any number of items, or of copies of one, is no limit.
        let mut u = unlocks(&[], &[]);
        let mut big = queue(&[]);
        for _ in 0..4 {
            record_picks(&mut u, &mut big, &[A; MAX_BUNDLE_ITEMS]);
            big.take_front(MAX_BUNDLE_ITEMS);
        }
        assert!(big.owed.is_empty());
        assert!(big.has_room_for(MAX_BUNDLE_ITEMS));
    }

    #[test]
    fn the_largest_bundle_fits_an_empty_queue() {
        assert!(queue(&[]).has_room_for(MAX_BUNDLE_ITEMS));
    }

    #[test]
    fn the_account_size_matches_what_is_written() {
        for n in [0usize, 1, 5, 50] {
            let bytes = queue(&vec![A; n]).try_to_vec().unwrap();
            assert_eq!(8 + bytes.len(), MintQueue::size_for(n));
        }
    }
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
