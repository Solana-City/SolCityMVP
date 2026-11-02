# Sol Mechs — deploy guide (devnet)

The program is `programs/sol-mechs/src/lib.rs`: casual PvP, friendly duels, and
the ranked season ladder. It is a separate program from `sol-city` — its own id
and upgrade authority, and nothing in the city program changes.

CI (`.github/workflows/programs.yml`) builds it as sBPFv3 on every push that
touches `programs/**`. Devnet still runs an older sBPFv0 build from
Playground; the next deploy replaces it with v3.

## 0. The two keypairs

Both live with the game wallet, in
`OneDrive/Documentos/Documentos pessoais/Burners/SolanaCity/`:

| File | What it is | Address |
| --- | --- | --- |
| `id.json` | the game wallet: pays for the deploy and becomes the upgrade authority, same as `sol-city` | `9592QS34mPUwqA7sPAkug1kcuFddjn59QPQMzzCgKhEp` |
| `sol-mechs-program.json` | the program keypair: fixes the program id, now and for every upgrade | `6sv4G2HuFdrcAFBRA2X4jTSRmZj2MJS5t66zRUqy5vxJ` |

`declare_id!` in `lib.rs` is already that program id, so nothing has to be
edited after the deploy. Both files are secrets: never commit them.

## 1. Build and deploy (sBPFv3, ~10 min)

Every deploy and upgrade is sBPFv3. SIMD-0500 (Agave 4.4) refuses v0, v1 and v2
for deploy and upgrade, and Solana Playground, `anchor build` and a plain
`cargo build-sbf` all produce v0. Do not deploy from any of them.

Needs the Agave CLI 4.3.0 or newer (`solana --version`):
`sh -c "$(curl -sSfL https://release.anza.xyz/v4.3.0/install)"`.

1. Get `sol_mechs.so`, either from CI (GitHub → Actions → programs → the run
   of the commit being deployed → artifact `sol_city-v3`, which carries all
   three programs) or locally with `npm run programs:build` from the repo root
   (it lands in `target/deploy/`).
2. Check it: `node scripts/verify-sbpf.mjs sol_mechs.so` must list
   `declare_id sol-mechs 6sv4…` and end in "all checks passed".
3. Deploy, or upgrade: the same command does both. The program keypair fixes
   the id; `id.json` pays (devnet, ~4 SOL) and is the upgrade authority.

   ```
   solana program deploy sol_mechs.so \
     --program-id <Burners>/sol-mechs-program.json \
     --keypair <Burners>/id.json --upgrade-authority <Burners>/id.json \
     --url devnet
   ```

   If the CLI says the program account is too small for the new file, run
   `solana program extend 6sv4G2HuFdrcAFBRA2X4jTSRmZj2MJS5t66zRUqy5vxJ <bytes>`
   with the difference and deploy again.
4. Check what is on chain: `node scripts/verify-sbpf.mjs --onchain sol-mechs`
   must end in "all checks passed".
5. Set `NEXT_PUBLIC_SOLMECHS_PROGRAM=6sv4G2HuFdrcAFBRA2X4jTSRmZj2MJS5t66zRUqy5vxJ`
   in Vercel (and in `apps/web/.env.local` for local runs), then redeploy the
   site.

Without that env var the client keeps using the two-tab local transport, so
nothing breaks while the deploy is in flight.

**Upgrading later** is the same flow: steps 1 to 4. Same program id, same
authority, no client change.

Check what landed:

```
solana program show 6sv4G2HuFdrcAFBRA2X4jTSRmZj2MJS5t66zRUqy5vxJ --url devnet
```

The upgrade authority should read `9592QS34mPUwqA7sPAkug1kcuFddjn59QPQMzzCgKhEp`.

## 2. Open season 1

Ranked needs a `Season` account, which also creates the match queue. Run it
once with the wallet that should be the season admin (it resolves disputes and
pays out).

```
init_season(id = 1, starts_at, ends_at, pass_collection, require_pass)
init_prize_pool()
```

For the devnet alpha use `require_pass = false` and pass
`11111111111111111111111111111111` as `pass_collection`: the ladder is then
open to everyone and no Battle Pass is needed. `treasury` is the account that
receives the non-pool share of energy purchases.

The easiest way to send both is Playground's generated UI (the "Test" tab),
which builds a form from the IDL — no script needed. Use Playground only to
send these: never Deploy from it, because it builds v0.

Season dates are unix SECONDS (not ms).

## 3. Verify (2 wallets, 2 devices)

Casual PvP:
- [ ] Wallet A: PvP → FIND MATCH → one wallet approval, then "Searching".
- [ ] Wallet B on another device: FIND MATCH → one approval → both screens show
      "Opponent found" with the other's squad.
- [ ] A round shows the same HP on both screens, and no "desync" line.
- [ ] Closing one side mid-match: the other sees "left the match".
- [ ] A second match needs no new approval.

Friendly duel (from the city):
- [ ] Click another player in the city → MECH BATTLE.
- [ ] The other player gets the invite, accepts, and both land in a 3v3.
- [ ] Declining, and letting it expire (2 minutes), both end cleanly.

Ranked:
- [ ] `init_ladder_entry` on first ranked entry; rating starts at 1000.
- [ ] Joining the queue spends 1 energy; cancelling refunds it.
- [ ] Two wallets in the queue pair with each other, and a room is created.
- [ ] Both report the same result → both ratings move, and the winner gains
      what the client predicted (a point or two of rounding is fine).
- [ ] Both reporting a win → the room shows as disputed and no rating moves.

## What the program does and does not do

- **Does:** pairs players (lobby, invite, or rating queue), carries the
  commit–reveal exchange so neither side sees the other's move first, stores
  every revealed action, holds rating / energy / prize lamports, and settles a
  ranked result when both players report the same outcome.
- **Does not:** simulate combat. Both clients run the same deterministic engine.
  A ranked result is official when both sides agree; disagreements park the room
  for the season admin, who replays the stored actions and calls
  `resolve_dispute`. A later program can verify this on-chain without changing
  the stored data.

## Accounts

| Account | Layer | What it holds |
| --- | --- | --- |
| `Duelist` (per wallet) | rollup | session key, team, current match, commit/reveal, incoming challenge |
| `Lobby` (global) | rollup | the single casual waiting slot, match id counter |
| `Season` (per season) | base | dates, admin, treasury, pass collection, room counter |
| `LadderEntry` (per wallet per season) | base | rating, wins/losses, recent opponents, energy |
| `MatchQueue` (per season) | base | up to 64 ranked tickets |
| `MatchRoom` (per ranked pairing) | base | the two players, both claims, winner |
| `PrizePool` (per season) | base | the season's lamports |

Money and rating live on the base layer on purpose: they are written once per
match, and keeping them off the rollup means a rollup hiccup can never touch
them. Only the battle itself needs the rollup's speed.

## Constants

`season/config.ts` in the client mirrors the constants in the program (energy,
Elo K-factors, matchmaking tolerance). The program is authoritative; the client
copy drives previews ("you will gain ~12") and the simulator. Changing one side
alone makes the preview lie.
