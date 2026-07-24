# FOR AI REVIEWERS — RAWE Dog App (`web/`)

This document is the **handoff brief** for any AI (or human) reviewing or extending this project. Read this before changing generation, export, library, or privacy behavior.

---

## 1. What this project is

**RAWE Dog** (Resume And Work Experience) is an open-source framework (`prompts/`, `templates/`, `guides/` at repo root) plus a **local Next.js app** in `web/`.

The app productizes the framework:

1. User pastes a **job posting**.
2. App loads the user’s **uploaded knowledge base** (Master Profile, experience files, templates).
3. App calls **xAI (Grok)** server-side with a **two-pass, token-aware** pipeline.
4. App returns a **kit**: resume, cover letter, alignment notes, STAR interview prep.
5. User exports **MD / PDF / DOCX** (resume & cover) or a **ZIP kit**.

**Not** multi-tenant SaaS. Runs on localhost. Personal career data stays on disk under gitignored `web/data/`.

Parent framework philosophy: *ground every claim in real experience files; never invent metrics/employers.*

---

## 2. Repo map (what lives where)

```
rawe-dog/                          # Open-source framework + app monorepo
├── prompts/                       # Framework system + tailoring prompts (generic)
├── templates/                     # Generic master-profile / experience templates
├── guides/                        # Human how-tos
├── examples/                      # Fake/example profiles (safe to ship)
├── web/                           # ★ Local Next.js app (this doc’s focus)
│   ├── app/                       # App Router UI + API routes
│   ├── lib/                       # Core logic (generate, vault, export, xAI)
│   ├── public/starters/           # Generic placeholder templates (NO real PII)
│   ├── data/                      # ★ GITIGNORED: API key + personal uploads
│   ├── scripts/                   # Seed / smoke helpers
│   └── docs/FOR_AI_REVIEWERS.md   # This file
└── .gitignore                     # Ignores web/data/, env files, etc.
```

**Source of truth for a real applicant** is usually an external vault (e.g. Obsidian Employment folder). The app does **not** bind live to that path; users **upload** (or seed) files into `web/data/library/`.

---

## 3. Runtime architecture

```
Browser (localhost:3000)
  /           Generate: paste job → pass1/pass2 → kit UI + export
  /library    Templates (distinct UI) + knowledge file uploads
  /settings   xAI API key (masked), model, test connection
        │
        ▼
Next.js App Router (Node runtime for APIs)
  POST /api/generate   modes: full | pass1 | pass2 | stream
  POST /api/export     formats: md | pdf | docx | zip
  GET/PUT/POST /api/settings
  GET/POST/DELETE /api/library
  GET /api/library/file?slot=&id=   download original upload
  GET /api/health
        │
        ├── web/data/settings.json     (API key, model)  GITIGNORED
        ├── web/data/library/{slot}/   (uploads + _meta.json) GITIGNORED
        ├── ../prompts/                (framework prompts, optional read)
        └── xAI API  https://api.x.ai/v1  (OpenAI-compatible chat.completions)
```

### Library slots

| Slot | Multi | Required | Purpose |
| --- | --- | --- | --- |
| `master-profile` | no | yes | Strategy, alignment tables, tone |
| `experience` | yes | ≥1 | Ground-truth workplace writeups |
| `resume-template` | no | yes | Output shape (`{}` cues or PDF extract) |
| `cover-template` | no | yes | Cover letter shape |
| `system-instructions` | no | no | **Addon only** — cannot override core guardrails |

---

## 4. Generation pipeline (critical)

Entry: `lib/generate.ts`  
Prompts: `lib/prompt.ts`  
Packing: `lib/context-pack.ts`, `lib/normalize-md.ts`  
Model: `lib/xai.ts` (`chatJson` / `chatJsonParsed` with one JSON repair retry)

### Guardrails layering

1. **`CORE_GUARDRAILS`** in `lib/prompt.ts` — **immutable**. No fabrication, no dash abuse in resume/cover, plain markdown (no HTML), JSON-only output schemas.
2. Compact workflow text (not full framework dump — keeps tokens down).
3. Optional uploaded **system-instructions** — labeled **ADDON ONLY**; if conflict, core wins.

