/**
 * Canonical job brief — the token-efficient representation of a posting that
 * the fit scan extracts once and the generation pipeline consumes later,
 * instead of re-sending the raw multi-thousand-char description.
 */

import type { JobPosting } from "./provider.js";

export type JobBrief = {
  targetTitle: string;
  company: string;
  seniority: string;
  mustHaves: string[];
  niceToHaves: string[];
  responsibilities: string[];
  atsKeywords: string[];
  /** Compensation as stated in the posting; "" if not stated. */
  compensation: string;
};

function strArray(v: unknown, max: number): string[] {
  return Array.isArray(v)
    ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, max)
    : [];
}

export function normalizeBrief(raw: Partial<JobBrief> | null | undefined): JobBrief {
  const d = raw || {};
  return {
    targetTitle: typeof d.targetTitle === "string" ? d.targetTitle.trim() : "",
    company: typeof d.company === "string" ? d.company.trim() : "",
    seniority: typeof d.seniority === "string" ? d.seniority.trim() : "",
    mustHaves: strArray(d.mustHaves, 12),
    niceToHaves: strArray(d.niceToHaves, 10),
    responsibilities: strArray(d.responsibilities, 10),
    atsKeywords: strArray(d.atsKeywords, 20),
    compensation: typeof d.compensation === "string" ? d.compensation.trim() : "",
  };
}

/** A brief is only worth substituting for the raw posting if it has substance. */
export function briefIsUsable(brief: JobBrief | null | undefined): brief is JobBrief {
  return Boolean(
    brief &&
      (brief.mustHaves.length || brief.responsibilities.length || brief.atsKeywords.length)
  );
}

function bulletList(items: string[]): string {
  return items.map((i) => `- ${i}`).join("\n");
}

function factsLine(posting: JobPosting): string {
  const facts = [
    posting.location && `Location: ${posting.location}`,
    posting.remote === true ? "Remote: yes" : posting.remote === false ? "Remote: no" : "",
    posting.salary && `Posted salary: ${posting.salary}`,
    posting.datePosted && `Posted: ${posting.datePosted}`,
  ].filter(Boolean);
  return facts.join(" · ");
}

/**
 * Requirement-level rendering — stands in for the raw posting during
 * drafting and verification. Faithful to the posting, a fraction of the size.
 */
export function renderBriefForDrafting(posting: JobPosting, brief: JobBrief): string {
  const parts: string[] = [];
  parts.push(
    `Structured job brief (extracted verbatim from the live posting "${
      brief.targetTitle || posting.title
    }" at ${brief.company || posting.company || "unknown company"}).`
  );
  const facts = factsLine(posting);
  if (facts) parts.push(facts);
  if (brief.seniority) parts.push(`Seniority: ${brief.seniority}`);
  if (brief.mustHaves.length) parts.push(`## Must-have requirements\n${bulletList(brief.mustHaves)}`);
  if (brief.niceToHaves.length) parts.push(`## Nice-to-haves\n${bulletList(brief.niceToHaves)}`);
  if (brief.responsibilities.length) {
    parts.push(`## Core responsibilities\n${bulletList(brief.responsibilities)}`);
  }
  if (brief.atsKeywords.length) parts.push(`## ATS keywords\n${brief.atsKeywords.join(", ")}`);
  if (brief.compensation) parts.push(`## Compensation\n${brief.compensation}`);
  return parts.join("\n\n");
}

/** Compact rendering for the selection stage — a few hundred chars. */
export function renderBriefCompact(posting: JobPosting, brief: JobBrief): string {
  const lines = [
    `${brief.targetTitle || posting.title} @ ${brief.company || posting.company || "?"}${
      brief.seniority ? ` (${brief.seniority})` : ""
    }`,
    brief.mustHaves.length ? `Must-haves: ${brief.mustHaves.join("; ")}` : "",
    brief.responsibilities.length
      ? `Responsibilities: ${brief.responsibilities.slice(0, 5).join("; ")}`
      : "",
    brief.atsKeywords.length ? `Keywords: ${brief.atsKeywords.join(", ")}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}
