# Task: Port Crypto Payments + Credits from BreakBPM → rawe-dog

**Goal**  
Turn rawe-dog into a paid product where users pay for resume kit generations (target ~$5 USD, adjustable) while keeping full data privacy via **Bring Your Own Model (BYOM)**. Reuse the battle-tested payment infrastructure from BreakBPM instead of rewriting it.

**Source of truth**  
- BreakBPM repo: `https://github.com/ThatOtherZach/BreakBPM` (main branch)
- Target repo: `https://github.com/ThatOtherZach/rawe-dog` (main branch)

---

## 1. Product Model for rawe-dog

| Concept | BreakBPM | rawe-dog (new) |
|---------|----------|----------------|
| What the user buys | Time-based access (Day / 30-day / Lifetime) | **Generation credits** (1 credit = 1 successful kit) |
| Pricing | Multiple tiers | Single product for now: **1 credit ≈ $5 USD** (make configurable) |
| Consumption | Passive entitlement while pass is active | Credit is consumed only when a kit is successfully generated |
| Discount codes | Yes (admin-minted + Lucky Break) | Yes – keep the same system |
| Crypto | Base USDC + native ETH | Keep the same chains / flow |
| Accounting | CAD sales ledger + FX + tax | Keep – useful for Canadian tax reporting |

**BYOM constraint (non-negotiable)**  
The payment / credit system must never force the user onto a particular model. The LLM layer stays completely user-controlled (API key + base URL). Payments only gate the *framework usage*, not the model.

---

## 2. What to Extract from BreakBPM

### High-value modules (copy + adapt)

| BreakBPM Path | Purpose | Adaptation Notes |
|---------------|---------|------------------|
| `artifacts/api-server/src/lib/cryptoChain.ts` | On-chain payment verification (Base) | Keep almost as-is |
| `artifacts/api-server/src/routes/crypto.ts` | Crypto checkout + status endpoints | Adapt product names / amounts |
| `artifacts/api-server/src/lib/paymentProvider.ts` | Provider-agnostic interface | Keep the seam; Stripe path can stay for later |
| `artifacts/api-server/src/lib/pricing.ts` | Single source of truth for prices | Rewrite for credit packs |
| `artifacts/api-server/src/lib/redeemCore.ts` | Discount / redeem code logic | Reuse heavily |
| `artifacts/api-server/src/lib/adminCodes.ts` | Admin minting of codes | Keep |
| `artifacts/api-server/src/lib/saleEvents.ts` | Sales ledger | Keep |
| `artifacts/api-server/src/lib/fx.ts` + `tax.ts` | FX + CAD tax helpers | Keep |
| `lib/db/src/schema/` related tables | `cryptoOrders`, `discountCodes`, `saleEvents`, etc. | Port the relevant schemas |

### Lower priority / later
- Full Clerk auth (rawe-dog currently has minimal auth – decide whether to bring Clerk or keep it simple)
- Stripe subscription path (not needed for v1)
- Lucky Break / free pass pools (nice-to-have later)

---

## 3. New Credit Model (rawe-dog)

### Database
Add (or adapt) a simple credits table / column:

```ts
// Suggested shape
userCredits: {
  userId: string (PK)
  balance: integer          // remaining generation credits
  lifetimePurchased: integer
  lifetimeConsumed: integer
  updatedAt: timestamp
}
```

Optional: a `creditTransactions` ledger for auditability (purchase, consume, refund, admin grant).

### API surface (new or adapted)

- `POST /api/credits/purchase` – start crypto (or card) checkout for N credits
- `GET  /api/credits/balance` – current balance
- `POST /api/credits/redeem` – apply a discount / redeem code
- Admin endpoints for minting codes and adjusting balances

### Generation gate
In the existing generate pipeline (`/api/generate`):

1. Check `balance >= 1`
2. Start generation
3. On **successful** kit completion → atomically decrement balance by 1
4. On hard failure before any useful output → do **not** consume the credit (or refund it)

Make the price and credit amount configurable via env / settings so the operator can drop from $5 → $1 later without code changes.

---

## 4. Integration Steps (recommended order)

1. **Port the database schemas** for crypto orders, discount codes, and sales events.
2. **Port `cryptoChain.ts` + crypto routes** and make them create *credits* instead of *passes*.
3. **Implement the credit balance + consumption logic**.
4. **Wire the generate endpoint** to require and consume a credit.
5. **Port the redeem / admin code system**.
6. **Port the sales ledger** so Canadian tax reporting still works.
7. **Add a minimal Credits / Account UI** in the frontend (balance, buy more, redeem code).
8. **Keep BYOM completely separate** – settings still only store the user’s own model credentials.

---

## 5. Acceptance Criteria

- [ ] User can pay with crypto (Base USDC preferred) and receive generation credits
- [ ] Discount / redeem codes work and can grant free or discounted credits
- [ ] Admin can mint codes and view sales
- [ ] Generating a kit consumes exactly 1 credit on success
- [ ] Failed generations do not consume a credit
- [ ] Price per credit is configurable
- [ ] User’s own model (API key + base URL) is still the only LLM used
- [ ] Sales ledger records enough data for CAD tax reporting
- [ ] No personal payment data is stored beyond what is required for the crypto order

---

## 6. Out of Scope for this task

- Full BYOM provider abstraction (that can be a follow-up task)
- Stripe / card payments (crypto first)
- Subscriptions or recurring billing
- Marketing pages or pricing page polish
- Changing the core generation pipeline quality / prompts

---

## 7. Notes for the Agent

- Prefer **copy + adapt** over clever abstraction for the first pass. We can clean up shared packages later.
- Keep the existing rawe-dog generate pipeline (selection → parallel drafts → verify → repair) intact.
- The payment system should feel like a thin gate in front of the existing product, not a rewrite.
- When in doubt, look at how BreakBPM handles `cryptoOrders` and the `PaymentProvider` seam – those are the cleanest parts.

**Success looks like**: a user can buy credits with crypto, redeem a code, and generate a resume kit while still using their own model, with a clean sales record on the backend.
