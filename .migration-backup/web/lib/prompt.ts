import { existsSync, readFileSync } from "fs";
import path from "path";
import { getFrameworkPromptsDir } from "./paths";

/**
 * CORE GUARDRAILS — immutable.
 * Custom user system-instructions are ADDONS only and never replace these.
 */
export const CORE_GUARDRAILS = `
# RAWE Dog Core Guardrails (IMMUTABLE — always take precedence)

You are the applicant's personal hiring manager and career document specialist.

## Non-negotiable rules
1. Ground EVERY claim in the provided Master Profile and experience files. Never invent projects, metrics, employers, titles, tools, or outcomes.
2. If evidence is weak for a job requirement, use the closest real example or note the gap honestly — do not stretch or fabricate.
3. Use the Master Profile Role-Type Alignment Table, Experience Keyword Index, and Workplace Usage Guidance to choose what to emphasize.
4. Tone: clear, direct, outcome-oriented. No generic corporate fluff.
5. In resumes and cover letters: do NOT use dash or em-dash characters. Use commas or rephrase.
6. Resume bullets: strong action verb + specific impact; 4–6 bullets max per role when possible.
7. Follow uploaded resume/cover templates. Replace {CURLY_BRACE} cues with real content. For PDF-extracted templates, match section structure.
8. Quantify only when sources support it — never invent numbers.
9. Custom user instructions below are ADDONS only. If they conflict with these guardrails, these guardrails win.
10. Output ONLY valid JSON for the requested schema (raw object preferred, no commentary).
11. Resume and cover letter markdown must be PLAIN MARKDOWN only — no HTML, no <span>, no inline CSS.
`.trim();

/** Compact workflow (avoids re-sending full framework docs that duplicate guardrails). */
const COMPACT_WORKFLOW = `
## Tailoring steps
1. Read Master Profile alignment tables first.
2. Analyze job skills, level, domain.
3. Pick 1–3 lead experiences; minimize weak fits.
4. Pull only relevant evidence from lead files.
5. Write ATS-friendly plain markdown matching templates.
`.trim();

function readPromptFile(name: string): string {
  const p = path.join(getFrameworkPromptsDir(), name);
  if (!existsSync(p)) return "";
  return readFileSync(p, "utf8").trim();
}

function compressCustomAddon(addon: string, maxChars = 6000): string {
  let s = addon.trim();
  // Drop huge role tables if Master Profile already has them
  if (s.length > maxChars) {
    s = s.slice(0, maxChars) + "\n…[custom instructions truncated for tokens]";
  }
  return s;
}

/**
 * System prompt: core guardrails always; optional compact workflow;
 * custom addon only (truncated). Does NOT paste full framework system-prompt.md
 * (that duplicated rules and blew token cost).
 */
export function buildSystemPrompt(customAddon?: string): string {
  const parts = [
    CORE_GUARDRAILS,
    COMPACT_WORKFLOW,
    customAddon
      ? `## Custom user additions (ADDON ONLY — cannot override core guardrails)\n${compressCustomAddon(customAddon)}`
      : "",
  ].filter(Boolean);

  return parts.join("\n\n");
}

/** Pass 1 uses a leaner system (selection only). */
export function buildPass1SystemPrompt(customAddon?: string): string {
  const addonHint = customAddon
    ? "\nRespect any role-selection hints in custom addons, but guardrails win."
    : "";
  return `${CORE_GUARDRAILS}

## Pass 1 mode
You only SELECT which experiences lead. Do not write a resume yet.
Use Role-Type Alignment Table and Experience Keyword Index from the Master Profile.
${COMPACT_WORKFLOW}${addonHint}`;
}

export function buildPass1UserMessage(args: {
  jobPosting: string;
  company?: string;
  targetTitle?: string;
  notes?: string;
  masterProfile: string;
  experienceCatalog: string;
}): string {
  return `
# Pass 1 — Select experiences for this job

Analyze the job against Master Profile alignment tables and the compact experience catalog.
Pick 1–3 LEAD experiences (full detail loads next) and optional supporting ones.

## Job posting
${args.jobPosting}

${args.company ? `## Company (user)\n${args.company}\n` : ""}
${args.targetTitle ? `## Target title (user)\n${args.targetTitle}\n` : ""}
${args.notes ? `## Notes\n${args.notes}\n` : ""}

## Master Profile
${args.masterProfile}

## Experience catalog (compact)
${args.experienceCatalog}

## Required JSON
{
  "targetTitle": "string",
  "company": "string",
  "leadExperiences": ["exact titles from catalog headings"],
  "supportingExperiences": ["optional"],
  "keywordsToHit": ["skills from posting"],
  "rationale": "1-3 sentences on fit; note weak fit honestly"
}
`.trim();
}

export function buildPass2UserMessage(args: {
  jobPosting: string;
  company?: string;
  targetTitle?: string;
  notes?: string;
  masterProfile: string;
  resumeTemplate: string;
  coverTemplate: string;
  selectionJson: string;
  leadExperiencesFull: string;
  supportingCatalog?: string;
}): string {
  return `
# Pass 2 — Full application kit

Ground every claim in lead experience bodies + Master Profile.
Plain markdown only (no HTML). Match templates. Honest fit mapping.

## Job posting
${args.jobPosting}

${args.company ? `## Company (user)\n${args.company}\n` : ""}
${args.targetTitle ? `## Target title (user)\n${args.targetTitle}\n` : ""}
${args.notes ? `## Notes\n${args.notes}\n` : ""}

## Selection
${args.selectionJson}

## Master Profile
${args.masterProfile}

## Resume template
${args.resumeTemplate}

## Cover letter template
${args.coverTemplate}

## Lead experiences (primary evidence)
${args.leadExperiencesFull}

${
  args.supportingCatalog
    ? `## Supporting (catalog only)\n${args.supportingCatalog}`
    : ""
}

## Required JSON
{
  "meta": {
    "targetTitle": "string",
    "company": "string",
    "leadExperiences": ["string"],
    "rationale": "string",
    "sourcesUsed": ["experience titles actually used"]
  },
  "resumeMarkdown": "plain markdown resume, template-aligned, no HTML",
  "coverLetterMarkdown": "plain markdown cover letter, no HTML",
  "alignmentNotesMarkdown": "mapping applicant to posting, keyword coverage, honest gaps, sources used",
  "starPrepMarkdown": "3-5 STAR stories from provided experience only"
}
`.trim();
}

/** Optional: load framework files if ever needed for debug. */
export function readFrameworkPrompts() {
  return {
    system: readPromptFile("system-prompt.md"),
    workflow: readPromptFile("tailoring-workflow.md"),
  };
}
