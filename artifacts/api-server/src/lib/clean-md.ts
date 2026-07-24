/**
 * Cleaning utilities for generated markdown before display / export.
 */

/** Strip common AI-output artifacts from a markdown string. */
export function cleanDocumentMarkdown(raw: string): string {
  let s = (raw || "").trim();

  // Strip fenced code blocks wrapping the whole document
  s = s.replace(/^```(?:markdown|md)?\n([\s\S]*?)```\s*$/i, "$1").trim();

  // Collapse 3+ blank lines to 2
  s = s.replace(/\n{3,}/g, "\n\n");

  return s.trim();
}

/**
 * Enforce the resume/cover dash policy deterministically:
 * - em/en dash used as a bullet marker → markdown "-" bullet
 * - en/em dash in numeric ranges → plain hyphen (2019-2023)
 * - any remaining em/en dash punctuation → comma
 * Markdown hyphens (bullets, tables, hr) are untouched.
 */
export function sanitizeDashPunctuation(md: string): string {
  let s = md || "";
  s = s.replace(/^([ \t]*)[—–]\s+/gm, "$1- ");
  s = s.replace(/(\d)\s?[–—]\s?(\d)/g, "$1-$2");
  s = s.replace(/[ \t]*[—–][ \t]*/g, ", ");
  return s;
}

export function cleanKitFields<T extends Record<string, unknown>>(kit: T): T {
  const out = { ...kit } as T;
  for (const key of Object.keys(out)) {
    const v = out[key as keyof T];
    if (typeof v === "string" && /Markdown$/i.test(key)) {
      (out as Record<string, unknown>)[key] = cleanDocumentMarkdown(v);
    }
  }
  return out;
}

export function slugifyFilename(s: string, fallback = "document"): string {
  const cleaned = (s || fallback)
    .replace(/[^\w.\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 60);
  return cleaned || fallback;
}
