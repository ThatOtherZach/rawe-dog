/**
 * Normalize Obsidian/markdown career docs for model context.
 * Keep high-signal structure; strip noise. Accuracy-first, token-aware.
 */

export function stripFrontmatter(md: string): string {
  if (!md.startsWith("---")) return md;
  const end = md.indexOf("\n---", 3);
  if (end === -1) return md;
  return md.slice(end + 4).replace(/^\s*\n/, "");
}

export function stripWikilinks(md: string): string {
  return md
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1");
}

export function normalizeMarkdown(md: string): string {
  let out = stripFrontmatter(md);
  out = stripWikilinks(out);
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

export function extractTitle(md: string, fallback: string): string {
  const h1 = md.match(/^#\s+(.+)$/m);
  if (h1) {
    return h1[1]
      .replace(/Work Experience Summary/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  return fallback.replace(/\.(md|txt|pdf)$/i, "");
}

function extractSection(
  md: string,
  headingPattern: RegExp,
  maxChars?: number
): string {
  const lines = md.split("\n");
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.*)$/);
    if (m && headingPattern.test(m[2])) {
      start = i;
      level = m[1].length;
      break;
    }
  }
  if (start === -1) return "";

  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/);
    if (m && m[1].length <= level) break;
    body.push(lines[i]);
  }
  let text = body.join("\n").trim();
  if (maxChars && text.length > maxChars) {
    text = text.slice(0, maxChars) + "\n…";
  }
  return text;
}

/**
 * Compact Master Profile for Pass 1: keep strategy tables, drop long hobby/quote prose if huge.
 */
export function compactMasterProfile(md: string, maxChars = 9000): string {
  const normalized = normalizeMarkdown(md);
  if (normalized.length <= maxChars) return normalized;

  const keep = [
    extractSection(normalized, /personal information/i, 800),
    extractSection(normalized, /certifications/i, 800),
    extractSection(normalized, /education/i, 600),
    extractSection(normalized, /role-type alignment/i, 2500),
    extractSection(normalized, /experience keyword/i, 3000),
    extractSection(normalized, /tone|formatting/i, 600),
    extractSection(normalized, /workplace usage/i, 2500),
    extractSection(normalized, /guidance for gpts/i, 1200),
  ].filter(Boolean);

  let packed = keep.join("\n\n");
  if (!packed) packed = normalized.slice(0, maxChars);
  if (packed.length > maxChars) packed = packed.slice(0, maxChars) + "\n…";
  return packed;
}

/** High-signal compact catalog entry for Pass 1 selection. */
export function compactExperience(
  md: string,
  fileName: string,
  options?: { summaryChars?: number; starChars?: number; skillsChars?: number }
): string {
  const normalized = normalizeMarkdown(md);
  const title = extractTitle(normalized, fileName);
  const summaryChars = options?.summaryChars ?? 500;
  const starChars = options?.starChars ?? 2200;
  const skillsChars = options?.skillsChars ?? 500;

  const skills = extractSection(
    normalized,
    /skills|tools|technology/i,
    skillsChars
  );
  const star =
    extractSection(normalized, /star\s*index/i, starChars) ||
    extractSection(normalized, /star/i, starChars);
  const companySummary =
    extractSection(normalized, /company\s*summary/i, summaryChars) ||
    extractSection(normalized, /summary/i, summaryChars) ||
    normalized.slice(0, summaryChars);

  return [
    `### ${title}`,
    `Source: ${fileName}`,
    companySummary ? `#### Summary\n${companySummary}` : "",
    skills ? `#### Skills\n${skills}` : "",
    star ? `#### STAR Index\n${star}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Prefer full text for lead experiences; if huge, keep STAR + Project Impact +
 * keyword-matching sections so accuracy stays high without dumping every Q&A.
 */
export function packLeadExperience(
  md: string,
  fileName: string,
  keywords: string[] = [],
  charBudget = 12000
): string {
  const normalized = normalizeMarkdown(md);
  const title = extractTitle(normalized, fileName);

  if (normalized.length <= charBudget) {
    return `### FULL EXPERIENCE: ${title}\nSource: ${fileName}\n\n${normalized}`;
  }

  const star = extractSection(normalized, /star\s*index/i, 3500);
  const impact = extractSection(normalized, /project\s*impact/i, 3500);
  const process = extractSection(normalized, /process\s*improvement/i, 2000);
  const technical = extractSection(normalized, /technical\s*creativity/i, 2000);
  const skills = extractSection(normalized, /skills|tools|technology/i, 1000);
  const summary = extractSection(normalized, /company\s*summary/i, 1000);

  const chunks = [summary, skills, star, impact, process, technical].filter(
    Boolean
  );

  if (keywords.length) {
    const lowerKw = keywords.map((k) => k.toLowerCase());
    const sections = normalized.split(/(?=^#{1,3}\s+)/m);
    for (const sec of sections) {
      const low = sec.toLowerCase();
      if (lowerKw.some((k) => k.length > 2 && low.includes(k))) {
        const clipped = sec.length > 1800 ? sec.slice(0, 1800) + "\n…" : sec;
        if (!chunks.includes(clipped)) chunks.push(clipped);
      }
    }
  }

  let packed = chunks.join("\n\n");
  if (packed.length > charBudget) {
    packed = packed.slice(0, charBudget) + "\n…";
  }

  return `### FULL EXPERIENCE (compressed): ${title}\nSource: ${fileName}\n\n${packed}`;
}

/** Cap template text for model context. */
export function compactTemplate(md: string, maxChars = 4000): string {
  const n = normalizeMarkdown(md);
  if (n.length <= maxChars) return n;
  return n.slice(0, maxChars) + "\n…[template truncated]";
}