Do **not** re-concatenate full `prompts/system-prompt.md` + full custom GPT instructions without deduping; that was intentionally removed for cost/noise.

### Pass 1 — select experiences

- Input: job posting + **compact Master Profile** + **compact experience catalog** (summary + skills + STAR index, not full Q&A prose).
- Output JSON: `leadExperiences`, `supportingExperiences`, `keywordsToHit`, `rationale`.
- UI: user can **override leads** with checkboxes before Pass 2.
- If ≤2 experience files, Pass 1 is skipped.

### Pass 2 — write kit

- Input: selection + full (or budgeted) **lead** experience bodies + templates + Master Profile.
- Non-leads: catalog stubs only or omitted.
- Output JSON kit fields:
  - `resumeMarkdown`, `coverLetterMarkdown`
  - `alignmentNotesMarkdown`, `starPrepMarkdown`
  - `meta` (title, company, leads, rationale, sourcesUsed)
- Post-process: `lib/clean-md.ts` strips HTML, normalizes dashes, etc.

### UI progress model

Stage-based **percent** (not token streaming): Pass 1 ~5–40%, review 45%, Pass 2 ~50–95%, done 100%. Implemented in `app/page.tsx`.

---

## 5. Export behavior

| Artifact | Resume / Cover | Alignment / STAR |
| --- | --- | --- |
| UI | Plain text preview (resume/cover) | **Rendered markdown** (`MarkdownView` + `marked`) + Copy source |
| PDF / DOCX buttons | Yes | Hidden (markdown-focused) |
| ZIP kit | md + pdf + docx | **md only** |

- PDF: `lib/export/pdf.ts` — structured pdfkit layout (headers, section rules, hanging bullets). DOCX was considered good; prefer improving PDF over changing DOCX unless asked.
- DOCX: `lib/export/docx.ts`
- ZIP: `lib/export/kit-zip.ts`

---

## 6. UI product notes (intentional)

- **Library Templates** section is **visually distinct** from knowledge file browser (document cards, starter download, “Active for generation”).
- Starters in `public/starters/` must stay **placeholder PII** (`{EMAIL}`, etc.) — never real contact data in git.
- Generate: job paste bin height **matches right column** via grid + `.textarea-fill`.
- Model name pill uses green `badge-ok`.
- Settings: blank API key field on save **keeps** existing key; never return full key to client (masked only).

---

## 7. Privacy & git safety (non-negotiable)

### Must never commit / push

| Path | Contents |
| --- | --- |
| `web/data/` | `settings.json` (API key), full personal library uploads |
| `web/.env`, `web/.env.local` | Secrets |
| External vaults | e.g. Obsidian/Proton paths outside repo |

Ignore rules: root `.gitignore` (`web/data/`, env) **and** `web/.gitignore` (`/data`, `.env*`).

### Safe to commit

- App source under `web/app`, `web/lib`, `web/scripts`
- `public/starters/*` with **placeholders only**
- Framework examples under `examples/` (generic)

### Before push checklist

```bash
git add -n web/          # dry-run: must NOT list web/data/
git check-ignore -v web/data/settings.json
# Scan staged files for email/phone/API keys if unsure
```

If `web/data/` appears in `git status` as staged, **stop**.

---

## 8. Config precedence

1. `web/data/settings.json` (Settings UI) wins at runtime.
2. Env `XAI_API_KEY` / `XAI_MODEL` seed defaults when settings empty / “Reset from env”.
3. Default model: `grok-4.5`.
4. Base URL: `https://api.x.ai/v1` (OpenAI SDK compatible).

---

## 9. Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Next dev server |
| `npm run build` | Production build |
| `npm run smoke` | E2E against running server (needs key + library) |
| `node scripts/seed-library.mjs <EmploymentVaultPath>` | Bulk import MD into `data/library` |
| `node scripts/seed-settings.mjs [apiKey]` | Write settings (dev only; never commit output) |
| `node scripts/test-pdf.mjs` | PDF + library download smoke without full generate |

