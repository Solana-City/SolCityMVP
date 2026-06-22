# sol-city-rps — JoKenPo wager program

Ported from MagicBlock's Rock-Paper-Scissors reference template
(`magicblock-labs/magicblock-engine-examples/rock-paper-scissor`). Private
Ephemeral Rollups keep each player's choice hidden from the other player and
from the RPC until `reveal_round` flips both choices public at once.

This program needs a **newer Anchor/SDK toolchain than `programs/sol-city`**,
so it's deliberately a separate workspace member with its own program ID —
deploying or upgrading it cannot affect `sol-city`.

## One-time local setup (this can't be done from the coding sandbox)

```bash
# 1. Install avm (Anchor Version Manager) if you don't have it
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force

# 2. Install + use the Anchor CLI version this program needs
avm install 1.0.2
avm use 1.0.2

# 3. The deploy keypair already exists at programs/sol-city-rps/keys/
#    (gitignored — holds upgrade authority, never commit it).
#    Anchor expects it at target/deploy/<crate>-keypair.json:
mkdir -p target/deploy
cp programs/sol-city-rps/keys/sol-city-rps-keypair.json target/deploy/sol_city_rps-keypair.json

# 4. Make sure your deploy wallet (Anchor.toml [provider] wallet) has devnet SOL
solana airdrop 2 --url devnet

# 5. Build + deploy
anchor build
anchor deploy --provider.cluster devnet --program-name sol_city_rps

# 6. Copy the generated IDL into the web client
cp target/idl/sol_city_rps.json ../../apps/web/src/game/solana/rps/idl/sol_city_rps.json
cp target/types/sol_city_rps.ts ../../apps/web/src/game/solana/rps/idl/sol_city_rps.ts
```

Program ID (already baked into `declare_id!` and `Anchor.toml`):
`C6gWf1CtwgiZKpkmBjjnos13VGfFr3zwuhtkNLkXU5qW`

If `anchor build` regenerates a *different* keypair because step 3 was
skipped, either re-run step 3 before building, or run `anchor keys sync` and
update `declare_id!` + `Anchor.toml` + the web client's `PROGRAM_ID` to match
whatever new ID it produced — don't deploy with mismatched IDs.

## Why this needs MagicBlock's TEE devnet endpoint

Unlike `sol-city`'s ordinary (non-private) Ephemeral Rollup delegation, this
program's `reveal_round`/`next_round`/`init_permission` instructions run
through MagicBlock's **Permission Program** on their TEE-backed devnet
endpoint (`https://devnet-tee.magicblock.app`), not the plain ER validator.
That's what makes a player's choice unreadable — including to the
RPC — until both players have committed.
