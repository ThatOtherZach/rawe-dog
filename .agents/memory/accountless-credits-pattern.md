---
name: Accountless pay-per-search credits (toasteth pattern)
description: Design rules for the no-accounts crypto/code credit gate — token model, product kind, spend-on-success semantics, and the concurrency invariants that keep it safe.
---

# Accountless credits — durable design rules

The user's preferred monetization for tools: **no accounts, no DB, no wallet-connect** (their "toasteth" pattern — pay on-chain, server verifies, resource unlocks). Ported from their BreakBPM repo into this project by explicit choice; reuse these rules if the gate is ever extended.

## Product model

- **Kit generation is FREE** — `/api/generate` has no credit check. Kits are the free lane.
- **Postings search costs $1** — `POST /api/postings/refresh` requires a `kind: "search"` bearer token when `RAWEDOG_CREDITS_ENFORCED=true`.
- **Two localStorage keys**: `rawe.search.token` / `rawe.search.quote` for search credits (Postings page); `rawe.credit.token` / `rawe.credit.quote` is the legacy kit key (kept for any outstanding tokens, not used for new purchases).
- **Token kind field**: `CreditToken.kind?: "search"`. All newly minted tokens get `kind: "search"`. Tokens without a kind (legacy) are rejected by the search gate (strict kind check). The generate route never checks kind.

## The rules and why

- **Bearer token = the account.** HMAC token in localStorage; the flat-file ledger row is authoritative, the token payload carries only `{id, iat}`.
  **Why:** user explicitly rejected Clerk/accounts/DB ("copy-paste job, strip Clerk, no data saved beyond what exists"). Losing the signing secret (SESSION_SECRET) voids all outstanding tokens — acceptable tradeoff, was called out.
- **Gate must default OFF and be armed by a single env flag (`RAWEDOG_CREDITS_ENFORCED`).**
  **Why:** dev, self-hosters, and the user's own runs stay free and un-brickable; enforcement is an operator decision, not a code default.
- **Spend AFTER successful fetch/persist, never at admission.** Provider/quota/network failures are free; scoring failures after a successful fetch still spend (results were delivered).
  **Why:** user chose buyer-favoring semantics; a crash eating a paid credit is worse than an occasional free run.
- **Spend-on-success REQUIRES an in-flight reservation at admission.**
  **Why (review finding):** validate-early + spend-late means N parallel runs on a 1-credit token all deliver. Reserve (in-memory is fine single-process) at admission, release in a `finally`, reject over-committed balances with 402 `in_use`.
- **Token check runs before API-key/filters checks.** Misconfiguration (missing TheirStack key, no filters) returns 400 but the credit is released (not spent) — no credit is ever burned by a bad server config.
- **Payment claim and quote allocation must each be ONE store transaction.** Unique-amount search + insert atomic; verify's re-check (quote pending, tx unused) + mark-paid + mint atomic.
  **Why (review finding):** check-then-write split across separate mutex acquisitions let parallel verifies double-mint and parallel quotes collide on amounts — the unique exact amount IS the payment→quote mapping, collisions break claim attribution.
- **Manual-send flow:** unique exact amount (base + random atomic tail) to a fixed address, buyer pastes tx hash, server verifies via RPC. Quote IDs are private, so exact-amount match can't be claim-raced by strangers.

## How to apply
Any new paid unlock in this project (or a port to another): same token module, same gate placement (admission check + reserve → deliver → spend → release), same atomic-claim store shape. Add a new `kind` value to `CreditToken` and enforce it at the gate. The race tests to keep: parallel redeem of a 1-redemption code, parallel refreshes on a 1-credit token, parallel quote allocation.
