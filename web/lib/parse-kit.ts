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
    sourcesUsed: string[];
  };
  resumeMarkdown: string;
  coverLetterMarkdown: string;
  alignmentNotesMarkdown: string;
  starPrepMarkdown: string;
};

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return trimmed;
}

export function parseJsonLoose<T>(text: string): T {
  const raw = extractJsonObject(text);
  try {
    return JSON.parse(raw) as T;
  } catch {
    const repaired = raw
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/\u201c|\u201d/g, '"')
      .replace(/\u2018|\u2019/g, "'");
    return JSON.parse(repaired) as T;
  }
}

export function tryParseJsonLoose<T>(
  text: string
): { ok: true; data: T } | { ok: false; error: string } {
  try {
    return { ok: true, data: parseJsonLoose<T>(text) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
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
