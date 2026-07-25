import { Router, type Request, type Response } from "express";
import { loadSettings } from "../lib/settings.js";
import {
  loadPostingsFile,
  saveFilters,
  upsertPostings,
  getStoredPosting,
  setPostingStatus,
  recordRefresh,
  type PostingsFile,
  type StoredPosting,
  type PostingStatus,
  type CrossListingRef,
} from "../lib/jobs/store.js";
import {
  JobProviderError,
  normalizeFilters,
  type SearchFilters,
} from "../lib/jobs/provider.js";
import { briefIsUsable } from "../lib/jobs/brief.js";
import { TheirStackProvider } from "../lib/jobs/theirstack.js";
import { deriveFiltersFromProfile, scorePostings } from "../lib/jobs/match.js";
import { loadMasterProfile, loadAllExperiences } from "../lib/context-pack.js";

const router = Router();

function summarize(sp: StoredPosting) {
  const { posting, fit, addedAt, status } = sp;
  return {
    id: posting.id,
    title: posting.title,
    company: posting.company,
    location: posting.location,
    remote: posting.remote,
    hybrid: posting.hybrid,
    seniority: posting.seniority,
    salary: posting.salary,
    url: posting.url,
    datePosted: posting.datePosted,
    addedAt,
    status: status ?? "new",
    score: fit ? fit.score : null,
    rationale: fit?.rationale ?? "",
    matchedExperienceIds: fit?.matchedExperienceIds ?? [],
    hasBrief: briefIsUsable(fit?.brief),
    scoredAt: fit?.scoredAt ?? null,
    // Legitimacy fields — absent on pre-existing records (no badge rendered)
    legitimacy: fit?.legitimacy ?? null,
    legitimacySignals: fit?.legitimacySignals ?? [],
    // Cross-listing detection — null when not a duplicate
    crossListingOf: (sp.crossListingOf ?? null) as CrossListingRef | null,
  };
}

/** Ranked: scored postings by score desc, then unscored, newest first. */
function rankPostings(a: StoredPosting, b: StoredPosting): number {
  const as = a.fit?.score ?? -1;
  const bs = b.fit?.score ?? -1;
  if (bs !== as) return bs - as;
  return (b.posting.datePosted || b.addedAt).localeCompare(
    a.posting.datePosted || a.addedAt
  );
}

function statusCounts(postings: StoredPosting[]) {
  let newCount = 0;
  let kitGeneratedCount = 0;
  let appliedCount = 0;
  let dismissedCount = 0;
  for (const sp of postings) {
    const s = sp.status ?? "new";
    if (s === "new") newCount++;
    else if (s === "kit_generated") kitGeneratedCount++;
    else if (s === "applied") appliedCount++;
    else if (s === "dismissed") dismissedCount++;
  }
  return { newCount, kitGeneratedCount, appliedCount, dismissedCount };
}

function statePayload(file: PostingsFile) {
  const s = loadSettings();
  return {
    providerConfigured: Boolean(s.theirstackApiKey),
    xaiConfigured: Boolean(s.apiKey),
    filters: file.filters,
    filtersSource: file.filtersSource,
    lastRefreshAt: file.lastRefreshAt,
    lastRefreshStats: file.lastRefreshStats,
    statusCounts: statusCounts(file.postings),
    postings: [...file.postings].sort(rankPostings).map(summarize),
  };
}

router.get("/postings", async (_req: Request, res: Response) => {
  const [master, experiences] = await Promise.all([
    loadMasterProfile(),
    loadAllExperiences(),
  ]);
  res.json({
    ...statePayload(loadPostingsFile()),
    hasMasterProfile: Boolean(master),
    hasExperienceCatalog: experiences.length > 0,
  });
});

router.post("/postings/derive-filters", async (_req: Request, res: Response) => {
  try {
    const derived = await deriveFiltersFromProfile();
    const file = saveFilters(derived.filters, "derived");
    res.json({ ok: true, ...statePayload(file), rationale: derived.rationale });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message.includes("API key") || message.includes("Master Profile") ? 400 : 500;
    res.status(status).json({ ok: false, error: message });
  }
});

