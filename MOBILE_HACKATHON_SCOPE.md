# Sol City — Solana Mobile Hackathon Scope

Goal: ship **The Solana City as a real Android app on the Seeker / Solana dApp
Store**, while a player on the web and a player on the Android app walk the same
streets, see each other move, chat, and compete in the same world.

This file is the scope of work. It is the plan, not a record of what is done.

---

## 1. Where we stand today (verified against the repo)

| Fact | Evidence |
|---|---|
| Project age | First commit `2026-04-06`, 618 commits. Roughly 5.5 months old. |
| Client | Next.js 14 + Phaser 3, `apps/web` |
| Distribution | PWA via `@ducanh2912/next-pwa` (`public/manifest.json`, `public/sw.js`) |
| Wallet on Android | `@solana-mobile/wallet-standard-mobile` registered in `src/ui/MwaRegistration.tsx`, browser-side only |
| Touch input | `src/ui/MobileControls.tsx` (joystick + interact button), `src/ui/usePinchZoom.ts` |
| Shared world | On-chain. `src/game/multiplayer/OnChainMultiplayer.ts` polls `player_v2` PDAs on the ephemeral rollup every 500ms |
| Off-chain state | 12 Next.js API routes (names, quests, leaderboard, events, heat, flags) over Upstash KV (`src/lib/kv.ts`) |
| Session key | Deterministic: wallet signs a fixed message, SHA-256 of the signature seeds the keypair (`src/game/solana/sessionKeys.ts:78`) |
| Existing Android plan | `SEEKER_LAUNCH.md`: Bubblewrap TWA, store assets, dApp Store NFT flow |
| Native Android project | **None.** No Capacitor, no Gradle, no Kotlin. |
| Asset weight | 14 MB in `public/` (7.4 MB tilesets, 3.9 MB maps). Comfortable for an APK. |

**Eligibility read:** the project is older than the 3 month window, so it enters
under the pre-existing-project carve-out and must show significant *new mobile
development during the hackathon*. That work must be visible in git history
inside the hackathon window, and the README must state plainly that the web app
predates the event and the Android layer was built during it.

---

## 2. The problem with the existing Seeker path

`SEEKER_LAUNCH.md` ships the app via **Bubblewrap**, which produces a Trusted
Web Activity: a system browser in fullscreen pointed at solanacity.io. That is
the single shape the rules call out by name:

> *Direct ports or minimal conversions of existing web apps, including PWA
> wrappers with little to no mobile optimisation, will score poorly and are
> unlikely to win.*

The TWA path stays valid for **publishing** later. It is the wrong artifact for
**this hackathon**. The scope below replaces it with a native shell whose
Android code we actually write.

---

## 3. Architecture decision

**Capacitor shell, web client bundled locally, native plugins written by us,
remote HTTPS APIs.**

```
┌─────────────────────────────────────────────────┐
│ Android app (io.solanacity.app)                 │
│  ┌───────────────────────────────────────────┐  │
│  │ Kotlin layer (ours)                       │  │
│  │  - MWA client (native, Seed Vault)        │  │
│  │  - Session key in Android Keystore        │  │
│  │  - FCM push                               │  │
│  │  - Haptics, lifecycle, immersive mode     │  │
│  └───────────────┬───────────────────────────┘  │
│                  │ Capacitor bridge             │
│  ┌───────────────▼───────────────────────────┐  │
│  │ WebView: Phaser client, bundled offline   │  │
│  └───────────────┬───────────────────────────┘  │
└──────────────────┼──────────────────────────────┘
                   │ same program IDs, same origin
     ┌─────────────▼──────────────┐   ┌───────────────────┐
     │ MagicBlock ER + base RPC   │   │ solanacity.io API │
     │ player_v2 PDAs             │   │ Upstash KV        │
     └─────────────▲──────────────┘   └────────▲──────────┘
                   │                           │
              ┌────┴───────────────────────────┴───┐
              │ Web players on solanacity.io       │
              └────────────────────────────────────┘
```

Why bundled rather than remote-loaded: an app that boots its own world offline,
with no address bar and no cold network fetch of 14 MB, reads as an app. A
WebView pointed at a URL reads as a wrapper, to a judge and to a reviewer. The
cost is that game content updates need a new APK, which is acceptable for a
frozen submission build and is handled by the version gate in W7.

Rejected alternatives:

- **Bubblewrap TWA** — see section 2.
- **Full Kotlin rewrite of the client** — would mean reimplementing the Phaser
  world and would break cross-play at the rendering and protocol level. Not
  achievable in a hackathon window.

