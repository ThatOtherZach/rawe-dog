/**
 * Normalize model markdown for display + export.
 * Strips HTML, HTML entities, and export-hostile noise.
 */

export function cleanDocumentMarkdown(md: string): string {
  if (!md) return "";
  let s = md.replace(/\r\n/g, "\n");

  // Drop HTML tags but keep inner text
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n");
  s = s.replace(/<li[^>]*>/gi, "- ");
  s = s.replace(/<[^>]+>/g, "");

  // Common entities
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Em/en dashes → comma-friendly punctuation for ATS rules
  s = s.replace(/[—–]/g, ", ");

  // Collapse whitespace
  s = s.replace(/[ \t]+\n/g, "\n");
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
