# CLOCK IN submission checklist

Deadline **2026-10-12**, extended from 10-08. Code and APK freeze **2026-10-10**.
Audited 2026-10-06.

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
| Oct 3 | Seeker Lover, SKR balance read on mainnet, gift wired |
| Oct 6 | Decide the Seeker gift (art, or reserve an existing hat) and ORE |
| Oct 7-9 | ORE, if taken. Otherwise install the release APK and play a full loop |
| Oct 10 | **Freeze**, and it stays frozen through judging |
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

### The freeze has not happened

The header of this file says the code and APK freeze is 10-10; the section
below says web deploys freeze from 10-06. **86 commits landed between 10-06 and
today**, including a twenty-colour hair system, a Player Profile redesign, the
swap and send panels merged behind one pair of tabs, a donations NPC, and
**Steve Sends retiring from the city on 10-08**.

That matters more here than it would anywhere else, because the APK loads the
live site: the judged app is whatever is deployed when a judge opens it, which
can be weeks after submission.

Two things to check before the freeze, in this order:

1. **Does the demo video still match the city?** It was recorded on 10-02.
   Steve Sends was a named NPC then and is gone now; swap and send have moved.
   If the video shows either, it now contradicts what a judge will see. Either
   re-record the affected shots or accept the mismatch knowingly.
2. **Install the signed release APK and play a full loop against production**
   once the keystore exists. The R8 build was proven with a throwaway key; it
   has never been played through signed with the real one.

## Open on 2026-10-06

- **The Seeker gift delivers nothing.** The art never landed, and grant() skips a
  reward whose variant is missing, so Seeker Lover promises a gift and hands over
  nothing. Either the art arrives or an existing hat is reserved with `unlockVia`,
  which also removes it from the booster pool.
- **ORE is viable again.** It was cut on 10-02 for want of time. Four extra days
  bring it back: 2 to 3 days, mainnet, hand-rolled instruction encoders. The
  matched prize only pays inside the Top 10, so it is a bet on placing anyway.
- **Push stays cut.** It does not fit alongside ORE, and ORE has the larger prize.
