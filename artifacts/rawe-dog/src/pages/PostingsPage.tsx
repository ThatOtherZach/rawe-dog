import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { SearchCreditsPanel } from "../components/SearchCreditsPanel";
import { searchCreditHeader } from "../lib/credits";
import { awardXp } from "../lib/xpStore";

const SENIORITY_OPTIONS = [
  { value: "junior", label: "Junior" },
  { value: "mid_level", label: "Mid-level" },
  { value: "senior", label: "Senior" },
  { value: "staff", label: "Staff" },
  { value: "c_level", label: "C-level" },
];

type Filters = {
  titleQueries: string[];
  countryCodes: string[];
  remoteOnly: boolean;
  seniority: string[];
  maxAgeDays: number;
  minSalaryUsd: number | null;
  descriptionKeywords: string[];
  limit: number;
};

type RefreshStats = {
  fetched: number;
  added: number;
  scored: number;
  scoreFailures: number;
};

type PostingStatus = "new" | "kit_generated" | "applied" | "dismissed";

type LegitimacyTier = "high_confidence" | "caution" | "suspicious";

type CrossListingRef = {
  id: string;
  company: string;
  title: string;
};

type PostingSummary = {
  id: string;
  title: string;
  company: string;
  location: string;
  remote: boolean | null;
  hybrid: boolean | null;
  seniority: string;
  salary: string;
  url: string;
  datePosted: string;
  addedAt: string;
  status: PostingStatus;
  score: number | null;
  rationale: string;
  matchedExperienceIds: string[];
  hasBrief: boolean;
  scoredAt: string | null;
  /** Absent on pre-existing records — no badge rendered when null. */
  legitimacy: LegitimacyTier | null;
  legitimacySignals: string[];
  /** Set when this posting's content fingerprint matches an earlier stored actionable one. */
  crossListingOf: CrossListingRef | null;
};

type StatusCounts = {
  newCount: number;
  kitGeneratedCount: number;
  appliedCount: number;
  dismissedCount: number;
};

type PostingsState = {
  providerConfigured: boolean;
  xaiConfigured: boolean;
  hasMasterProfile?: boolean;
  hasExperienceCatalog?: boolean;
  filters: Filters | null;
  filtersSource: "derived" | "manual" | null;
  lastRefreshAt: string | null;
  lastRefreshStats: RefreshStats | null;
  statusCounts: StatusCounts;
  postings: PostingSummary[];
};

type Brief = {
  targetTitle: string;
  company: string;
  seniority: string;
  mustHaves: string[];
  niceToHaves: string[];
  responsibilities: string[];
  atsKeywords: string[];
  compensation: string;
};

type PostingDetail = PostingSummary & {
  provider: string;
  sourceUrl: string;
  countryCode: string;
  employmentStatuses: string[];
  minSalaryUsd: number | null;
  maxSalaryUsd: number | null;
  discoveredAt: string;
  description: string;
  fit: {
    score: number;
    rationale: string;
    matchedExperienceIds: string[];
    brief: Brief;
    legitimacy?: LegitimacyTier;
    legitimacySignals?: string[];
    scoredAt: string;
    model: string;
  } | null;
};

function parseList(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

function scoreChipClass(score: number): string {
  if (score >= 70)
    return "border-[color-mix(in_srgb,var(--accent)_55%,var(--border))] text-[var(--accent)]";
  if (score >= 55) return "border-[#7a5c2e] text-[#ffd28f]";
  return "border-[#7a2e2e] text-[#ff8f8f]";
}

/**
 * Legitimacy badge — shown only when tier ≠ high_confidence.
 * Signals inform, never block. Copy tone is observational ("worth a look"),
 * never accusatory. Absent on pre-existing records (null tier).
 */
function LegitimacyBadge({
  tier,
}: {
  tier: LegitimacyTier | null;
}) {
  if (!tier || tier === "high_confidence") return null;

  const isSuspicious = tier === "suspicious";
  const label = isSuspicious ? "Review carefully" : "Worth a look";
  const title = isSuspicious
    ? "Review carefully — multiple signals worth checking before applying"
    : "Worth a look — one or more signals worth verifying before applying";
  const classes = isSuspicious
    ? "border-[#7a2e2e] bg-[#2a1414] text-[#ff8f8f]"
    : "border-[#7a5c2e] bg-[#2a2214] text-[#ffd28f]";

  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${classes}`}
      title={title}
    >
      {isSuspicious ? "⚠ " : "○ "}
      {label}
    </span>
  );
}

function ScoreChip({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <span
        className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs text-[var(--muted)]"
        title="Fit score not yet available — will be calculated on next refresh"
      >
        unscored
      </span>
    );
  }
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold tabular-nums ${scoreChipClass(score)}`}
      title="Fit score vs your Master Profile (0-100)"
    >
      {score}
    </span>
  );
}

