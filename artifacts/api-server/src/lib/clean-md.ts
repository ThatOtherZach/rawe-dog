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
