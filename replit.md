# RAWE Dog — Application Kit

Generates tailored job-application kits (resume, cover letter, alignment notes, STAR prep) from a job posting and the user's personal knowledge library, grounded strictly in the user's own experience files via xAI models. A live **Postings** page pulls ranked job matches from TheirStack so the user can browse scored opportunities and generate kits directly from a posting.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (binds to `$PORT`, default 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required env: `SESSION_SECRET` — HMAC signing key for credit tokens

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 — no database; all state in flat JSON files under `artifacts/api-server/data/`
- Validation: Zod (`zod/v4`)
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server` — Express 5 backend under `/api`; generation pipeline in `src/lib` (`generate.ts` orchestrator, `prompt.ts`, `context-pack.ts`, `xai.ts`, `verify.ts`, `schemas.ts`), job-search subsystem in `src/lib/jobs/`, routes in `src/routes`
- `artifacts/rawe-dog` — React/Vite frontend (root path); pages in `src/pages`
- App data lives in `artifacts/api-server/data/` (gitignored runtime state):
  - `data/library/` — user knowledge files (Master Profile, experiences, templates)
  - `data/postings/postings.json` — postings cache (max 300 entries; status persists across refreshes)

## Architecture decisions

### Kit generation pipeline
- Atomized generation: one selection call → four parallel per-document draft calls → (for posting-sourced kits) one verification call → targeted repair of flagged docs (max one round). All stages use API-enforced JSON schemas (`response_format: json_schema, strict`) with json_object fallback, truncation retry, and cheap malformed-JSON repair.
- **Verification is source-gated**: posting-sourced kits (`postingId` present) run the full pipeline including verification (Pass 3) and repair (Pass 4) — ATS keyword grounding matters when the brief was model-extracted. Paste-sourced kits (no `postingId`) skip verification and repair entirely; the pipeline ends after drafting. The `done` SSE event fires immediately after drafting for paste kits.
- Experiences are selected by stable catalog IDs (E1, E2, … assigned by library file id order); the selection schema constrains IDs via enum, and zero resolved leads is a hard 400 — no silent fallback.
- Per-stage models: settings support optional fast models for selection/verification; drafting uses the premium model.
- Progressive delivery over SSE (`mode: "stream"` on POST /api/generate): status/pass1/draft/qa/repair/done events; UI fills kit tabs as drafts land and shows a QA report panel. For paste kits, the `qa` event carries `skipped: true` and the Quality tab shows a "Verification not run" notice instead of findings.

### Postings & job discovery
- **Explicit refresh model**: jobs are fetched only when the user triggers a refresh (no background polling). Postings are deduped by internal ID and survive refreshes — only new IDs are added; statuses are never clobbered.
- **Fit scoring**: each posting is scored 0–100 against the Master Profile in the same LLM call that extracts a canonical brief. Score, rationale, and matched experience catalog IDs are stored alongside the posting.
- **Token-efficient kit handoff**: the canonical `JobBrief` (target title, must-haves, ATS keywords, responsibilities, compensation) is extracted once at scan time and stored with the posting. When generating a kit from `postingId`, the pipeline consumes this brief — the raw job description is never re-sent to the LLM.
- **Search filters**: derived automatically from the Master Profile via an LLM call (`POST /api/postings/derive-filters`) or set manually (`PUT /api/postings/filters`). Filters cover job titles, countries, remote/hybrid, seniority, min salary, ATS keywords, and result limit.
- **Concurrent refresh guard**: an in-process `refreshInFlight` mutex rejects a second simultaneous refresh with 409 (not queued, to avoid burning TheirStack credits).
- **Prompt-injection fencing**: all provider-supplied fields (title, company, description, facts) are wrapped in untrusted-data fence markers in every prompt. `fenceData()` in `prompt.ts` strips forged fence marker lookalikes from content before inserting it, preventing boundary escapes.

### Application status tracking
- Each stored posting carries a `PostingStatus`: `"new" | "kit_generated" | "applied" | "dismissed"`.
- Status is updated via `PATCH /api/postings/:id/status`. Generating a kit from a `postingId` automatically flips its status to `kit_generated`.
- The list endpoint returns status counts (`newCount`, `kitGeneratedCount`, `appliedCount`, `dismissedCount`) for summary display.
- Dismissed postings are hidden by default in the UI with a toggle to reveal them.
- **`appliedAt` timestamp**: set the first time a posting transitions to `"applied"`; **never overwritten** on subsequent status round-trips (applied → reverted → re-applied keeps the original timestamp). Stored on `StoredPosting.appliedAt`.
- **`kitGeneratedAt` timestamp**: set the first time a posting transitions to `"kit_generated"`; also never overwritten. Stored on `StoredPosting.kitGeneratedAt`.
- **CSV export**: `GET /api/postings/export.csv` returns all applied postings as a UTF-8 CSV (BOM included for Excel). Columns: title, company, location, URL, applied-at, fit score, kit generated (yes/no), kit generated at, cross-listing flag, suspicious flag. The "Export applied jobs" button appears on the Postings page only when at least one posting is applied.

### Pay-per-search credits (the toasteth pattern)
- **Two lanes**: kit generation is **free** (no credit check on `/api/generate`); a $1 search credit is required to refresh postings via `/api/postings/refresh` (when `RAWEDOG_CREDITS_ENFORCED=true`). Paying gets you speed + targeting (pre-scored postings), not gated output quality.
- **Accountless**: no user accounts, no DB. A credit is an HMAC bearer token (`rdc1.<payload>.<sig>`, signed with `SESSION_SECRET`) held in browser localStorage and sent as `X-Credit-Token`; the ledger row in `data/credits/credits.json` is the source of truth (tokens, quotes, codes, CAD sales rows). Flat-file store with a promise-chain mutex + atomic tmp/rename writes.
- **Token kind**: all newly minted tokens carry `kind: "search"`. The refresh gate requires `kind === "search"` — legacy tokens without a kind field are not accepted by the search gate.
- **Gate off by default**: `/api/postings/refresh` is free unless `RAWEDOG_CREDITS_ENFORCED=true`. When armed, the refresh requires a valid search-kind bearer token; **1 credit is consumed only after postings are fetched and saved** (provider/quota/network failures never burn a credit; scoring failures after a successful fetch still spend because results were delivered).
- **Concurrency safety**: the refresh gate takes an in-memory in-flight reservation at admission (one credit funds one refresh at a time → parallel-refresh bypass returns 402 `in_use`); quote amount allocation and payment-claim + token-mint are each single atomic store transactions (no double-mint from parallel verifies, no duplicate quote amounts).
- **Buying**: no wallet-connect. Server quotes a unique exact amount (base price + random atomic tail) on Base (ETH or USDC) to a fixed receiving address; buyer sends from any wallet, pastes the tx hash; server verifies on-chain via viem (exact amount, N confirmations) and mints the token. Price: `RAWEDOG_SEARCH_CREDIT_PRICE_USD` (default $1). Quotes live `RAWEDOG_QUOTE_TTL_HOURS` (24h default).
- **Codes**: admin mints `RAWE-XXXXXXXXXX` codes (`POST /api/credits/admin/mint`, `x-admin-key` header) with configurable credits/redemptions; buyers redeem for the same tokens. Ledger at `GET /api/credits/admin/ledger`.
- **CAD sales rows**: each crypto sale records gross CAD (Bank of Canada FX, `RAWEDOG_USD_CAD_FALLBACK_RATE` fallback) with BC 5% GST / 7% PST backed out; FX failure is non-fatal (null fields).
- **Frontend**: Postings page renders a `SearchCreditsPanel` (separate localStorage key `rawe.search.token` / `rawe.search.quote` from the legacy kit key). Panel is invisible when enforcement is off. A 402 on refresh bumps the panel to re-fetch status and shows an error.

## API routes (key ones)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/generate` | Generate a kit (SSE stream); accepts `postingId` for posting-sourced kits |
| `GET` | `/api/postings` | Ranked postings list with fit scores, status, and status counts |
| `POST` | `/api/postings/refresh` | Fetch + score new jobs from TheirStack (409 if already in flight) |
| `POST` | `/api/postings/derive-filters` | LLM-derive search filters from Master Profile |
| `PUT` | `/api/postings/filters` | Save manually-edited search filters |
| `GET` | `/api/postings/:id` | Full posting detail + canonical brief + raw description |
| `PATCH` | `/api/postings/:id/status` | Update posting status (new/kit_generated/applied/dismissed) |
| `GET` | `/api/postings/export.csv` | Download applied postings as CSV (UTF-8 BOM, Excel-safe) |
| `GET` | `/api/library` | List library files |
| `POST` | `/api/library/compose` | Quiz-compose a knowledge doc from interview answers (returns a markdown draft; saving is a separate explicit upload) |
| `GET/POST/DELETE` | `/api/settings` | Read/update/clear settings (xAI key, TheirStack key, models) |
| `GET` | `/api/credits/status` | Gate state + price + token balance (`X-Credit-Token` optional) |
| `POST` | `/api/credits/quote` | Quote a unique exact amount (`{asset: "eth"\|"usdc"}`) |
| `POST` | `/api/credits/verify` | Verify tx on-chain, mint credit token (`{quoteId, txHash}`) |
| `POST` | `/api/credits/redeem` | Redeem a `RAWE-…` code for a credit token |
| `POST` | `/api/credits/admin/mint` | Mint codes (requires `x-admin-key`) |
| `GET` | `/api/credits/admin/ledger` | Full credits ledger (requires `x-admin-key`) |

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `SESSION_SECRET` | Yes | HMAC key for credit token signing — losing it voids all outstanding tokens |
| `XAI_BASE_URL` | Dev/test | Override xAI endpoint (e.g. local mock server for e2e tests) |
| `THEIRSTACK_BASE_URL` | Dev/test | Override TheirStack endpoint (e.g. local mock server) |
| `RAWEDOG_CREDITS_ENFORCED` | No | `true` arms the search credit gate on `POST /api/postings/refresh` (off by default) |
| `RAWEDOG_CRYPTO_RECEIVING_ADDRESS` | To sell | Fixed address payments are sent to (crypto checkout closed without it) |
| `RAWEDOG_ADMIN_KEY` | To mint | Admin key for minting codes / reading the ledger |
| `RAWEDOG_CRYPTO_NETWORK` | No | `base` (default) or `base-sepolia` |
| `RAWEDOG_CRYPTO_RPC_URL` | No | RPC override (defaults to public RPC for the network) |
| `RAWEDOG_CRYPTO_ETH_USD_FEED` | No | Chainlink ETH/USD feed override |
| `RAWEDOG_CRYPTO_CONFIRMATIONS` | No | Confirmations required before granting (default 2) |
| `RAWEDOG_SEARCH_CREDIT_PRICE_USD` | No | Price per search credit in dollars (default 1) |
| `RAWEDOG_CREDIT_PRICE_USD` | No | Legacy — price per kit credit (unused; kits are now free) |
| `RAWEDOG_QUOTE_TTL_HOURS` | No | How long a quoted amount stays claimable (default 24) |
| `RAWEDOG_USD_CAD_FALLBACK_RATE` | No | FX fallback when Bank of Canada API is unreachable |

## Product

**Generate page**: Paste a job posting → Pass 1 selects lead experiences from the library (reviewable) → four documents draft in parallel → a verification pass checks grounding, cross-document consistency, form rules, and keyword coverage → flagged documents get one repair round. Kit tabs fill progressively; a quality report shows findings, keyword coverage, and repair status.

**Postings page**: Browse live job matches scored against your profile. Derive search filters from your Master Profile or edit them manually. Hit Refresh to fetch new results from TheirStack (costs a $1 search credit when enforcement is on). Each posting shows a fit score (0-100), rationale, and the experiences that matched. Expand a row for the canonical brief (must-haves, ATS keywords, responsibilities) and full description. Click "Generate Kit" to start kit generation using the stored brief — no copy-pasting required. Mark postings as Applied or Dismissed to keep the feed actionable. **Export applied jobs** as a CSV (title, company, location, URL, applied-at, fit score, kit timestamps, flags) for a clean handoff record.

**Library page**: Manage knowledge files — Master Profile, experience entries, and resume/cover-letter templates. Each knowledge slot has a **Create** button (guided interview → model drafts the file against the starter skeleton → review/tweak/regenerate → accept to save), a **Template** link (download starter), and a direct upload. Experience loops one role at a time, oldest first. Creating is BYOM (needs the AI LLM key) and never credit-gated.

**Settings page**: Two panels — **AI & LLM Settings** (API key, endpoint, drafting/selection/verification model overrides, Save, Test connection) and **TheirStack** (API key for live job search). Clear buttons remove keys immediately; saving a new key goes through Save.

## User preferences

- **Update all docs after every task** — replit.md, affected `.agents/memory/` topic files, and inline code comments. This is a standing instruction, not task-specific.
- **No accounts, no server-side persistence beyond what the user explicitly saved** — the system is intentionally accountless and ephemeral. Users have full data control. Nothing is retained without user action. This principle applies to all future features.
- **Keep the XP/achievements system out of replit.md** — it's a product Easter egg; document it only in `.agents/memory/`.

## Gotchas

- Postings are fetched and scored only on explicit user refresh (no background polling). The data file lives in `data/postings/postings.json`; deleting it resets the cache but not the filters.
- `THEIRSTACK_BASE_URL` / `XAI_BASE_URL` env hooks make e2e testing against local mock servers straightforward (see `.agents/memory/llm-mock-e2e.md` for the pattern).
- The postings refresh uses an in-process mutex (`refreshInFlight`). Only one refresh can run at a time; concurrent requests get a 409. This is intentional — queuing them would silently burn TheirStack credits.
- `fenceData()` in `prompt.ts` must be used for every piece of provider-supplied text before it reaches a prompt. It strips lookalike fence markers so content cannot escape its untrusted-data boundary.
- The credit gate is invisible when off: `SearchCreditsPanel` renders nothing and `/api/postings/refresh` skips the credit check unless `RAWEDOG_CREDITS_ENFORCED=true`. `/api/generate` is always free — no credit check. Losing `SESSION_SECRET` invalidates every issued credit token (HMAC), even though ledger rows survive.
- `appliedAt` and `kitGeneratedAt` on `StoredPosting` are write-once: set on the first transition to that status, never overwritten on subsequent round-trips. If you change `setPostingStatus`, preserve the `if (!sp.appliedAt)` guard.
- Credit consumption is spend-after-deliver: the credit is debited after the kit succeeds, backed by an in-flight reservation so one credit can't fund parallel runs. Don't move the spend earlier (failed runs must stay free), and don't remove the reservation (that reopens the parallel-run bypass).
- The starter skeletons are duplicated: `artifacts/rawe-dog/public/starters/*.md` (user downloads) and `STARTER_SKELETONS` in `artifacts/api-server/src/lib/compose.ts` (quiz-compose prompts — the server can't read the web artifact's public dir in production). A drift-guard unit test in `tests/specs/quiz-compose.spec.ts` fails if they diverge; update both together.
- In dev, the vite server (`:24020`) has no `/api` proxy — the platform router on `localhost:80` joins the web app and API server. Curl APIs via `localhost:80/api/…`; hitting `:24020/api/…` returns the SPA HTML (GET) or 404 (POST). Playwright specs intercept all `/api` calls, so they run against `:24020` fine.
- After editing `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen`. Route changes without a codegen run leave the generated clients stale and store up breakage for whoever regenerates next. If a regen fails with TS2308 in `lib/api-zod/src/index.ts`, a new orval name collision appeared — add the name to the explicit re-export list there (see the comment in that file).

## Credits

- **Ghost-posting legitimacy signal taxonomy** adapted from [career-ops](https://github.com/santifer/career-ops) (MIT licence, Santiago Fernández de Valderrama). Design port of the signal categories and calibration rules; no shared code. Attribution comments live in `artifacts/api-server/src/lib/schemas.ts` (schema) and `artifacts/api-server/src/lib/jobs/store.ts` (type).
- **Cross-listing content fingerprint** ported from [career-ops `fingerprint-core.mjs`](https://github.com/santifer/career-ops) (MIT licence, Santiago Fernández de Valderrama). TypeScript port of the 64-bit SimHash over 3-token shingles, normalization pipeline, and tuning constants (MIN_CHARS=200, MIN_TOKENS=3, SIMILARITY_THRESHOLD=0.92). Full MIT copyright notice preserved in `artifacts/api-server/src/lib/jobs/fingerprint.ts`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `.agents/memory/llm-mock-e2e.md` for the mocked end-to-end testing pattern (TheirStack + xAI mocks, schema-name dispatch, prompt-boundary assertions)
