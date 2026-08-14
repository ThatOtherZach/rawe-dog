/**
 * Normalized job-posting shape + provider interface.
 *
 * Everything downstream (store, fit scan, UI, kit handoff) consumes THIS
 * shape; provider-specific quirks stay inside adapters like theirstack.ts.
 */

export type JobPosting = {
  /** Internal stable id, e.g. "ts-12345" (provider prefix + provider id). */
  id: string;
  provider: string;
  providerId: string;
  title: string;
  company: string;
  companyDomain: string;
  location: string;
  countryCode: string;
  remote: boolean | null;
  hybrid: boolean | null;
  seniority: string;
  employmentStatuses: string[];
  /** Human-readable salary string as published ("" if none). */
  salary: string;
  minSalaryUsd: number | null;
  maxSalaryUsd: number | null;
  /** Best application link. */
  url: string;
  /** Where the job was discovered (ATS/board page). */
  sourceUrl: string;
  /** yyyy-mm-dd */
  datePosted: string;
  discoveredAt: string;
  /** Raw description text from the provider (kept for display/fallback). */
  description: string;
};

export const SENIORITY_VALUES = [
  "junior",
  "mid_level",
  "senior",
  "staff",
  "c_level",
] as const;

export type SearchFilters = {
  /** Keyword title queries; all words of one query must appear in the title. */
  titleQueries: string[];
  /** ISO-2 country codes; empty = worldwide. */
  countryCodes: string[];
  /** City names for post-fetch filtering (case-insensitive substring match on location). */
  cities?: string[];
  /** true = remote jobs only; false = no remote filter. */
  remoteOnly: boolean;
  /** Subset of SENIORITY_VALUES; empty = no filter. */
  seniority: string[];
  /** Only postings younger than this many days. */
  maxAgeDays: number;
  /** Minimum annual USD salary; null = no minimum. */
  minSalaryUsd: number | null;
  /** Literal keywords the description must contain (ORed); keep rare/niche. */
  descriptionKeywords: string[];
  /** Max results per refresh (each returned job costs 1 provider credit). */
  limit: number;
};

export function defaultFilters(): SearchFilters {
  return {
    titleQueries: [],
    countryCodes: [],
    cities: [],
    remoteOnly: false,
    seniority: [],
    maxAgeDays: 14,
    minSalaryUsd: null,
    descriptionKeywords: [],
    limit: 25,
  };
}

function strArray(v: unknown, max: number): string[] {
  return Array.isArray(v)
    ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, max)
    : [];
}

/** Clamp + sanitize possibly-untrusted filter input (UI or LLM derived). */
export function normalizeFilters(
  raw: Partial<SearchFilters> | null | undefined
): SearchFilters {
  const d = defaultFilters();
  if (!raw || typeof raw !== "object") return d;

  const maxAge = Number(raw.maxAgeDays);
  const limit = Number(raw.limit);
  const minSalary = Number(raw.minSalaryUsd);
  const seniorityAllowed = new Set<string>(SENIORITY_VALUES);

  return {
    titleQueries: strArray(raw.titleQueries, 6).map((s) => s.slice(0, 80)),
    countryCodes: strArray(raw.countryCodes, 8)
      .map((c) => c.toUpperCase())
      .filter((c) => /^[A-Z]{2}$/.test(c)),
    cities: strArray(raw.cities, 8).map((c) => c.trim().toLowerCase().slice(0, 60)).filter(Boolean),
    remoteOnly: Boolean(raw.remoteOnly),
    seniority: strArray(raw.seniority, 5).filter((s) => seniorityAllowed.has(s)),
    maxAgeDays:
      Number.isFinite(maxAge) && maxAge >= 1 ? Math.min(Math.round(maxAge), 90) : d.maxAgeDays,
    minSalaryUsd:
      Number.isFinite(minSalary) && minSalary > 0 ? Math.round(minSalary) : null,
    descriptionKeywords: strArray(raw.descriptionKeywords, 5).map((s) => s.slice(0, 60)),
    limit: Number.isFinite(limit) && limit >= 1 ? Math.min(Math.round(limit), 50) : d.limit,
  };
}

export type JobProviderErrorKind = "auth" | "quota" | "bad_request" | "network";

/** Typed provider failure so routes can map to precise HTTP responses. */
export class JobProviderError extends Error {
  readonly kind: JobProviderErrorKind;
  constructor(kind: JobProviderErrorKind, message: string) {
    super(message);
    this.name = "JobProviderError";
    this.kind = kind;
  }
}

export interface JobProvider {
  readonly name: string;
  search(filters: SearchFilters): Promise<{ postings: JobPosting[] }>;
}
