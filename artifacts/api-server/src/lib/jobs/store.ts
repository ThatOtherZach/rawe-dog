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
import { fingerprintText, isCrossListing } from "./fingerprint.js";

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

export type CrossListingRef = {
  /** Internal id of the earlier posting this one duplicates. */
  id: string;
  company: string;
  title: string;
};

export type StoredPosting = {
  posting: JobPosting;
  fit: FitResult | null;
  addedAt: string;
  status: PostingStatus;
  /**
   * ISO timestamp of when the posting's status was changed to "applied".
   * Absent on pre-existing records — kept blank in the CSV for backwards
   * compatibility.  Cleared when the status is reverted from "applied".
   */
  appliedAt?: string;
  /**
   * ISO timestamp of when the kit was first generated for this posting
   * (i.e. when the status first transitioned to "kit_generated").
   * Absent on pre-existing records — kept blank in the CSV for backwards
   * compatibility.  Not cleared if the status advances to "applied".
   */
  kitGeneratedAt?: string;
  /**
   * SimHash fingerprint of the normalized description (16 hex chars).
   * Empty string when the body is too short to fingerprint reliably.
   * Absent on pre-existing records — treated as no fingerprint.
   */
  fingerprint?: string;
  /**
   * Set when this posting's content fingerprint matches an earlier stored
   * actionable posting — indicates a likely cross-listing of the same opening
   * under a different URL or employer name.
   */
  crossListingOf?: CrossListingRef;
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

/**
 * Insert new postings, skipping ids we already have.
 *
 * Computes a SimHash content fingerprint for each incoming posting and
 * compares it against existing actionable postings (status "new" or
 * "kit_generated") and against other postings in the same batch. When a
 * near-duplicate is found (similarity ≥ 0.92), the newer posting is
 * annotated with `crossListingOf` pointing at the earlier one.
 *
 * Existing postings that lack a fingerprint get one computed and stored as a
 * cheap side-effect of the comparison scan (no extra reads, no LLM calls).
 *
 * Returns the added StoredPosting records (with fingerprint/crossListingOf set).
 */
export function upsertPostings(incoming: JobPosting[]): {
  added: StoredPosting[];
  total: number;
} {
  const file = loadPostingsFile();
  const known = new Set(file.postings.map((sp) => sp.posting.id));
  const now = new Date().toISOString();

  // Build a fingerprint index from existing actionable postings.
  // Also backfill fingerprints that are missing (cheap compute-on-next-scan).
  const existingIndex: { fp: string; id: string; company: string; title: string }[] = [];
  let backfilled = false;

  // Fast id → StoredPosting map for root resolution (see below).
  const byId = new Map<string, StoredPosting>(
    file.postings.map((sp) => [sp.posting.id, sp])
  );

  for (const sp of file.postings) {
    if (sp.status === "dismissed" || sp.status === "applied") continue;
    if (!sp.fingerprint) {
      const fp = fingerprintText(sp.posting.description ?? "");
      if (fp) {
        sp.fingerprint = fp;
        backfilled = true;
      }
    }
    if (sp.fingerprint) {
      // Resolve to the canonical root posting so that a new duplicate always
      // points at the original, not at an intermediate cross-listing.
      // Without this, a chain A → B → C would form: C points to B instead of
      // A, so pickTopFour cannot suppress C when only A is picked.
      let root: StoredPosting = sp;
      const visited = new Set<string>([sp.posting.id]);
      while (root.crossListingOf) {
        const parent = byId.get(root.crossListingOf.id);
        if (!parent || visited.has(parent.posting.id)) break; // guard against cycles
        visited.add(parent.posting.id);
        root = parent;
      }
      existingIndex.push({
        fp: sp.fingerprint,
        id: root.posting.id,
        company: root.posting.company,
        title: root.posting.title,
      });
    }
  }

  // Fingerprint index for postings added within this batch (to catch same-batch duplicates).
  const batchIndex: { fp: string; id: string; company: string; title: string }[] = [];

  const added: StoredPosting[] = [];
  for (const posting of incoming) {
    if (known.has(posting.id)) continue;
    known.add(posting.id);

    const fp = fingerprintText(posting.description ?? "");
    let crossListingOf: CrossListingRef | undefined;

    if (fp) {
      // Check existing actionable postings first, then within the batch.
      const match =
        existingIndex.find((e) => isCrossListing(fp, e.fp)) ??
        batchIndex.find((e) => isCrossListing(fp, e.fp));
      if (match) {
        crossListingOf = { id: match.id, company: match.company, title: match.title };
      }
    }

    const sp: StoredPosting = {
      posting,
      fit: null,
      addedAt: now,
      status: "new",
      ...(fp ? { fingerprint: fp } : {}),
      ...(crossListingOf ? { crossListingOf } : {}),
    };
    added.push(sp);

    // Only add to the batch index if this isn't itself a cross-listing,
    // to avoid chaining where C→B and then D→C (D should point to B).
    if (fp && !crossListingOf) {
      batchIndex.push({ fp, id: posting.id, company: posting.company, title: posting.title });
    }
  }

  // Prepend newest first; backfilled fingerprints already mutated in place.
  file.postings = [...added, ...file.postings];
  if (file.postings.length > MAX_STORED) {
    file.postings = [...file.postings]
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
      .slice(0, MAX_STORED);
  }
  if (added.length || backfilled) savePostingsFile(file);
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
  if (status === "applied") {
    // Only stamp the time on the first transition into "applied".
    // If the status is already "applied" and a timestamp exists, preserve it
    // so that repeated or duplicate PATCH calls don't overwrite the original.
    if (!sp.appliedAt) {
      sp.appliedAt = new Date().toISOString();
    }
  } else {
    delete sp.appliedAt;
  }
  if (status === "kit_generated") {
    // Only stamp the time on the first kit generation.
    // The timestamp persists even when the status later advances to "applied".
    if (!sp.kitGeneratedAt) {
      sp.kitGeneratedAt = new Date().toISOString();
    }
  }
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
