# Seeker dApp Store Launch Guide
## The Solana City — Step-by-step

This document is the complete playbook for launching Sol City on the Seeker dApp Store.
Everything in the **codebase** is already ready. What follows is the one-time build + submission process.

---

## Prerequisites (install once)

```bash
# 1. Java JDK 17 (required by Android build tools)
#    Download: https://adoptium.net/
java -version   # must show 17+

# 2. Android SDK (via Android Studio or command-line tools)
#    Download: https://developer.android.com/studio
#    After install, accept licenses:
yes | sdkmanager --licenses

# 3. Bubblewrap CLI
npm install -g @bubblewrap/cli

# 4. Solana dApp Store CLI
npm install -g @solana-mobile/dapp-store-cli

# 5. Solana CLI (for publisher wallet)
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
```

---

## Step 1 — Switch app to mainnet

Before building the APK, update the network from devnet to mainnet:

1. In `vercel.json`, change `NEXT_PUBLIC_NETWORK` to `"mainnet-beta"`
2. In `apps/web/src/ui/SolanaProvider.tsx`, change `const NETWORK = "devnet"` to `"mainnet-beta"`
3. Deploy to Vercel and confirm the live site is on mainnet
4. Verify `https://www.solanacity.io` loads correctly

---

## Step 2 — Generate the APK with Bubblewrap

```bash
# Create a working directory outside the repo
mkdir ~/solcity-twa && cd ~/solcity-twa

# Initialise — Bubblewrap reads our manifest automatically
bubblewrap init --manifest https://www.solanacity.io/manifest.json

# Bubblewrap will ask several questions:
#   - Application ID:        io.solanacity.app
#   - App name:              The Solana City
#   - Short name:            Sol City
#   - Host:                  www.solanacity.io
#   - Start URL:             /
#   - Theme color:           #9945FF
#   - Background color:      #06080e
#   - Display mode:          standalone
#   - Orientation:           landscape
#   - Icon URL:              https://www.solanacity.io/icons/icon-512.png
#   - Maskable icon:         yes
#   - Signing key:           CREATE NEW  ← choose this
#   - Key alias:             solcity
#   - Key password:          (choose a strong password — SAVE IT)
#   - Store password:        (choose a strong password — SAVE IT)

# After init, build the release APK:
bubblewrap build
# Output: app-release-signed.apk
```

> ⚠️ **CRITICAL**: Save `android.keystore` + both passwords in a password manager.
> Losing the keystore means you can NEVER update the app on the store.

---

## Step 3 — Update assetlinks.json

Bubblewrap generates the SHA256 fingerprint of your signing key. Get it:

```bash
bubblewrap fingerprint add
# or:
keytool -list -v -keystore android.keystore -alias solcity
# Look for: SHA256: XX:XX:XX:...
```

Then update `apps/web/public/.well-known/assetlinks.json`:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "io.solanacity.app",
      "sha256_cert_fingerprints": [
        "PASTE_THE_ACTUAL_SHA256_HERE"
      ]
    }
  }
]
```

Commit, push, and verify it's live:
```bash
curl https://www.solanacity.io/.well-known/assetlinks.json
```

---

## Step 4 — Prepare store assets

Place these files in `dapp-store/assets/`:

| File | Size | Notes |
|------|------|-------|
| `app-icon-512.png` | 512×512 | Already exists at `/icons/icon-512.png` — copy it |
| `banner-1200x600.png` | 1200×600 | Feature banner for the store listing |
| `screenshot-01.png` | 1080×1920 | Gameplay screenshot (portrait) |
| `screenshot-02.png` | 1080×1920 | NPC interaction |
| `screenshot-03.png` | 1080×1920 | Sushi minigame |
| `screenshot-04.png` | 1080×1920 | Wallet connection / wallet screen |

Take screenshots on a real Android device or emulator with `adb screencap`.

---

## Step 5 — Complete config.yaml

Edit `dapp-store/config.yaml`:
- Fill in `email` and `support_email`
- Update screenshot filenames if different
- Copy APK to `dapp-store/` and update the filename in `files`

---

## Step 6 — Mint Publisher, App, and Release NFTs

```bash
# Fund a Solana mainnet wallet (~0.2 SOL needed)
solana config set --url mainnet-beta
solana balance

cd path/to/SolCityMVP/dapp-store

# Initialise (creates addresses in config.yaml)
npx dapp-store init --keypair ~/.config/solana/id.json

# Mint Publisher NFT (once — represents your dev identity)
npx dapp-store create publisher --keypair ~/.config/solana/id.json

# Mint App NFT (once per app)
npx dapp-store create app --keypair ~/.config/solana/id.json

# Mint Release NFT (once per version)
npx dapp-store create release --keypair ~/.config/solana/id.json
```

---

## Step 7 — Submit for review

```bash
npx dapp-store publish submit \
  --keypair ~/.config/solana/id.json \
  --requestor-is-authorized \
  --complies-with-solana-dapp-store-policies
```

Review takes **2–5 business days**. Monitor at: https://publish.solanamobile.com

---

## Step 8 — For every future update

```bash
# 1. Deploy new code to Vercel (automatic on git push to main)
# 2. Build new APK:        bubblewrap build   (in ~/solcity-twa)
# 3. Mint new Release NFT: npx dapp-store create release
# 4. Submit:               npx dapp-store publish submit ...
```

The web app updates instantly via Vercel deploy.
The APK only needs to be resubmitted when the Android wrapper itself changes
(manifest, package name, signing key) — NOT for game content updates.

---

## What's already done in the codebase ✅

| Item | Status |
|------|--------|
| Service Worker (PWA installable) | ✅ |
| Web App Manifest | ✅ |
| HTTPS via Vercel | ✅ |
| Mobile Wallet Adapter (MWA) | ✅ |
| Seed Vault / Seeker badge detection | ✅ |
| Touch joystick + interact button | ✅ |
| Landscape lock (RotatePrompt) | ✅ |
| Safe areas (notch/home bar) | ✅ |
| Error boundary | ✅ |
| Session key persistence (localStorage) | ✅ |
| `.well-known/wallet-adapter.json` | ✅ |
| `.well-known/assetlinks.json` (template) | ✅ fill SHA256 in Step 3 |
| Privacy Policy (`/privacy`) | ✅ |
| Terms of Service (`/terms`) | ✅ |
| dApp Store `config.yaml` | ✅ fill emails + screenshots |

---

## Useful links

- [Solana dApp Store Docs](https://docs.solanamobile.com/dapp-publishing/overview)
- [Bubblewrap CLI](https://github.com/GoogleChromeLabs/bubblewrap)
- [Digital Asset Links validator](https://developers.google.com/digital-asset-links/tools/generator)
- [Seeker device specs](https://solanamobile.com/seeker)
