# RAWE Dog — Application Kit

Generates tailored job-application kits (resume, cover letter, alignment notes, STAR prep) from a job posting and the user's personal knowledge library, grounded strictly in the user's own experience files via xAI models. A live **Postings** page pulls ranked job matches from TheirStack so the user can browse scored opportunities and generate kits directly from a posting.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
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
- Atomized generation: one selection call → four parallel per-document draft calls → one verification call → targeted repair of flagged docs (max one round). All stages use API-enforced JSON schemas (`response_format: json_schema, strict`) with json_object fallback, truncation retry, and cheap malformed-JSON repair.
- Experiences are selected by stable catalog IDs (E1, E2, … assigned by library file id order); the selection schema constrains IDs via enum, and zero resolved leads is a hard 400 — no silent fallback.
- Per-stage models: settings support optional fast models for selection/verification; drafting uses the premium model.
- Progressive delivery over SSE (`mode: "stream"` on POST /api/generate): status/pass1/draft/qa/repair/done events; UI fills kit tabs as drafts land and shows a QA report panel.

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
| `GET` | `/api/library` | List library files |
| `GET/POST/DELETE` | `/api/settings` | Read/update/clear settings (xAI key, TheirStack key, models) |

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | Postgres connection string |
| `SESSION_SECRET` | Yes | Express session signing |
| `XAI_BASE_URL` | Dev/test | Override xAI endpoint (e.g. local mock server for e2e tests) |
| `THEIRSTACK_BASE_URL` | Dev/test | Override TheirStack endpoint (e.g. local mock server) |

## Product

**Generate page**: Paste a job posting → Pass 1 selects lead experiences from the library (reviewable) → four documents draft in parallel → a verification pass checks grounding, cross-document consistency, form rules, and keyword coverage → flagged documents get one repair round. Kit tabs fill progressively; a quality report shows findings, keyword coverage, and repair status.

**Postings page**: Browse live job matches scored against your profile. Derive search filters from your Master Profile or edit them manually. Hit Refresh to fetch new results from TheirStack. Each posting shows a fit score (0-100), rationale, and the experiences that matched. Expand a row for the canonical brief (must-haves, ATS keywords, responsibilities) and full description. Click "Generate Kit" to start kit generation using the stored brief — no copy-pasting required. Mark postings as Applied or Dismissed to keep the feed actionable.

**Library page**: Manage knowledge files — Master Profile, experience entries, and resume/cover-letter templates.

**Settings page**: Configure the xAI API key (required for all generation), TheirStack API key (required for Postings), and per-stage model overrides.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Postings are fetched and scored only on explicit user refresh (no background polling). The data file lives in `data/postings/postings.json`; deleting it resets the cache but not the filters.
- `THEIRSTACK_BASE_URL` / `XAI_BASE_URL` env hooks make e2e testing against local mock servers straightforward (see `.agents/memory/llm-mock-e2e.md` for the pattern).
- The postings refresh uses an in-process mutex (`refreshInFlight`). Only one refresh can run at a time; concurrent requests get a 409. This is intentional — queuing them would silently burn TheirStack credits.
- `fenceData()` in `prompt.ts` must be used for every piece of provider-supplied text before it reaches a prompt. It strips lookalike fence markers so content cannot escape its untrusted-data boundary.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `.agents/memory/llm-mock-e2e.md` for the mocked end-to-end testing pattern (TheirStack + xAI mocks, schema-name dispatch, prompt-boundary assertions)
