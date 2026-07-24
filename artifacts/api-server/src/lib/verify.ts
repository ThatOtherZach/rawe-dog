/**
 * Verification pass support: deterministic (automated) checks, keyword
 * coverage, and QA report assembly. LLM findings from the verifier stage are
 * merged with automated findings into a single severity-tagged report.
 */

import {
  DOC_KEYS,
  DOC_FIELDS,
  DOC_LABELS,
  type ApplicationKit,
  type DocKey,
  type Pass1Selection,
  type VerifierOutput,
} from "./parse-kit.js";

export type QaSeverity = "info" | "minor" | "major";
export type QaCategory = "grounding" | "consistency" | "form" | "keywords";

export type QaFinding = {
  id: string;
  document: DocKey;
  category: QaCategory;
  severity: QaSeverity;
  detail: string;
  suggestion?: string;
  source: "verifier" | "automated";
  status: "open" | "repair_attempted";
};

export type KeywordCoverageEntry = {
  keyword: string;
  inResume: boolean;
  inCoverLetter: boolean;
  covered: boolean;
};

export type QaReport = {
  verdict: "pass" | "issues_found" | "repaired";
  summary: string;
  findings: QaFinding[];
  keywordCoverage: KeywordCoverageEntry[];
  repairedDocuments: DocKey[];
  counts: { major: number; minor: number; info: number };
  verifierRan: boolean;
};

const HTML_TAG_RE = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?>/i;
const EM_EN_DASH_RE = /[—–]/;
/** A spaced hyphen used mid-sentence (not a line-start bullet). */
const SPACED_HYPHEN_MIDLINE_RE = /[^\s|-] - (?!-)/;

export function wordCount(md: string): number {
  const words = (md || "").trim().split(/\s+/).filter(Boolean);
  return words.length;
}

/** Docs where the dash punctuation rule is enforced. */
const DASH_RULE_DOCS: DocKey[] = ["resume", "coverLetter"];

/** Deterministic form checks — run locally, no model involved. */
export function runAutomatedChecks(kit: ApplicationKit): QaFinding[] {
  const findings: QaFinding[] = [];
  let n = 0;
  const add = (
    document: DocKey,
    severity: QaSeverity,
    detail: string,
    suggestion?: string
  ) => {
    findings.push({
      id: `a${++n}`,
      document,
      category: "form",
      severity,
      detail,
      suggestion,
      source: "automated",
      status: "open",
    });
  };

  for (const doc of DOC_KEYS) {
    const md = String(kit[DOC_FIELDS[doc]] || "");
    const label = DOC_LABELS[doc];

    if (md.trim().length < 200) {
      add(doc, "major", `${label} came back nearly empty (${md.trim().length} chars).`);
      continue;
    }

    if (HTML_TAG_RE.test(md)) {
      add(
        doc,
        DASH_RULE_DOCS.includes(doc) ? "major" : "minor",
        `${label} contains HTML tags; documents must be plain markdown.`,
        "Rewrite the flagged parts as plain markdown."
      );
    }

    if (DASH_RULE_DOCS.includes(doc)) {
      if (EM_EN_DASH_RE.test(md)) {
        add(
          doc,
          "minor",
          `${label} still contains em/en dash characters after sanitization.`,
          "Replace with commas or rephrase."
        );
      }
      if (SPACED_HYPHEN_MIDLINE_RE.test(md)) {
        add(
          doc,
          "minor",
          `${label} uses a spaced hyphen ( - ) as sentence punctuation.`,
          "Use a comma or rephrase; hyphens are only for compound words, ranges, and bullets."
        );
      }
    }
  }

  const resumeWords = wordCount(kit.resumeMarkdown);
  if (resumeWords > 950) {
    add("resume", "minor", `Resume is long (${resumeWords} words; budget is 450-650).`, "Cut weaker bullets.");
  }
  const coverWords = wordCount(kit.coverLetterMarkdown);
  if (coverWords > 550) {
    add("coverLetter", "minor", `Cover letter is long (${coverWords} words; budget is 220-380).`, "Tighten paragraphs.");
  }

  return findings;
}