function ListBlock({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="label mb-1">{label}</p>
      <ul className="list-disc space-y-0.5 pl-4 text-sm text-[var(--text)]">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function workModeLabel(p: PostingSummary): string {
  if (p.remote === true) return "Remote";
  if (p.hybrid === true) return "Hybrid";
  if (p.remote === false) return "On-site";
  return "";
}

const RANK_LABELS = [
  "Best match",
  "Second best",
  "You could do this",
  "Eh, maybe?",
] as const;

/**
 * Derive the top-four picks: scored, actionable (not applied/dismissed), in
 * existing rank order.
 *
 * Cross-listing dedup — three cases all handled:
 * 1. Normal: original A is picked, cross-listing B (→A) is skipped because
 *    A is in pickedIds.
 * 2. Inverted score: cross-listing B (→A) scores higher and is picked first;
 *    A is then skipped because A's id is in crossListingTargets.
 * 3. Sibling: A is picked, then both B (→A) and C (→A) are skipped because
 *    A is in pickedIds AND in crossListingTargets — either check catches them.
 *    Even if B was picked before A (inverted), C is caught because A ends up
 *    in crossListingTargets and C.crossListingOf.id === A.
 */
export function pickTopFour(postings: PostingSummary[]): PostingSummary[] {
  const picks: PostingSummary[] = [];
  /** IDs of postings already added to the digest. */
  const pickedIds = new Set<string>();
  /**
   * IDs that are the crossListingOf target of any already-picked posting.
   * Serves double duty:
   * - Excludes the original when a higher-scored cross-listing is picked first.
   * - Excludes sibling cross-listings (both B→A and C→A) once any of them or
   *   A itself has been picked: all share the same target A, so once A lands in
   *   this set every sibling is caught by the second guard below.
   */
  const crossListingTargets = new Set<string>();

  for (const p of postings) {
    if (picks.length >= 4) break;
    if (p.score === null) continue;
    if (p.status === "applied" || p.status === "dismissed") continue;
    // Guard 1: this posting is the root target of a cross-listing already picked
    if (crossListingTargets.has(p.id)) continue;
    // Guard 2: this posting's cross-listing target is already picked, OR is
    // itself a sibling target (another picked posting also points to the same root)
    if (
      p.crossListingOf &&
      (pickedIds.has(p.crossListingOf.id) || crossListingTargets.has(p.crossListingOf.id))
    )
      continue;
    picks.push(p);
    pickedIds.add(p.id);
    if (p.crossListingOf) crossListingTargets.add(p.crossListingOf.id);
  }
  return picks;
}

function DigestStrip({
  picks,
  patchingId,
  onCardClick,
  onPatch,
}: {
  picks: PostingSummary[];
  patchingId: string | null;
  onCardClick: (id: string) => void;
  onPatch: (id: string, status: PostingStatus) => void;
}) {
  if (picks.length === 0) return null;
  return (
    <section className="panel p-5">
      <h2 className="mb-3 text-base font-semibold">Today's picks</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {picks.map((p, i) => {
          const label = RANK_LABELS[i];
          const isPatching = patchingId === p.id;
          // Truncate rationale to one line (~120 chars)
          const hook =
            p.rationale && p.rationale.length > 120
              ? p.rationale.slice(0, 117).trimEnd() + "…"
              : p.rationale;
          return (
            <div
              key={p.id}
              className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[#0c0e13] p-4"
            >
              {/* Rank label */}
              <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">
                {label}
              </span>
              {/* Score + legitimacy */}
              <div className="flex flex-wrap items-start gap-2">
                <ScoreChip score={p.score} />
                <LegitimacyBadge tier={p.legitimacy} />
              </div>
              <button
                className="text-left text-sm font-semibold text-[var(--text)] hover:underline"
                onClick={() => onCardClick(p.id)}
                title="Expand in list below"
              >
                {p.title}
              </button>
              <p className="text-xs text-[var(--muted)]">{p.company}</p>
              {/* Rationale hook */}
              {hook && (
                <p className="flex-1 text-xs leading-relaxed text-[var(--muted)]">
                  {hook}
                </p>
              )}
              {/* Actions */}
              <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                <button
                  className="btn !px-2 !py-1 text-xs text-[var(--muted)]"
                  disabled={isPatching}
                  onClick={() => onPatch(p.id, "dismissed")}
                  title="Dismiss"
                >
                  {isPatching ? "…" : "Dismiss"}
                </button>
                <Link
                  href={`/?posting=${encodeURIComponent(p.id)}`}
                  className="btn btn-primary !px-2.5 !py-1 text-xs"
                >
                  Generate kit
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function PostingsPage() {
  const [state, setState] = useState<PostingsState | null>(null);
  const [editing, setEditing] = useState(false);

  const [titlesText, setTitlesText] = useState("");
  const [countriesText, setCountriesText] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [seniority, setSeniority] = useState<string[]>([]);
  const [maxAgeDays, setMaxAgeDays] = useState("14");
  const [minSalary, setMinSalary] = useState("");
  const [keywordsText, setKeywordsText] = useState("");
  const [limit, setLimit] = useState("25");

  const [deriving, setDeriving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshPct, setRefreshPct] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scoreFailures, setScoreFailures] = useState<string[]>([]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, PostingDetail>>({});
  const [detailLoading, setDetailLoading] = useState(false);

  /**
   * Speculative Pass 1 prefetch (Instagram image pre-load pattern).
   * When a posting row is expanded we immediately fire a background
   * mode:"pass1" call.  If it resolves before the user clicks
   * "Generate kit", GeneratePage reads the result from sessionStorage
   * and skips its own Pass 1 call — jumping straight to drafting.
   * One slot only: expanding a different row aborts the previous fetch
   * and overwrites the cache entry.
   */
  const prefetchAbortRef = useRef<AbortController | null>(null);

  const [showDismissed, setShowDismissed] = useState(false);
  const [patchingId, setPatchingId] = useState<string | null>(null);
  const [libraryBannerDismissed, setLibraryBannerDismissed] = useState(false);

  // Search credits panel — bump to force a status re-fetch (e.g. after buying)
  const [creditsBump, setCreditsBump] = useState(0);

  useEffect(() => {
    if (!refreshing) {
      setRefreshPct(0);
      return;
    }
    setRefreshPct(0);
    const id = setInterval(() => {
      setRefreshPct((prev) => {
        if (prev >= 95) return prev;
        const step = Math.max(0.25, (95 - prev) * 0.035);
        return Math.min(95, prev + step);
      });
    }, 350);
    return () => clearInterval(id);
  }, [refreshing]);

  const fillForm = useCallback((f: Filters) => {
    setTitlesText(f.titleQueries.join(", "));
    setCountriesText(f.countryCodes.join(", "));
    setRemoteOnly(f.remoteOnly);
    setSeniority(f.seniority);
    setMaxAgeDays(String(f.maxAgeDays));
    setMinSalary(f.minSalaryUsd ? String(f.minSalaryUsd) : "");
    setKeywordsText(f.descriptionKeywords.join(", "));
    setLimit(String(f.limit));
  }, []);

  const applyState = useCallback(
    (s: PostingsState) => {
      setState(s);
      if (s.filters) fillForm(s.filters);
    },
    [fillForm]
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/postings");
      if (!res.ok) throw new Error(`Failed to load postings (${res.status})`);
      applyState((await res.json()) as PostingsState);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [applyState]);

  useEffect(() => {
    void load();
  }, [load]);

  function formFilters(): Filters {
    return {
      titleQueries: parseList(titlesText),
      countryCodes: parseList(countriesText).map((c) => c.toUpperCase()),
      remoteOnly,
      seniority,
      maxAgeDays: Number(maxAgeDays) || 14,
      minSalaryUsd: minSalary.trim() ? Number(minSalary) || null : null,
      descriptionKeywords: parseList(keywordsText),
      limit: Number(limit) || 25,
    };
  }

  function toggleSeniority(value: string) {
    setSeniority((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  function clearNotices() {
    setError(null);
    setMessage(null);
    setWarning(null);
    setScoreFailures([]);
  }

  async function deriveFilters() {
    setDeriving(true);
    clearNotices();
    try {
      const res = await fetch("/api/postings/derive-filters", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(
          (data as { error?: string }).error || "Filter derivation failed"
        );
      }
      applyState(data as PostingsState);
      setEditing(true);
      const rationale = (data as { rationale?: string }).rationale;
      setMessage(
        rationale
          ? `Filters derived — ${rationale} Review below, then save.`
          : "Filters derived from your Master Profile. Review below, then save."
      );
      // XP: derive filters (first time) + filter change
      awardXp("derive_filters");
      awardXp("filter_change");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeriving(false);
    }
  }

  async function saveFilters() {
    const f = formFilters();
    if (!f.titleQueries.length) {
      setError("Add at least one job-title query before saving.");
      return;
    }
    setSaving(true);
    clearNotices();
    try {
      const res = await fetch("/api/postings/filters", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: f }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error((data as { error?: string }).error || "Save failed");
      }
      applyState(data as PostingsState);
      setEditing(false);
      setMessage("Filters saved. Refresh to fetch matching postings.");
      // XP: manual filter change
      awardXp("filter_change");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function refreshPostings() {
    setRefreshing(true);
    clearNotices();
    try {
      const res = await fetch("/api/postings/refresh", {
        method: "POST",
        headers: { ...searchCreditHeader() },
      });
      const data = await res.json();
      if (res.status === 402) {
        const code = (data as { code?: string }).code;
        if (code === "credit_required") {
          // Force the search-credits panel to re-fetch status so the balance
          // badge and buy form appear immediately.
          setCreditsBump((n) => n + 1);
          setError((data as { error?: string }).error || "A search credit is required to refresh postings.");
          return;
        }
      }
      if (!res.ok || !data.ok) {
        throw new Error(
          (data as { error?: string }).error || `Refresh failed (${res.status})`
        );
      }
      applyState(data as PostingsState);
      // Fit results may have changed — drop cached detail rows so expanded
      // views refetch fresh data instead of showing stale briefs/scores.
      setDetails({});
      setExpandedId(null);
      const st = (data as { lastRefreshStats?: RefreshStats }).lastRefreshStats;
      setMessage(
        st
          ? `Fetched ${st.fetched} posting${st.fetched === 1 ? "" : "s"} (${st.added} new) · fit-scored ${st.scored}.`
          : "Postings refreshed."
      );
      // XP: paid search run
      awardXp("paid_search");
      const w = (data as { warning?: string }).warning;
      if (w) setWarning(w);
      const sf = (data as { scoreFailures?: string[] }).scoreFailures;
      if (Array.isArray(sf) && sf.length) setScoreFailures(sf);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }

  async function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      // Abort any in-flight prefetch and clear the cache slot when collapsing.
      if (prefetchAbortRef.current) {
        prefetchAbortRef.current.abort();
        prefetchAbortRef.current = null;
      }
      try { sessionStorage.removeItem("rdPrefetchPass1"); } catch { /* ignore */ }
      return;
    }

    // Abort the previous row's in-flight prefetch and clear its cache entry.
    if (prefetchAbortRef.current) {
      prefetchAbortRef.current.abort();
      prefetchAbortRef.current = null;
    }
    try { sessionStorage.removeItem("rdPrefetchPass1"); } catch { /* ignore */ }

    setExpandedId(id);

    // Fire speculative Pass 1 in the background — errors are silent cache misses.
    const ac = new AbortController();
    prefetchAbortRef.current = ac;
    fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "pass1", postingId: id }),
      signal: ac.signal,
    })
      .then((res) => res.json())
      .then((data: { ok?: boolean; selection?: unknown; experienceOptions?: unknown; warning?: string }) => {
        if (!ac.signal.aborted && data.ok && data.selection) {
          try {
            sessionStorage.setItem(
              "rdPrefetchPass1",
              JSON.stringify({
                postingId: id,
                cachedAt: Date.now(),
                selection: data.selection,
                experienceOptions: data.experienceOptions ?? [],
                warning: data.warning,
              })
            );
          } catch { /* storage full or unavailable — treat as miss */ }
        }
      })
      .catch(() => { /* silent miss */ });

    if (!details[id]) {
      setDetailLoading(true);
      try {
        const res = await fetch(`/api/postings/${encodeURIComponent(id)}`);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(
            (data as { error?: string }).error || "Failed to load posting"
          );
        }
        setDetails((d) => ({ ...d, [id]: data as PostingDetail }));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setExpandedId(null);
      } finally {
        setDetailLoading(false);
      }
    }
  }

  async function patchStatus(id: string, status: PostingStatus) {
    setPatchingId(id);
    try {
      const res = await fetch(`/api/postings/${encodeURIComponent(id)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error((data as { error?: string }).error || "Status update failed");
      }
      applyState(data as PostingsState);
      // XP: applied or dismissed
      if (status === "applied") {
        const posting = state?.postings.find((p) => p.id === id);
        awardXp("applied", {
          postingId: id,
          fitScore: posting?.score ?? undefined,
        });
      } else if (status === "dismissed") {
        awardXp("dismiss");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPatchingId(null);
    }
  }

  const busy = deriving || saving || refreshing;
  const filters = state?.filters ?? null;
  const allPostings = state?.postings ?? [];
  const visiblePostings = showDismissed
    ? allPostings
    : allPostings.filter((p) => p.status !== "dismissed");
  const showEditor = editing || (state !== null && !filters);
  const scoredCount = allPostings.filter((p) => p.score !== null).length;
  const counts = state?.statusCounts;
  const picks = pickTopFour(allPostings);

  function handleDigestCardClick(id: string) {
    // Only expand (never collapse) — toggleExpand collapses when already open
    if (expandedId !== id) {
      void toggleExpand(id);
    }
    // Scroll to the row (use setTimeout so the expand render completes first)
    setTimeout(() => {
      const el = document.getElementById(`posting-${id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  return (
    <div className="space-y-6">
      <section className="panel p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-xl font-semibold">Postings</h1>
          <span
            className={`badge ${state?.providerConfigured ? "badge-ok" : "badge-bad"}`}
          >
            TheirStack {state?.providerConfigured ? "ready" : "missing"}
          </span>
          <span className={`badge ${state?.xaiConfigured ? "badge-ok" : "badge-bad"}`}>
            xAI {state?.xaiConfigured ? "ready" : "missing"}
          </span>
          {state?.lastRefreshAt && (
            <span className="badge" title="Last refresh">
              refreshed {fmtDateTime(state.lastRefreshAt)}
            </span>
          )}
        </div>
        <p className="mb-4 max-w-3xl text-sm text-[var(--muted)]">
          Live jobs fetched from TheirStack and fit-scored against your Master
          Profile. Pick a posting and generate a kit without pasting anything —
          the pipeline reuses the scored brief to keep token usage low.
        </p>

        {state && !state.providerConfigured && (
          <div className="mb-4 rounded-lg border border-[#7a5c2e] bg-[#2a2214] px-3 py-3 text-sm text-[#ffd28f]">
            Add a TheirStack API key in{" "}
            <Link href="/settings" className="underline">
              Settings
            </Link>{" "}
            to fetch live postings. The free tier includes 200 job credits per
            month (1 credit per fetched posting).
          </div>
        )}
        {state && !state.xaiConfigured && (
          <div className="mb-4 rounded-lg border border-[#7a5c2e] bg-[#2a2214] px-3 py-3 text-sm text-[#ffd28f]">
            No xAI API key — filter derivation and fit scoring need one. Add it
            in{" "}
            <Link href="/settings" className="underline">
              Settings
            </Link>
            .
          </div>
        )}
        {state &&
          state.xaiConfigured &&
          (!state.hasMasterProfile || !state.hasExperienceCatalog) &&
          !libraryBannerDismissed && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-[#7a5c2e] bg-[#2a2214] px-3 py-3 text-sm text-[#ffd28f]">
              <span className="flex-1">
                Fit scoring is disabled — it requires a{" "}
                {!state.hasMasterProfile && !state.hasExperienceCatalog
                  ? "Master Profile and at least one Experience Catalog entry"
                  : !state.hasMasterProfile
                  ? "Master Profile"
                  : "at least one Experience Catalog entry"}{" "}
                in the{" "}
                <Link href="/library" className="underline">
                  Library
                </Link>
                . Postings will appear unscored until then.
              </span>
              <button
                className="ml-2 shrink-0 text-[#ffd28f] opacity-60 hover:opacity-100"
                onClick={() => setLibraryBannerDismissed(true)}
                title="Dismiss"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          )}

        {filters && !showEditor && (
          <div className="mb-4 rounded-xl border border-[var(--border)] bg-[#0c0e13] p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="label !mb-0">Search filters</span>
              <span className="badge">
                {state?.filtersSource === "derived"
                  ? "Filtered by Master Profile"
                  : "manual"}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {filters.titleQueries.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-[color-mix(in_srgb,var(--accent)_45%,var(--border))] px-2.5 py-0.5 text-[var(--accent)]"
                >
                  {t}
                </span>
              ))}
              {filters.countryCodes.map((c) => (
                <span
                  key={c}
                  className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-[var(--muted)]"
                >
                  {c}
                </span>
              ))}
              {filters.remoteOnly && (
                <span className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-[var(--muted)]">
                  remote only
                </span>
              )}
              {filters.seniority.map((s) => (
                <span
                  key={s}
                  className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-[var(--muted)]"
                >
                  {s}
                </span>
              ))}
              <span className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-[var(--muted)]">
                ≤ {filters.maxAgeDays}d old
              </span>
              {filters.minSalaryUsd ? (
                <span className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-[var(--muted)]">
                  ≥ ${filters.minSalaryUsd.toLocaleString()}
                </span>
              ) : null}
              {filters.descriptionKeywords.map((k) => (
                <span
                  key={k}
                  className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-[var(--muted)]"
                >
                  “{k}”
                </span>
              ))}
              <span className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-[var(--muted)]">
                up to {filters.limit} jobs
              </span>
            </div>
          </div>
        )}

        {showEditor && (
          <div className="mb-4 rounded-xl border border-[var(--border)] bg-[#0c0e13] p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="label !mb-0">Search filters</span>
              {state?.filtersSource && (
                <span className="badge">
                  {state.filtersSource === "derived"
                    ? "Filtered by Master Profile"
                    : "manual"}
                </span>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="label">Title queries (comma-separated)</label>
                <input
                  className="input"
                  value={titlesText}
                  onChange={(e) => setTitlesText(e.target.value)}
                  placeholder="business systems analyst, salesforce administrator"
                  disabled={busy}
                />
                <p className="mt-1 text-xs text-[var(--muted)]">
                  A job matches if its title contains all words of any one query.
                </p>
              </div>
              <div>
                <label className="label">Country codes (comma-separated)</label>
                <input
                  className="input"
                  value={countriesText}
                  onChange={(e) => setCountriesText(e.target.value)}
                  placeholder="US"
                  disabled={busy}
                />
                <p className="mt-1 text-xs text-[var(--muted)]">
                  ISO-2 codes, e.g. US, CA. Empty = anywhere.
                </p>
              </div>
              <div>
                <label className="label">Seniority</label>
                <div className="flex flex-wrap gap-2">
                  {SENIORITY_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={seniority.includes(opt.value)}
                        onChange={() => toggleSeniority(opt.value)}
                        disabled={busy}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
                <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={remoteOnly}
                    onChange={(e) => setRemoteOnly(e.target.checked)}
                    disabled={busy}
                  />
                  Remote jobs only
                </label>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">Max age (days)</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={90}
                    value={maxAgeDays}
                    onChange={(e) => setMaxAgeDays(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div>
                  <label className="label">Min salary $</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step={5000}
                    value={minSalary}
                    onChange={(e) => setMinSalary(e.target.value)}
                    placeholder="none"
                    disabled={busy}
                  />
                </div>
                <div>
                  <label className="label">Jobs per fetch</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={50}
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div className="col-span-3">
                  <label className="label">
                    Description keywords (comma-separated, optional)
                  </label>
                  <input
                    className="input"
                    value={keywordsText}
                    onChange={(e) => setKeywordsText(e.target.value)}
                    placeholder="salesforce, servicenow"
                    disabled={busy}
                  />
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Narrows results to postings whose description mentions any of
                    these. Leave empty unless titles alone are too broad.
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="btn btn-primary"
                onClick={() => void saveFilters()}
                disabled={busy}
              >
                {saving ? "Saving…" : "Save filters"}
              </button>
              {filters && (
                <button
                  className="btn"
                  onClick={() => {
                    fillForm(filters);
                    setEditing(false);
                  }}
                  disabled={busy}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}

        {/* Search credits panel — invisible when enforcement is off; appears automatically when on */}
        <SearchCreditsPanel
          refreshKey={creditsBump}
          onChanged={() => setCreditsBump((n) => n + 1)}
          limit={Number(limit) || 25}
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn"
            onClick={() => void deriveFilters()}
            disabled={busy || !state?.xaiConfigured}
            title="One cheap LLM call reads your Master Profile and proposes filters"
          >
            {deriving ? "Deriving…" : "Filter by Master Profile"}
          </button>
          {filters && !showEditor && (
            <button className="btn" onClick={() => setEditing(true)} disabled={busy}>
              Edit filters
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={() => void refreshPostings()}
            disabled={busy || !filters || !state?.providerConfigured}
          >
            {refreshing ? "Fetching & scoring…" : "Refresh postings"}
          </button>
          <span className="text-xs text-[var(--muted)]">
            Each refresh spends ~1 TheirStack credit per job returned (up to{" "}
            {filters?.limit ?? 25}); new postings are fit-scored with xAI.
          </span>
        </div>

        {refreshing && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-[var(--muted)]">
              <span>
                {refreshPct < 18
                  ? "Contacting TheirStack…"
                  : refreshPct < 50
                  ? "Retrieving job listings…"
                  : refreshPct < 82
                  ? "Scoring fit with xAI…"
                  : refreshPct < 95
                  ? "Ranking results…"
                  : "Almost there…"}
              </span>
              <span>{Math.round(refreshPct)}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all duration-300 ease-out"
                style={{ width: `${refreshPct}%` }}
              />
            </div>
          </div>
        )}

        {message && (
          <div className="mt-4 rounded-lg border border-[color-mix(in_srgb,var(--accent)_40%,var(--border))] bg-[#0d1a14] px-3 py-2 text-sm text-[var(--accent)]">
            {message}
          </div>
        )}
        {warning && (
          <div className="mt-4 rounded-lg border border-[#7a5c2e] bg-[#2a2214] px-3 py-2 text-sm text-[#ffd28f]">
            {warning}
          </div>
        )}
        {scoreFailures.length > 0 && (
          <div className="mt-4 rounded-lg border border-[#7a5c2e] bg-[#2a2214] px-3 py-2 text-xs text-[#ffd28f]">
            <p className="mb-1 font-medium">
              Some postings could not be scored and stay listed as "unscored":
            </p>
            <ul className="list-disc pl-4">
              {scoreFailures.slice(0, 5).map((f, i) => (
                <li key={i}>{f}</li>
              ))}
              {scoreFailures.length > 5 && (
                <li>…and {scoreFailures.length - 5} more</li>
              )}
            </ul>
            <p className="mt-1.5">
              These postings will be retried automatically on the next refresh.
            </p>
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-lg border border-[color-mix(in_srgb,var(--danger)_45%,var(--border))] bg-[#2a1414] px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </div>
        )}
      </section>

      {state && picks.length > 0 && (
        <DigestStrip
          picks={picks}
          patchingId={patchingId}
          onCardClick={handleDigestCardClick}
          onPatch={(id, status) => void patchStatus(id, status)}
        />
      )}

      <section className="panel p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-lg font-semibold">
            Ranked postings{allPostings.length ? ` (${allPostings.length})` : ""}
          </h2>
          {counts && (counts.appliedCount > 0 || counts.kitGeneratedCount > 0 || counts.dismissedCount > 0) && (
            <span className="text-xs text-[var(--muted)]">
              {[
                counts.appliedCount > 0 && `${counts.appliedCount} applied`,
                counts.kitGeneratedCount > 0 && `${counts.kitGeneratedCount} kit generated`,
                counts.newCount > 0 && `${counts.newCount} new`,
                counts.dismissedCount > 0 && `${counts.dismissedCount} dismissed`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
          {allPostings.length > 0 && (
            <span className="text-xs text-[var(--muted)]">
              {scoredCount} scored · sorted by fit
            </span>
          )}
          {counts && counts.appliedCount > 0 && (
            <button
              className="btn !px-2.5 !py-1 text-xs"
              onClick={() => {
                const a = document.createElement("a");
                a.href = "/api/postings/export.csv";
                a.download = "applied-jobs.csv";
                a.click();
                awardXp("csv_exported");
              }}
              title={`Download CSV of ${counts.appliedCount} applied posting${counts.appliedCount === 1 ? "" : "s"}`}
            >
              Export applied jobs
            </button>
          )}
          {counts && counts.dismissedCount > 0 && (
            <button
              className="btn !px-2.5 !py-1 text-xs"
              onClick={() => setShowDismissed((v) => !v)}
            >
              {showDismissed ? "Hide dismissed" : `Show dismissed (${counts.dismissedCount})`}
            </button>
          )}
        </div>

        {!state ? (
          <p className="animate-pulse text-sm text-[var(--muted)]">Loading…</p>
        ) : visiblePostings.length === 0 ? (
          <div className="flex min-h-[10rem] items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[#0c0e13] p-6 text-center">
            <div className="max-w-md text-sm text-[var(--muted)]">
              {!state.providerConfigured ? (
                <p>
                  Add a TheirStack key in{" "}
                  <Link href="/settings" className="text-[var(--accent)] underline">
                    Settings
                  </Link>
                  , then come back here.
                </p>
              ) : !filters ? (
                <p>
                  No filters yet. Click{" "}
                  <strong className="text-[var(--text)]">
                    Filter by Profile
                  </strong>{" "}
                  (or edit them manually), save, then refresh.
                </p>
              ) : allPostings.length > 0 ? (
                <p>
                  All postings are dismissed.{" "}
                  <button
                    className="text-[var(--accent)] underline"
                    onClick={() => setShowDismissed(true)}
                  >
                    Show them
                  </button>{" "}
                  or refresh to fetch new ones.
                </p>
              ) : (
                <p>
                  No postings cached yet. Click{" "}
                  <strong className="text-[var(--text)]">Refresh postings</strong>{" "}
                  to fetch live jobs matching your filters.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {visiblePostings.map((p) => {
              const expanded = expandedId === p.id;
              const d = details[p.id];
              const isPatching = patchingId === p.id;
              const isDismissed = p.status === "dismissed";
              const isApplied = p.status === "applied";
              const isKitGenerated = p.status === "kit_generated";
              const meta = [
                p.location,
                workModeLabel(p),
                p.seniority,
                p.salary,
                p.datePosted ? `posted ${fmtDate(p.datePosted)}` : "",
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <div
                  key={p.id}
                  id={`posting-${p.id}`}
                  className={`rounded-xl border bg-[#0c0e13] p-4 ${
                    isDismissed
                      ? "border-[var(--border)] opacity-50"
                      : "border-[var(--border)]"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <ScoreChip score={p.score} />
                    <LegitimacyBadge tier={p.legitimacy} />
                    <button
                      className="text-left text-sm font-semibold text-[var(--text)] hover:underline"
                      onClick={() => void toggleExpand(p.id)}
                      title={expanded ? "Collapse" : "Show details"}
                    >
                      {p.title}
                    </button>
                    <span className="text-sm text-[var(--muted)]">
                      {p.company}
                    </span>
                    {p.crossListingOf && (
                      <span
                        className="rounded-full border border-[#4a3c6e] bg-[#1a1428] px-2 py-0.5 text-xs text-[#c8b4ff]"
                        title="This posting appears to be the same job listed under a different URL — only one will appear in Today's picks"
                      >
                        ≈ likely same as {p.crossListingOf.company} — {p.crossListingOf.title}
                      </span>
                    )}
                    {isApplied && (
                      <span className="rounded-full border border-[color-mix(in_srgb,var(--accent)_55%,var(--border))] px-2 py-0.5 text-xs text-[var(--accent)]">
                        ✓ applied
                      </span>
                    )}
                    {isKitGenerated && !isApplied && (
                      <span className="rounded-full border border-[#7a5c2e] px-2 py-0.5 text-xs text-[#ffd28f]">
                        kit generated
                      </span>
                    )}
                    {isDismissed && (
                      <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">
                        dismissed
                      </span>
                    )}
                  </div>
                  {meta && (
                    <p className="mt-1 text-xs text-[var(--muted)]">{meta}</p>
                  )}
                  {p.rationale && (
                    <p className="mt-1.5 text-sm text-[var(--muted)]">
                      {p.rationale}
                    </p>
                  )}
                  {p.matchedExperienceIds.length > 0 && (
                    <p className="mt-1.5 text-xs text-[var(--muted)]">
                      Matched experiences:{" "}
                      {p.matchedExperienceIds.map((id) => (
                        <span
                          key={id}
                          className="mr-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-[var(--accent)]"
                        >
                          {id}
                        </span>
                      ))}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {p.url && (
                      <a
                        className="text-xs text-[var(--muted)] underline hover:text-[var(--text)]"
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        original ↗
                      </a>
                    )}
                    {!isApplied && (
                      <button
                        className="btn !px-2.5 !py-1 text-xs"
                        disabled={isPatching}
                        onClick={() => void patchStatus(p.id, "applied")}
                        title="Mark as applied"
                      >
                        {isPatching ? "…" : "Mark applied"}
                      </button>
                    )}
                    {isApplied && (
                      <button
                        className="btn !px-2.5 !py-1 text-xs"
                        disabled={isPatching}
                        onClick={() => void patchStatus(p.id, "new")}
                        title="Undo applied"
                      >
                        {isPatching ? "…" : "Undo applied"}
                      </button>
                    )}
                    {!isDismissed ? (
                      <button
                        className="btn !px-2.5 !py-1 text-xs text-[var(--muted)]"
                        disabled={isPatching}
                        onClick={() => void patchStatus(p.id, "dismissed")}
                        title="Hide this posting"
                      >
                        {isPatching ? "…" : "Dismiss"}
                      </button>
                    ) : (
                      <button
                        className="btn !px-2.5 !py-1 text-xs"
                        disabled={isPatching}
                        onClick={() => void patchStatus(p.id, "new")}
                        title="Restore to active list"
                      >
                        {isPatching ? "…" : "Restore"}
                      </button>
                    )}
                    {!isDismissed && (
                      <Link
                        href={`/?posting=${encodeURIComponent(p.id)}`}
                        className="btn btn-primary !px-3 !py-1.5 text-xs"
                      >
                        Generate kit
                      </Link>
                    )}
                  </div>

                  {expanded && (
                    <div className="mt-3 border-t border-[var(--border)] pt-3">
                      {!d ? (
                        <p className="animate-pulse text-sm text-[var(--muted)]">
                          {detailLoading ? "Loading details…" : "…"}
                        </p>
                      ) : (
                        <>
                          {/* Legitimacy signals — shown when tier ≠ high_confidence */}
                          {d.legitimacy && d.legitimacy !== "high_confidence" && (
                            <div
                              className={`mb-3 rounded-lg border px-3 py-2 text-xs ${
                                d.legitimacy === "suspicious"
                                  ? "border-[#7a2e2e] bg-[#2a1414] text-[#ff8f8f]"
                                  : "border-[#7a5c2e] bg-[#2a2214] text-[#ffd28f]"
                              }`}
                            >
                              <p className="mb-1 font-medium">
                                {d.legitimacy === "suspicious"
                                  ? "⚠ Review carefully — multiple signals worth verifying"
                                  : "○ Worth a look — signals worth verifying before applying"}
                              </p>
                              {d.legitimacySignals && d.legitimacySignals.length > 0 && (
                                <ul className="list-disc space-y-0.5 pl-4">
                                  {d.legitimacySignals.map((s, i) => (
                                    <li key={i}>{s}</li>
                                  ))}
                                </ul>
                              )}
                              <p className="mt-1.5 opacity-70">
                                Every signal has a legitimate explanation — you decide.
                              </p>
                            </div>
                          )}
                          {d.fit?.brief && (
                            <div className="grid gap-3 md:grid-cols-2">
                              <ListBlock
                                label="Must-haves"
                                items={d.fit.brief.mustHaves}
                              />
                              <ListBlock
                                label="Nice-to-haves"
                                items={d.fit.brief.niceToHaves}
                              />
                              <ListBlock
                                label="Responsibilities"
                                items={d.fit.brief.responsibilities}
                              />
                              {d.fit.brief.atsKeywords.length > 0 && (
                                <div>
                                  <p className="label mb-1">ATS keywords</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {d.fit.brief.atsKeywords.map((k) => (
                                      <span
                                        key={k}
                                        className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]"
                                      >
                                        {k}
                                      </span>
                                    ))}
                                  </div>
                                  {d.fit.brief.compensation && (
                                    <p className="mt-2 text-xs text-[var(--muted)]">
                                      Compensation:{" "}
                                      {d.fit.brief.compensation.replace(
                                        /\$\s*([\d]+(?:\.\d+)?)/g,
                                        (_, n) =>
                                          "$\u202f" +
                                          Number(n).toLocaleString("en-US", {
                                            minimumFractionDigits: 0,
                                            maximumFractionDigits: 0,
                                          })
                                      )}
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                          {d.description ? (
                            <div className="mt-3">
                              <p className="label mb-1">Full description</p>
                              <div className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[#0a0c10] p-3 text-xs leading-relaxed text-[var(--muted)]">
                                {d.description}
                              </div>
                            </div>
                          ) : (
                            <p className="mt-3 text-xs text-[var(--muted)]">
                              No description available — use the original posting
                              link.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
