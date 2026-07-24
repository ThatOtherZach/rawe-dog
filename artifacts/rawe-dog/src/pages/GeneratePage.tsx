import { Link } from "wouter";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownView } from "../components/MarkdownView";

type Health = {
  settings: { hasApiKey: boolean; model: string };
  library: {
    ready: boolean;
    masterProfile: boolean;
    experienceCount: number;
    resumeTemplate: boolean;
    coverTemplate: boolean;
    systemInstructions: boolean;
  };
};

type DocKey = "resume" | "coverLetter" | "alignmentNotes" | "starPrep";

const DOC_LABELS: Record<DocKey, string> = {
  resume: "Resume",
  coverLetter: "Cover letter",
  alignmentNotes: "Alignment",
  starPrep: "STAR prep",
};

type Selection = {
  targetTitle: string;
  company: string;
  leadExperienceIds: string[];
  supportingExperienceIds: string[];
  leadExperiences: string[];
  supportingExperiences: string[];
  keywordsToHit: string[];
  rationale: string;
};

type Kit = {
  meta: {
    targetTitle: string;
    company: string;
    leadExperiences: string[];
    rationale: string;
    sourcesUsed?: string[];
  };
  resumeMarkdown: string;
  coverLetterMarkdown: string;
  alignmentNotesMarkdown: string;
  starPrepMarkdown: string;
};

type ExpOption = { id: string; catalogId: string; title: string; fileName: string };

type QaFinding = {
  id: string;
  document: DocKey;
  category: "grounding" | "consistency" | "form" | "keywords";
  severity: "info" | "minor" | "major";
  detail: string;
  suggestion?: string;
  source: "verifier" | "automated";
  status: "open" | "repair_attempted";
};

type KeywordCoverageEntry = {
  keyword: string;
  inResume: boolean;
  inCoverLetter: boolean;
  covered: boolean;
};

type QaReport = {
  verdict: "pass" | "issues_found" | "repaired";
  summary: string;
  findings: QaFinding[];
  keywordCoverage: KeywordCoverageEntry[];
  repairedDocuments: DocKey[];
  counts: { major: number; minor: number; info: number };
  verifierRan: boolean;
};

type GenStats = {
  models?: { selection: string; drafting: string; verification: string };
  durationMs?: number;
  repairedDocuments?: DocKey[];
  [key: string]: unknown;
};

type SseEvent =
  | { type: "status"; stage: string; message: string }
  | {
      type: "pass1";
      selection: Selection;
      experienceOptions: ExpOption[];
      stats: Record<string, unknown>;
      warning?: string;
    }
  | { type: "draft"; doc: DocKey; markdown: string; sourcesUsed: string[] }
  | { type: "qa"; report: QaReport }
  | { type: "repair"; doc: DocKey; markdown: string }
  | {
      type: "done";
      kit: Kit;
      selection: Selection;
      experienceOptions: ExpOption[];
      qaReport: QaReport;
      stats: GenStats;
    }
  | { type: "error"; error: string }
  | { type: "close" };

type Tab = "resume" | "cover" | "alignment" | "star";

const TAB_TO_DOC: Record<Tab, DocKey> = {
  resume: "resume",
  cover: "coverLetter",
  alignment: "alignmentNotes",
  star: "starPrep",
};

type Stage =
  | "idle"
  | "pass1"
  | "review"
  | "drafting"
  | "verifying"
  | "repairing"
  | "done"
  | "error";

type DocStatus = "pending" | "ready" | "repairing" | "repaired";

const EMPTY_DOCS: Record<DocKey, string> = {
  resume: "",
  coverLetter: "",
  alignmentNotes: "",
  starPrep: "",
};

const PENDING_STATUS: Record<DocKey, DocStatus> = {
  resume: "pending",
  coverLetter: "pending",
  alignmentNotes: "pending",
  starPrep: "pending",
};

