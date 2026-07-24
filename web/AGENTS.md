<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version may have breaking changes vs older training data. Prefer reading
`node_modules/next/dist/docs/` and project-local docs before inventing APIs.
<!-- END:nextjs-agent-rules -->

# Agent instructions — RAWE Dog `web/` app

You are working on a **local personal resume-tailoring app**, not a multi-tenant SaaS.

## Read first

1. **[docs/FOR_AI_REVIEWERS.md](./docs/FOR_AI_REVIEWERS.md)** — full architecture, privacy, pipeline, file index.
2. **[README.md](./README.md)** — runbook and product summary.
3. Parent framework: `../prompts/`, `../README.md` (generic RAWE Dog skill; app productizes it with xAI).

## Hard rules

1. **Never commit or log** contents of `data/` (API keys, personal Master Profile, experiences).
2. **Never put real PII** (phone, email) into `public/starters/` or docs; use placeholders.
3. **Core guardrails in `lib/prompt.ts` are immutable.** Custom system-instructions are addons only.
4. **Do not reintroduce** dumping every experience file + full dual system prompts on every call — use two-pass packing in `lib/generate.ts` / `lib/context-pack.ts`.
5. Keep **server-side** secrets: `XAI_API_KEY` only in settings/env, never `NEXT_PUBLIC_*`.
6. Prefer fixing **PDF** layout in `lib/export/pdf.ts` over changing DOCX unless the user asks.
7. Alignment/STAR UI: **render markdown** (`MarkdownView`), still allow copy of source; no PDF/DOCX emphasis for those tabs.
8. Library **templates UI ≠ knowledge file list** — preserve the distinct template cards.

## Where to change what

| Goal | Start here |
| --- | --- |
| Model prompts / rules | `lib/prompt.ts` |
| Pass orchestration | `lib/generate.ts` |
| Context packing | `lib/context-pack.ts`, `lib/normalize-md.ts` |
| xAI client | `lib/xai.ts` |
| Exports | `lib/export/*` |
| Generate UX | `app/page.tsx` |
| Library UX | `app/library/page.tsx` |
| Settings | `app/settings/page.tsx`, `lib/settings.ts` |
| Library FS | `lib/library.ts` |

## Verify after changes

```bash
npm run build
npm run dev
# health → settings test → generate short job → export PDF/DOCX/ZIP
git add -n .   # ensure data/ never stages
```

## Out of scope unless asked

Live Obsidian path, multi-user auth, cloud hosting, auto job-board apply, Notion sync.
