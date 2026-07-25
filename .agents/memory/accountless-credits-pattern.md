---
name: Accountless pay-per-run credits (toasteth pattern)
description: Design rules for the no-accounts crypto/code credit gate — token model, spend-on-success semantics, and the concurrency invariants that keep it safe.
---

# Accountless credits — durable design rules

The user's preferred monetization for tools: **no accounts, no DB, no wallet-connect** (their "toasteth" pattern — pay on-chain, server verifies, resource unlocks). Ported from their BreakBPM repo into this project by explicit choice; reuse these rules if the gate is ever extended.

## The rules and why

- **Bearer token = the account.** HMAC token in localStorage; the flat-file ledger row is authoritative, the token payload carries only `{id, iat}`.
  **Why:** user explicitly rejected Clerk/accounts/DB ("copy-paste job, strip Clerk, no data saved beyond what exists"). Losing the signing secret (SESSION_SECRET) voids all outstanding tokens — acceptable tradeoff, was called out.
- **Gate must default OFF and be armed by a single env flag.**
  **Why:** dev, self-hosters, and the user's own runs stay free and un-brickable; enforcement is an operator decision, not a code default.
- **Spend AFTER successful delivery, never at admission.** Failed/crashed runs are free; selection-only (pass1) requires a valid token but never debits.
  **Why:** user chose buyer-favoring semantics; a crash eating a paid credit is worse than an occasional free run.
- **Spend-on-success REQUIRES an in-flight reservation at admission.**
  **Why (review finding):** validate-early + spend-late means N parallel runs on a 1-credit token all deliver. Reserve (in-memory is fine single-process) at admission for consuming modes, release in a `finally`, reject over-committed balances with 402.
- **Payment claim and quote allocation must each be ONE store transaction.** Unique-amount search + insert atomic; verify's re-check (quote pending, tx unused) + mark-paid + mint atomic.
  **Why (review finding):** check-then-write split across separate mutex acquisitions let parallel verifies double-mint and parallel quotes collide on amounts — the unique exact amount IS the payment→quote mapping, collisions break claim attribution.
- **Manual-send flow:** unique exact amount (base + random atomic tail) to a fixed address, buyer pastes tx hash, server verifies via RPC. Quote IDs are private, so exact-amount match can't be claim-raced by strangers.

## How to apply
Any new paid unlock in this project (or a port to another): same token module, same gate placement (admission check + reserve → deliver → spend → release), same atomic-claim store shape. The race tests to keep: parallel redeem of a 1-redemption code, parallel runs on a 1-credit token, parallel quote allocation.
