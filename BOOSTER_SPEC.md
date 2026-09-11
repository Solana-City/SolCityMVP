# Sol City — Outfit Booster (on-chain VRF) Spec

The shipped booster: pay → draw **5 random wardrobe pieces via MagicBlock VRF**
→ grant them to an on-chain unlock store. The client already has a **playable
preview** (`BoosterOverlay`, `boosterPool.ts`) that uses the exact same pool and
5-piece draw rules — only the **entropy source** (Math.random → VRF) and the
**grant** (localStorage → on-chain PDA) change. Reveal UX is final.

Status: **program WRITTEN (commit 7f9e223), needs a Solana Playground deploy;
client wiring lands after.** Decisions locked: **VRF via MagicBlock ephemeral
VRF**, **0.01 SOL** per pack to the **game-wallet treasury**, base devnet
(wallet-signed — no ER-session dependency). Nothing ships client-side until the
program is live (same rule as `REDEPLOY_CHECKLIST.md`).

### What's on-chain now (`programs/sol-city/src/lib.rs`)
- `open_booster(pool_count, client_seed)` — pays 0.01 SOL → treasury, requests
  VRF (`ephemeral-vrf-sdk` `create_request_randomness_ix`, `DEFAULT_QUEUE`),
  callback `callback_open_booster`. Stores `pending` + `pending_pool_count` on
  `UnlockState`.
- `callback_open_booster(randomness)` — VRF-identity-signed; 5 distinct indices
  in `[0, pool_count)` → bits in `UnlockState` (seed `["unlocks", wallet]`,
  256-bit capacity), emits `BoosterOpened { authority, indices }`.
- Cargo: `anchor-lang` + `init-if-needed`, `ephemeral-vrf-sdk = 0.3.0` (anchor).

### Deploy (Solana Playground) — do this next
1. Open the program in beta.solpg.io, add the two deps to `Cargo.toml`, build.
   **Expect to iterate** on `ephemeral-vrf-sdk` path/name mismatches — the
   `BUILD NOTES` block in `lib.rs` lists what to check (`#[vrf]` macro,
   `create_request_randomness_ix`, `consts::DEFAULT_QUEUE` / `VRF_PROGRAM_IDENTITY`).
2. Deploy to devnet (upgrade authority = game wallet). Program id unchanged
   (`HPvDFVnruSXHwKKP44eUvRh8oYqBaHCeQbK1sKWT1aU2`).
3. **VRF oracle:** confirm from MagicBlock's docs whether the request payer must
   pre-fund the oracle queue / any per-request fee on devnet; top up if so.
4. Export the new IDL — the client needs the `open_booster` accounts (the
   `#[vrf]` macro appends VRF-program accounts) + the `BoosterOpened` event.

### Client — Phase 2

**Already staged (commit 3302092, behind `BOOSTER_ONCHAIN`, flag OFF):**
- `program.ts`: `deriveUnlockPDA`, `decodeUnlockState`, `unlockedIndices`,
  `VRF_QUEUE_DEVNET`, `BOOSTER_ONCHAIN`.
- `boosterPool.ts`: `POOL_VERSION` + `boosterIndexTable`/`boosterIndexOf`/
  `itemAtIndex`/`boosterPoolCount` (the client⇄program index space).
- `instructions.ts`: `buildOpenBoosterIx({ payer, poolCount, clientSeed,
  treasury, vrfAccounts })`.
- `wardrobeUnlocks.ts`: `setOnChainUnlocks`/`getOnChainUnlocks` (decode the PDA
  bitset → keys); `isVariantUnlocked` honors on-chain unlocks when the flag is on.

**Remaining at deploy (small, needs the IDL / a live oracle):**
1. From the deployed IDL, fill `buildOpenBoosterIx`'s `vrfAccounts` (the accounts
   the `#[vrf]` macro appends, in order).
2. Feed the PDA: on connect, fetch the `UnlockState` account on the base RPC and
   call `setOnChainUnlocks(wallet, data)` (and re-fetch after a pack).
3. `BoosterOverlay`: when `BOOSTER_ONCHAIN`, OPEN → wallet signs/pays
   `open_booster` (via the sign-only + base-send path) → snapshot the unlocked
   set → poll `UnlockState` until `pending` flips false → reveal the newly-set
   indices (diff). Keep the mock path when the flag is off.
4. Flip `NEXT_PUBLIC_BOOSTER_ONCHAIN=1` and verify.

---

## Pieces

### 1. Canonical item-index table (client ⇄ program must match)
The program can't hold strings for every trait, and the client draw must match
the on-chain draw. Define **one canonical ordered list** of the booster pool —
each `(category, variantId)` gets a stable `u16` index.