**Hard constraint: zero on-chain program changes.** Nothing in this scope needs
a redeploy (no Anchor CLI on this machine, and the redeploy is deferred anyway).
Every item works against the currently deployed program.

---

## 4. Cross-play model

The good news: **cross-play is already the architecture.** The shared world is
on-chain, and off-chain state is plain HTTPS. Any client pointed at the same
program IDs and the same origin is already in the same world. There is no lobby,
no matchmaking, and no server to federate.

What actually has to be true:

| Requirement | Status | Work |
|---|---|---|
| Same program IDs and cluster on both clients | Config only | W1 |
| Same ER + base RPC endpoints | Config only | W1 |
| Same API origin for KV state (names, quests, leaderboard) | Android calls `https://www.solanacity.io/api/*` | W1 |
| **Same session key for the same wallet on both platforms** | **Resolved**, MWA signs raw bytes (section 4) | Confirm in 0.3 |
| Feature parity so a mobile player is not a second-class citizen | Gaps exist | W3 |
| Protocol skew between a frozen APK and a continuously deployed web build | No guard today | W7 |

### Session key derivation: resolved, MWA signs the same bytes

`sessionKeys.ts:78-84` derives the in-game keypair as:

```
seed = SHA256( ed25519_sign(wallet, FIXED_MESSAGE) )
```

Because ed25519 signatures are deterministic, the same wallet yields the same
session key on every device. That is what makes a player continuous across
browsers today, and it is what makes cross-play work with no migration at all.

The open question was whether MWA and Seed Vault sign the same bytes a browser
wallet signs. **They do.** Evidence, strongest first:

1. **The MWA 2.0 spec is explicit that the raw payload is signed.** On
   `sign_messages`: *"the wallet endpoint should sign the messages with the
   private key for the authorized account address"*, and on the response, *"The
   signatures should be appended to the message, in the same order as
   `addresses`."* There is no envelope and no prefix anywhere in the protocol.
2. **The response format differs from the browser, and the adapter already
   normalises it.** `signed_payloads` is `message || signature`, not a bare
   signature. `@solana-mobile/wallet-standard-mobile` handles the extraction in
   `lib/cjs/index.browser.js:1348`:

   ```js
   return (await wallet.signMessages({ addresses, payloads: messages }))
     .signed_payloads.map(toUint8Array).map((signedMessage) => ({
       signedMessage,
       signature: signedMessage.slice(-SIGNATURE_LENGTH_IN_BYTES)
     }));
   ```

   The payload sent up is the raw message, base64 only for transport. The
   `signature` handed back is the plain 64 bytes, exactly the shape Phantom web
   returns. This slice is also robust if a wallet returns a bare 64-byte
   signature instead of the concatenation.
3. **The Kotlin client does the same for the native path.**
   `signMessagesDetached(...)` returns `.messages[i].signatures[i]` directly, so
   W2 never has to do the slicing by hand.
4. **Our bridge is a pass-through.** `WalletSignBridge.tsx:72` calls the
   wallet-adapter `signMessage(message)` and emits the result unmodified. Both
   Phantom web and MWA implement the same wallet-standard `solana:signMessage`
   feature, so identical bytes reach the SHA-256 in `sessionKeys.ts`.

The off-chain message envelope that prompted the original concern is a
*separate, proposed* feature (`signOffchainMessage`, anza-xyz/wallet-standard
issue 81), not something `solana:signMessage` applies. Conflating the two was
the error.

**What remains is discipline, not risk.** The message string is load-bearing and
stays byte-identical. It contains `Only sign on solanacity.io.` and there will be
a temptation to reword that for an app. Do not. The separator is an em dash,
U+2014, three UTF-8 bytes `E2 80 94`, verified against `sessionKeys.ts:77`; in
Kotlin it is `—`, never a hyphen, and no linter may normalise it. One byte
different is a different signature, a different session key, and a player split
in two.

Step 0.3 still confirms this on the real device before W2 is built on it, but it
is now a ten-minute check expected to pass, not a spike that could change the
architecture.

---

## 5. Workstreams

Effort is in developer-days. W0 blocks the wallet work; the rest can move in
parallel.

### W0 — Session key parity check

**Was 1 day, now folded into Phase 0 step 0.3 as a ten-minute check.**

Resolved on the documentation and the shipped adapter code: MWA signs the raw
payload, and both the JS and Kotlin clients hand back a plain 64-byte signature.
See section 4. The day this frees goes to W3, which is the workstream that
actually needs it.

