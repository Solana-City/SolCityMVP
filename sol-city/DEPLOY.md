# Deploy Runbook — Anchor program → Solana devnet

Everything the deploy script does, why, and how to recover if it breaks.

## TL;DR

```bash
scripts/deploy-devnet.sh
```

That's the happy path. The rest of this doc is for when something goes wrong
or you want to understand what's happening.

## Prerequisites

| Tool         | Version      | Check                       |
| ------------ | ------------ | --------------------------- |
| solana-cli   | ≥ 1.18       | `solana --version`          |
| anchor-cli   | 0.30.1       | `anchor --version`          |
| rustc/cargo  | stable       | `rustc --version`           |
| A keypair    | any          | `~/.config/solana/id.json`  |
| Devnet SOL   | ≥ 2 SOL      | `solana balance --url devnet` |

If you're missing any of these:

- **solana-cli**: `sh -c "$(curl -sSfL https://release.solana.com/stable/install)"`
- **anchor-cli**: `cargo install --git https://github.com/coral-xyz/anchor avm && avm install 0.30.1 && avm use 0.30.1`
- **keypair**: `solana-keygen new` (pick a path or accept the default)
- **devnet SOL**: the script airdrops automatically if below 2 SOL. If rate-limited, use <https://faucet.solana.com>.

## What the script does

1. **Preflight.** Verifies toolchain versions, that cluster is set to devnet, that a keypair exists, and that balance is sufficient. Airdrops if low.
2. **Build.** `anchor build`. Produces `target/deploy/sol_city.so` and `target/idl/sol_city.json`.
3. **Extract program ID.** Reads `target/deploy/sol_city-keypair.json` — that keypair's pubkey IS the program ID. Stable across redeploys unless deleted.
4. **Patch source if stale.** If `declare_id!(...)` inside `programs/sol-city/src/lib.rs` doesn't match the extracted ID, rewrites it and rebuilds. This only happens on the very first deploy.
5. **Patch Anchor.toml.** Ensures the program is registered under `[programs.devnet]`.
6. **Deploy.** `anchor deploy --provider.cluster devnet` (or `anchor upgrade` with `--upgrade`).
7. **Propagate.** Patches three client-side references to the program ID:
   - `apps/web/src/game/solana/program.ts` (code fallback)
   - `apps/web/.env.example`
   - `apps/web/.env.local` (if present)
8. **Copy IDL.** Places the generated IDL at `apps/web/src/game/idl/sol_city.json` for future @coral-xyz/anchor consumers.

The script is **idempotent.** Re-running after a successful deploy is safe; it'll no-op the patches and redeploy the same binary.

## First-time deploy

```bash
scripts/deploy-devnet.sh
```

Expected output ends with:

```
=== Deploy complete ===
  Program ID: <some 43-char base58 string>
  Cluster:    devnet
  Explorer:   https://explorer.solana.com/address/<id>?cluster=devnet
```

After that, `cd apps/web && npm run dev`, open <http://localhost:3000>, and verify via the on-chain log panel (top-right, hotkey `T`) that new transactions are flowing.

## Upgrading after a code change

Program IDs are stable — the program keypair doesn't change unless you delete `target/deploy/sol_city-keypair.json`. To push a new binary to the same ID:

```bash
scripts/deploy-devnet.sh --upgrade
```

This calls `anchor upgrade` under the hood, which is cheaper and faster than a fresh deploy.

## Dry run

```bash
scripts/deploy-devnet.sh --dry-run
```

Validates prereqs without building or deploying. Useful in CI.

## Common failures

### "insufficient funds for rent/fees"

Airdrop rate-limited. Grab more SOL at <https://faucet.solana.com>.

### "Error: invalid program argument" during `anchor deploy`

Usually means the `.so` artifact is larger than your deployer wallet can afford to allocate. Programs use rent-exempt storage proportional to binary size. Top up the wallet.

### "Program failed to deploy: custom program error: 0x1"

Anchor's way of saying "this program ID is already in use by someone else." Happens if you delete `target/deploy/sol_city-keypair.json` and generate a new one that collides. Fix: regenerate the keypair (`solana-keygen new -o target/deploy/sol_city-keypair.json --force --no-bip39-passphrase`), and re-run the script so `declare_id!` is repatched.

### "Program ID in lib.rs doesn't match keypair"

The script catches this and rebuilds automatically. If you see this error and the script didn't handle it, check that `sed` and `python3` are both installed.

## After deploy: verifying the client picked it up

1. `cd apps/web && npm run dev`
2. Open <http://localhost:3000> and connect a wallet.
3. Move around. The on-chain log panel should show `move` entries with real signatures (not `sim:move`) and a `↗` link to the MagicBlock explorer.
4. Clicking a signature link should load the transaction in a block explorer.

If you still see `simulation` badges, the `NEXT_PUBLIC_SOL_CITY_PROGRAM_ID` didn't propagate. Check `apps/web/.env.local` — that's the file Next.js reads, and it should contain the real program ID. Restart `npm run dev` after editing env.

## Rolling back

Anchor programs can be closed with `solana program close <PROGRAM_ID> --bypass-warning`, which reclaims the rent. For a soft rollback without closing:

```bash
git checkout <old-commit> -- programs/sol-city/src/lib.rs
scripts/deploy-devnet.sh --upgrade
```
