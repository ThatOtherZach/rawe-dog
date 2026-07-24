# RAWE Dog — Application Kit

Generates tailored job-application kits (resume, cover letter, alignment notes, STAR prep) from a job posting and the user's personal knowledge library, grounded strictly in the user's own experience files via xAI models.

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

- `artifacts/api-server` — Express 5 backend under `/api`; generation pipeline in `src/lib` (`generate.ts` orchestrator, `prompt.ts`, `context-pack.ts`, `xai.ts`, `verify.ts`, `schemas.ts`), routes in `src/routes`
- `artifacts/rawe-dog` — React/Vite frontend (root path); pages in `src/pages`
- App data (library uploads, settings) lives in `artifacts/api-server/data/` (gitignored runtime state)

## Architecture decisions

- Atomized generation: one selection call → four parallel per-document draft calls → one verification call → targeted repair of flagged docs (max one round). All stages use API-enforced JSON schemas (`response_format: json_schema, strict`) with json_object fallback, truncation retry, and cheap malformed-JSON repair.
- Experiences are selected by stable catalog IDs (E1, E2, … assigned by library file id order); the selection schema constrains IDs via enum, and zero resolved leads is a hard 400 — no silent fallback.
- Per-stage models: settings support optional fast models for selection/verification; drafting uses the premium model.
- Progressive delivery over SSE (`mode: "stream"` on POST /api/generate): status/pass1/draft/qa/repair/done events; UI fills kit tabs as drafts land and shows a QA report panel.
- Job postings and notes are fenced as untrusted data in prompts to resist embedded prompt injection.
- `XAI_BASE_URL` env var overrides the xAI endpoint (dev/test hook for mock-server e2e testing).

## Product

Paste a job posting → Pass 1 selects lead experiences from the library (reviewable) → four documents draft in parallel → a verification pass checks grounding, cross-document consistency, form rules, and keyword coverage → flagged documents get one repair round. Kit tabs fill progressively; a quality report shows findings, keyword coverage, and repair status. Library page manages the knowledge files; Settings manages the xAI key and per-stage models.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
