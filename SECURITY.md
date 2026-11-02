# Security policy

Solana City runs two on-chain programs and a web app that moves real value:
pack payments, tradable cosmetics, and swaps through third-party venues. If
you find a way to break any of them, we want to hear it before anyone else
does.

## In scope

| Component | Where |
|---|---|
| `sol-city` program | `HPvDFVnruSXHwKKP44eUvRh8oYqBaHCeQbK1sKWT1aU2` · `programs/sol-city` |
| `sol-city-collectibles` program | `EptRxVBysFzJEz52r58c2yCkpDGvF55aBPj1eCkWaphz` · `programs/sol-city-collectibles` |
| Shared crate | `programs/sol-city-catalog` |
| Web app | https://solanacity.io · `apps/web` |
| Android app | `apps/android` |

Out of scope: third-party programs and services we integrate with (Jupiter,
MagicBlock, Metaplex Bubblegum, wallets, RPC providers). Report those to
their owners; tell us too if it affects players here.

## How to report

Privately, through GitHub's private vulnerability reporting:
https://github.com/Solana-City/SolCityMVP/security/advisories/new

Please include what is affected (program, instruction, page), how to
reproduce it, and what an attacker gains. A test or a transaction is worth
more than a description. Do not open a public issue, and do not exploit the
bug beyond what is needed to show it exists, never against other players'
funds or items.

We read reports in English or Portuguese.

## What happens next

We acknowledge a report within 3 business days and keep you updated while we
fix it. We will credit you when the fix ships, unless you prefer otherwise.

The same contact is published inside both program binaries
(`security.txt`) and at https://solanacity.io/.well-known/security.txt.