- Client: `getBoosterPool()` in `paperDoll.ts` already yields a deterministic
  order (LAYER_ORDER × enabled variants, minus free/quest/NPC). Freeze that
  order as the index table; export `boosterIndexOf(cat,id)` / `itemAtIndex(i)`.
- Program: ship the **same** list as a `const POOL: [ (u8 category, u16 variant) ; N ]`
  (or just `N` and an index space the client owns). The program only needs the
  count `N` and to return indices; the client maps index → item.
- **Rule:** appending to the pool is safe (indices stable); never reorder or
  remove — that shifts every index. Add a `POOL_VERSION` and pin it in both.

### 2. `UnlockState` PDA (the on-chain unlock store)
Per-wallet, seed `[b"unlocks", wallet]`. Holds a **bitset** of unlocked pool
indices (booster items). Free/quest/NPC items are NOT stored here (free = never
gated; quest/NPC stay client-side, or move on-chain later — decide below).

```rust
#[account]
pub struct UnlockState {
    pub authority: Pubkey,
    pub bits: [u8; (N + 7) / 8], // 1 bit per pool index; N ≈ current pool size, size generously
}
```
`is_unlocked(i) = bits[i/8] & (1 << (i%8))`. This is the seam `wardrobeUnlocks.ts`
already isolates: swap `getUnlockedSet` (localStorage) for a decode of this PDA.

### 3. `request_booster` (pay + request VRF)
- **Payment:** transfer the pack price (SOL, or a token) from the wallet to a
  treasury. Wallet-signed (a real purchase — one popup), OR debit a prepaid
  balance with the session key. Decide price + treasury.
- **VRF request:** CPI into **MagicBlock's ephemeral VRF** to request randomness
  with a callback into `fulfill_booster`. Runs on the ER (low-latency). Store a
  small `PendingBooster { authority, requested_at }` PDA so the callback knows
  who to grant to. *(Confirm the exact ephemeral-VRF program id, SDK helper —
  request ix + callback discriminator — from MagicBlock's ephemeral-vrf docs at
  implementation time; do not hardcode from memory.)*

### 4. `fulfill_booster` (VRF callback → grant 5)
- Receives the random bytes. Derive **5 distinct indices** in `[0, N)` from the
  seed (rejection-sample or a Fisher–Yates over an index array using successive
  8-byte chunks of the hash).
- **Dedup vs owned:** to mirror the preview's "prefer un-owned", either (a) skip
  already-set bits and draw more, or (b) grant anyway and let the client show
  "OWNED" (simplest; the preview already does this — a duplicate is just no new
  bit). Pick (b) for v1 unless you add dust/points for dupes.
- Set the 5 bits in `UnlockState` (init_if_needed on first pack). Emit an event
  with the 5 indices so the client reveals without re-reading.

---

## Client changes (post-deploy)
Order: deploy → verify → push these together.

1. **`boosterPool.ts`** — `rollBooster` becomes async: `request_booster` (pay +
   VRF) → await the `fulfill_booster` event / poll `UnlockState` → return the 5
   `BoosterDrop`s from the returned indices. The current sync `rollBooster` is
   the preview fallback.
2. **`wardrobeUnlocks.ts`** — `getUnlockedSet` reads the `UnlockState` PDA
   (decode the bitset → keys) instead of localStorage; cache + refresh on the
   fulfill event. `unlockItem` for booster items becomes a no-op client-side
   (the program is the source of truth); quest/NPC unlocks either move on-chain
   too (needs their own ix) or stay localStorage — **decide**.
3. **`BoosterOverlay.tsx`** — swap the instant reveal for: OPEN → sign/pay →
   "opening…" while VRF fulfills → reveal from the event. The card UX is unchanged.
4. **`program.ts` / `instructions.ts`** — add `UNLOCKS_SEED`, `deriveUnlockPDA`,
   `decodeUnlockState`, and `buildRequestBoosterIx`.

---

## Decisions to lock before building
- **Price + currency** (SOL amount, or a game token) and **treasury** wallet.
- **Dupes:** show "OWNED" (v1) vs convert to dust/points (needs a currency).
- **Scope of on-chain unlocks:** booster-only on-chain (quest/NPC stay client),
  or unify all unlocks on-chain (more ixs, one source of truth). Recommended:
  **booster on-chain now, quest/NPC on-chain in the same redeploy** so the
  wardrobe has one authority.
- **VRF specifics:** confirm MagicBlock ephemeral-VRF program id + SDK (request
  ix, callback pattern, any oracle funding) from their current docs.

## Verification (post-deploy)
- [ ] Open a pack: one payment popup; VRF fulfills; 5 items revealed on 2 devices
      show the **same** result for the same request (VRF is verifiable).
- [ ] `UnlockState` bits set correctly; wardrobe reads them on both devices.
- [ ] Pool index table identical in client and program (POOL_VERSION match).
- [ ] Duplicate handling matches the decision above.
