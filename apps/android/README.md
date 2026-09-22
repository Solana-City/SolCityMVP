# Sol City for Seeker (Android)

The Android app for the Solana dApp Store. The web game at
[www.solanacity.io](https://www.solanacity.io) stays the primary client for
desktop and mobile browsers; this app is the Seeker build.

It is a native Kotlin shell around the live web client, built from Solana
Mobile's official web-shell template (`@solana-mobile/webshell-cli` 0.1.0), which
their docs now recommend over Bubblewrap / TWA. On top of the template it adds
the parts a real-time game needs, and a JavaScript bridge for native features.

## How it fits together

```
Seeker ── Sol City app (this folder)
            WebView ── loads https://www.solanacity.io
            Kotlin  ── wallet hand-off, immersive landscape, lifecycle,
                       back button, window.SolCityNative bridge

Desktop / phone browser ── https://www.solanacity.io directly
```

Both clients run the **same web build** against the same program and APIs, so
players on the app and in the browser share one world. Consequences:

- **Every push to `main` updates the app too.** No APK release is needed for
  game changes, only for changes in this folder.
- **A broken web deploy breaks the app too.** Freeze web deploys while judges
  are testing.
- **The pending program redeploy needs nothing here**, because the app always
  runs the current web client.

## What the shell changes versus the template

| Change | Why |
|---|---|
| Landscape lock (`sensorLandscape`) | The game is landscape-only on phones; the web's rotate prompt never shows |
| Immersive fullscreen, screen kept on | No system bars over the game, no dimming mid-session |
| No pull-to-refresh, no WebView zoom | Both gestures fought the joystick and the game's own pinch zoom |
| `textZoom = 100` | System large-text settings can't push UI text out of panels |
| Autoplay audio | Music and SFX start from game events, not only taps |
| Back button sends Escape to the page | Closes the open panel instead of exiting the single-page game |
| JS timers pause 30s into background | Stops the multiplayer poll draining battery, but never during a wallet hand-off |
| `configChanges` covers everything | A config change can't recreate the Activity and reload the game |
| `allowBackup="false"` | Android backup would copy the funded session key off the device |
| `window.SolCityNative` bridge | Native features the page can call; absent in browsers |
| Sol City icon, splash, name | Generated from `assets/branding/icon.png` |

Kept from the template unchanged: the `Solana Mobile Web Shell` user-agent
marker and the `solana-wallet:` intent forwarding. Together they are how
`@solana-mobile/wallet-standard-mobile` (>= 0.5.1, we ship 0.5.2) runs the Mobile
Wallet Adapter inside a WebView. Do not remove either, or the wallet button
disappears in the app.

## The bridge

Always feature-detect; in a browser the object does not exist.

```ts
const native = (window as any).SolCityNative;
native?.haptic("success"); // tap | select | heavy | success | warning
native?.version();         // "0.1.0"
```

The page can also define `window.__solCityNativeBack = () => boolean` to take
over the back button (return `true` when it closed something). Until it does,
back sends an Escape keydown to `window`.

The app fires `solcity:native-resume` on `window` when it returns to the
foreground.

## Toolchain (one time)

1. Install [Android Studio](https://developer.android.com/studio). It bundles a
   JDK (JBR 21) and the SDK manager. Open it once and let it install the SDK.
2. Point the command line at them (Git Bash):

   ```bash
   export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
   export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
   export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
   ```

3. On the Seeker: Settings, About, tap Build number seven times, then enable USB
   debugging in Developer options. Connect by USB and accept the prompt.

   ```bash
   adb devices
   ```

## Build and install a debug APK

```bash
cd apps/android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Debug builds allow `chrome://inspect` from desktop Chrome for the page's
console, network and DOM.

Point a build at a Vercel preview instead of production:

```bash
./gradlew assembleDebug -PWEB_SHELL_URL=https://<preview>.vercel.app/
```

## Release signing

Create the keystore once and store it, with both passwords, in a password
manager. **Losing it means the dApp Store listing can never be updated.** It is
gitignored and must never be committed.

```bash
keytool -genkeypair -v -keystore solcity-release.keystore -alias solcity \
  -keyalg RSA -keysize 2048 -validity 10000
```

```bash
./gradlew assembleRelease \
  -PWEB_SHELL_SIGNING_STORE_FILE=/absolute/path/solcity-release.keystore \
  -PWEB_SHELL_SIGNING_KEY_ALIAS=solcity
```

Passwords come from `WEB_SHELL_SIGNING_STORE_PASSWORD` and
`WEB_SHELL_SIGNING_KEY_PASSWORD` in the environment. Bump
`WEB_SHELL_VERSION_CODE` in `gradle.properties` for every store release.

## Icons

```bash
node apps/android/scripts/make-icons.mjs
```

Regenerates the launcher foregrounds from `apps/web/public/assets/branding/icon.png`.