The check still happens on the Seeker before W2 is built on top of it, because it
costs almost nothing and the cost of being wrong is high. If it were ever to
fail, the fallback is a per-platform session key: the player PDA is keyed by the
wallet, so the *character* is unchanged, and the cost is one extra
`authorize_session` popup on first mobile login plus a branch in
`sessionManager.ts`.

**Acceptance:** both derived pubkeys recorded in this file.

---

### W1 — Native Android shell

**2-3 days**

- `apps/android/` Capacitor project, app id `io.solanacity.app` (matches the
  existing `assetlinks.json` and `dapp-store/config.yaml`).
- Static export of the game client into the APK; API calls and RPC stay remote.
  This requires splitting the build: the 12 `src/app/api/*` routes stay
  server-side on Vercel, the client bundle is exported for packaging.
- Env split so one codebase produces web and Android builds off the same program
  IDs and RPC config.
- Native splash and boot, no browser chrome, no URL bar, immersive fullscreen.
- Android back button mapped to in-game panel dismissal, not to app exit.
- Orientation handling that replaces the web `RotatePrompt`.

**Acceptance:** the APK installs on a Seeker or Android device, boots to the city
offline up to the wallet step, and shows no browser UI anywhere.

---

### W2 — Native wallet: MWA + Seed Vault + Keystore

**3-4 days**

- Kotlin MWA client (`mobile-wallet-adapter-clientlib`) behind a Capacitor
  plugin, exposing `authorize`, `signMessage`, `signTransaction` and
  `signAndSendTransaction` to the WebView.
- Wire that plugin into the existing `wallet:needSign` / `wallet:needSignMessage`
  event bus so `sessionKeys.ts` is untouched. The bus is already the seam.
- Keep `MwaRegistration.tsx` for the browser path; the native plugin takes over
  inside the app.
- **Session key moves to Android Keystore / EncryptedSharedPreferences** instead
  of `localStorage`. A signing key sitting in WebView storage is the weakest part
  of the current design, and fixing it is a genuine native win, worth a slide in
  the deck.
- Seed Vault detection and the Seeker badge path, exercised on device.

**Acceptance:** connect with Seed Vault on a Seeker, derive the session key, walk
around, and confirm the same character appears on solanacity.io in a browser with
the same wallet.

---

### W3 — Touch-first gameplay pass

**4-5 days**

This is the workstream that decides whether judges see a port or an app. The
current `MobileControls.tsx` is a web joystick bolted onto a keyboard game.

- Rebuild the joystick: dead zone, capture radius, 8-way versus analog tuning,
  thumb-anchored origin rather than a fixed position.
- Tap-to-move with pathfinding as the primary movement verb, joystick as the
  precision fallback.
- One-thumb reachability pass on every panel: wardrobe, stocks, Sol Mechs, chat,
  hunt. Anything needing two hands or a hover state gets reworked.
- Safe areas for notch and gesture bar, on device, not in a simulator.
- Performance budget: sustained 60fps on a mid-range Android. Phaser texture
  memory audit, atlas consolidation, dynamic resolution when frames drop.
- Portrait support or an honest landscape lock, decided on device.

**Acceptance:** a player completes a full loop (connect, walk, talk to an NPC,
join a hunt, chat) with one thumb, at 60fps, with no UI element under the notch
or gesture bar.

---

### W4 — Haptics

**1 day**

Capacitor Haptics plugin, fired on NPC interaction, PvP hit and loss, hunt target
found, mech assembly snap, and transaction confirmed on the ER. Distinct patterns
per event, plus a settings toggle.

**Acceptance:** each event has a deliberately chosen pattern, not one generic
buzz.

---

### W5 — Push notifications

**3-4 days**

The city is asynchronous and multiplayer, so notifications are a mechanic, not
decoration. This is the strongest non-wallet mobile argument available.

- FCM via Capacitor Push Notifications.
- Token registry: new `src/app/api/push/register` route, wallet-to-token map in
  the existing Upstash KV. Reuses `src/lib/kv.ts`.
- Send endpoint `src/app/api/push/notify`, called by the client that causes the
  event, so no chain-watching daemon is required.
- Triggers, in priority order:
  1. Someone found the Find Someone target before you, round over
  2. New hunt round started, target is live
  3. PvP challenge received in Sol Mechs
  4. Chat mention in the city
- Deep link from the notification into the relevant panel.
- Opt-in, per-category toggles, quiet by default.

**Acceptance:** a hunt round started from a web client raises a notification on
the Android device within seconds, and tapping it opens the hunt panel.

---

### W6 — Battery and network awareness

**2 days**

