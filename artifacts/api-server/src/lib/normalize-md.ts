/**
 * Utilities to normalize and compact markdown for LLM context windows.
 *
 * Compaction is SECTION-AWARE: documents are split on their actual markdown
 * headings and packed by priority, instead of positional char-slicing. The
 * Master Profile's Role-Type Alignment Table, Experience Keyword Index, and
 * Workplace Usage Guidance sections are always preserved in full, regardless
 * of where they sit in the file.
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

export type MdSection = {
  heading: string;
  level: number;
  /** Body text below the heading, up to the next heading (any level). */
  body: string;
};

/**
 * Split markdown into a preamble (text before the first heading) and a flat
 * list of sections. Headings inside fenced code blocks are ignored.
 */
export function splitSections(text: string): { preamble: string; sections: MdSection[] } {
  const lines = text.split("\n");
  const sections: MdSection[] = [];
  const preambleLines: string[] = [];
  let current: MdSection | null = null;
  let inFence = false;

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = !inFence ? line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/) : null;
    if (m) {
      if (current) sections.push(current);
      current = { heading: m[2].trim(), level: m[1].length, body: "" };
    } else if (current) {
      current.body += (current.body ? "\n" : "") + line;
    } else {
      preambleLines.push(line);
    }
  }
  if (current) sections.push(current);

  return {
    preamble: preambleLines.join("\n").trim(),
    sections: sections.map((s) => ({ ...s, body: s.body.trim() })),
  };
}

/** Render one section back to markdown. */
export function renderSection(s: MdSection): string {
  const head = `${"#".repeat(Math.min(6, Math.max(1, s.level)))} ${s.heading}`;
  return s.body ? `${head}\n${s.body}` : head;
}

/** Trim text to a budget at a line boundary, with a visible marker. */
export function trimToBoundary(text: string, maxChars: number, marker = "\n…[trimmed]"): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, Math.max(0, maxChars));
  const cut = slice.lastIndexOf("\n");
  const body = cut > maxChars * 0.5 ? slice.slice(0, cut) : slice;
  return body.trimEnd() + marker;
}

/** The three Master Profile sections that must always survive compaction. */
export const MASTER_KEY_SECTION_PATTERNS: RegExp[] = [
  /role[\s-]*type.*alignment|alignment[\s-]*table/i,
  /keyword[\s-]*index/i,
  /(workplace[\s-]*)?usage[\s-]*guidance/i,
];

export function isKeyMasterHeading(heading: string): boolean {
  return MASTER_KEY_SECTION_PATTERNS.some((re) => re.test(heading));
}

/**
 * Compact a master profile to a char budget, section-aware.
 * Key sections (alignment table / keyword index / usage guidance) are always
 * kept in full — even if that alone exceeds the budget.
 */
export function compactMasterProfile(text: string, maxChars = 9000): string {
  if (text.length <= maxChars) return text;

  const { preamble, sections } = splitSections(text);
  if (!sections.length) return trimToBoundary(text, maxChars);

  type Entry = { text: string; key: boolean; include: boolean; heading: string };
  const entries: Entry[] = sections.map((sec) => ({
    text: renderSection(sec),
    key: isKeyMasterHeading(sec.heading),
    include: false,
    heading: sec.heading,
  }));

  let budget = maxChars;

  // 1) Key sections: always included, in full.
  for (const e of entries) {
    if (e.key) {
      e.include = true;
      budget -= e.text.length;
    }
  }

  // 2) Preamble (identity/summary lines before the first heading).
  let pre = "";
  if (preamble && budget > 300) {
    pre = trimToBoundary(preamble, Math.min(1200, budget));
    budget -= pre.length;
  }

  // 3) Remaining sections in document order, each capped, until budget runs out.
  for (const e of entries) {
    if (e.include) continue;
    if (budget < 400) break;
    const capped = trimToBoundary(e.text, Math.min(1600, budget));
    e.text = capped;
    e.include = true;
    budget -= capped.length;
  }

  const omitted = entries.filter((e) => !e.include).map((e) => e.heading);
  const parts: string[] = [];
  if (pre) parts.push(pre);
  for (const e of entries) if (e.include) parts.push(e.text);
  if (omitted.length) {
    parts.push(`[Master Profile sections omitted to fit context: ${omitted.join("; ")}]`);
  }
  return parts.join("\n\n");
}

const SUMMARY_HEADING_RE = /summary|overview|about|context|profile|role\b/i;
const STAR_HEADING_RE = /star|achievement|accomplishment|impact|result|outcome|highlight|project/i;
const SKILLS_HEADING_RE = /skill|tool|tech|stack|keyword|competenc/i;

/**
 * Compact an experience file by its actual section structure.
 * Priority: summary/overview → STAR/achievements → skills/tools → the rest.
 * Sections are rendered back in original document order.
 */
export function compactExperience(
  text: string,
  opts: { label: string; maxChars: number }
): string {
  const header = `### ${opts.label}`;
  const budgetTotal = Math.max(300, opts.maxChars);
  const { preamble, sections } = splitSections(text);

  if (!sections.length) {
    return `${header}\n\n${trimToBoundary(text, budgetTotal)}`;
  }

  type Entry = {
    text: string;
    priority: number;
    cap: number;
    order: number;
    include: boolean;
  };

  const capFor = (p: number) => (p === 0 ? 700 : p === 1 ? 1600 : p === 2 ? 500 : 400);
  const priorityFor = (h: string) =>
    SUMMARY_HEADING_RE.test(h) ? 0 : STAR_HEADING_RE.test(h) ? 1 : SKILLS_HEADING_RE.test(h) ? 2 : 3;

  const entries: Entry[] = [];
  let order = 0;

  // Preamble acts as a summary block when present.
  if (preamble) {
    entries.push({ text: preamble, priority: 0, cap: 700, order: order++, include: false });
  }

  for (const sec of sections) {
    // Skip a bare title heading that duplicates the label (no body).
    if (!sec.body && sec.level <= 2 && order === entries.length && entries.length === 0) {
      order++;
      continue;
    }
    const p = priorityFor(sec.heading);
    entries.push({
      text: renderSection(sec),
      priority: p,
      cap: capFor(p),
      order: order++,
      include: false,
    });
  }

  let budget = budgetTotal;
  const byPriority = [...entries].sort(
    (a, b) => a.priority - b.priority || a.order - b.order
  );
  for (const e of byPriority) {
    if (budget < 150) break;
    const t = trimToBoundary(e.text, Math.min(e.cap, budget));
    e.text = t;
    e.include = true;
    budget -= t.length;
  }

  const included = entries.filter((e) => e.include).sort((a, b) => a.order - b.order);
  const omittedCount = entries.length - included.length;
  const parts = [header, ...included.map((e) => e.text)];
  if (omittedCount > 0) parts.push(`[${omittedCount} smaller section(s) omitted]`);
  return parts.join("\n\n");
}

/** Compact a template to a char budget (line-boundary trim). */
export function compactTemplate(text: string, maxChars = 3500): string {
  return trimToBoundary(text, maxChars, "\n…[template trimmed]");
}

/** Full text for a lead experience (not compacted), capped at a sane maximum. */
export function packFullExperience(label: string, text: string, maxChars = 14000): string {
  return `### ${label}\n\n${trimToBoundary(text, maxChars)}`;
}
