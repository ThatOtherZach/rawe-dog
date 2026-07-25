/**
 * Quiz-compose: turn guided-interview answers into knowledge-slot markdown.
 *
 * The model composes a document targeting the exact skeleton shape of the
 * downloadable starters (artifacts/rawe-dog/public/starters/). The skeletons
 * are inlined here as the runtime source of truth — the API server cannot
 * read the web artifact's public dir in production. A unit test guards
 * against drift between these constants and the public starter files.
 *
 * Composition is deliberately OUTSIDE the credits gate: credits price kits,
 * not setup. It runs on the user's configured key/model (BYOM).
 */
import type { JsonSchemaObject } from "./schemas.js";

export const COMPOSE_SLOTS = [
  "master-profile",
  "system-instructions",
  "experience",
] as const;

export type ComposeSlot = (typeof COMPOSE_SLOTS)[number];

export function isComposeSlot(slot: string): slot is ComposeSlot {
  return (COMPOSE_SLOTS as readonly string[]).includes(slot);
}

export type ComposeAnswer = { question: string; answer: string };

export type ComposeRequest = {
  slot: ComposeSlot;
  answers: ComposeAnswer[];
  tweakNote?: string;
};

/** Bounds keep a hand-rolled client from turning one compose into a giant prompt. */
const MAX_ANSWERS = 30;
const MAX_QUESTION_CHARS = 300;
const MAX_ANSWER_CHARS = 2000;
const MAX_TWEAK_CHARS = 1000;

/** Validate + normalize a compose request body. Throws with a user-facing message. */
export function parseComposeRequest(body: unknown): ComposeRequest {
  const b = (body || {}) as {
    slot?: unknown;
    answers?: unknown;
    tweakNote?: unknown;
  };
  const slot = String(b.slot || "");
  if (!isComposeSlot(slot)) {
    throw new Error(
      `slot must be one of: ${COMPOSE_SLOTS.join(", ")} (templates are not composable)`
    );
  }
  if (!Array.isArray(b.answers) || b.answers.length === 0) {
    throw new Error("answers must be a non-empty array of { question, answer }");
  }
  if (b.answers.length > MAX_ANSWERS) {
    throw new Error(`Too many answers (max ${MAX_ANSWERS}).`);
  }
  const answers: ComposeAnswer[] = b.answers.map((raw, i) => {
    const entry = (raw || {}) as { question?: unknown; answer?: unknown };
    const question = String(entry.question ?? "").trim();
    const answer = String(entry.answer ?? "").trim();
    if (!question) throw new Error(`Answer ${i + 1} is missing its question text.`);
    if (question.length > MAX_QUESTION_CHARS) {
      throw new Error(`Question ${i + 1} is too long (max ${MAX_QUESTION_CHARS} chars).`);
    }
    if (answer.length > MAX_ANSWER_CHARS) {
      throw new Error(`Answer ${i + 1} is too long (max ${MAX_ANSWER_CHARS} chars).`);
    }
    return { question, answer };
  });
  if (!answers.some((a) => a.answer)) {
    throw new Error("At least one question must be answered.");
  }
  let tweakNote: string | undefined;
  if (b.tweakNote != null && String(b.tweakNote).trim()) {
    tweakNote = String(b.tweakNote).trim();
    if (tweakNote.length > MAX_TWEAK_CHARS) {
      throw new Error(`Revision note is too long (max ${MAX_TWEAK_CHARS} chars).`);
    }
  }
  return { slot, answers, ...(tweakNote ? { tweakNote } : {}) };
}

/** json_schema name is the key the e2e mock harness dispatches on. */
export const COMPOSE_SCHEMA_NAME = "knowledge_compose";

export const KNOWLEDGE_COMPOSE_SCHEMA: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["markdown"],
  properties: {
    markdown: {
      type: "string",
      description:
        "The complete composed markdown document, starting with a level-1 heading",
    },
  },
};

/* ---------------------------------------------------------------------- */
/* Starter skeletons — MUST stay in sync with the public starter files.    */
/* (guarded by a drift unit test in tests/specs/quiz-compose.spec.ts)      */
/* ---------------------------------------------------------------------- */

const MASTER_PROFILE_SKELETON = `# REPLACE: Your Full Name

> Starter file. Replace every "REPLACE:" line with your real details and delete
> lines that don't apply. This file is fed to the model exactly as written —
> anything you leave in here, the model treats as true.

## Contact & Links

- Email: REPLACE: you@example.com
- Phone: REPLACE: +1 555 000 0000
- Location: REPLACE: City, Country
- LinkedIn: REPLACE: linkedin.com/in/you
- Portfolio / GitHub: REPLACE: url (delete if none)

## Who I Am

REPLACE: 2-4 first-person sentences on your professional identity — what you
do, how long you've done it, what you're known for. Plain language.

## Target Roles

- REPLACE: The job title you want most
- REPLACE: A second title you'd be strong in
- REPLACE: An adjacent title you'd accept (delete if none)

## Location & Work Authorization

- Based in: REPLACE: city, country
- Authorized to work in: REPLACE: countries — include visa status if relevant
- Remote stance: REPLACE: remote only / hybrid OK / open to relocating

## Constraints

- Salary floor: REPLACE: amount + currency (delete if flexible)
- Notice period / earliest start: REPLACE:
- Deal-breakers: REPLACE: e.g. no on-call, no agencies (delete if none)

## Core Skills

REPLACE: comma-separated list of your strongest skills, strongest first.

## Tools & Technologies

REPLACE: comma-separated list of what you actually use — languages, platforms,
software. Honest beats long.
`;