`OnChainMultiplayer.ts` polls PDAs every 500ms plus discovery every 12s. On a
phone that is a battery and data problem, and reviewers do notice.

- Pause polling on app background via the Capacitor lifecycle, resume and resync
  on foreground.
- Back off the poll interval on cellular versus wifi.
- Degrade gracefully on connection loss and resync on recovery, rather than
  showing a dead city.

**Acceptance:** measured battery draw over 15 minutes of play, before and after,
in the deck.

---

### W7 — Cross-play hardening

**2-3 days**

- **Parity audit**: walk every feature on both clients, list what differs, then
  fix it or explicitly scope it out.
- **Version gate**: the APK is frozen at submission while the web deploys
  continuously. Add a minimum-client-version key to the existing
  `src/app/api/flags` route; the app checks it on boot and shows an update prompt
  rather than desyncing.
- **Deep links / App Links**: `assetlinks.json` already exists with a placeholder
  fingerprint. Fill it from the real signing key so solanacity.io invites open the
  app. This is the web-to-mobile funnel for the demo.
- **Platform presence (optional)**: a small mobile indicator next to players on a
  phone. Must be off-chain via KV, since an on-chain field would require a
  program redeploy.

**Acceptance:** a scripted two-device demo where a web player and an Android
player see each other move, chat, and compete in the same hunt round.

---

### W8 — Submission package

**2-3 days**

- Signed release APK. Keystore and passwords into a password manager on day one;
  losing them means never updating the listing.
- GitHub repo tidy, with a README stating the pre-existing web app and the mobile
  work built during the hackathon, plus a changelog of the mobile commits.
- Demo video: two real devices side by side, web and Seeker, in the same world.
  Lead with the cross-play shot and with Seed Vault signing, not a menu tour.
- Pitch deck.
- dApp Store: `dapp-store/config.yaml` needs emails and screenshots; publisher,
  app and release NFTs per `SEEKER_LAUNCH.md` steps 4 to 7. Not required by the
  deadline, but required within 30 days of winning, so it should be rehearsed.

---

## 6. Effort summary

| Workstream | Days | In minimum cut |
|---|---|---|
| W0 Session key check | folded into Phase 0 | yes |
| W1 Native shell | 2-3 | yes |
| W2 MWA + Seed Vault + Keystore | 3-4 | yes |
| W3 Touch-first pass | 4-5 | partial (2) |
| W4 Haptics | 1 | yes |
| W5 Push notifications | 3-4 | no |
| W6 Battery and network | 2 | no |
| W7 Cross-play hardening | 2-3 | partial (1) |
| W8 Submission package | 2-3 | yes |
| **Total** | **19-25** | **~10-12** |

**Minimum cut** (W0, W1, W2, W4, a trimmed W3 and W7, W8) still produces a
defensible entry: native shell, native wallet with hardware-backed key storage,
real touch controls, cross-play demo. It drops push notifications, which is the
single most persuasive mobile-only feature, so cut that last.

---

## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| MWA signature bytes differ from web | Cross-play identity splits | Resolved against the MWA spec and the shipped adapter, see section 4. Confirmed on device in 0.3. |
| Judges still read Capacitor as a wrapper | Low score | Volume of native Kotlin we write, plus mobile-only features with no web equivalent (push, haptics, Keystore) |
| Phaser performance on mid-range Android | Bad demo | Perf budget in W3, tested on a real low-end device early |
| Devnet versus mainnet | dApp Store expects a real app | Decide early, see section 8 |
| Frozen APK desyncs from live web | Broken demo | Version gate in W7, and freeze web deploys during judging |
| Keystore loss | Can never update the listing | Password manager, day one |
| Registration honesty | Disqualification | README and submission state the project start date and scope the mobile work explicitly |

---

## 8. Decisions

| Decision | Status |
|---|---|
| Submission deadline | **2026-10-07.** 20 calendar days from 2026-09-17. |
| Test hardware | **Seeker on hand.** Seed Vault work can be done on the real device from day one. |
| Devnet or mainnet for the submission build | **Open.** Recommendation: devnet for the judged build (cheaper iteration, it is where the program already lives), with the mainnet switch in `SEEKER_LAUNCH.md` step 1 rehearsed but not shipped until the 30-day publish window. |
| Eligible countries list | **Open.** Confirm before investing, it decides whether USDC prizes are in play at all. |
| Landscape lock or portrait support | **Open.** Decided on the Seeker during W3. |

### Calendar reality

