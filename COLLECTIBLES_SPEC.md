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

## Compressed, decided

**Decided 2026-10-15: compressed.** The numbers below are why, and the rest of
this section is what that costs, which is real and is not money.

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

### What choosing compressed commits us to

- **A DAS indexer in the critical path.** Helius answers "what does this wallet
  own" and supplies the proof. It lags a few seconds behind a transfer, so a
  buyer who syncs immediately may be told they own nothing.
- **A canopy, not an option.** Without one the proof is 14 nodes and does not
  fit comfortably. Canopy 10 makes it 4, and takes the tree from 0.16 to 0.49
  SOL per 16,384 assets. Still 80x under Core.
- **Fixed capacity per tree.** Depth 14 is 16,384 assets, forever. Either size
  it for the whole life of the collection or plan several trees, and then the
  sync has to know which tree an item came from.
- **The heaviest code in the design lands in the program**, as a CPI into
  account compression. That is the part a mainnet-readiness review reads
  closest.
- **Soulbound needs checking.** Core has a plugin for it. Whether Bubblegum
  offers the same has to be confirmed before anything is promised, and it
  matters for the open question below about quest items.

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

## Items given by NPCs: the provisional measure

**Taken 2026-10-15.** `claim_free_outfit` is out of the queued redeploy. Not
gated, not co-signed: removed.

The reasoning, in order:

1. The hole was entitlement, not duplication. Receiving the same item twice was
   already impossible; claiming sixteen items nobody earned was not.
2. A co-signer closes it and needs a server to hold the key. There is no server
   here by design, and the key it would hold was the program's upgrade
   authority.
3. No on-chain gate replaces it. The facts a quest rests on are written by
   session-signed instructions the client authors, so the program cannot tell a
   real claim from an invented one.
4. Nothing called the instruction. Quest rewards are local unlocks today and
   stay exactly as they were.

So the cost of waiting is zero and the cost of shipping it is a finding in a
review. `QUEST_FREE_SLOTS` stays reserved so the bit layout does not move when
it comes back, and `minted` stays so whatever grants it later cannot be minted
twice.

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

## Open decisions

Split by when they have to be answered. Nothing here blocks the hackathon:
none of this path is wired to a client today.

### Blocks the first mint

**1. Tree size.** Depth 14 holds 16,384 assets forever, depth 17 holds 131,072.
The tree is paid once and cannot grow. Sizing it for one season is cheap and
means several trees later, each of which the sync has to recognise.

**2. Canopy depth.** Sets how much of each proof the chain already holds, so it
sets how big a sync transaction is. Canopy 10 at depth 14 means 4 proof nodes
and 0.49 SOL for the tree.

**3. Who pays the mint.** The decision taken was: the player, when they choose
to turn an unlock into an asset. Worth confirming against the alternative,
which is the treasury paying so items arrive already tradable, at 0.0000302 SOL
each with the canopy above.

**4. Whether "buy and open now" mints a pack asset at all.** Minting a sealed
pack only to burn it seconds later is rent round-tripped for nothing. Skipping
it makes the common path cheaper and means only "buy sealed" mints.

### Blocks quest and NPC items becoming assets

**5. How entitlement is proved without a server.** The open question, and the
reason `claim_free_outfit` is out of the redeploy. Three answers, none free:

- **Soulbound for earned items.** Faking a quest then yields something
  unsellable, so the exploit stops paying. Costs the "everything is tradable"
  goal, and needs Bubblegum to support it.
- **Only trustless conditions.** Holding a token, holding an NFT, elapsed time:
  the program can check all of these by itself. Covers the Seeker Hat today.
  Does not cover "talked to Kuka" or "won a round", because that happens on the
  player's device.
- **Make the facts themselves trustworthy.** Mini-game results and NPC visits
  would have to reach the chain in a way the client cannot forge. That is a
  different project, not a gate.

**6. Whether `sync_unlocks` is permissionless.** If anyone may refresh anyone's
bits, a buyer can clear the seller's permission themselves. If not, a seller
keeps wearing what they sold until they choose to sync.

### Can wait

**7. Royalties.** A percentage, and who receives it. Affects the asset size and
therefore the per-item rent.

**8. What closing a season does to its collection**, and to items already in
wallets.

**9. Whether rare items get Core instead**, where the per-item cost is noise
against their value and the sync is one account read. Buys simplicity for some
items at the price of two code paths.