function keywordPresent(haystackLower: string, keyword: string): boolean {
  const k = keyword.trim().toLowerCase();
  if (!k) return false;
  if (/[^a-z0-9 ]/.test(k) || k.includes(" ")) {
    return haystackLower.includes(k);
  }
  const re = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return re.test(haystackLower);
}

export function computeKeywordCoverage(
  kit: ApplicationKit,
  keywords: string[]
): KeywordCoverageEntry[] {
  const resume = (kit.resumeMarkdown || "").toLowerCase();
  const cover = (kit.coverLetterMarkdown || "").toLowerCase();
  const seen = new Set<string>();
  const out: KeywordCoverageEntry[] = [];
  for (const raw of keywords) {
    const keyword = raw.trim();
    const dedupe = keyword.toLowerCase();
    if (!keyword || seen.has(dedupe)) continue;
    seen.add(dedupe);
    const inResume = keywordPresent(resume, keyword);
    const inCoverLetter = keywordPresent(cover, keyword);
    out.push({ keyword, inResume, inCoverLetter, covered: inResume || inCoverLetter });
  }
  return out;
}

function coverageFindings(coverage: KeywordCoverageEntry[]): QaFinding[] {
  const missing = coverage.filter((c) => !c.covered).map((c) => c.keyword);
  if (!missing.length) return [];
  return [
    {
      id: "k1",
      document: "resume",
      category: "keywords",
      severity: "minor",
      detail: `Spine keywords missing from both resume and cover letter: ${missing.join(", ")}.`,
      suggestion:
        "Weave them in only where the evidence honestly supports them; note real gaps in the alignment doc instead of stuffing.",
      source: "automated",
      status: "open",
    },
  ];
}

const SEVERITY_RANK: Record<QaSeverity, number> = { major: 0, minor: 1, info: 2 };

/**
 * Assemble the QA report from verifier output + deterministic checks.
 * Called after verification and again after repair (with the repaired kit),
 * so automated findings always reflect the current documents.
 */
export function buildQaReport(opts: {
  kit: ApplicationKit;
  selection: Pass1Selection;
  verifier: VerifierOutput | null;
  repairedDocuments: DocKey[];
  verifierUnavailableReason?: string;
}): QaReport {
  const automated = runAutomatedChecks(opts.kit);
  const coverage = computeKeywordCoverage(opts.kit, opts.selection.keywordsToHit);
  const kw = coverageFindings(coverage);

  const verifierFindings: QaFinding[] = (opts.verifier?.findings || []).map(
    (f, i) => ({
      id: `v${i + 1}`,
      document: f.document,
      category: f.category,
      severity: f.severity,
      detail: f.detail,
      suggestion: f.suggestion || undefined,
      source: "verifier",
      status: opts.repairedDocuments.includes(f.document)
        ? "repair_attempted"
        : "open",
    })
  );

  const findings = [...verifierFindings, ...automated, ...kw].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.document.localeCompare(b.document)
  );

  const counts = {
    major: findings.filter((f) => f.severity === "major").length,
    minor: findings.filter((f) => f.severity === "minor").length,
    info: findings.filter((f) => f.severity === "info").length,
  };

  const verdict: QaReport["verdict"] = opts.repairedDocuments.length
    ? "repaired"
    : counts.major + counts.minor > 0
      ? "issues_found"
      : "pass";

  let summary = (opts.verifier?.summary || "").trim();
  if (!summary) {
    summary =
      counts.major + counts.minor === 0
        ? "Automated checks passed; no issues found."
        : `Automated checks flagged ${counts.major} major and ${counts.minor} minor issue(s).`;
  }
  if (opts.verifierUnavailableReason) {
    summary += ` Note: the model verification pass could not run (${opts.verifierUnavailableReason}); this report contains automated checks only.`;
  }

  return {
    verdict,
    summary,
    findings,
    keywordCoverage: coverage,
    repairedDocuments: opts.repairedDocuments,
    counts,
    verifierRan: Boolean(opts.verifier),
  };
}

/** Documents that need a repair round: any OPEN major finding. */
export function docsNeedingRepair(findings: QaFinding[]): DocKey[] {
  const docs: DocKey[] = [];
  for (const f of findings) {
    if (f.severity === "major" && f.status === "open" && !docs.includes(f.document)) {
      docs.push(f.document);
    }
  }
  return docs;
}