function severityClass(sev: QaFinding["severity"]): string {
  if (sev === "major") return "border-[#7a2e2e] bg-[#2a1414] text-[#ff8f8f]";
  if (sev === "minor") return "border-[#7a5c2e] bg-[#2a2214] text-[#ffd28f]";
  return "border-[var(--border)] bg-[#12151c] text-[var(--muted)]";
}

export default function GeneratePage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [jobPosting, setJobPosting] = useState("");
  const [company, setCompany] = useState("");
  const [targetTitle, setTargetTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [kit, setKit] = useState<Kit | null>(null);
  const [docs, setDocs] = useState<Record<DocKey, string>>(EMPTY_DOCS);
  const [docStatus, setDocStatus] = useState<Record<DocKey, DocStatus>>(PENDING_STATUS);
  const [qaReport, setQaReport] = useState<QaReport | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [expOptions, setExpOptions] = useState<ExpOption[]>([]);
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  const [stats, setStats] = useState<GenStats | null>(null);
  const [tab, setTab] = useState<Tab>("resume");
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const draftsDone = useRef(0);

  const clearProgressTimer = () => {
    if (progressTimer.current) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
  };

  const pulseToward = (from: number, cap: number) => {
    clearProgressTimer();
    setProgress((p) => Math.max(p, from));
    progressTimer.current = setInterval(() => {
      setProgress((p) => {
        if (p >= cap) return p;
        const step = Math.max(0.3, (cap - p) * 0.04);
        return Math.min(cap, p + step);
      });
    }, 400);
  };

  const snapProgress = (value: number, label?: string) => {
    clearProgressTimer();
    setProgress((p) => Math.max(p, value));
    if (label) setStatusMsg(label);
  };

  useEffect(() => () => clearProgressTimer(), []);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/health");
    setHealth(await res.json());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isMarkdownTab = tab === "alignment" || tab === "star";
  const activeDoc = TAB_TO_DOC[tab];
  const activeMarkdown = docs[activeDoc] || "";

  const baseName = useMemo(() => {
    return (kit?.meta.company || company || kit?.meta.targetTitle || "application")
      .replace(/\s+/g, "_")
      .slice(0, 40);
  }, [kit, company]);

  const tabFilename = useMemo(() => {
    const map: Record<Tab, string> = {
      resume: `${baseName}_Resume`,
      cover: `${baseName}_Cover_Letter`,
      alignment: `${baseName}_Alignment`,
      star: `${baseName}_STAR_Prep`,
    };
    return map[tab];
  }, [baseName, tab]);

  const busy =
    stage === "pass1" ||
    stage === "drafting" ||
    stage === "verifying" ||
    stage === "repairing";
  const showProgress = stage !== "idle" && stage !== "error";
  const kitVisible =
    stage === "drafting" ||
    stage === "verifying" ||
    stage === "repairing" ||
    stage === "done";

  function resetRunState() {
    setError(null);
    setWarning(null);
    setKit(null);
    setDocs(EMPTY_DOCS);
    setDocStatus(PENDING_STATUS);
    setQaReport(null);
    setStats(null);
    setCopied(false);
    draftsDone.current = 0;
  }

  const handleEvent = useCallback((ev: SseEvent) => {
    switch (ev.type) {
      case "status": {
        setStatusMsg(ev.message);
        if (ev.stage === "pass1") {
          setStage("pass1");
          pulseToward(8, 30);
        } else if (ev.stage === "drafting") {
          setStage("drafting");
          pulseToward(40, 78);
        } else if (ev.stage === "verifying") {
          setStage("verifying");
          pulseToward(82, 90);
        } else if (ev.stage === "repairing") {
          setStage("repairing");
          // Mark docs with open major findings as being repaired.
          setQaReport((r) => {
            if (r) {
              const repairing = new Set(
                r.findings
                  .filter((f) => f.severity === "major" && f.status === "open")
                  .map((f) => f.document)
              );
              setDocStatus((ds) => {
                const next = { ...ds };
                repairing.forEach((d) => (next[d] = "repairing"));
                return next;
              });
            }
            return r;
          });
          pulseToward(92, 97);
        }
        break;
      }
      case "pass1": {
        setSelection(ev.selection);
        setExpOptions(ev.experienceOptions || []);
        setSelectedLeads(ev.selection.leadExperienceIds || []);
        if (ev.warning) setWarning(ev.warning);
        snapProgress(35, "Experiences selected.");
        break;
      }
      case "draft": {
        draftsDone.current += 1;
        setDocs((d) => ({ ...d, [ev.doc]: ev.markdown }));
        setDocStatus((ds) => ({ ...ds, [ev.doc]: "ready" }));
        snapProgress(40 + draftsDone.current * 10, `${DOC_LABELS[ev.doc]} drafted.`);
        pulseToward(40 + draftsDone.current * 10, 78);
        break;
      }
      case "qa": {
        setQaReport(ev.report);
        snapProgress(91);
        break;
      }
      case "repair": {
        setDocs((d) => ({ ...d, [ev.doc]: ev.markdown }));
        setDocStatus((ds) => ({ ...ds, [ev.doc]: "repaired" }));
        setStatusMsg(`${DOC_LABELS[ev.doc]} repaired.`);
        break;
      }
      case "done": {
        clearProgressTimer();
        setKit(ev.kit);
        setSelection(ev.selection);
        if (ev.experienceOptions?.length) setExpOptions(ev.experienceOptions);
        setDocs({
          resume: ev.kit.resumeMarkdown,
          coverLetter: ev.kit.coverLetterMarkdown,
          alignmentNotes: ev.kit.alignmentNotesMarkdown,
          starPrep: ev.kit.starPrepMarkdown,
        });
        setDocStatus((ds) => {
          const next = { ...ds };
          (Object.keys(next) as DocKey[]).forEach((d) => {
            if (next[d] === "pending" || next[d] === "repairing") next[d] = "ready";
          });
          return next;
        });
        setQaReport(ev.qaReport);
        setStats(ev.stats);
        setStage("done");
        snapProgress(100, "Kit ready.");
        break;
      }
      case "error": {
        clearProgressTimer();
        setStage("error");
        setError(ev.error);
        break;
      }
      case "close":
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function streamGenerate(body: Record<string, unknown>) {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const ct = res.headers.get("content-type") || "";
    if (!res.ok || !res.body || !ct.includes("text/event-stream")) {
      const data = await res.json().catch(() => ({}));
      throw new Error(
        (data as { error?: string }).error || `Request failed (${res.status})`
      );
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = frame
          .split("\n")
          .find((l) => l.startsWith("data: "));
        if (!line) continue;
        try {
          handleEvent(JSON.parse(line.slice(6)) as SseEvent);
        } catch {
          /* skip malformed frame */
        }
      }
    }
  }

  async function runPass1() {
    resetRunState();
    setStage("pass1");
    snapProgress(5, "Pass 1: selecting experiences…");
    pulseToward(10, 38);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "pass1",
          jobPosting,
          company,
          targetTitle,
          notes,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Pass 1 failed");

      setSelection(data.selection);
      setExpOptions(data.experienceOptions || []);
      setSelectedLeads(data.selection.leadExperienceIds || []);
      if (data.warning) setWarning(data.warning);
      setStage("review");
      snapProgress(45, "Review lead experiences, then write the kit.");
    } catch (err) {
      clearProgressTimer();
      setStage("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function runPass2() {
    if (!selection) return;
    setError(null);
    setWarning(null);
    setCopied(false);
    setKit(null);
    setDocs(EMPTY_DOCS);
    setDocStatus(PENDING_STATUS);
    setQaReport(null);
    draftsDone.current = 0;
    setStage("drafting");
    snapProgress(40, "Writing application kit…");
    pulseToward(42, 78);
    setTab("resume");
    try {
      await streamGenerate({
        mode: "stream",
        jobPosting,
        company,
        targetTitle,
        notes,
        selection: { ...selection, leadExperienceIds: selectedLeads },
        overrideLeads: selectedLeads,
      });
      // Terminal state is set by the done/error event handlers.
    } catch (err) {
      clearProgressTimer();
      setStage("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function runFull() {
    resetRunState();
    setSelection(null);
    setStage("pass1");
    snapProgress(5, "Starting full pipeline…");
    pulseToward(8, 30);
    setTab("resume");
    try {
      await streamGenerate({
        mode: "stream",
        jobPosting,
        company,
        targetTitle,
        notes,
      });
    } catch (err) {
      clearProgressTimer();
      setStage("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function toggleLead(catalogId: string) {
    setSelectedLeads((prev) =>
      prev.includes(catalogId)
        ? prev.filter((t) => t !== catalogId)
        : [...prev, catalogId]
    );
  }

  async function download(format: "md" | "pdf" | "docx") {
    if (!activeMarkdown) return;
    setExporting(true);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          markdown: activeMarkdown,
          format,
          filename: tabFilename,
          title: tabFilename,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${tabFilename}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  async function downloadKitZip() {
    if (!kit) return;
    setExporting(true);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "zip",
          filename: baseName,
          kit,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Zip export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${baseName}_kit.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  async function copyActive() {
    if (!activeMarkdown) return;
    await navigator.clipboard.writeText(activeMarkdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const lib = health?.library;
  const ready = Boolean(health?.settings.hasApiKey && lib?.ready);
  const displayPct = Math.round(progress);

  const kitTitle =
    kit?.meta.targetTitle || selection?.targetTitle || targetTitle || "Tailored kit";
  const kitCompany = kit?.meta.company || selection?.company || company || "";

  return (
    <div className="space-y-6">
      <section className="panel p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-xl font-semibold">Generate kit</h1>
          <span
            className={`badge ${health?.settings.hasApiKey ? "badge-ok" : "badge-bad"}`}
          >
            API {health?.settings.hasApiKey ? "ready" : "missing"}
          </span>
          <span className="badge badge-ok">{health?.settings.model || "…"}</span>
          <span className={`badge ${lib?.ready ? "badge-ok" : "badge-bad"}`}>
            Profile {lib?.masterProfile ? "✓" : "×"} · Exp{" "}
            {lib?.experienceCount ?? 0} · Templates{" "}
            {lib?.resumeTemplate && lib?.coverTemplate ? "✓" : "×"}
          </span>
        </div>

        {!ready && (
          <div className="mb-4 rounded-lg border border-[var(--border)] bg-[#12151c] px-3 py-3 text-sm text-[var(--muted)]">
            {!health?.settings.hasApiKey && (
              <p>
                Add an xAI API key in{" "}
                <Link href="/settings" className="text-[var(--accent)] underline">
                  Settings
                </Link>
                .
              </p>
            )}
            {lib && !lib.ready && (
              <p className="mt-1">
                Complete the knowledge{" "}
                <Link href="/library" className="text-[var(--accent)] underline">
                  Library
                </Link>
                : Master Profile, ≥1 experience, resume + cover templates.
              </p>
            )}
          </div>
        )}

        <div className="grid items-stretch gap-4 md:grid-cols-3">
          <div className="flex h-full min-h-[20rem] flex-col md:col-span-2">
            <label className="label shrink-0">Job posting (paste bin)</label>
            <textarea
              className="textarea textarea-fill"
              placeholder="Paste the full job description here…"
              value={jobPosting}
              onChange={(e) => setJobPosting(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="flex h-full flex-col space-y-3">
            <div>
              <label className="label">Company (optional)</label>
              <input
                className="input"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Acme Corp"
                disabled={busy}
              />
            </div>
            <div>
              <label className="label">Target title (optional)</label>
              <input
                className="input"
                value={targetTitle}
                onChange={(e) => setTargetTitle(e.target.value)}
                placeholder="Business Systems Analyst"
                disabled={busy}
              />
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <label className="label shrink-0">Notes (optional)</label>
              <textarea
                className="textarea min-h-[5.5rem] flex-1"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Emphasize enterprise BSA, remote, etc."
                disabled={busy}
              />
            </div>
            <button
              className="btn btn-primary w-full shrink-0"
              disabled={busy || !jobPosting.trim() || !ready}
              onClick={() => void runPass1()}
            >
              {stage === "pass1" ? "Selecting…" : "1. Select experiences"}
            </button>
            <button
              className="btn w-full shrink-0"
              disabled={busy || !jobPosting.trim() || !ready}
              onClick={() => void runFull()}
              title="Skip manual review; run the full pipeline automatically"
            >
              {busy ? "Working…" : "Generate all (auto)"}
            </button>
            <p className="shrink-0 text-xs leading-relaxed text-[var(--muted)]">
              Core guardrails always apply. Selection picks evidence by ID, four
              documents draft in parallel, then a verification pass checks
              grounding, consistency, form, and keywords — repairing only what
              fails.
            </p>
          </div>
        </div>

        {showProgress && (
          <div className="mt-5 rounded-xl border border-[var(--border)] bg-[#0c0e13] p-4">
            <div className="mb-2 flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-[var(--text)]">
                {statusMsg || "Working…"}
              </span>
              <span className="tabular-nums text-[var(--accent)]">
                {displayPct}%
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-[#1a1f2b]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#1b4332] to-[var(--accent)] transition-[width] duration-300 ease-out"
                style={{ width: `${Math.min(100, Math.max(0, displayPct))}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">
              {stage === "pass1" && "Selection — mapping job to experiences"}
              {stage === "review" && "Paused for your lead selection"}
              {stage === "drafting" && "Drafting 4 documents in parallel"}
              {stage === "verifying" &&
                "Verifying — grounding, consistency, form, keywords"}
              {stage === "repairing" && "Repairing flagged documents"}
              {stage === "done" && "Complete"}
            </p>
          </div>
        )}

        {warning && (
          <div className="mt-4 rounded-lg border border-[#7a5c2e] bg-[#2a2214] px-3 py-2 text-sm text-[#ffd28f]">
            {warning}
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-[color-mix(in_srgb,var(--danger)_45%,var(--border))] bg-[#2a1414] px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </div>
        )}
      </section>

      {(stage === "review" || kitVisible) && selection && (
        <section className="panel p-5">
          <h2 className="mb-1 text-lg font-semibold">Lead experiences</h2>
          <p className="mb-3 text-sm text-[var(--muted)]">{selection.rationale}</p>
          <div className="mb-4 grid gap-2 sm:grid-cols-2">
            {expOptions.map((opt) => {
              const checked = selectedLeads.includes(opt.catalogId);
              const recommended = selection.leadExperienceIds.includes(opt.catalogId);
              const supporting = selection.supportingExperienceIds.includes(
                opt.catalogId
              );
              return (
                <label
                  key={opt.catalogId}
                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--border)] bg-[#0c0e13] px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked}
                    disabled={busy}
                    onChange={() => toggleLead(opt.catalogId)}
                  />
                  <span>
                    <span className="font-medium">{opt.title}</span>
                    <span className="ml-2 text-xs text-[var(--muted)]">
                      {opt.catalogId}
                    </span>
                    {recommended && (
                      <span className="ml-2 text-xs text-[var(--accent)]">
                        model pick
                      </span>
                    )}
                    {!recommended && supporting && (
                      <span className="ml-2 text-xs text-[var(--muted)]">
                        supporting
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          {selection.keywordsToHit?.length > 0 && (
            <p className="mb-3 text-xs text-[var(--muted)]">
              Keywords: {selection.keywordsToHit.join(", ")}
            </p>
          )}
          {stage === "review" && (
            <button
              className="btn btn-primary"
              disabled={busy || selectedLeads.length === 0}
              onClick={() => void runPass2()}
            >
              2. Write application kit
            </button>
          )}
          {stage === "review" && (
            <p className="mt-3 text-xs text-[var(--muted)]">
              Leads selected: {selectedLeads.length} (1–3 recommended)
            </p>
          )}
        </section>
      )}

      {kitVisible && (
        <section className="panel p-5">
          <div className="mb-3 flex flex-wrap items-start gap-3">
            <div className="mr-auto">
              <h2 className="text-lg font-semibold">
                {kitTitle}
                {kitCompany ? ` · ${kitCompany}` : ""}
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
                {kit?.meta.rationale || selection?.rationale || ""}
              </p>
              {kit && (kit.meta.sourcesUsed || kit.meta.leadExperiences)?.length > 0 && (
                <p className="mt-2 text-xs text-[var(--muted)]">
                  Sources:{" "}
                  {(kit.meta.sourcesUsed || kit.meta.leadExperiences).join(", ")}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn btn-primary"
                disabled={!activeMarkdown}
                onClick={() => void copyActive()}
              >
                {copied ? "Copied!" : isMarkdownTab ? "Copy markdown" : "Copy"}
              </button>
              <button
                className="btn"
                disabled={exporting || !activeMarkdown}
                onClick={() => void download("md")}
              >
                .md
              </button>
              {!isMarkdownTab && (
                <>
                  <button
                    className="btn btn-primary"
                    disabled={exporting || !activeMarkdown}
                    onClick={() => void download("pdf")}
                  >
                    PDF
                  </button>
                  <button
                    className="btn"
                    disabled={exporting || !activeMarkdown}
                    onClick={() => void download("docx")}
                  >
                    DOCX
                  </button>
                </>
              )}
              <button
                className="btn"
                disabled={exporting || !kit}
                onClick={() => void downloadKitZip()}
              >
                Full kit ZIP
              </button>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap gap-1">
            {(
              [
                ["resume", "Resume"],
                ["cover", "Cover letter"],
                ["alignment", "Alignment"],
                ["star", "STAR prep"],
              ] as const
            ).map(([id, label]) => {
              const st = docStatus[TAB_TO_DOC[id]];
              return (
                <button
                  key={id}
                  className="tab"
                  data-active={tab === id}
                  onClick={() => {
                    setTab(id);
                    setCopied(false);
                  }}
                >
                  {label}
                  {st === "pending" && busy && (
                    <span className="ml-1.5 inline-block animate-pulse text-[var(--muted)]">
                      …
                    </span>
                  )}
                  {st === "repairing" && (
                    <span className="ml-1.5 text-xs text-[#ffd28f]">fixing</span>
                  )}
                  {st === "repaired" && (
                    <span className="ml-1.5 text-xs text-[var(--accent)]">✦</span>
                  )}
                </button>
              );
            })}
          </div>

          {!activeMarkdown ? (
            <div className="flex min-h-[12rem] items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[#0c0e13] p-4">
              <p className="animate-pulse text-sm text-[var(--muted)]">
                {docStatus[activeDoc] === "pending"
                  ? `Drafting ${DOC_LABELS[activeDoc].toLowerCase()}…`
                  : "Waiting…"}
              </p>
            </div>
          ) : isMarkdownTab ? (
            <div className="rounded-xl border border-[var(--border)] bg-[#0c0e13] p-4">
              <p className="mb-3 text-xs text-[var(--muted)]">
                Rendered markdown — use{" "}
                <strong className="text-[var(--text)]">Copy markdown</strong> for the
                raw source.
              </p>
              <div className="max-h-[32rem] overflow-auto">
                <MarkdownView source={activeMarkdown} />
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--border)] bg-[#0c0e13] p-4">
              <div className="prose-out">
                {docStatus[activeDoc] === "repairing" && (
                  <p className="mb-2 text-xs text-[#ffd28f]">
                    Repairing this document…
                  </p>
                )}
                {activeMarkdown}
              </div>
            </div>
          )}
        </section>
      )}

      {kitVisible && (stage === "verifying" || stage === "repairing" || qaReport) && (
        <section className="panel p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-lg font-semibold">Quality report</h2>
            {qaReport ? (
              <>
                <span
                  className={`badge ${
                    qaReport.verdict === "pass"
                      ? "badge-ok"
                      : qaReport.verdict === "repaired"
                        ? "badge-ok"
                        : "badge-bad"
                  }`}
                >
                  {qaReport.verdict === "pass"
                    ? "Passed"
                    : qaReport.verdict === "repaired"
                      ? "Repaired"
                      : "Issues found"}
                </span>
                <span className="badge">
                  {qaReport.counts.major} major · {qaReport.counts.minor} minor ·{" "}
                  {qaReport.counts.info} info
                </span>
                {!qaReport.verifierRan && (
                  <span className="badge badge-bad">automated checks only</span>
                )}
              </>
            ) : (
              <span className="badge animate-pulse">Verifying…</span>
            )}
          </div>

          {qaReport && (
            <>
              <p className="mb-4 text-sm text-[var(--muted)]">{qaReport.summary}</p>

              {qaReport.repairedDocuments.length > 0 && (
                <p className="mb-3 text-xs text-[var(--accent)]">
                  Repaired: {qaReport.repairedDocuments.map((d) => DOC_LABELS[d]).join(", ")}
                </p>
              )}

              {qaReport.keywordCoverage.length > 0 && (
                <div className="mb-4">
                  <p className="label mb-1.5">Keyword coverage (resume + cover letter)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {qaReport.keywordCoverage.map((k) => (
                      <span
                        key={k.keyword}
                        className={`rounded-full border px-2.5 py-0.5 text-xs ${
                          k.covered
                            ? "border-[color-mix(in_srgb,var(--accent)_50%,var(--border))] text-[var(--accent)]"
                            : "border-[#7a5c2e] text-[#ffd28f]"
                        }`}
                        title={
                          k.covered
                            ? `In ${[k.inResume && "resume", k.inCoverLetter && "cover letter"].filter(Boolean).join(" + ")}`
                            : "Not found in resume or cover letter"
                        }
                      >
                        {k.covered ? "✓" : "✗"} {k.keyword}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {qaReport.findings.length > 0 ? (
                <div className="space-y-2">
                  {qaReport.findings.map((f) => (
                    <div
                      key={f.id}
                      className={`rounded-lg border px-3 py-2 text-sm ${severityClass(f.severity)}`}
                    >
                      <div className="mb-0.5 flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide opacity-80">
                        <span className="font-semibold">{f.severity}</span>
                        <span>· {DOC_LABELS[f.document]}</span>
                        <span>· {f.category}</span>
                        <span>· {f.source}</span>
                        {f.status === "repair_attempted" && (
                          <span className="text-[var(--accent)]">
                            · repair attempted
                          </span>
                        )}
                      </div>
                      <p className="text-[var(--text)]">{f.detail}</p>
                      {f.suggestion && (
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          Suggestion: {f.suggestion}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--muted)]">
                  No issues found — all checks passed.
                </p>
              )}

              {stats?.models && (
                <p className="mt-4 text-xs text-[var(--muted)]">
                  Models — selection: {stats.models.selection} · drafting:{" "}
                  {stats.models.drafting} · verification: {stats.models.verification}
                  {typeof stats.durationMs === "number" &&
                    ` · ${(stats.durationMs / 1000).toFixed(1)}s total`}
                </p>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
