/**
 * Shared types + JSON normalization helpers for LLM pipeline outputs.
 */

export type DocKey = "resume" | "coverLetter" | "alignmentNotes" | "starPrep";

export const DOC_KEYS: DocKey[] = [
  "resume",
  "coverLetter",
  "alignmentNotes",
  "starPrep",
];

export const DOC_LABELS: Record<DocKey, string> = {
  resume: "Resume",
  coverLetter: "Cover letter",
  alignmentNotes: "Alignment notes",
  starPrep: "STAR prep",
};

export type Pass1Selection = {
  targetTitle: string;
  company: string;
  /** Stable catalog IDs (E1, E2, …) — the canonical selection. */
  leadExperienceIds: string[];
  supportingExperienceIds: string[];
  /** Resolved display titles (filled server-side after ID resolution). */
  leadExperiences: string[];
  supportingExperiences: string[];
  keywordsToHit: string[];
  rationale: string;
};

export type ApplicationKit = {
  meta: {
    targetTitle: string;
    company: string;
    leadExperiences: string[];
    rationale: string;
    sourcesUsed?: string[];
    /** True when the kit was generated in Long Shot (career-pivot) mode. */
    longShot?: boolean;
  };
  resumeMarkdown: string;
  coverLetterMarkdown: string;
  alignmentNotesMarkdown: string;
  starPrepMarkdown: string;
};

export type DocField =
  | "resumeMarkdown"
  | "coverLetterMarkdown"
  | "alignmentNotesMarkdown"
  | "starPrepMarkdown";

/** Map DocKey -> ApplicationKit markdown field. */
export const DOC_FIELDS: Record<DocKey, DocField> = {
  resume: "resumeMarkdown",
  coverLetter: "coverLetterMarkdown",
  alignmentNotes: "alignmentNotesMarkdown",
  starPrep: "starPrepMarkdown",
};

/** Output of one per-document draft call. */
export type DraftOutput = {
  markdown: string;
  sourcesUsed: string[];
};

export type VerifierFinding = {
  document: DocKey;
  category: "grounding" | "consistency" | "form" | "keywords";
  severity: "info" | "minor" | "major";
  detail: string;
  suggestion: string;
};

export type VerifierOutput = {
  findings: VerifierFinding[];
  summary: string;
};

/** Try to parse JSON from a string, tolerating markdown code fences and trailing text. */
export function tryParseJsonLoose<T>(raw: string): { ok: true; data: T } | { ok: false } {
  // Try direct parse first
  try {
    return { ok: true, data: JSON.parse(raw) as T };
  } catch {
    // strip fences
  }

  // Strip markdown code fences
  const stripped = raw.replace(/^```(?:json)?\n?([\s\S]*?)```\s*$/i, "$1").trim();
  try {
    return { ok: true, data: JSON.parse(stripped) as T };
  } catch {
    // try to find first { ... }
  }

  // Find first JSON object
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return { ok: true, data: JSON.parse(raw.slice(start, end + 1)) as T };
    } catch {
      // no luck
    }
  }

  return { ok: false };
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
}

/**
 * Normalize a Pass 1 selection object. Accepts both the new ID-based shape
 * and the legacy title-based shape (old clients POSTing mode:"pass2").
 */
export function normalizePass1(data: Partial<Pass1Selection> | undefined | null): Pass1Selection {
  const d = data || {};
  return {
    targetTitle: typeof d.targetTitle === "string" ? d.targetTitle : "",
    company: typeof d.company === "string" ? d.company : "",
    leadExperienceIds: strArray(d.leadExperienceIds).slice(0, 5),
    supportingExperienceIds: strArray(d.supportingExperienceIds).slice(0, 8),
    leadExperiences: strArray(d.leadExperiences),
    supportingExperiences: strArray(d.supportingExperiences),
    keywordsToHit: strArray(d.keywordsToHit).slice(0, 25),
    rationale: typeof d.rationale === "string" ? d.rationale : "",
  };
}

export function normalizeDraft(data: Partial<DraftOutput> | undefined | null): DraftOutput {
  const d = data || {};
  return {
    markdown: typeof d.markdown === "string" ? d.markdown : "",
    sourcesUsed: strArray(d.sourcesUsed),
  };
}

const FINDING_CATEGORIES = new Set(["grounding", "consistency", "form", "keywords"]);
const FINDING_SEVERITIES = new Set(["info", "minor", "major"]);
const FINDING_DOCS = new Set(DOC_KEYS as string[]);

export function normalizeVerifier(data: Partial<VerifierOutput> | undefined | null): VerifierOutput {
  const d = data || {};
  const findings: VerifierFinding[] = [];
  if (Array.isArray(d.findings)) {
    for (const raw of d.findings) {
      if (!raw || typeof raw !== "object") continue;
      const f = raw as Record<string, unknown>;
      const document = String(f["document"] || "");
      const category = String(f["category"] || "");
      const severity = String(f["severity"] || "");
      const detail = String(f["detail"] || "").trim();
      if (!detail) continue;
      findings.push({
        document: (FINDING_DOCS.has(document) ? document : "resume") as DocKey,
        category: (FINDING_CATEGORIES.has(category) ? category : "form") as VerifierFinding["category"],
        severity: (FINDING_SEVERITIES.has(severity) ? severity : "minor") as VerifierFinding["severity"],
        detail,
        suggestion: String(f["suggestion"] || "").trim(),
      });
    }
  }
  return {
    findings: findings.slice(0, 40),
    summary: typeof d.summary === "string" ? d.summary : "",
  };
}