---

## 10. API quick reference

### `POST /api/generate`

```json
{
  "mode": "full" | "pass1" | "pass2" | "stream",
  "jobPosting": "...",
  "company": "optional",
  "targetTitle": "optional",
  "notes": "optional",
  "overrideLeads": ["Experience Title"],
  "selection": { /* required for pass2 */ }
}
```

### `POST /api/export`

```json
{
  "format": "md" | "pdf" | "docx" | "zip",
  "markdown": "...",
  "filename": "optional",
  "kit": { /* required for zip */ }
}
```

---

## 11. Design decisions log (why things are this way)

| Decision | Rationale |
| --- | --- |
| Upload library, not live vault path | Proton/G: offline, no Windows path coupling, portable |
| Two-pass generation | Accuracy (full leads) without always sending every experience file |
| Core guardrails > custom addons | Prevents user/GPT instructions from enabling fabrication |
| Alignment/STAR as rendered MD + copy | Interview prep notes, not print documents |
| PDF rewritten separately from DOCX | DOCX quality was acceptable; PDF needed layout fix |
| Templates UI ≠ knowledge UI | Templates are output tools; knowledge is evidence |
| Starters are generic placeholders | Public repo must not ship real contact PII |
| Settings store local JSON | Simple personal tool; no DB |

---

## 12. Known out-of-scope / backlog

- Live Obsidian path bind
- Auto-save kits into “Applications 2025” folders
- Multi-user cloud hosting
- Pixel-perfect match to old Word/Proton PDFs
- True token streaming of model output (progress is stage-based %)
- Notion integration (framework doc only at `advanced/notion-integration.md`)

---

## 13. How to verify health after changes

1. `npm run build` in `web/` — TypeScript + Next compile clean.
2. `npm run dev` → `/api/health` → `library.ready` + `settings.hasApiKey`.
3. Settings → Test connection.
4. Generate a short BSA-style posting: Pass 1 should favor enterprise BSA evidence when present (e.g. TD-like + consulting Salesforce).
5. Export resume PDF (valid `%PDF`), DOCX (ZIP magic `PK`), kit ZIP.
6. Confirm Alignment/STAR **render** as HTML markdown (not monospace dump only).
7. Confirm `git add -n web/` never stages `web/data/`.

---

## 14. File responsibility index

| File | Role |
| --- | --- |
| `lib/generate.ts` | Orchestrates pass1/pass2, progress emit hooks |
| `lib/prompt.ts` | Guardrails + pass message builders |
| `lib/context-pack.ts` | Load library docs, catalog, lead packing |
| `lib/normalize-md.ts` | Frontmatter/wikilinks, compact extracts |
| `lib/xai.ts` | OpenAI client → xAI, JSON retry |
| `lib/parse-kit.ts` | JSON extract + normalize kit types |
| `lib/clean-md.ts` | Sanitize model markdown for export/display |
| `lib/library.ts` | Filesystem library CRUD |
| `lib/settings.ts` | API key/model persistence + mask |
| `lib/export/*` | PDF, DOCX, ZIP |
| `app/page.tsx` | Generate UX |
| `app/library/page.tsx` | Templates + knowledge UI |
| `app/settings/page.tsx` | Credentials UI |
| `app/components/MarkdownView.tsx` | Client markdown render (`marked`) |

---

## 15. Relationship to personal Employment vault

If the operator maintains a separate Obsidian vault (outside git):

- **Master Profile.md** — strategy tables
- **Workplace Experience Summaries/*.md** — STAR-rich experience bodies
- **Templates/** — real resume/cover with personal contact info
- **Saym Services** (or equivalent) — project archive including GitHub product work

Upload or `seed-library.mjs` into `web/data/`. **Never commit the vault or `web/data/`.**

Framework root `prompts/` + app `CORE_GUARDRAILS` should stay aligned in *intent* (grounding, no fabrication); app intentionally uses a **deduped** system stack for tokens.

---

*Last updated for the local app polish pass: two-pass generate, progress %, PDF layout, rendered Alignment/STAR, library template UX, privacy hardening for git push.*
