# Sol Mechs — deploy guide (devnet)

The program is `programs/sol-mechs/src/lib.rs`: casual PvP, friendly duels, and
the ranked season ladder. It is a separate program from `sol-city` — its own id
and upgrade authority, and nothing in the city program changes.

It has never been compiled on this machine (no C++ linker / WSL here), so the
first build in Playground is also the first compile. If it reports an error,
paste it back and it gets fixed.

## 0. The two keypairs

Both live with the game wallet, in
`OneDrive/Documentos/Documentos pessoais/Burners/SolanaCity/`:

| File | What it is | Address |
| --- | --- | --- |
| `id.json` | the game wallet: pays for the deploy and becomes the upgrade authority, same as `sol-city` | `9592QS34mPUwqA7sPAkug1kcuFddjn59QPQMzzCgKhEp` |
| `sol-mechs-program.json` | the program keypair: fixes the program id, now and for every upgrade | `6sv4G2HuFdrcAFBRA2X4jTSRmZj2MJS5t66zRUqy5vxJ` |

`declare_id!` in `lib.rs` is already that program id, so nothing has to be
edited after the deploy. Both files are secrets: never commit them.

## 1. Build and deploy (Solana Playground, ~15 min)

1. Open <https://beta.solpg.io> and **connect first**: click the wallet in the
   bottom-left status bar and let it create the throwaway Playground wallet.
   The import options only appear once a wallet is connected — that is the
   chicken-and-egg that cost an afternoon last time.
2. In the wallet panel, **import `id.json`** and switch to it, so the deploy is
   paid and owned by the game wallet. Check the balance (devnet, needs ~4 SOL;
   `solana airdrop 5` in the Playground terminal tops it up).
3. Create a new **Anchor** project named `sol-mechs`.
4. In **Build & Deploy → Program Credentials**, import
   `sol-mechs-program.json`. The panel must then show program id
   `6sv4G2HuFdrcAFBRA2X4jTSRmZj2MJS5t66zRUqy5vxJ`, matching `declare_id!`.
5. Replace `src/lib.rs` with `programs/sol-mechs/src/lib.rs` from this repo.
6. `Cargo.toml` needs only `anchor-lang = "0.30.1"` (same as `sol-city`).
7. **Build**, then **Deploy** to devnet.
8. Set `NEXT_PUBLIC_SOLMECHS_PROGRAM=6sv4G2HuFdrcAFBRA2X4jTSRmZj2MJS5t66zRUqy5vxJ`
   in Vercel (and in `apps/web/.env.local` for local runs), then redeploy the
   site.

Without that env var the client keeps using the two-tab local transport, so
nothing breaks while the deploy is in flight.

**Upgrading later** is the same flow: connect, import both keypairs, paste the
new `lib.rs`, Build, Deploy. Same program id, same authority, no client change.

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
which builds a form from the IDL — no script needed.

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
