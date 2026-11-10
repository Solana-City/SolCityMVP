# Sol City on the Solana dApp Store: listing

Everything the Publisher Portal (https://publish.solanamobile.com) asks for, in
the order it asks. Copy the text fields as they are. The full procedure is in
`SEEKER_LAUNCH.md` at the repo root.

The old `config.yaml` flow (`dapp-store init / create publisher / create app /
create release`) is gone from Solana Mobile's docs. Publishing now goes through
the portal, and the `dapp-store` CLI only uploads new releases of an app that
already exists there.

## Fixed values

| Field | Value |
|---|---|
| Package name | `io.solanacity.app` (case-sensitive, can never change) |
| App name | The Solana City |
| Website | https://www.solanacity.io |
| Terms of use | https://www.solanacity.io/terms |
| Privacy policy | https://www.solanacity.io/privacy |
| Support email | _owner to fill_ |
| Contact email | _owner to fill_ |
| First version | 1.0.0 (versionCode 1) |

## Assets

| Asset | Portal rule | File |
|---|---|---|
| Icon | 512x512, solid background, no transparency | `assets/app-icon-512.png` (ready) |
| Banner | 1200x600 | `assets/banner-1200x600.png` (missing) |
| Screenshots | 4 to 8 | `assets/screenshot-01.png` ... (missing; capture on the Seeker) |
| APK | release-signed, debug builds are rejected | `apps/android/app/build/outputs/apk/release/app-release.apk` |

Screenshot ideas, one each: the city with other players walking, an NPC
dialog, the wardrobe, a minigame (Sushi cart, Kite Clash or Sol Mechs).

## Short description

```
A multiplayer pixel city on Solana. Walk, talk, trade and play.
```

## Long description

```
The Solana City is a multiplayer pixel-art city that lives on Solana.

Walk the streets with players on Seeker and in the browser at the same time:
everyone shares one city, with no lobby and no game server. Positions, outfits
and chat travel on chain through MagicBlock ephemeral rollups.

Talk to more than 30 NPCs. Some open real Solana services: swap tokens through
Jupiter, send SOL to another player, mine ORE, follow tokenized stocks. Others
run minigames: serve the Sushi cart, fly in Kite Clash, build a team in Sol
Mechs.

Dress your citizen in the wardrobe, hunt for a citizen across the city in Find
Someone, chat, make friends.

Built for Seeker: connect Seed Vault once through Mobile Wallet Adapter and play
without a wallet prompt on every step. No account, no ads: your wallet is your
identity. You can also look around as a guest without a wallet.
```

## What's new (first release)

```
First release on the Solana dApp Store.
```

## Testing instructions for the reviewer

```
1. Open the app. It loads the live city at www.solanacity.io in landscape.
2. To look around without a wallet, tap CONTINUE AS GUEST, then PLAY SOLO.
3. To play online, tap CONNECT WALLET and approve in Seed Vault. Entering the
   city asks for one signature.
4. Move with the joystick (bottom left). Walk up to an NPC and tap the interact
   button to open its panel.
5. The Android back button closes the open panel.
The city currently runs on Solana devnet, so the online path needs a devnet
wallet with a little devnet SOL.
```

Check before submitting: if the city has moved to mainnet by then, drop the
last two lines of the testing instructions and change nothing else.
