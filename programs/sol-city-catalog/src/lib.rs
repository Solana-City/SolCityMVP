//! The vocabulary the Sol City programs share, and nothing else.
//!
//! ── Why this crate is not a program ─────────────────────────────────────
//!
//! It exists so that no PROGRAM ever depends on another program.
//!
//! Before this, `sol-city` took `sol-city-collectibles` as a library to get
//! the `UnlockState` layout, with `no-entrypoint` so the collectibles
//! entrypoint would not be linked into the city. Both correct on their own.
//! Together they were not: cargo unifies features across one invocation, so a
//! workspace-wide `cargo build-sbf` compiled the collectibles cdylib with
//! `no-entrypoint` as well and emitted a 4 KB object with no entrypoint. It
//! exited 0. A program that was not a program, and nothing said so.
//!
//! A crate with no entrypoint of its own has none to leak. Every program
//! depends on this one and none depends on another, so the hazard is not
//! caught by a check, it is unreachable. The graph is a star, which also
//! means a cycle cannot appear the day collectibles needs something the city
//! has.
//!
//! Nothing here costs a player anything: this is all compile time, it links
//! away, and the bytecode that runs is the same.
//!
//! ── What belongs here ───────────────────────────────────────────────────
//!
//! Only what more than one program must agree on, which today is the catalog
//! block boundaries and the `UnlockState` account. Anything one program alone
//! understands stays in that program. A shared crate that collects whatever
//! is convenient becomes a second place to look for everything.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey;

/// The program that OWNS every account defined here.
///
/// Spelled out rather than taken from `crate::ID`, because this crate has no
/// id: it is not a program. `sol-city-collectibles` declares the same key and
/// a test there fails if the two ever drift, so this is one fact in two
/// places with a guard, instead of one fact in two places with a comment.
pub const COLLECTIBLES_PROGRAM_ID: Pubkey =
    pubkey!("EptRxVBysFzJEz52r58c2yCkpDGvF55aBPj1eCkWaphz");

// ── The catalog, cut into blocks ────────────────────────────────────────────
//
// A cosmetic is addressed by one global index, and which BLOCK that index
// falls in is what decides how it may be acquired and whether anything is
// enforced about it. Both programs have to agree on the boundaries: the city
// enforces above ENFORCED_FROM in `update_look_session`, and collectibles
// grants below it in `admin_grant_event_item`.

/// Indices `[0, FREE_ITEM_COUNT)` are free to everyone and never checked.
pub const FREE_ITEM_COUNT: u16 = 512;

/// Slots reserved for quest and NPC rewards, starting at FREE_ITEM_COUNT.
///
/// Reserved rather than used: nothing on chain grants a quest bit today, so
/// the city skips this whole block rather than making ten earned outfits
/// unwearable. The space stays booked so the booster indices above it do not
/// move when a grant arrives.
pub const QUEST_FREE_SLOTS: u16 = 1024;

/// Where enforcement starts, which is where the booster block starts.
pub const ENFORCED_FROM: u16 = FREE_ITEM_COUNT + QUEST_FREE_SLOTS;

/// Per-wallet unlock store, seeds ["unlocks", wallet].
pub const UNLOCKS_SEED: &[u8] = b"unlocks";

/// Common, uncommon, rare, legendary.
pub const RARITY_COUNT: usize = 4;

// ── UnlockState ─────────────────────────────────────────────────────────────

/// What a wallet owns, and what it has already turned into an asset.
///
/// Owned by the collectibles program and read by the city, which copies it
/// into the player's wardrobe snapshot and never writes it.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct UnlockState {
    /// Wallet that owns these unlocks.
    pub authority: Pubkey,
    /// Catalog indices this wallet may wear, sorted ascending.
    ///
    /// A LIST of what is owned, not a bitset over what exists. The difference
    /// is the whole economics of the account: a bitset costs
    /// `catalog_size / 8` bytes whether a player owns one cosmetic or all of
    /// them, so growing the catalog taxed every wallet up front. A list costs
    /// two bytes per item actually owned, and the catalog size appears here
    /// nowhere at all.
    ///
    /// That is how a wallet holding ten thousand cNFTs costs nothing extra:
    /// you pay as you acquire. `open_booster` reallocs room for the pack it is
    /// about to grant and the buyer funds those bytes, so the cost follows the
    /// purchase that caused it.
    ///
    /// Sorted because `update_look_session` binary-searches it on the rollup,
    /// where compute is the scarce thing.
    pub owned: Vec<u16>,
    /// Indices already turned into a tradable asset by this wallet, sorted.
    ///
    /// Separate from `owned` because they answer different questions: `owned`
    /// is permission and survives a sale, this is "an asset for this index has
    /// already been minted to this wallet once". Any future mint path must
    /// refuse an index already here, or a player could mint, sell, and mint
    /// again from the same unlock.
    ///
    /// Usually empty: minting is a choice, and most wallets never make it.
    pub minted: Vec<u16>,
    /// A pack has been paid for and is awaiting the VRF callback.
    pub pending: bool,
    /// The paid-for pack, frozen at the moment of payment.
    pub draw: PendingDraw,
}

