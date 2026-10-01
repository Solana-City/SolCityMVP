# Linking an X account to a Sol City profile — study, not a build

Asked for 2026-10-01: understand the best way to do it before building anything.
Nothing here is implemented.

## The headline: X has no free tier any more

This is the fact that decides the design, and it changed recently enough to be
worth stating plainly.

On **2026-02-06** X replaced its tiered plans with **pay-per-use as the
default**. There is no free tier for new developers, and new customers cannot
sign up for Basic or Pro at all. Legacy Basic ($200/mo) and Pro ($5,000/mo)
remain only for existing subscribers. Free access is granted case by case to
"for-good public utility apps".

Rates that matter to us:

| Operation | Cost |
|---|---|
| **User: Read** (someone else's profile, including our players) | **$0.010 per resource** |
| Posts: Read | $0.005 per resource |
| "Owned reads" (the app owner's OWN data) | $0.001 per resource |
| OAuth authorization itself | not billed |

**The owned-read discount does not apply to us.** It is for an app reading the
data of the account that owns the developer app. Our players are not that
account, so every player we verify is a full User Read.

No contracts, no minimum spend, credits bought up front.

## So what does verifying one player cost?

**$0.010, once per player.** Here is why it cannot be zero.

X's OAuth 2.0 is plain OAuth 2.0 with PKCE. The documented scopes are
`tweet.read`, `users.read`, `follows.read`, `follows.write`, `offline.access` —
there is **no `openid` scope and no documented `id_token`**. That means the token
response tells us a token was granted but not *who* granted it. To learn the
handle we have to call `GET /2/users/me`, which is a billed User Read.

> Worth confirming in console.x.com before building, since it is the whole
> difference between $0 and $0.010 per player. If X has quietly added OIDC, the
> handle would come out of the id_token for free.

At $0.010 per link: 100 players linking costs $1. 10,000 costs $100. One-off per
player, not recurring, and only players who choose to link.

**That is the honest answer to "does it cost us anything": yes, a little, and
there is no architecture that avoids it** while still proving the account is
really theirs. The alternatives all cost more or prove nothing:

| Approach | Cost | What it proves |
|---|---|---|
| OAuth + `/2/users/me` | $0.010 / player, once | They control the account |
| Post a code, we read the post | $0.005+ per check, and a search is pricier | Same, worse UX |
| Code in their X bio, we read the profile | $0.010, same as OAuth | Same, worse UX |
| Let them type a handle, no check | **$0** | **Nothing** |

## Why the free option is the dangerous one

Typing an unverified handle costs nothing and should still be refused.

A handle shown on a player's card is a claim about a real person. Unverified, a
player could put a known founder's handle on their profile and walk around the
city as them. That is impersonation with our UI vouching for it, and it is a
different class of problem from a forged achievement: a fake badge is vanity, a
fake identity targets somebody real.

If we ever want an unverified version, it has to be visibly unverified — and a
greyed-out handle nobody trusts is not worth a feature.

## Where the handle should live, and the trap

This is where it intersects with the on-chain preference, and there is a real
catch.

**A handle written by the player cannot be trusted, even on chain.** The session
key can already write to its own `PlayerState` with no popup. If we add a
`x_handle` field and a session-signed setter, any player can publish any handle.
On-chain storage makes a forged handle *more* credible, not less, because it
looks authoritative.

So an on-chain handle needs an **attestor**: our server verifies through OAuth,
signs the (wallet, handle) pair, and the program accepts the write only with
that signature. Concretely, a `TRUSTED_ATTESTOR: Pubkey` constant and an
instruction that requires it as a signer, or an Ed25519 signature verified
against it.

Two routes:

| | On chain, attested | Off chain (Redis) |
|---|---|---|
| Forgery | impossible | impossible (only our server writes) |
| Program change | **yes** | none |
| Reads by other players | free, rides the position poll | 1 KV command per card opened |
| Works if our server disappears | yes | no |
| Composable by other apps | yes | no |

**The deadline that matters:** an attested on-chain handle needs an instruction
in the program, and there is **one redeploy** planned. If we want the handle on
chain, that instruction has to go into the SAME deploy as the profile and friends
work, or it waits for another reset. The Redis route has no such constraint and
can ship any time.

A cheap hedge: add the attestor constant and the setter instruction to this
deploy even if the OAuth side is not built yet. The instruction is small, nothing
calls it until we are ready, and it keeps the on-chain option open without
blocking anything. That is the one decision this study would ask for now.

## What building it would actually involve

Roughly, when we come back to it:

1. An X developer app with OAuth 2.0 + PKCE, and credits on the account.
2. `/api/x/start` and `/api/x/callback` routes. The callback exchanges the code,
   makes the one `/2/users/me` call, and records (wallet, handle, verified_at).
   The client secret never leaves the server.
3. Session-key auth on our side, the same pattern `api/dm` already uses, so the
   player links without a wallet popup.
4. Either the attestation signature (on-chain route) or a `x:handle:<wallet>`
   key (Redis route).
5. On the card: the handle, linked out, with the same open-elsewhere icon every
   external link already uses.
6. A rate limit on the callback. Each attempt costs us a real $0.010, so this is
   the first endpoint we have where spam has a direct bill attached. Cache a
   wallet's result and refuse re-verification within a window.

Not yet decided, and worth deciding before building:

- Is one verification permanent, or does a handle get re-checked? Re-checking
  costs $0.010 each time, and people do rename and delete accounts.
- Does linking earn anything? If it grants an outfit or points, the $0.010
  becomes a user-acquisition cost rather than a feature cost, which is a
  different budget. (Not proposing it, just noting it changes the maths.)
- Do we show follower counts? Those are more billed reads, and they go stale.

## Sources

- [X API pay-per-usage pricing and credits (official)](https://docs.x.com/x-api/getting-started/pricing)
- [X OAuth 2.0 user access token (official)](https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/user-access-token)
- [X (Twitter) API Pricing in 2026: All Tiers](https://postproxy.dev/blog/x-api-pricing-2026/)
- [X API Pricing 2026: Pay-Per-Use Rates, Limits, Costs](https://www.outstand.so/blog/x-api-pricing)
- [X API Pay-Per-Use Explained: 2026 Rates, Credits, and Real Monthly Costs](https://opentweet.io/how-to/x-api-pay-per-use-explained)
