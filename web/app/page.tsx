"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownView } from "./components/MarkdownView";

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

type Selection = {
  targetTitle: string;
  company: string;
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

type ExpOption = { id: string; title: string; fileName: string };

type Tab = "resume" | "cover" | "alignment" | "star";

type Stage =
  | "idle"
  | "pass1"
  | "review"
  | "pass2"
  | "done"
  | "error";

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
  const [kit, setKit] = useState<Kit | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [expOptions, setExpOptions] = useState<ExpOption[]>([]);
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [tab, setTab] = useState<Tab>("resume");
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearProgressTimer = () => {
    if (progressTimer.current) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
  };

  /** Animate progress slowly toward `cap` while waiting on network. */
  const pulseToward = (from: number, cap: number) => {
    clearProgressTimer();
    setProgress(from);
    progressTimer.current = setInterval(() => {
      setProgress((p) => {
        if (p >= cap) return p;
        const step = Math.max(0.3, (cap - p) * 0.04);
        return Math.min(cap, p + step);
      });
    }, 400);
  };

  const snapProgress = (value: number, label: string) => {
    clearProgressTimer();
    setProgress(value);
    setStatusMsg(label);
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

  const activeMarkdown = useMemo(() => {
    if (!kit) return "";
    if (tab === "resume") return kit.resumeMarkdown;
    if (tab === "cover") return kit.coverLetterMarkdown;
    if (tab === "alignment") return kit.alignmentNotesMarkdown;
    return kit.starPrepMarkdown;
  }, [kit, tab]);

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

  const busy = stage === "pass1" || stage === "pass2";
  const showProgress = stage === "pass1" || stage === "pass2" || stage === "review" || stage === "done";

  async function runPass1() {
    setError(null);
    setKit(null);
    setStats(null);
    setCopied(false);
    setStage("pass1");
    snapProgress(5, "Starting Pass 1…");
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
      setSelectedLeads(data.selection.leadExperiences || []);
      setStats(data.stats);
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
    setCopied(false);
    setStage("pass2");
    snapProgress(50, "Pass 2: writing application kit…");
    pulseToward(55, 92);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "pass2",
          jobPosting,
          company,
          targetTitle,
          notes,
          selection,
          overrideLeads: selectedLeads,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Pass 2 failed");

      setKit(data.kit);
      setSelection(data.selection);
      setStats((s) => ({ ...(s || {}), ...(data.stats || {}) }));
      setStage("done");
      snapProgress(100, "Kit ready.");
      setTab("resume");
    } catch (err) {
      clearProgressTimer();
      setStage("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function runFull() {
    setError(null);
    setKit(null);
    setCopied(false);
    setStage("pass1");
    snapProgress(5, "Generating (Pass 1 + Pass 2)…");
    // Single request does both passes server-side; animate toward ~90 until done
    pulseToward(10, 90);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "full",
          jobPosting,
          company,
          targetTitle,
          notes,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Generation failed");

      setKit(data.kit);
      setSelection(data.selection);
      setExpOptions(data.experienceOptions || []);
      setSelectedLeads(data.selection?.leadExperiences || []);
      setStats(data.stats);
      setStage("done");
      snapProgress(100, "Kit ready.");
      setTab("resume");
    } catch (err) {
      clearProgressTimer();
      setStage("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function toggleLead(title: string) {
    setSelectedLeads((prev) =>
      prev.includes(title)
        ? prev.filter((t) => t !== title)
        : [...prev, title]
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
        throw new Error(data.error || "Export failed");
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
        throw new Error(data.error || "Zip export failed");
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
              title="Skip manual review; run both passes automatically"
            >
              {busy ? "Working…" : "Generate all (auto)"}
            </button>
            <p className="shrink-0 text-xs leading-relaxed text-[var(--muted)]">
              Core guardrails always apply. Custom library instructions are
              addons only. Pass 1 is cheap selection; Pass 2 uses full lead
              evidence for accuracy.
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
              {stage === "pass1" && "Pass 1 of 2 — mapping job to experiences"}
              {stage === "review" && "Paused for your lead selection"}
              {stage === "pass2" && "Pass 2 of 2 — writing resume kit"}
              {stage === "done" && "Complete"}
            </p>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-[color-mix(in_srgb,var(--danger)_45%,var(--border))] bg-[#2a1414] px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </div>
        )}
      </section>

      {(stage === "review" || stage === "pass2" || stage === "done") &&
        selection && (
          <section className="panel p-5">
            <h2 className="mb-1 text-lg font-semibold">Lead experiences</h2>
            <p className="mb-3 text-sm text-[var(--muted)]">
              {selection.rationale}
            </p>
            <div className="mb-4 grid gap-2 sm:grid-cols-2">
              {(expOptions.length
                ? expOptions.map((e) => e.title)
                : selection.leadExperiences
              ).map((title) => {
                const checked = selectedLeads.includes(title);
                const recommended = selection.leadExperiences.includes(title);
                return (
                  <label
                    key={title}
                    className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--border)] bg-[#0c0e13] px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checked}
                      disabled={busy}
                      onChange={() => toggleLead(title)}
                    />
                    <span>
                      <span className="font-medium">{title}</span>
                      {recommended && (
                        <span className="ml-2 text-xs text-[var(--accent)]">
                          model pick
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
            <button
              className="btn btn-primary"
              disabled={busy || selectedLeads.length === 0}
              onClick={() => void runPass2()}
            >
              {stage === "pass2"
                ? "Writing kit…"
                : "2. Write application kit"}
            </button>
            {stats && (
              <p className="mt-3 text-xs text-[var(--muted)]">
                {typeof stats.pass1Chars === "number" &&
                  `Pass 1 ~${Number(stats.pass1Chars).toLocaleString()} chars · `}
                {typeof stats.pass2Chars === "number" &&
                  `Pass 2 ~${Number(stats.pass2Chars).toLocaleString()} chars · `}
                Leads selected: {selectedLeads.length}
              </p>
            )}
          </section>
        )}

      {kit && (
        <section className="panel p-5">
          <div className="mb-3 flex flex-wrap items-start gap-3">
            <div className="mr-auto">
              <h2 className="text-lg font-semibold">
                {kit.meta.targetTitle || "Tailored kit"}
                {kit.meta.company ? ` · ${kit.meta.company}` : ""}
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
                {kit.meta.rationale}
              </p>
              {(kit.meta.sourcesUsed || kit.meta.leadExperiences)?.length >
                0 && (
                <p className="mt-2 text-xs text-[var(--muted)]">
                  Sources:{" "}
                  {(kit.meta.sourcesUsed || kit.meta.leadExperiences).join(
                    ", "
                  )}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-primary" onClick={() => void copyActive()}>
                {copied ? "Copied!" : isMarkdownTab ? "Copy markdown" : "Copy"}
              </button>
              <button
                className="btn"
                disabled={exporting}
                onClick={() => void download("md")}
              >
                .md
              </button>
              {!isMarkdownTab && (
                <>
                  <button
                    className="btn btn-primary"
                    disabled={exporting}
                    onClick={() => void download("pdf")}
                  >
                    PDF
                  </button>
                  <button
                    className="btn"
                    disabled={exporting}
                    onClick={() => void download("docx")}
                  >
                    DOCX
                  </button>
                </>
              )}
              <button
                className="btn"
                disabled={exporting}
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
            ).map(([id, label]) => (
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
              </button>
            ))}
          </div>

          {isMarkdownTab ? (
            <div className="rounded-xl border border-[var(--border)] bg-[#0c0e13] p-4">
              <p className="mb-3 text-xs text-[var(--muted)]">
                Rendered markdown — use <strong className="text-[var(--text)]">Copy markdown</strong>{" "}
                for the raw source.
              </p>
              <div className="max-h-[32rem] overflow-auto">
                <MarkdownView source={activeMarkdown} />
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--border)] bg-[#0c0e13] p-4">
              <div className="prose-out">{activeMarkdown}</div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
