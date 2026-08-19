# Sol City — Outfit Booster (on-chain VRF) Spec

The shipped booster: pay → draw **5 random wardrobe pieces via MagicBlock VRF**
→ grant them to an on-chain unlock store. The client already has a **playable
preview** (`BoosterOverlay`, `boosterPool.ts`) that uses the exact same pool and
5-piece draw rules — only the **entropy source** (Math.random → VRF) and the
**grant** (localStorage → on-chain PDA) change. Reveal UX is final.

Status: **staged, needs a program redeploy.** Nothing here ships client-side
until the program is live (same rule as `REDEPLOY_CHECKLIST.md`).

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
