# Devnet integration tests

```bash
npm run test:devnet -w apps/web
```

Ten tests against the bytecode deployed on devnet. They are the answer to "what
tests exist" for the programs, where the unit suite cannot reach: it runs
offline and proves the client agrees with itself, while these prove the program
on chain rejects what it should.

## Why they are not in `npm test`

The unit suite is offline, deterministic and fast by design (see the comment in
`vitest.config.mts`). Mixing a network dependency into it makes every run
hostage to an RPC. These live outside `src/` so the unit config's
`src/**/*.test.ts` cannot pick them up, and they have their own config.

## They cost nothing and change nothing

Everything goes through `simulateTransaction` with `sigVerify: false`. No key is
needed, no SOL is spent, no account is written. The one requirement is that the
accounts named in an instruction EXIST, which is why the fee payer is the game
wallet's public key rather than a fresh keypair: a random payer fails with
`AccountNotFound` before the program ever runs.

Point them at a different RPC with `DEVNET_RPC=... npm run test:devnet`.

## What they cover

`cpiTargets.test.ts` proves the delegation CPI cannot be steered by the caller.
`delegate_duelist` and `delegate_lobby` take the program they CPI into as
accounts; until 2026-10-15 both were bare `UncheckedAccount`s. Each is now
checked three ways: a wrong `owner_program` is rejected with
`ConstraintAddress`, a wrong `delegation_program` likewise, and the correct pair
gets past the account constraints. A duelist PDA seeded for another wallet is
rejected with `ConstraintSeeds`.

`solCity.test.ts` asserts both programs are live and executable, and that
`claim_free_outfit` is not callable. That instruction granted any index in the
quest block to whoever called it, because its condition was checked in the
client. It was pulled before it ever shipped, and this test is the standing
proof that the chain has never exposed it.

## What they deliberately do not cover yet

The deployed sol-city predates the current source: the redeploy carrying
`player_v3`, wardrobe enforcement and the same `address =` constraints is
prepared and held (see the BLOCKER at the top of `REDEPLOY_CHECKLIST.md`). So
sol-city's constraint tests are not written yet. Asserting them today would only
prove they are not deployed, which is already written down. They mirror
`cpiTargets.test.ts` and land with the redeploy.

Simulation also cannot cover state transitions across several transactions, or
anything needing a real signature. Those need either LiteSVM, which needs a Rust
toolchain this machine does not have, or funded devnet runs.
