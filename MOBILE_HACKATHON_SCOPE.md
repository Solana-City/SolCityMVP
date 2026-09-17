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
| **Same session key for the same wallet on both platforms** | **At risk** | **W0** |
| Feature parity so a mobile player is not a second-class citizen | Gaps exist | W3 |
| Protocol skew between a frozen APK and a continuously deployed web build | No guard today | W7 |

### The landmine: session key derivation

`sessionKeys.ts:78-84` derives the in-game keypair as:

```
seed = SHA256( ed25519_sign(wallet, FIXED_MESSAGE) )
```

Because ed25519 signatures are deterministic, the same wallet yields the same
session key on every device. That is what makes a player continuous across
browsers today, and it is what makes cross-play work with no migration at all.

Two ways Android silently breaks it:

1. **Someone edits the message string.** It contains `Only sign on
   solanacity.io.` and there will be a temptation to say "in the app" instead.
   Different bytes, different key, and the ER never authorized that key. The
   message is load-bearing. It stays byte-identical.
2. **MWA wraps the payload.** Some wallets sign raw bytes; some apply the
   off-chain message signing envelope first. If Seed Vault via MWA does not
   return a signature over the exact bytes Phantom web signs, the same wallet
   gets two different session keys, and the mobile player shows up as a stranger
   standing next to their own web character.

Item 2 is unverified and cannot be assumed either way. W0 exists to settle it
before anything is built on top of it.

---

## 5. Workstreams

Effort is in developer-days. W0 blocks the wallet work; the rest can move in
parallel.

### W0 — Session key parity spike (blocking, do first)

**1 day**

- Minimal Android harness: connect via native MWA, sign the exact
  `sessionKeys.ts` message, return the signature bytes.
- Compare the derived session pubkey against the one Phantom web derives for the
  same wallet.
- Outcomes:
  - **Match** → cross-play identity is free, proceed as planned.
  - **Mismatch** → fall back to a per-platform session key. The player PDA is
    still keyed by the wallet, so the *character* stays the same; what changes is
    that the mobile session key needs its own `authorize_session`. Costs one
    extra popup on first mobile login and a branch in `sessionManager.ts`.

**Acceptance:** a written answer, with both pubkeys, committed into this file.

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
| W0 Session key spike | 1 | yes |
| W1 Native shell | 2-3 | yes |
| W2 MWA + Seed Vault + Keystore | 3-4 | yes |
| W3 Touch-first pass | 4-5 | partial (2) |
| W4 Haptics | 1 | yes |
| W5 Push notifications | 3-4 | no |
| W6 Battery and network | 2 | no |
| W7 Cross-play hardening | 2-3 | partial (1) |
| W8 Submission package | 2-3 | yes |
| **Total** | **20-26** | **~11-13** |

**Minimum cut** (W0, W1, W2, W4, a trimmed W3 and W7, W8) still produces a
defensible entry: native shell, native wallet with hardware-backed key storage,
real touch controls, cross-play demo. It drops push notifications, which is the
single most persuasive mobile-only feature, so cut that last.

---

## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| MWA signature bytes differ from web | Cross-play identity splits | W0, before anything else |
| Judges still read Capacitor as a wrapper | Low score | Volume of native Kotlin we write, plus mobile-only features with no web equivalent (push, haptics, Keystore) |
| Phaser performance on mid-range Android | Bad demo | Perf budget in W3, tested on a real low-end device early |
| Devnet versus mainnet | dApp Store expects a real app | Decide early, see section 8 |
| Frozen APK desyncs from live web | Broken demo | Version gate in W7, and freeze web deploys during judging |
| Keystore loss | Can never update the listing | Password manager, day one |
| Registration honesty | Disqualification | README and submission state the project start date and scope the mobile work explicitly |

---

## 8. Decisions needed before W1 starts

1. **Hackathon launch date and submission deadline.** Determines whether the full
   scope or the minimum cut is the target, and the window the mobile commits must
   land in.
2. **Devnet or mainnet for the submission build.** `SEEKER_LAUNCH.md` step 1
   switches to mainnet. Devnet is fine for judging and cheaper to iterate;
   mainnet is needed for the dApp Store within 30 days of winning. A devnet demo
   build plus a mainnet publish build is the likely answer.
3. **Eligible countries list.** Confirm before investing, since it decides whether
   USDC prizes are in play at all.
4. **Landscape lock or portrait support**, decided on a real device in W3.
5. **Test hardware.** Is a Seeker available, or is this an emulator plus a generic
   Android phone? The Seed Vault work needs the real device.

---

## 9. Relationship to existing docs

- `SEEKER_LAUNCH.md` — keep for the dApp Store publishing procedure (steps 4 to
  8). **Steps 1 to 3, the Bubblewrap TWA build, are superseded by W1.**
- `REDEPLOY_CHECKLIST.md` — untouched. This scope needs no program changes.
