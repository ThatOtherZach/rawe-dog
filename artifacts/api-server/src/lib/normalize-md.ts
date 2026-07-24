/**
 * Utilities to normalize and compact markdown for LLM context windows.
 */

/** Basic markdown normalization (trim, collapse blank lines). */
export function normalizeMarkdown(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Extract the first H1 or H2 title from markdown, falling back to filename. */
export function extractTitle(text: string, filename: string): string {
  const m = text.match(/^#{1,2}\s+(.+)$/m);
  if (m) return m[1].trim();
  return filename.replace(/\.(md|pdf|txt|markdown)$/i, "").replace(/[-_]/g, " ").trim();
}

/** Compact an experience file to a token budget. */
export function compactExperience(
  text: string,
  filename: string,
  opts: { summaryChars?: number; starChars?: number; skillsChars?: number } = {}
): string {
  const { summaryChars = 450, starChars = 2000, skillsChars = 450 } = opts;
  const title = extractTitle(text, filename);

  // Extract a "summary" block (first non-heading paragraph)
  const summaryMatch = text.match(/^(?![#\-*>])(.+(?:\n.+)*)/m);
  const summary = summaryMatch ? summaryMatch[0].slice(0, summaryChars) : "";

  // Extract STAR / achievement bullet blocks
  const starMatch = text.match(/(?:star|achievement|result|outcome|impact)[^\n]*\n([\s\S]{0,})/i);
  const star = starMatch ? starMatch[1].slice(0, starChars) : text.slice(0, starChars);

  // Extract skills/tools
  const skillsMatch = text.match(/(?:skills|tools|tech)[^\n]*\n([\s\S]{0,})/i);
  const skills = skillsMatch ? skillsMatch[1].slice(0, skillsChars) : "";

  const parts = [`## ${title}`, summary, star, skills].filter(Boolean);
  return parts.join("\n\n");
}

/** Compact a master profile to a token budget. */
export function compactMasterProfile(text: string, maxChars = 9000): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n…[profile truncated for tokens]";
}

/** Compact a template to a token budget. */
export function compactTemplate(text: string, maxChars = 3500): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n…[template truncated]";
}

/** Full text for a lead experience (not compacted). */
export function packLeadExperience(doc: { text: string; title: string; meta: { originalName: string } }): string {
  return `### ${doc.title} (${doc.meta.originalName})\n\n${doc.text}`;
}
