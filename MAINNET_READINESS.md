# Mainnet readiness — Solana City

Submitted for the Superteam Brasil mainnet-subsidy side track. Under 500 words.

## What is deployed, and where

Devnet, both upgradeable, upgrade authority `9592QS34mPUwqA7sPAkug1kcuFddjn59QPQMzzCgKhEp`:

| Program | ID | Scope |
|---|---|---|
| `sol-city` | `HPvDFVnruSXHwKKP44eUvRh8oYqBaHCeQbK1sKWT1aU2` | player state, wardrobe, hunt, beach ball, friends, VRF outfit boxes |
| `sol-mechs` | `6sv4G2HuFdrcAFBRA2X4jTSRmZj2MJS5t66zRUqy5vxJ` | PvP lobby, commit-reveal rounds, ranked ladder |

Both delegate their PDAs to MagicBlock Ephemeral Rollups. Gameplay writes are
signed by a session key on the rollup, so a player moving, dressing or chatting
sees no popup and pays no fee.

## Security analysis

A static audit commissioned through the Solana Mobile hackathon returned 203
findings. All three criticals were npm advisories, not program code. We triaged
every finding that touched the programs and fixed the real ones:

- **`init_if_needed` is gone.** `init_unlock_state` is the single explicit
  `init` and fails if the account exists. The Anchor feature flag is off in
  `Cargo.toml`.
- **No unchecked arithmetic.** Every raw `+=`/`-=` is checked or saturating, and
  `overflow-checks = true` in the release profile is the backstop. The last bare
  cast (`as i32` on a ladder rating) is now clamped.
- **CPI targets are pinned.** `owner_program` and `delegation_program` carry
  `address =` constraints, as `magic_program`, `magic_context`, `vrf_program`
  and `slot_hashes` already did.
- **`claim_free_outfit` was pulled before it ever deployed.** It verified its
  quest condition in the client, so any wallet could have claimed all sixteen
  quest indices.

Findings we examined and rejected as false positives are explained in the commit
history rather than silently dropped.

## How accounts and CPIs are validated

Every PDA is seed-derived in its `#[derive(Accounts)]` struct. Each write is
bound to a signer: directly through `has_one = authority`, or, on the rollup
path, through `constraint = duelist.session == session.key()`, where the session
key can only be set by an instruction that itself requires
`has_one = authority` plus `authority: Signer`. Admin paths (`payout`,
`resolve_dispute`) compare the signer against the stored `season.admin` before
moving lamports. The undelegation callback accepts only a signer owned by the
delegation program at its canonical PDA. Hand-rolled CPIs name hard-coded
program ids in the instruction they build; they never dispatch to an account the
caller chose.

## Tests

236 unit tests across 24 files (`npm test` from a clean clone), covering
instruction encoding, PDA derivation, clock skew, chat filtering and game logic.
Rust has no unit suite: this machine has no SBF or MSVC toolchain, so Solana
Playground is the compiler of record and devnet is the integration test.

## Known gaps

- No Rust tests and no `anchor build --verifiable` output yet. Both are blocked
  on local toolchain and Docker, which is the first thing the subsidy unblocks.
- A queued redeploy is held: it would enable wardrobe enforcement while nothing
  grants quest unlocks on chain. Documented as a blocker, not discovered late.
- Mini-game scores are client-reported. On chain here means shared and
  permanent, not verified, and we say so rather than overclaiming.

## What remains before mainnet

Rust tests under LiteSVM, a verifiable build with its hash committed here, the
queued redeploy resolved and exercised on devnet, then the same artifacts
promoted to mainnet.
