/**
 * TheirStack job-search adapter (https://theirstack.com).
 *
 * Notes:
 * - Every job RETURNED costs 1 API credit (free tier ≈ 200/month), so the
 *   `limit` filter directly controls spend per refresh.
 * - THEIRSTACK_BASE_URL is a dev/test hook (points e2e runs at a local mock).
 */

import {
  JobProviderError,
  type JobPosting,
  type JobProvider,
  type SearchFilters,
} from "./provider.js";

const DEFAULT_BASE_URL = "https://api.theirstack.com";

function baseUrl(): string {
  return process.env["THEIRSTACK_BASE_URL"]?.trim() || DEFAULT_BASE_URL;
}

function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build the TheirStack search body from normalized filters. */
export function buildSearchBody(f: SearchFilters): Record<string, unknown> {
  const body: Record<string, unknown> = {
    posted_at_max_age_days: f.maxAgeDays,
    limit: f.limit,
    page: 0,
    blur_company_data: false,
    include_total_results: false,
    order_by: [{ desc: true, field: "date_posted" }],
  };
  if (f.titleQueries.length) body["job_title_or"] = f.titleQueries;
  if (f.countryCodes.length) body["job_country_code_or"] = f.countryCodes;
  if (f.remoteOnly) body["remote"] = true;
  if (f.seniority.length) body["job_seniority_or"] = f.seniority;
  if (f.minSalaryUsd) body["min_salary_usd"] = f.minSalaryUsd;
  if (f.descriptionKeywords.length) {
    body["job_description_pattern_or"] = f.descriptionKeywords.map(escapeRegex);
  }
  return body;
}

type TsJob = {
  id?: number | string;
  job_title?: string | null;
  company?: unknown;
  company_object?: { name?: string | null; domain?: string | null } | null;
  company_domain?: string | null;
  description?: string | null;
  location?: string | null;
  short_location?: string | null;
  long_location?: string | null;
  country_code?: string | null;
  remote?: boolean | null;
  hybrid?: boolean | null;
  seniority?: string | null;
  employment_statuses?: unknown;
  salary_string?: string | null;
  min_annual_salary_usd?: number | null;
  max_annual_salary_usd?: number | null;
  url?: string | null;
  final_url?: string | null;
  source_url?: string | null;
  date_posted?: string | null;
  discovered_at?: string | null;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function mapJob(j: TsJob): JobPosting | null {
  const providerId = j.id === undefined || j.id === null ? "" : String(j.id);
  if (!providerId) return null;
  const company =
    str(j.company) || str(j.company_object?.name) || "";
  return {
    id: `ts-${providerId}`,
    provider: "theirstack",
    providerId,
    title: str(j.job_title) || "(untitled role)",
    company,
    companyDomain: str(j.company_domain) || str(j.company_object?.domain),
    location: str(j.short_location) || str(j.location) || str(j.long_location),
    countryCode: str(j.country_code).toUpperCase(),
    remote: typeof j.remote === "boolean" ? j.remote : null,
    hybrid: typeof j.hybrid === "boolean" ? j.hybrid : null,
    seniority: str(j.seniority),
    employmentStatuses: Array.isArray(j.employment_statuses)
      ? j.employment_statuses.map(String).filter(Boolean)
      : [],
    salary: str(j.salary_string),
    minSalaryUsd: typeof j.min_annual_salary_usd === "number" ? j.min_annual_salary_usd : null,
    maxSalaryUsd: typeof j.max_annual_salary_usd === "number" ? j.max_annual_salary_usd : null,
    url: str(j.final_url) || str(j.url) || str(j.source_url),
    sourceUrl: str(j.source_url) || str(j.url),
    datePosted: str(j.date_posted),
    discoveredAt: str(j.discovered_at),
    description: typeof j.description === "string" ? j.description : "",
  };
}

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      const detail =
        (data["error"] as Record<string, unknown> | undefined)?.["message"] ??
        data["detail"] ??
        data["message"];
      if (typeof detail === "string") return detail.slice(0, 300);
      if (detail !== undefined) return JSON.stringify(detail).slice(0, 300);
    } catch {
      /* not JSON */
    }
    return text.slice(0, 300);
  } catch {
    return "";
  }
}

export class TheirStackProvider implements JobProvider {
  readonly name = "theirstack";
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(filters: SearchFilters): Promise<{ postings: JobPosting[] }> {
    if (!this.apiKey) {
      throw new JobProviderError(
        "auth",
        "No TheirStack API key configured. Add one on the Settings page."
      );
    }

    let res: Response;
    try {
      res = await fetch(`${baseUrl()}/v1/jobs/search`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildSearchBody(filters)),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new JobProviderError("network", `Could not reach TheirStack: ${msg}`);
    }

    if (!res.ok) {
      const detail = await readErrorDetail(res);
      const suffix = detail ? ` (${detail})` : "";
      if (res.status === 401 || res.status === 403) {
        throw new JobProviderError(
          "auth",
          "TheirStack rejected the API key. Check it on the Settings page."
        );
      }
      if (res.status === 402) {
        throw new JobProviderError(
          "quota",
          "TheirStack reports you are out of API credits (free tier: 200/month, 1 credit per job returned). Lower the result limit or wait for the monthly reset."
        );
      }
      if (res.status === 400 || res.status === 422) {
        throw new JobProviderError(
          "bad_request",
          `TheirStack rejected the search filters${suffix}. Adjust them and retry.`
        );
      }
      throw new JobProviderError(
        "network",
        `TheirStack error (HTTP ${res.status})${suffix}.`
      );
    }

    let payload: { data?: unknown };
    try {
      payload = (await res.json()) as { data?: unknown };
    } catch {
      throw new JobProviderError("network", "TheirStack returned an unreadable response.");
    }

    const rows = Array.isArray(payload.data) ? (payload.data as TsJob[]) : [];
    const postings: JobPosting[] = [];
    for (const row of rows) {
      const mapped = mapJob(row);
      if (mapped) postings.push(mapped);
    }
    return { postings };
  }
}