router.put("/postings/filters", (req: Request, res: Response) => {
  const body = (req.body || {}) as { filters?: Partial<SearchFilters> };
  if (!body.filters || typeof body.filters !== "object") {
    res.status(400).json({ ok: false, error: "filters object is required" });
    return;
  }
  const file = saveFilters(normalizeFilters(body.filters), "manual");
  res.json({ ok: true, ...statePayload(file) });
});

/**
 * In-process guard: postings.json updates are read-modify-write, so two
 * overlapping refreshes could silently drop each other's fits/stats.
 * Concurrent refreshes are rejected instead of queued — the second caller
 * would only re-fetch the same results and burn provider credits.
 */
let refreshInFlight = false;

router.post("/postings/refresh", async (_req: Request, res: Response) => {
  if (refreshInFlight) {
    res.status(409).json({
      ok: false,
      error: "A refresh is already running — wait for it to finish.",
    });
    return;
  }
  refreshInFlight = true;
  try {
    const settings = loadSettings();
    if (!settings.theirstackApiKey) {
      res.status(400).json({
        ok: false,
        error: "Add a TheirStack API key on the Settings page first.",
      });
      return;
    }
    const file = loadPostingsFile();
    if (!file.filters) {
      res.status(400).json({
        ok: false,
        error:
          "Set search filters first — derive them from your Master Profile or edit them manually.",
      });
      return;
    }

    const provider = new TheirStackProvider(settings.theirstackApiKey);
    const { postings } = await provider.search(file.filters);
    const { added } = upsertPostings(postings);

    // Score anything without a fit yet (new + previously failed) so the
    // cache self-heals; provider credits are NOT spent on re-scoring.
    let scored = 0;
    const scoreFailures: string[] = [];
    let warning: string | undefined;
    const unscored = loadPostingsFile()
      .postings.filter((sp) => !sp.fit)
      .map((sp) => sp.posting);
    if (unscored.length) {
      try {
        const r = await scorePostings(unscored);
        scored = r.scored;
        scoreFailures.push(...r.failures);
      } catch (err) {
        warning = `Fetched postings, but fit scoring failed: ${
          err instanceof Error ? err.message : String(err)
        }`;
      }
    }

    const updated = recordRefresh({
      fetched: postings.length,
      added: added.length,
      scored,
      scoreFailures: scoreFailures.length,
    });
    res.json({
      ok: true,
      ...statePayload(updated),
      warning,
      scoreFailures,
    });
  } catch (err) {
    if (err instanceof JobProviderError) {
      const status =
        err.kind === "quota" ? 402 : err.kind === "network" ? 502 : 400;
      res.status(status).json({ ok: false, error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message });
  } finally {
    refreshInFlight = false;
  }
});

const VALID_STATUS_VALUES: PostingStatus[] = ["new", "kit_generated", "applied", "dismissed"];

router.patch("/postings/:id/status", (req: Request, res: Response) => {
  const id = String(req.params["id"] || "");
  const body = (req.body || {}) as { status?: string };
  const status = body.status as PostingStatus | undefined;
  if (!status || !VALID_STATUS_VALUES.includes(status)) {
    res.status(400).json({
      ok: false,
      error: `status must be one of: ${VALID_STATUS_VALUES.join(", ")}`,
    });
    return;
  }
  const found = setPostingStatus(id, status);
  if (!found) {
    res.status(404).json({ ok: false, error: "Posting not found." });
    return;
  }
  res.json({ ok: true, ...statePayload(loadPostingsFile()) });
});

router.get("/postings/:id", (req: Request, res: Response) => {
  const sp = getStoredPosting(String(req.params["id"] || ""));
  if (!sp) {
    res.status(404).json({
      error: "Posting not found — it may have been pruned. Refresh the Postings page.",
    });
    return;
  }
  res.json({
    ...summarize(sp),
    provider: sp.posting.provider,
    sourceUrl: sp.posting.sourceUrl,
    countryCode: sp.posting.countryCode,
    employmentStatuses: sp.posting.employmentStatuses,
    minSalaryUsd: sp.posting.minSalaryUsd,
    maxSalaryUsd: sp.posting.maxSalaryUsd,
    discoveredAt: sp.posting.discoveredAt,
    description: sp.posting.description,
    fit: sp.fit,
  });
});

export default router;