The full scope is 20 to 26 developer-days against 20 calendar days. It fits only
at close to full-time including weekends, with no slack. The plan below therefore
treats **W6 as cut** and **W5 as the swing item**, and sets a hard APK freeze on
**2026-10-05**, leaving two days for the video and the deck. Those two days are
not padding. Recording a clean two-device demo and building a deck reliably takes
longer than anyone budgets.

| Window | Work |
|---|---|
| Sep 18-19 | Phase 0: toolchain, keystore, two zero-code experiments |
| Sep 20-21 | Start W1 (W0 folded into Phase 0) |
| Sep 22-24 | W1 native shell |
| Sep 25-29 | W2 MWA + Seed Vault + Keystore |
| Sep 30 - Oct 2 | W3 touch pass, W4 haptics |
| Oct 2-4 | W5 push notifications (swing item) |
| Oct 4-5 | W7 cross-play hardening, rehearse the two-device demo |
| **Oct 5** | **APK freeze. No more code.** |
| Oct 5-7 | W8 video, deck, submission |

---

## 9. Phase 0: the first 48 hours

Nothing here is the build. It is the work that makes the build predictable, and
two of the items answer the largest open risk without writing any Android code.

### 0.1 Toolchain and device (half a day, mostly waiting on downloads)

- JDK 17, Android Studio with the SDK, platform tools.
- Developer mode and USB debugging on the Seeker, then confirm `adb devices`
  actually lists it. This is the step that eats an afternoon when it goes wrong.
- Seed Vault on the Seeker holding a **throwaway devnet seed phrase**, funded
  with devnet SOL.
- That same seed phrase imported into desktop Phantom. Both sides must be the
  same wallet or experiment 0.3 proves nothing.

### 0.2 Signing keystore, on day one

Generate the release keystore and put it, with both passwords, into a password
manager before any other work. Everything downstream depends on its SHA-256
fingerprint: `assetlinks.json`, App Links, the dApp Store release NFT. Losing it
means the listing can never be updated, and there is no recovery.

### 0.3 Confirm session key parity, with zero Android code

The browser MWA path already ships in `MwaRegistration.tsx`. On the Seeker, open
solanacity.io in the browser, connect through Seed Vault, and read the console
line the client already prints:

```
[SessionKey] derived deterministic key <8 chars>… for <8 chars>…
```

Then do the same on desktop Phantom with the same wallet. The 8 characters
should match: per section 4 this is settled on the spec and on the shipped
adapter code, so this is a confirmation, not an experiment. Browser MWA and
native MWA both hand the raw payload to the same wallet app for `sign_messages`,
so a match here also covers the native client in W2.

Ten minutes, and it retires the one unknown that could have reshaped the
architecture. If it somehow differs, the fallback is the per-platform session key
described in W0.

**The message is load-bearing and contains a trap.** The exact payload is:

```
Solana City<U+2014>session key
Wallet: <base58>
Signing derives your in-game session key. Only sign on solanacity.io.
```

The separator on line 1 is an **em dash, U+2014, three UTF-8 bytes `E2 80 94`**,
with a space on each side. Verified against `sessionKeys.ts:77`. There is no
trailing newline.

When this string is reproduced in Kotlin, write the separator as a unicode escape
(backslash, `u`, `2014`) rather than pasting the character, and let no editor,
formatter or linter normalise it. One byte different is a different signature, a
different session key, and a player split in two.

This is not hypothetical: while writing this very document the escape sequence was
silently normalised into a literal em dash on disk. Build the message in Kotlin
from an explicit byte array and assert its length and SHA-256 in a unit test, so a
future normalisation fails a test instead of splitting players.

### 0.4 Experiment: parity audit on the Seeker, also zero code

Play the live site on the Seeker for half an hour and write down every place the
game fights the device: panels that need two hands, controls that miss, text
under the notch or the gesture bar, anything unreachable one-thumbed, and the
frame rate when the city is busy. That list becomes the W3 backlog, written from
the real device rather than guessed at.

### 0.5 Commit hygiene for the eligibility story

The submission has to show significant new mobile development inside the
hackathon window. Keep working on `main` as usual, but prefix every mobile commit
consistently (`feat(android):`, `fix(android):`, `perf(android):`) so the
changelog for the README extracts in one command:

```bash
git log --grep="(android)" --since=2026-09-17 --oneline
```

---

## 10. Relationship to existing docs

- `SEEKER_LAUNCH.md` — keep for the dApp Store publishing procedure (steps 4 to
  8). **Steps 1 to 3, the Bubblewrap TWA build, are superseded by W1.**
- `REDEPLOY_CHECKLIST.md` — untouched. This scope needs no program changes.
