# BreakBPM Crypto Payment Gateway

**Self-custody on-chain checkout for one-time purchases**

Extracted from [ThatOtherZach/BreakBPM](https://github.com/ThatOtherZach/BreakBPM) for reuse in other apps.

This document is written so a developer can implement the same pattern (or port the existing code) on Replit or elsewhere.

---

## 1. What this is

A complete crypto payment flow that:

- Accepts **USDC** (ERC-20) and **native ETH** on **Base** (or Base Sepolia for testing)
- Issues a locked quote with an exact atomic amount
- Lets the user pay from any wallet (QR / copy-address or connected wallet)
- Verifies the on-chain transaction server-side
- Grants a product (pass, credits, unlock, etc.) only after confirmed payment
- Is fully idempotent and protected against replay / race conditions

No custodial payment processor. You control the receiving wallet.

There is a separate Stripe path in BreakBPM for cards + subscriptions. This document covers **only the crypto side**.

---

## 2. High-level architecture

```
Frontend (CryptoCheckout)
        │
        │  POST /crypto/quote
        ▼
API Server  ──►  crypto_orders table (pending quote)
        │
        │  User pays on-chain (any wallet)
        │
        │  POST /crypto/verify  (or auto-detect for manual USDC)
        ▼
On-chain verification (viem + Base RPC)
        │
        ▼
Grant product + mark order paid
```

### Core files in the original repo

| File | Purpose |
|------|---------|
| `artifacts/api-server/src/lib/cryptoChain.ts` | Network config, Chainlink oracle, amount math, tx verification, USDC auto-detect, signature proof |
| `artifacts/api-server/src/routes/crypto.ts` | `/crypto/quote` and `/crypto/verify` endpoints |
| `lib/db/src/schema/cryptoOrders.ts` | Database table + unique indexes |
| `artifacts/breakbpm/src/components/CryptoCheckout.tsx` | Full UI (pass picker, QR, polling, resume) |
| `artifacts/api-server/src/lib/pricing.ts` | Shared price catalog (server is source of truth) |
| `docs/ENV.md` | Environment variables |

---

## 3. Data model (`crypto_orders`)

```ts
{
  id: string;                    // primary key
  userId: string;                // who is buying
  purpose: "pass" | "ad";        // what is being bought (extend as needed)
  passKind?: string;             // product identifier
  passDays?: number;             // for flexible day packs
  asset: "usdc" | "eth";
  network: "base" | "base-sepolia";
  chainId: number;
  receivingAddress: string;      // your wallet (snapshot at quote time)
  payerAddress: string | null;   // null = manual order, set = connected wallet
  tokenAddress: string | null;   // USDC contract, null for ETH
  expectedAmount: string;        // atomic units as decimal string (wei or 6-dec USDC)
  priceCents: number;            // USD price locked at quote time
  ethUsdRaw: string | null;      // Chainlink answer used for ETH quotes
  status: "pending" | "paid" | "expired" | "failed";
  txHash: string | null;         // settling transaction (lowercased)
  passId / adId: string | null;  // the granted product
  expiresAt: Date;               // quote TTL
  createdAt / updatedAt: Date;
}
```

### Critical unique indexes

1. **`txHash` unique** (partial, where not null) → one on-chain tx can settle only one order.
2. **Manual amount unique** (partial on `receivingAddress + asset + expectedAmount` where `payerAddress IS NULL` and status is live) → each manual payment amount maps to exactly one order. This is what makes auto-detect safe.

---

## 4. API surface

### `POST /crypto/quote`

**Request body examples:**

```json
// Flexible days
{ "passKind": "days", "days": 7, "asset": "usdc" }

// Fixed product
{ "passKind": "lifetime", "asset": "eth" }

// Connected wallet (optional)
{
  "passKind": "lifetime",
  "asset": "usdc",
  "payerAddress": "0x...",
  "signature": "0x...",
  "issuedAt": 1720000000
}
```

**Response (success):**

```json
{
  "success": true,
  "order": {
    "id": "...",
    "manual": true,
    "passKind": "days",
    "days": 7,
    "asset": "usdc",
    "network": "base",
    "chainId": 8453,
    "receivingAddress": "0xYourWallet",
    "tokenAddress": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "expectedAmount": "1990000",          // atomic
    "decimals": 6,
    "displayAmount": "1.99 USDC",
    "priceCents": 199,
    "expiresAt": "2026-..."
  }
}
```

### `POST /crypto/verify`

**Request:**

```json
{ "orderId": "...", "txHash": "0x..." }   // txHash optional for manual USDC
```

**Response statuses:**

- `granted` – product issued
- `pending` – waiting for more confirmations
- `not_found` – tx not seen yet
- `mismatch` – wrong amount / sender / recipient
- `failed` – reverted or other hard failure
- `expired` – ETH quote timed out

---

## 5. Payment flow (detailed)

### Quote phase

1. Authenticate the user.
2. Resolve product → `priceCents` (server is authoritative).
3. If `payerAddress` is supplied, require a signed message proving ownership.
4. Calculate atomic amount:
   - **USDC**: `priceCents * 10^(decimals-2)`
   - **ETH**: read Chainlink ETH/USD, convert, truncate toward zero.
5. For **manual** orders, add a tiny random tail so the amount is unique.
6. Insert `crypto_orders` row with `status: pending` and TTL (default 15 min).
7. Return the order details to the client.

### Payment phase (client)

- Show exact amount + receiving address.
- Generate EIP-681 URI for QR / “Open in wallet” button.
- Persist the pending order in `localStorage` so a refresh can resume.

### Verify phase

1. Load the order (must belong to the authenticated user).
2. If already `paid` → return the granted product (idempotent).
3. Resolve `txHash`:
   - User pasted it, **or**
   - Manual USDC → server scans recent `Transfer` logs for the exact amount.
4. Call `verifyPayment()`:
   - Receipt exists and succeeded
   - Enough confirmations (default 2)
   - Correct recipient
   - Amount rules (exact for manual, ≥ for connected)
   - Sender matches if connected
5. For ETH: enforce that the payment *landed* before the quote expired (use block timestamp).
6. For manual orders: reject any transfer that predates the order.
7. Inside a DB transaction:
   - Grant the product
   - Record sale event
   - Mark order `paid` + store `txHash`
8. Return success + product details.

---

## 6. Key design decisions (keep these)

| Decision | Why |
|----------|-----|
| Atomic amounts only (bigint / string) | No floating-point precision loss |
| Manual orders claimed by unique exact amount | Enables safe auto-detect + prevents double-claim |
| Connected orders bind `payerAddress` + require signature | Prevents quoting a victim’s address and stealing their payment |
| ETH quote TTL judged by block timestamp | On-time payments that confirm late are still honored |
| Unique indexes on `txHash` and manual amount | Replay / race protection at the database level |
| Oracle staleness + future-skew checks | Refuse to lock a bad price |
| Idempotent grant via `source_ref = txHash` | Safe to re-submit the same hash |

---

## 7. Environment variables

```bash
# Feature flag
BREAKBPM_CRYPTO_PAYMENTS_ENABLED=true

# Required for crypto to actually work
BREAKBPM_CRYPTO_RECEIVING_ADDRESS=0xYourWalletHere

# Network (default: base)
BREAKBPM_CRYPTO_NETWORK=base          # or base-sepolia

# Optional overrides
BREAKBPM_CRYPTO_RPC_URL=...
BREAKBPM_CRYPTO_ETH_USD_FEED=...
BREAKBPM_CRYPTO_CONFIRMATIONS=2
BREAKBPM_CRYPTO_QUOTE_TTL_SECONDS=900
BREAKBPM_CRYPTO_ORACLE_MAX_STALENESS_SECONDS=3600
```

USDC addresses (hard-coded in `cryptoChain.ts`):

- Base mainnet: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Base Sepolia: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

---

## 8. Frontend responsibilities (CryptoCheckout)

- Product picker (flexible days slider + fixed options)
- Asset toggle (USDC / ETH)
- Call `/crypto/quote`
- Show exact amount, address, QR (EIP-681), copy buttons
- “I’ve paid” → call `/crypto/verify` and poll until granted / error
- Persist pending order in `localStorage` for resume-after-refresh
- Handle all status messages cleanly

EIP-681 examples:

```
# ETH
ethereum:0xReceiver@8453?value=123456789012345678

# USDC
ethereum:0xUSDC@8453/transfer?address=0xReceiver&uint256=1990000
```

---

## 9. Implementation checklist for a new app

### Backend

- [ ] Copy / adapt `cryptoChain.ts` (network, oracle, verify, auto-detect)
- [ ] Create `crypto_orders` table with the two unique indexes
- [ ] Implement `POST /crypto/quote`
- [ ] Implement `POST /crypto/verify`
- [ ] Replace the “grant pass” logic with your product grant
- [ ] Add feature flag + receiving address env vars
- [ ] Test on Base Sepolia first

### Frontend

- [ ] Product selection UI
- [ ] Quote → show amount + address + QR
- [ ] Confirm / poll verify
- [ ] localStorage resume support
- [ ] Clear error / success states

### Security / ops

- [ ] Receiving wallet is a dedicated hot wallet (or better, a safe with limited permissions)
- [ ] Monitor for incoming payments
- [ ] Have a manual recovery path (admin can force-grant if needed)
- [ ] Log every quote + verify attempt

---

## 10. Minimal adaptation notes

The original code is tightly coupled to “passes” and “Lucky Break”. To reuse:

1. Keep `cryptoChain.ts` almost unchanged.
2. Keep the quote/verify structure.
3. Change only the **grant** step inside the verify transaction.
4. Change the product catalog / pricing source.
5. Keep the unique amount + txHash protections — they are product-agnostic.

---

## 11. Quick start for the Replit agent

1. Read this file fully.
2. Pull the four core source files from the BreakBPM repo (listed in section 2).
3. Create a new module (e.g. `crypto-gateway/`) with:
   - `chain.ts` (from `cryptoChain.ts`)
   - `routes.ts` (from `crypto.ts`, strip product-specific grant)
   - `schema.ts` (from `cryptoOrders.ts`)
4. Wire the grant step to whatever the new app sells.
5. Add the env vars.
6. Ship a minimal UI that can quote + verify one product.

Once the skeleton works on Base Sepolia, expand the product catalog and polish the UI.

---

*Extracted from BreakBPM · July 2026*