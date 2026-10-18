# Mainnet readiness — Solana City

Submitted for the Superteam Brasil mainnet-subsidy side track. 495 words.

## DEPLOYED

Devnet. Both programs upgradeable, upgrade authority
9592QS34mPUwqA7sPAkug1kcuFddjn59QPQMzzCgKhEp.

sol-city: HPvDFVnruSXHwKKP44eUvRh8oYqBaHCeQbK1sKWT1aU2. Player state, wardrobe,
hunt, beach ball, friends, VRF outfit boxes.

sol-mechs: 6sv4G2HuFdrcAFBRA2X4jTSRmZj2MJS5t66zRUqy5vxJ. PvP lobby,
commit-reveal rounds, ranked ladder. Redeployed 2026-10-15.

Both delegate PDAs to MagicBlock Ephemeral Rollups. Gameplay writes are session
key signed on the rollup: no wallet popup, no fee per action.

## SECURITY ANALYSIS

Static audit through the Solana Mobile hackathon: 203 findings, 3 critical. All
3 criticals were npm advisories, not program code. Program findings triaged and
fixed:

init_if_needed removed. init_unlock_state is the only explicit init and fails if
the account exists. The Anchor feature flag is off in Cargo.toml.

Every raw += and -= is now checked or saturating. overflow-checks = true in the
release profile. The last bare cast, as i32 on a ladder rating, is clamped.

owner_program and delegation_program pinned with address constraints, matching
magic_program, magic_context, vrf_program and slot_hashes.

claim_free_outfit removed before it deployed. It verified its quest condition
client side, so any wallet could have claimed all 16 quest indices.

## ACCOUNT AND CPI VALIDATION

Every PDA is seed derived in its Accounts struct. Writes bind to a signer
through has_one = authority, or on the rollup path through
constraint = duelist.session == session.key(), where the session key is set only
by an instruction requiring has_one = authority plus authority: Signer. Admin
paths, payout and resolve_dispute, compare the signer against season.admin
before moving lamports. The undelegation callback requires a signer owned by the
delegation program at its canonical PDA. Hand rolled CPIs hard code the target
program id and the account metas, so a caller cannot redirect them.

## TESTS

236 unit tests across 24 files, run with npm test. Coverage: instruction
encoding, PDA derivation, clock skew, chat filtering, game logic. All pass from
a clean clone with no env file.

10 integration tests against devnet, run with npm run test:devnet. They simulate real
instructions against the deployed bytecode, spending nothing and changing
nothing, and prove the delegation CPI cannot be steered by the
caller: a wrong owner_program or delegation_program is rejected with
ConstraintAddress, a duelist PDA seeded for another wallet with ConstraintSeeds,
and claim_free_outfit is not callable at all.

No Rust tests, no LiteSVM, no Mollusk. The dev machine has no SBF or MSVC
toolchain, so Solana Playground is the compiler and devnet is the integration
environment. Both programs compile clean there.

## KNOWN GAPS

No Rust test suite. Program behaviour is covered by devnet simulation instead,
which cannot reach state transitions across several transactions.

No anchor build --verifiable output. It needs Docker, not yet installed.

One redeploy is prepared and held: it enables wardrobe enforcement while no
instruction grants quest unlocks on chain. Recorded as a blocker in
REDEPLOY_CHECKLIST.md.

Mini-game scores are client reported. On chain here means shared and permanent,
not verified.

## BEFORE MAINNET

Install the toolchain. Write Rust tests under LiteSVM. Produce a verifiable
build and commit its hash with the program ID. Resolve the held redeploy and
exercise it on devnet. Promote the same artifacts to mainnet.
