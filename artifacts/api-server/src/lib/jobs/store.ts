/**
 * Postings cache: JSON file under the app data dir.
 *
 * Postings are fetched only on explicit refresh, deduped by internal id, and
 * each carries an optional fit result (score + rationale + matched experience
 * IDs + canonical brief) so kits can be generated later from the posting id
 * alone — no raw description re-sent through the LLM pipeline.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { getDataRoot } from "../paths.js";
import { normalizeBrief, type JobBrief } from "./brief.js";
import { normalizeFilters, type JobPosting, type SearchFilters } from "./provider.js";

export type LegitimacyTier = "high_confidence" | "caution" | "suspicious";

export type FitResult = {
  /** 0-100 realistic-fit score. */
  score: number;
  /** One-line explanation of the decisive factors. */
  rationale: string;
  /** Catalog IDs (E1…) of the applicant experiences that best match. */
  matchedExperienceIds: string[];
  /** Canonical brief extracted from the posting in the same scan call. */
  brief: JobBrief;
  /**
   * Posting legitimacy tier — orthogonal to fit score (career-ops signal taxonomy,
   * MIT, Santiago Fernández de Valderrama, github.com/santifer/career-ops).
   * Absent on pre-existing records; treated as no badge in the UI.
   */
  legitimacy?: LegitimacyTier;
  /** 0-3 short observational notes explaining the legitimacy tier. */
  legitimacySignals?: string[];
  scoredAt: string;
  model: string;
};

export type PostingStatus = "new" | "kit_generated" | "applied" | "dismissed";

export type StoredPosting = {
  posting: JobPosting;
  fit: FitResult | null;
  addedAt: string;
  status: PostingStatus;
};

export type RefreshStats = {
  fetched: number;
  added: number;
  scored: number;
  scoreFailures: number;
};

export type PostingsFile = {
  filters: SearchFilters | null;
  filtersSource: "derived" | "manual" | null;
  lastRefreshAt: string | null;
  lastRefreshStats: RefreshStats | null;
  postings: StoredPosting[];
};

const MAX_STORED = 300;

function postingsDir(): string {
  return path.join(getDataRoot(), "postings");
}

function postingsPath(): string {
  return path.join(postingsDir(), "postings.json");
}

function emptyFile(): PostingsFile {
  return {
    filters: null,
    filtersSource: null,
    lastRefreshAt: null,
    lastRefreshStats: null,
    postings: [],
  };
}

const VALID_STATUSES: PostingStatus[] = ["new", "kit_generated", "applied", "dismissed"];

function normalizeStatus(raw: unknown): PostingStatus {
  if (typeof raw === "string" && VALID_STATUSES.includes(raw as PostingStatus)) {
    return raw as PostingStatus;
  }
  return "new";
}

export function loadPostingsFile(): PostingsFile {
  const p = postingsPath();
  if (!existsSync(p)) return emptyFile();
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<PostingsFile>;
    return {
      filters: raw.filters ? normalizeFilters(raw.filters) : null,
      filtersSource: raw.filtersSource === "derived" || raw.filtersSource === "manual"
        ? raw.filtersSource
        : null,
      lastRefreshAt: typeof raw.lastRefreshAt === "string" ? raw.lastRefreshAt : null,
      lastRefreshStats: raw.lastRefreshStats ?? null,
      postings: Array.isArray(raw.postings)
        ? raw.postings
            .filter(
              (sp): sp is StoredPosting =>
                Boolean(sp && typeof sp === "object" && (sp as StoredPosting).posting?.id)
            )
            .map((sp) => ({ ...sp, status: normalizeStatus(sp.status) }))
        : [],
    };
  } catch {
    // Corrupt cache is not worth crashing over — start fresh (explicit refresh model).
    return emptyFile();
  }
}

export function savePostingsFile(file: PostingsFile): void {
  mkdirSync(postingsDir(), { recursive: true });
  writeFileSync(postingsPath(), JSON.stringify(file, null, 2), "utf8");
}

export function saveFilters(
  filters: SearchFilters,
  source: "derived" | "manual"
): PostingsFile {
  const file = loadPostingsFile();
  file.filters = normalizeFilters(filters);
  file.filtersSource = source;
  savePostingsFile(file);
  return file;
}

/** Insert new postings, skipping ids we already have. Returns the added ones. */
export function upsertPostings(incoming: JobPosting[]): {
  added: StoredPosting[];
  total: number;
} {
  const file = loadPostingsFile();
  const known = new Set(file.postings.map((sp) => sp.posting.id));
  const now = new Date().toISOString();
  const added: StoredPosting[] = [];
  for (const posting of incoming) {
    if (known.has(posting.id)) continue;
    known.add(posting.id);
    added.push({ posting, fit: null, addedAt: now, status: "new" });
  }
  file.postings = [...added, ...file.postings];
  if (file.postings.length > MAX_STORED) {
    file.postings = [...file.postings]
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
      .slice(0, MAX_STORED);
  }
  savePostingsFile(file);
  return { added, total: file.postings.length };
}

/**
 * Update the status of a single posting. Returns false if the id was not found.
 * Only transitions that make sense are gated here — kit_generated is set
 * automatically by the generate route; all others are user-driven.
 */
export function setPostingStatus(id: string, status: PostingStatus): boolean {
  const file = loadPostingsFile();
  const sp = file.postings.find((p) => p.posting.id === id);
  if (!sp) return false;
  sp.status = status;
  savePostingsFile(file);
  return true;
}

export function getStoredPosting(id: string): StoredPosting | null {
  const file = loadPostingsFile();
  return file.postings.find((sp) => sp.posting.id === id) ?? null;
}

/** Attach fit results after a scan batch. */
export function setFits(fits: Map<string, FitResult>): void {
  if (!fits.size) return;
  const file = loadPostingsFile();
  for (const sp of file.postings) {
    const fit = fits.get(sp.posting.id);
    if (fit) {
      sp.fit = { ...fit, brief: normalizeBrief(fit.brief) };
    }
  }
  savePostingsFile(file);
}

export function recordRefresh(stats: RefreshStats): PostingsFile {
  const file = loadPostingsFile();
  file.lastRefreshAt = new Date().toISOString();
  file.lastRefreshStats = stats;
  savePostingsFile(file);
  return file;
}
