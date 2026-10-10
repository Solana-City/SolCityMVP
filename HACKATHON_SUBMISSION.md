# CLOCK IN submission checklist

Deadline **2026-10-12**, extended from 10-08. **No freeze**: the judges of both
hackathons count continued development after submission, so the city keeps
shipping (owner, 2026-10-10). Audited 2026-10-06.

This file is the single source of truth for submission status. The plan and the
reasoning live in `MOBILE_HACKATHON_SCOPE.md`; this is only what is done and what
is not.

## Mandatory, from the rules

| Item | Status |
|---|---|
| Functional Android APK | **Done.** Debug-signed, installs and runs on a Seeker |
| Public GitHub repo | **Done.** github.com/Solana-City/SolCityMVP |
| Demo video | **Done** by the user, 2026-10-02 |
| Pitch deck | **Done** by the user, 2026-10-02 |

All four exist. What remains is quality and the release build.

## Judging criteria, and what we have for each

| Criterion | What answers it | Status |
|---|---|---|
| Stickiness, a reason to come back | Push notifications were the plan | **Dropped**, see below |
| User experience | Responsive UI for Seeker, haptics | **Done** |
| Innovation | Web and Seeker players in one on-chain world, no wallet popups mid-game | Shown in the demo video |
| Presentation | Video, deck, README | **Done** |

## Push notifications: cut on 2026-10-02

Push was the strongest answer to the first criterion, and the plan treated it as
core. With six days left, two mandatory deliverables not started, and the touch
pass untouched, it no longer fits: it needs 3 to 4 days plus a Firebase project.

Spending those days on push would put the video and the deck at risk, and a
submission without them is not a submission. If the touch pass finishes early and
Firebase exists, it can come back.

## What does not need the user

- [x] README section on the Android app and the hackathon work
- [x] Haptics wired to game events through the existing bridge
- [x] Release build validated under R8: the minified dex still carries
      SolCityNative, haptic, version, the web-shell user-agent marker and the
      solana-wallet hand-off, so the proguard keep rule holds. 2 MB, against
      29.6 MB for the debug build
- [ ] Signed release APK with the real keystore

## What needs the user

| Need | Why it blocks |
|---|---|
| **Keystore wiring** | The keystore itself exists (user, 2026-10-09). What is missing is the three Gradle properties that make the build use it, which hold the passwords and so cannot be set from here. See "Signing the release APK" |
| **Devnet or mainnet for the judged build** | Recommendation: devnet |
| **Eligible countries list** | Decides whether the USDC prize exists for this team at all |
| **Contact and support email** | `dapp-store/config.yaml` still has REPLACE_WITH placeholders, needed only for publishing |

## Signing the release APK

The keystore exists: `C:\Users\mazza\solcity-release.keystore`, created
before 10-09. It is outside the repo on purpose and must stay there.

`app/build.gradle.kts` only signs when it can see all three of
`WEB_SHELL_SIGNING_STORE_FILE`, `WEB_SHELL_SIGNING_STORE_PASSWORD` and
`WEB_SHELL_SIGNING_KEY_ALIAS` (`hasReleaseSigning`). With any of them missing it
builds the release unsigned, quietly, which is what a release build does today.

The two passwords can also come from the environment. The store path and the
alias cannot: they are read with `findProperty` only. So they go in the
**user-level** Gradle properties, never in the repo:

`C:\Users\mazza\.gradle\gradle.properties` (create the file):

```properties
WEB_SHELL_SIGNING_STORE_FILE=C:/Users/mazza/solcity-release.keystore
WEB_SHELL_SIGNING_KEY_ALIAS=<the alias>
WEB_SHELL_SIGNING_STORE_PASSWORD=<the store password>
WEB_SHELL_SIGNING_KEY_PASSWORD=<the key password, if it differs>
```

Forward slashes even on Windows: a backslash is an escape in a properties file.

To read the alias back out of the keystore, which prompts for the password:

```
keytool -list -keystore C:/Users/mazza/solcity-release.keystore
```

Then, with the Android SDK on the path:

```
cd apps/android
./gradlew assembleRelease
```

The APK lands in `apps/android/app/build/outputs/apk/release/`. Confirm it is
really signed, and with the right key, before it goes anywhere:

```
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --print-certs app-release.apk
```

`ANDROID_HOME` is not set in this shell; the SDK is at
`C:\Users\mazza\AppData\Local\Android\Sdk`. Gradle needs it too, through
that variable or a `local.properties` with `sdk.dir`.

