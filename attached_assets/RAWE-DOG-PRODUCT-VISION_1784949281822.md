# rawe-dog — Product Vision (for implementation context)

This document exists so the agent implementing payments and credits understands *why* the product is shaped the way it is.

---

## Core Thesis

Most AI resume tools force the user to:
1. Trust the platform’s model with highly sensitive career data
2. Pay relatively high prices for mediocre, generic output
3. Give up control of their data

rawe-dog takes the opposite approach:

- The user brings their **own model** (API key + endpoint)
- The user keeps full control of their data
- The platform only provides the framework, orchestration, verification, and export quality
- Price is intentionally low (**$1 per generation** as the target)

This is not a black-box AI service. It is a high-quality framework that happens to be sold as a product.

---

## Why $1

- Low enough that almost anyone will try it once
- High enough to filter pure freeloaders and cover costs
- Easy mental math for the user
- Operator does not need massive scale to make meaningful money

The product does not need to capture the entire market. A relatively small number of paying users is sufficient.

---

## Proven Loop

The framework has already been used successfully by the creator to land a job.  
(Later termination was unrelated to the quality of the materials.)

This is not theoretical. The core value (grounded, high-quality, personalized career documents) has been demonstrated in the real world.

---

## What the User Actually Buys

1. **One generation credit** → produces a full application kit (resume + cover letter + supporting materials) grounded in their own experience files.
2. Optional: daily job matches (“best match + 3 others”) pulled from the existing TheirStack integration, scored against their Master Profile.

The job search feature is statistical, not magical. The value is reducing friction and surface area of the job hunt, not guaranteeing interviews.

---

## Non-Negotiables

- **BYOM is mandatory.** The system must never require the user to use a model chosen by the operator. Privacy and trust are the product.
- **User data stays under user control.** Easy to plug in, easy to delete.
- **Payments are decentralized-first** (crypto). No chargebacks, minimal personal payment data, clean accounting.
- **Failed generations do not consume a credit.**

---

## Positioning in one sentence

> A dirt-cheap, privacy-first framework that turns your real experience into strong application materials using *your* model — not ours.

---

## Implementation Notes for the Agent

- Treat the $1 price as the default product unit (1 credit = 1 successful kit).
- Keep the credit system simple.
- Do not couple the payment layer to any specific model provider.
- The existing generation pipeline and TheirStack job matching are already valuable; payments are just the gate in front of them.

This vision should guide trade-offs. When in doubt, prefer simplicity, user control, and low friction over feature bloat.
