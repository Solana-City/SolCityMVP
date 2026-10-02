# CLOCK IN submission checklist

Deadline **2026-10-08**. Code and APK freeze **2026-10-06**, leaving two days for
the video and the deck. Audited 2026-10-02.

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
| **Keystore password** | The release APK was proven with a throwaway key. The real one must be created once, and kept, because losing it means the dApp Store listing can never be updated |
| **Devnet or mainnet for the judged build** | Recommendation: devnet |
| **Eligible countries list** | Decides whether the USDC prize exists for this team at all |
| **Contact and support email** | `dapp-store/config.yaml` still has REPLACE_WITH placeholders, needed only for publishing |

## The freeze matters more than usual

The APK loads the live site, so **the judged app is whatever is deployed at the
moment a judge opens it**, which can be weeks after submission. A broken deploy
during judging breaks the submission, and the demo video will no longer match
what they see.

Freeze web deploys from 10-06 until the results are announced. Anything urgent in
that window should be weighed against the fact that it ships straight into the
hands of the judges.

## Not required by the deadline

Publishing to the dApp Store. Winners have 30 days after the announcement. The
procedure is in `SEEKER_LAUNCH.md` steps 4 to 8, and `dapp-store/config.yaml`
still needs emails and screenshots.

## Day plan

| Day | Work |
|---|---|
| Oct 2 | README, haptics, R8 validated, video and deck done |
| Oct 3-5 | Signed release APK, install it on the Seeker and play a full loop |
| Oct 6 | **Freeze**, and it stays frozen through judging |
| Oct 7 | Submit |
| Oct 8 | Deadline. Buffer, not a work day |
