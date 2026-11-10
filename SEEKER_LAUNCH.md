# Publishing Sol City on the Solana dApp Store

The Seeker app is `apps/android/`, a Kotlin WebView shell around the live site
built from Solana Mobile's web-shell template (not Bubblewrap, not a TWA). How
it works and how to build it: `apps/android/README.md`. What to type into the
store: `dapp-store/LISTING.md`.

## What needs a new release, and what does not

The app loads https://www.solanacity.io live. Game changes, program redeploys
and the move from devnet to mainnet all reach the app with a web deploy, with
no new APK. A release is needed only when something in `apps/android/` changes:
the icon, the name, permissions, the Kotlin code.

## 1. Test a debug build on the Seeker

```bash
cd apps/android
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
./gradlew assembleDebug
```

Install `app/build/outputs/apk/debug/app-debug.apk` by USB (`adb install -r`)
or by copying the file to the phone. A debug build and a release build are
signed with different keys, so uninstall one before installing the other.

Walk the loop: connect the wallet and enter the city, open an external link,
walk and chat, log out and back in.

## 2. Build the release APK

The keystore is `C:\Users\mazza\solcity-release.keystore`, outside the repo on
purpose. **Losing it, or its passwords, means the listing can never be
updated.** Keep both in a password manager.

The build signs only when it can see the signing properties. Put them in the
user-level Gradle file, never in the repo:
`C:\Users\mazza\.gradle\gradle.properties`

```properties
WEB_SHELL_SIGNING_STORE_FILE=C:/Users/mazza/solcity-release.keystore
WEB_SHELL_SIGNING_KEY_ALIAS=solcity
WEB_SHELL_SIGNING_STORE_PASSWORD=<store password>
WEB_SHELL_SIGNING_KEY_PASSWORD=<key password, if different>
```

Forward slashes, even on Windows. To read the alias back:
`keytool -list -keystore C:/Users/mazza/solcity-release.keystore`.

```bash
./gradlew assembleRelease
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --print-certs \
  app/build/outputs/apk/release/app-release.apk
```

If the properties are missing the release comes out **unsigned, without an
error**, so always run the `apksigner` check. The certificate it prints must be
the keystore's, never "Android Debug". The store rejects debug builds.

Install the release APK on the Seeker and play the loop once more before
submitting: R8 minifies the release build, which the debug build never shows.

## 3. First submission, in the Publisher Portal

https://publish.solanamobile.com, following `dapp-store/LISTING.md`:

1. Sign up and create the publisher profile.
2. Pass KYC (individual) or KYB (company). No app can be added before approval.
3. Connect the **publisher wallet**: a fresh wallet with a little mainnet SOL,
   used only for publishing. Every future release needs it; losing it means no
   more submissions.
4. Add the dApp: package name `io.solanacity.app` (never changes), links,
   emails, icon, banner, 4 to 8 screenshots. Save and approve the transaction
   that mints the App NFT.
5. Releases, New Version: upload `app-release.apk`, write What's New, Submit,
   and approve every signing request or the submission does not complete.

Review usually takes 3 to 4 business days; the answer comes by email from
publishersupport@dappstore.solanamobile.com. No answer after 5 business days:
ask in `#dev-answers` on the Solana Mobile Discord.

## 4. Every later release

1. Bump `WEB_SHELL_VERSION_CODE` (and `WEB_SHELL_VERSION_NAME`) in
   `apps/android/gradle.properties`. The store rejects a reused versionCode.
2. Build and verify the release APK as in step 2, with the **same** keystore.
3. Submit it in the portal (Releases, New Version), or with the CLI:

```bash
npm install -g @solana-mobile/dapp-store-cli
export DAPP_STORE_API_KEY=<key from publish.solanamobile.com/dashboard/settings/api-keys>
dapp-store --apk-file app/build/outputs/apk/release/app-release.apk \
  --keypair <publisher wallet keypair.json> \
  --whats-new "<one line>"
```

The CLI reads the package name from the APK and matches it to the app already
in the portal.

## Not needed

- `apps/web/public/.well-known/assetlinks.json` matters only for a TWA or for
  verified app links. The shell is neither (its manifest has no `autoVerify`
  filter), so the placeholder fingerprint there blocks nothing.
- The old `dapp-store/config.yaml` flow (`dapp-store init / create publisher /
  create app / create release`) is gone from Solana Mobile's docs.

Sources: https://docs.solanamobile.com/dapp-store/submit-new-app and
https://docs.solanamobile.com/dapp-store/publishing-cli (read 2026-11-10).
