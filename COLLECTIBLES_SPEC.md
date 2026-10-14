# Sol City — Collectibles as assets

How wardrobe items become tradable, and what that costs. Decisions the owner
took on 2026-10-15 are marked **decided**; everything else is open on purpose.

This is a design note. Nothing here is implemented, and nothing here belongs in
the redeploy that is already queued in `REDEPLOY_CHECKLIST.md`.

Related: `BOOSTER_SPEC.md` (the pack draw and what the program still owes it)
and `project_collections_seasons` (seasons and rarities).

## The shape: two layers

**Decided.** An asset answers *who owns this*. A bit answers *may this wallet
wear it*.

| | Lives on | Written by | Read by |
|---|---|---|---|
| Ownership | base layer, one asset per item | mint, trade, burn | marketplaces, `sync_unlocks` |
| Permission | `UnlockState` bitset, 32 bytes per wallet | `sync_unlocks`, quest claims, pack opens | `update_look_session`, on the rollup |

Why not read ownership directly when a player dresses: wardrobe writes are
signed by a session key on the ephemeral rollup, with no popup and no fee. The
assets live on the base layer, which the rollup cannot see. Checking an asset to
put on a hat drags that action back to base, and back to a signature prompt.
The split exists to avoid paying that on every outfit change, not to save rent.

### The cost of the split: a stale bit

The bitset is a cache, and a cache goes stale. Sell a hat and the bit stays lit
until something re-syncs, so the seller keeps wearing what they sold.

Three ways out, cheapest first:

1. Re-sync when the wardrobe opens. Covers the honest case, not a determined one.
2. Make `sync_unlocks` **permissionless**: anyone may refresh any wallet's bits,
   since it only reads ownership and writes what ownership says. A buyer can
   then clear the seller's bit themselves.
3. Verify ownership at equip time. Correct, and it costs the no-popup wardrobe.

(2) plus (1) is the recommendation. (3) is the honest fallback if cosmetic lag
turns out to matter more than it looks.

## Tradable packs

**Decided.** A pack is itself an asset, listable sealed, and the player chooses
on receipt whether to open it or keep it.

That is not a UI change. It splits the one instruction the program has today:

| Today (written, not deployed) | With sealed packs |
|---|---|
| `open_booster`: pay, then request VRF, then grant | `buy_pack`: pay, mint a sealed pack asset |
| | `open_pack`: burn the asset, request VRF, grant |

Two things follow, and the first is the whole reason the split is required:

- **The draw must happen at open, never at purchase.** If contents are decided
  when the pack is minted, anyone can read them before selling, open the good
  ones and list the rest. A sealed pack has to be genuinely sealed.
- **Burning returns the rent.** The pack's own rent comes back to whoever opens
  it, so a sealed pack costs the buyer a deposit, not a fee.

Open: whether a pack that is opened by its buyer ever becomes an asset at all,
or whether "buy and open now" skips the mint entirely and only "buy sealed"
mints. The second is cheaper and makes the common path free.

## Compressed or not: the number and the catch

Measured against live rent, not estimated:

| | Per item | Against Core |
|---|---|---|
| Metaplex Core, with attributes and royalties | 0.002454 SOL | baseline |
| cNFT, tree of 16,384, no canopy | 0.0000099 SOL | 250x cheaper |
| cNFT, tree of 16,384, canopy 10 | 0.0000302 SOL | 80x cheaper |
| cNFT, tree of 131,072, no canopy | 0.0000015 SOL | 1,600x cheaper |
| cNFT, tree of 1,048,576, no canopy | 0.00000022 SOL | 11,000x cheaper |

The mentors are right about cost, by orders of magnitude. The catch is not cost,
it is what `sync_unlocks` has to do.

A Core asset is an account: the program reads one account and checks two fields,
owner and collection. A compressed asset is a **leaf hash in a merkle tree**.
Nothing on chain holds "wallet X owns item Y". To prove it inside an
instruction you pass a merkle proof, and:

- the proof is `depth - canopy` hashes of 32 bytes, so it only fits comfortably
  with a canopy, which is what the canopy row above is for. At depth 14 with
  canopy 10 the proof is 4 nodes;
- the client has to **fetch that proof from a DAS indexer** before it can build
  the transaction. Ownership reads stop being "ask the chain" and become "ask
  Helius, and trust that it is current";
- a canopy is paid once per tree, so the real comparison for a sized collection
  is the canopy row, not the cheapest one.

So the trade is: cNFT costs almost nothing to mint and makes the in-game
permission sync depend on an indexer and on proof plumbing. Core costs about
$0.26 an item and makes it a single account read.

**Open decision.** A reasonable split, if one is wanted: packs and
mass-distributed cosmetics as cNFTs, where volume is the point and the sync can
be batched; anything rare or ceremonial as Core, where the per-item cost is
noise against its value. This doubles the code paths, which is its own cost.

## Who pays, and when

**Decided.** Earning never costs the player anything: a quest or an NPC lights
a bit, free, on the rollup, as it already does today. Minting the asset is a
separate action the player chooses when they want to trade, and they pay its
rent.

So: a player who only wants to wear things never pays. A player who wants to
sell pays to be able to sell.

The same logic applies to packs, and it is worth deciding deliberately: a pack
that mints five assets on open burns 41% of a 0.03 SOL pack in rent at Core
prices, for items most players will never list. Minting on demand keeps the
margin and spends only where someone actually wants to trade.

## Items given by NPCs, and conditions per item

The gap today is not the asset, it is the authorization.

`claim_free_outfit` currently checks only that the index is inside the
quest-reward block. The condition itself is checked **in the client**, which its
own comment says. So any wallet can claim all sixteen quest items by calling the
instruction directly. It is not deployed yet, so it can be fixed before it ever
ships.

Three ways to gate it, and the middle one is the recommendation:

| | How | Cost |
|---|---|---|
| **Table in the program** | An append-only list of claimable items, each with a condition and its parameter | Every new KIND of condition is a redeploy |
| **Table of items, fixed kinds** | Same list, but conditions come from a small closed set the program understands (a quest id completed, a token held, an achievement level) | Adding an ITEM is data; adding a KIND is code |
| **Signed voucher** | The game signs "wallet X may claim item Y"; the program verifies the signature | No redeploy ever, and one key that can mint anything if it leaks |

The voucher is the most flexible and it is not free: it moves the trust into an
off-chain key, which is exactly the kind of finding a mainnet-readiness review
names. Adding an item should be data. Adding a new kind of condition should be
code, and should be read.

Append-only is not a style choice here: `BOOSTER_SPEC` already fixed the pool
order for the same reason. An index that moves invalidates everything already
granted against it.

## Open decisions, collected

1. cNFT or Core, or both, per the trade above.
2. Whether "buy and open now" mints a pack asset at all.
3. Which gate `claim_free_outfit` gets, and whether that lands in the queued
   redeploy or a later one.
4. Whether `sync_unlocks` is permissionless.
5. Royalties: a percentage, and who receives it.
6. Whether a season closing freezes its collection, and what that means for
   items already in wallets.