**Keep the keystore and both passwords in a password manager today.** Losing
them does not cost a rebuild, it costs the listing: the dApp Store will never
accept an update signed by a different key.

## Shipping during judging

There is no freeze. Both hackathons treat continued development as a signal, so
work carries on through judging, and that is the owner's call (2026-10-10).

The hazard the freeze was guarding against does not go away with it: the APK
loads the live site, so **the judged app is whatever is deployed at the moment a
judge opens it**, which can be weeks after submission. A broken deploy during
judging breaks the submission itself, not just the web.

So the rule changes shape rather than disappearing. Through judging:

- Push work that has been **run on a device**, not work that only typechecks.
- Treat a change to boot, wallet connect, or the claim flows as higher stakes
  than a new NPC or a sprite: those are the paths a judge walks first.
- A change that cannot be tested before it is needed is better held until it
  can be.

## Not required by the deadline

Publishing to the dApp Store. Winners have 30 days after the announcement. The
procedure is in `SEEKER_LAUNCH.md` steps 4 to 8, and `dapp-store/config.yaml`
still needs emails and screenshots.

## Day plan

| Day | Work |
|---|---|
| Oct 2 | README, haptics, R8 validated, video and deck done |
| Oct 3 | Seeker Lover, SKR balance read on mainnet, gift wired |
| Oct 6 | Decide the Seeker gift (art, or reserve an existing hat) and ORE |
| Oct 7-9 | ORE, if taken. Otherwise install the release APK and play a full loop |
| Oct 10 | Development continues; no freeze |
| Oct 11 | Submit |
| Oct 12 | Deadline. Buffer, not a work day |

## Audited again on 2026-10-09 (three days left)

What closed since the 10-06 audit, checked against the tree and not the plan:

- **ORE was taken, and it works.** The claim office runs end to end, a finished
  round is read back, and the helmet is earned by striking ORE rather than by
  staking a claim. The ORE Miner stands east of the Remedi building.
- **The Seeker gift delivers.** `Seeker_hat.png` landed on 10-07, the variant is
  in `paperDoll.ts` with `unlockVia: "quest"` (so it is out of the pack pool),
  and `outfitRewards.skrHolder` grants it to a wallet holding SKR. The open item
  from 10-06 is closed. A backpack is prepared and still waiting on art.
- **A Seeker sizing pass** went in on 10-07.

### Still open, and every one of them is the user's

| Need | State today |
|---|---|
| **Real keystore** | Still nothing. `build.gradle.kts` reads `WEB_SHELL_SIGNING_STORE_FILE/_PASSWORD/_KEY_ALIAS`, none of them are set in `gradle.properties`, so `hasReleaseSigning` is false and a release build comes out unsigned. This is the one hard blocker left |
| **Devnet or mainnet** for the judged build | Open. Recommendation unchanged: devnet |
| **Eligible countries** | Open. Decides whether the USDC prize exists for this team |
| **Contact and support email** | `dapp-store/config.yaml` lines 21-22 still read REPLACE_WITH. Needed to publish, not to submit |

### The city kept shipping, which is now the plan

**86 commits landed between 10-06 and 10-09**, including a twenty-colour hair
system, a Player Profile redesign, the swap and send panels merged behind one
pair of tabs, a donations NPC, and **Steve Sends retiring from the city on
10-08**. That was drift against the old plan; as of 10-10 it is the plan.

Two things still want checking, in this order:

1. **Does the demo video still match the city?** It was recorded on 10-02.
   Steve Sends was a named NPC then and is gone now; swap and send have moved.
   If the video shows either, it now contradicts what a judge will see. Either
   re-record the affected shots or accept the mismatch knowingly.
2. **Install the signed release APK and play a full loop against production**
   once the signing properties are set. The R8 build was proven with a throwaway
   key; it has never been played through signed with the real one.

## Open on 2026-10-06

- **The Seeker gift delivers nothing.** The art never landed, and grant() skips a
  reward whose variant is missing, so Seeker Lover promises a gift and hands over
  nothing. Either the art arrives or an existing hat is reserved with `unlockVia`,
  which also removes it from the booster pool.
- **ORE is viable again.** It was cut on 10-02 for want of time. Four extra days
  bring it back: 2 to 3 days, mainnet, hand-rolled instruction encoders. The
  matched prize only pays inside the Top 10, so it is a bet on placing anyway.
- **Push stays cut.** It does not fit alongside ORE, and ORE has the larger prize.
