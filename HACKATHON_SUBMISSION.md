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
| Demo video | **Not started** |
| Pitch deck | **Not started** |

Two of the four are missing, and both are mandatory. Nothing else matters until
they exist.

## Judging criteria, and what we have for each

| Criterion | What answers it | Status |
|---|---|---|
| Stickiness, a reason to come back | Push notifications were the plan | **Dropped**, see below |
| User experience | Touch pass on the Seeker, haptics | Haptics wiring in progress, touch pass **not started** |
| Innovation | Web and Seeker players in one on-chain world, no wallet popups mid-game | Exists in the product, **not yet demonstrated** |
| Presentation | Video, deck, README | **Not started** |

## Push notifications: cut on 2026-10-02

Push was the strongest answer to the first criterion, and the plan treated it as
core. With six days left, two mandatory deliverables not started, and the touch
pass untouched, it no longer fits: it needs 3 to 4 days plus a Firebase project.

Spending those days on push would put the video and the deck at risk, and a
submission without them is not a submission. If the touch pass finishes early and
Firebase exists, it can come back.

## What does not need the user

- [x] README section on the Android app and the hackathon work
- [ ] Haptics wired to game events through the existing bridge
- [ ] Touch pass, for whatever can be fixed without seeing the device
- [ ] Deck outline and video script
- [ ] Signed release APK, once the keystore exists

## What needs the user

| Need | Why it blocks |
|---|---|
| **USB debugging, or photos panel by panel** | The touch pass is the largest remaining item and cannot be done blind |
| **Confirm chat and on-chain log on device** | Two fixes shipped on 09-23, still unverified |
| **Devnet or mainnet for the judged build** | Recommendation: devnet |
| **Eligible countries list** | Decides whether the USDC prize exists for this team at all |
| **Contact and support email** | `dapp-store/config.yaml` still has REPLACE_WITH placeholders |
| **Keystore password** | Needed for the signed release APK |
| **Two devices for the demo video** | The cross-play shot is the one that carries the submission |

## Not required by the deadline

Publishing to the dApp Store. Winners have 30 days after the announcement. The
procedure is in `SEEKER_LAUNCH.md` steps 4 to 8, and `dapp-store/config.yaml`
still needs emails and screenshots.

## Day plan

| Day | Work |
|---|---|
| Oct 2 | README, haptics wired, this checklist |
| Oct 3-4 | Touch pass on the Seeker |
| Oct 5 | Signed release APK, store screenshots, deck drafted |
| Oct 6 | **Freeze.** Record the two-device demo |
| Oct 7 | Video edited, deck finished |
| Oct 8 | Submit. Buffer, not a work day |
