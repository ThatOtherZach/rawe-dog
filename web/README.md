# RAWE Dog App

Local web app that turns a **job posting paste** into a tailored **application kit** (resume, cover letter, alignment notes, STAR prep) using an uploaded Master Profile + experience files and the **xAI API**.

> **AI / code reviewers:** start with **[docs/FOR_AI_REVIEWERS.md](./docs/FOR_AI_REVIEWERS.md)** — architecture, privacy, pipeline, and file index.

This folder is the runnable product. The parent repo is still the open-source **RAWE Dog** framework (prompts, generic templates, guides).

---

## Quick start

```bash
cd web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

| Page | What to do |
| --- | --- |
| **Settings** | Save `XAI_API_KEY`, model (default `grok-4.5`), Test connection |
| **Library** | Set **templates** (starters available) + upload **knowledge** files |
| **Generate** | Paste job → select experiences (or auto) → write kit → export |

Optional env seed (Settings UI overrides after first save):

```bash
cp .env.local.example .env.local
# XAI_API_KEY=...
# XAI_MODEL=grok-4.5
```

### Bulk import from an Obsidian Employment vault

```bash
node scripts/seed-library.mjs "G:\path\to\Employment"
```

Imported files land only in **gitignored** `data/`.

---

## Product behavior

### Generation (two-pass)

1. **Pass 1** — Compact catalog + Master Profile → which experiences lead.
2. **Review** — User can override lead checkboxes.
3. **Pass 2** — Full lead evidence + templates → JSON kit (then cleaned to markdown).

Core **guardrails are immutable**. Optional “system instructions” uploads are **addons only**.

Progress bar shows **stage %** (not live token stream).

### Library

- **Templates** (top): resume + cover as document cards — download starter, download active, set/replace active. Not the same UI as file lists.
- **Knowledge files** (below): Master Profile, experiences, optional system instructions — file browser style.

Public starters: `public/starters/*.md` (placeholders only — no real contact PII).

### Export

| | Resume / Cover | Alignment / STAR |
| --- | --- | --- |
| Preview | Plain text | **Rendered markdown** + Copy source |
| PDF / DOCX | Yes | No (md-focused) |
| Full kit ZIP | md + pdf + docx | md only |

---

## Privacy (read before `git push`)

| Path | Commit? | Contents |
| --- | --- | --- |
| `data/` | **Never** | API key + personal uploads |
| `.env*` | **Never** | Secrets |
| `public/starters/` | Yes if placeholders | Generic templates only |
| App source | Yes | Code |

Root and `web/.gitignore` both ignore `data/` and env files.

```bash
git add -n web/                    # must not list data/
git check-ignore -v data/settings.json
```

---

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run smoke` | E2E smoke (server must be up; needs key + library) |
| `node scripts/seed-library.mjs <vault>` | Bulk MD import → `data/library` |
| `node scripts/seed-settings.mjs [key]` | Local settings only (never commit) |
| `node scripts/test-pdf.mjs` | PDF + library download check |

---

## Stack

- Next.js App Router (TypeScript)
- xAI via OpenAI-compatible SDK (`baseURL: https://api.x.ai/v1`)
- pdfkit (PDF), docx (Word), jszip (kit), marked (Alignment/STAR render)

---

## Related

- Framework prompts: `../prompts/`
- Framework guides: `../guides/`
- AI handoff: [docs/FOR_AI_REVIEWERS.md](./docs/FOR_AI_REVIEWERS.md)
