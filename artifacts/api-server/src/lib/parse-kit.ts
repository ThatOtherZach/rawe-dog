/**
 * JSON output parsing helpers for LLM responses.
 */

export type Pass1Selection = {
  targetTitle: string;
  company: string;
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
  };
  resumeMarkdown: string;
  coverLetterMarkdown: string;
  alignmentNotesMarkdown: string;
  starPrepMarkdown: string;
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

export function normalizePass1(data: Partial<Pass1Selection>): Pass1Selection {
  return {
    targetTitle: data.targetTitle || "",
    company: data.company || "",
    leadExperiences: Array.isArray(data.leadExperiences)
      ? data.leadExperiences.map(String)
      : [],
    supportingExperiences: Array.isArray(data.supportingExperiences)
      ? data.supportingExperiences.map(String)
      : [],
    keywordsToHit: Array.isArray(data.keywordsToHit)
      ? data.keywordsToHit.map(String)
      : [],
    rationale: data.rationale || "",
  };
}

export function normalizeKit(data: Partial<ApplicationKit>): ApplicationKit {
  const meta = data.meta || {
    targetTitle: "",
    company: "",
    leadExperiences: [],
    rationale: "",
    sourcesUsed: [],
  };
  const sources =
    Array.isArray((meta as { sourcesUsed?: string[] }).sourcesUsed)
      ? (meta as { sourcesUsed: string[] }).sourcesUsed.map(String)
      : Array.isArray(meta.leadExperiences)
        ? meta.leadExperiences.map(String)
        : [];

  return {
    meta: {
      targetTitle: meta.targetTitle || "",
      company: meta.company || "",
      leadExperiences: Array.isArray(meta.leadExperiences)
        ? meta.leadExperiences.map(String)
        : [],
      rationale: meta.rationale || "",
      sourcesUsed: sources,
    },
    resumeMarkdown: data.resumeMarkdown || "",
    coverLetterMarkdown: data.coverLetterMarkdown || "",
    alignmentNotesMarkdown: data.alignmentNotesMarkdown || "",
    starPrepMarkdown: data.starPrepMarkdown || "",
  };
}