const SYSTEM_INSTRUCTIONS_SKELETON = `# REPLACE: My Custom Instructions

> Optional starter. This file is appended to the model's instructions on every
> generation run — use it for voice and rules, not for facts (facts belong in
> your Master Profile). Replace every "REPLACE:" line, delete sections you skip.

## Voice & Tone

REPLACE: e.g. "Plain and direct. Short sentences. Confident, never salesy.
No buzzwords like 'passionate' or 'synergy'."

## Always Emphasize

- REPLACE: the 1-3 themes every resume and cover letter should surface

## Never Claim

- REPLACE: e.g. "Never call me 'senior' — I'm mid-level and applying as such"
- REPLACE: e.g. "Never state metrics that aren't in my experience files"

## Quirks & Formatting

- REPLACE: e.g. "Use British spelling — I apply in the UK" (delete if none)
`;

const EXPERIENCE_SKELETON = `# REPLACE: Job Title — Company Name

> One role per file: save a copy of this starter for every job you've held and
> name each file after the role (e.g. "2019-acme-backend-engineer.md").
> Upload your OLDEST role first — catalog IDs (E1, E2, …) follow upload order.
> Replace every "REPLACE:" line; the model quotes this file as evidence.

- Company: REPLACE: name, industry, rough size
- Title: REPLACE: your exact title
- Dates: REPLACE: Mon YYYY – Mon YYYY (or "– present")
- Location: REPLACE: city / remote

## What the Role Was

REPLACE: 2-4 sentences — your scope, who you worked with, what you owned.

## Wins (with numbers)

> Kit verification grounds every claim in a generated resume against these
> bullets — a win without a number is hard to defend, so quantify where you
> honestly can. Concrete beats impressive.

- REPLACE: e.g. "Cut deploy time from 45 min to 8 by moving CI to …"
- REPLACE: e.g. "Grew trial-to-paid conversion 11% → 17% by …"
- REPLACE: 2-4 wins total, one line each

## Tech & Tools Used

REPLACE: comma-separated — only what you truly used in this role.
`;

export const STARTER_SKELETONS: Record<ComposeSlot, string> = {
  "master-profile": MASTER_PROFILE_SKELETON,
  "system-instructions": SYSTEM_INSTRUCTIONS_SKELETON,
  experience: EXPERIENCE_SKELETON,
};

/* ---------------------------------------------------------------------- */
/* Prompt building                                                         */
/* ---------------------------------------------------------------------- */

const SLOT_DOC_NAME: Record<ComposeSlot, string> = {
  "master-profile": "Master Profile",
  "system-instructions": "custom system instructions",
  experience: "workplace experience",
};

const SLOT_EXTRA_RULES: Record<ComposeSlot, string> = {
  "master-profile":
    "- This document is the factual identity record the tool grounds every application on.\n" +
    '- First line must be "# <the person\'s name>".',
  "system-instructions":
    "- This document is appended to the model's instructions on every generation run: write short imperative rules about voice and behavior, NOT facts about the person.\n" +
    '- First line must be "# Custom System Instructions".',
  experience:
    "- This document describes exactly ONE role and is quoted verbatim as evidence when verifying generated resumes.\n" +
    "- Keep every win bullet to one line and preserve the person's numbers EXACTLY as given — never round, extrapolate, or invent metrics.\n" +
    '- First line must be "# <Job Title> — <Company>".',
};

export function buildComposeMessages(req: ComposeRequest): {
  system: string;
  user: string;
} {
  const docName = SLOT_DOC_NAME[req.slot];
  const system = [
    `You turn a short structured interview into a finished "${docName}" markdown file for a job-application tool.`,
    "",
    "Hard rules:",
    "- Use ONLY facts stated in the interview answers. Never invent details, numbers, dates, links, or employers.",
    "- If an answer is blank, \"none\", or \"skip\", OMIT that section entirely — do not fabricate content for it.",
    "- Follow the skeleton's heading structure. Replace placeholders with real content; drop the instructional blockquotes and every \"REPLACE:\" marker.",
    "- Write in the first person, plain language, no buzzwords.",
    SLOT_EXTRA_RULES[req.slot],
    "",
    "Return JSON matching the schema: { markdown } — the complete document, nothing else.",
  ].join("\n");

  const transcript = req.answers
    .map((a, i) => `Q${i + 1}: ${a.question}\nA${i + 1}: ${a.answer || "(skipped)"}`)
    .join("\n\n");

  const parts = [
    "SKELETON (target structure):",
    "```markdown",
    STARTER_SKELETONS[req.slot].trim(),
    "```",
    "",
    "INTERVIEW:",
    "```",
    transcript,
    "```",
  ];
  if (req.tweakNote) {
    parts.push("", `REVISION REQUEST (apply to the previous draft's approach): ${req.tweakNote}`);
  }
  return { system, user: parts.join("\n") };
}