/// What the callback needs to resolve a pack, copied out of `PackConfig` when
/// the pack is paid for.
///
/// A snapshot rather than a pack id the callback looks up, and the reason is
/// not space: **the callback must not be able to fail.** The money is already
/// gone by then. A callback that read the live config could arrive after the
/// season was retired or the pack disabled, find nothing, and return an error
/// against a wallet that had paid.
///
/// It also narrows the admin key, which is the stated cost of putting the
/// table in an account: prices and odds can change, but not for a pack
/// somebody has already bought. The odds posted when they paid are the odds
/// they get.
///
/// Twelve bytes per wallet, once. The odds are copied; the index lists are
/// not, because they live in an account that can no longer change.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, Default)]
pub struct PendingDraw {
    pub pack_id: u8,
    pub size: u8,
    /// Basis points per rarity, in RARITY_ORDER (common first).
    pub weights: [u16; RARITY_COUNT],
    /// Which season's drop table resolves this pack. Two bytes rather than the
    /// table's 32-byte address: the callback re-derives the PDA and compares,
    /// which costs one find_program_address per pack instead of thirty bytes
    /// on every wallet forever.
    pub season: u16,
}

impl UnlockState {
    /// Bytes for an account holding `owned_cap` owned and `minted_cap` minted
    /// entries. 8 discriminator + 32 authority + two length-prefixed vectors
    /// + 1 pending + the pending draw.
    pub fn size_for(owned_cap: usize, minted_cap: usize) -> usize {
        8 + 32 + (4 + owned_cap * 2) + (4 + minted_cap * 2) + 1 + PendingDraw::INIT_SPACE
    }

    /// Insert keeping the list sorted, ignoring a value already present.
    /// Returns true when the list actually grew.
    pub fn insert_owned(&mut self, index: u16) -> bool {
        match self.owned.binary_search(&index) {
            Ok(_) => false,
            Err(at) => { self.owned.insert(at, index); true }
        }
    }

    /// Whether this wallet may wear a catalog index.
    pub fn owns(&self, index: u16) -> bool {
        self.owned.binary_search(&index).is_ok()
    }
}

// ── The four impls `#[account]` would have written ──────────────────────────
//
// It cannot be used here. It expands `Owner` to `crate::ID`, and this crate
// has no id because it is not a program. Writing them out is what lets ONE
// definition of the account serve both programs, so they are spelled out
// once here rather than duplicated as two structs that must stay identical.

impl anchor_lang::Discriminator for UnlockState {
    /// `sha256("account:UnlockState")[..8]`, which is what Anchor derives from
    /// the TYPE NAME. Written as bytes because it cannot be computed in a
    /// const, and pinned by a test so renaming the struct cannot silently
    /// orphan every account already written under the old discriminator.
    const DISCRIMINATOR: [u8; 8] = [143, 75, 189, 100, 96, 143, 168, 33];
}

impl anchor_lang::Owner for UnlockState {
    fn owner() -> Pubkey {
        COLLECTIBLES_PROGRAM_ID
    }
}

impl anchor_lang::AccountSerialize for UnlockState {
    fn try_serialize<W: std::io::Write>(&self, writer: &mut W) -> Result<()> {
        writer
            .write_all(&<Self as anchor_lang::Discriminator>::DISCRIMINATOR)
            .map_err(|_| error!(ErrorCode::AccountDidNotSerialize))?;
        AnchorSerialize::serialize(self, writer)
            .map_err(|_| error!(ErrorCode::AccountDidNotSerialize))?;
        Ok(())
    }
}

impl anchor_lang::AccountDeserialize for UnlockState {
    fn try_deserialize(buf: &mut &[u8]) -> Result<Self> {
        let want = <Self as anchor_lang::Discriminator>::DISCRIMINATOR;
        if buf.len() < want.len() {
            return Err(error!(ErrorCode::AccountDiscriminatorNotFound));
        }
        if want != buf[..8] {
            return Err(error!(ErrorCode::AccountDiscriminatorMismatch));
        }
        Self::try_deserialize_unchecked(buf)
    }

    fn try_deserialize_unchecked(buf: &mut &[u8]) -> Result<Self> {
        let mut data: &[u8] = &buf[8..];
        AnchorDeserialize::deserialize(&mut data)
            .map_err(|_| error!(ErrorCode::AccountDidNotDeserialize))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The discriminator is a constant here and derived from the name
    /// everywhere else. If they ever disagree, every account already written
    /// becomes unreadable, so this recomputes it rather than trusting it.
    #[test]
    fn discriminator_matches_the_type_name() {
        use anchor_lang::solana_program::hash::hash;
        let want = hash(b"account:UnlockState").to_bytes();
        assert_eq!(
            <UnlockState as anchor_lang::Discriminator>::DISCRIMINATOR,
            want[..8],
        );
    }

    #[test]
    fn the_blocks_do_not_overlap() {
        assert_eq!(ENFORCED_FROM, FREE_ITEM_COUNT + QUEST_FREE_SLOTS);
        assert!(FREE_ITEM_COUNT < ENFORCED_FROM);
    }
}
