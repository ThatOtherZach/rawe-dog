"use client";

import { useCallback, useEffect, useState } from "react";

type SlotInfo = {
  slot: string;
  label: string;
  multi: boolean;
  required: boolean;
};

type FileMeta = {
  id: string;
  slot: string;
  originalName: string;
  size: number;
  updatedAt: string;
  kind: string;
};

type LibraryResponse = {
  slots: SlotInfo[];
  files: Record<string, FileMeta[]>;
  readiness: {
    ready: boolean;
    masterProfile: boolean;
    experienceCount: number;
    resumeTemplate: boolean;
    coverTemplate: boolean;
  };
};

const TEMPLATE_SLOTS = ["resume-template", "cover-template"] as const;
const KNOWLEDGE_SLOTS = [
  "master-profile",
  "experience",
  "system-instructions",
] as const;

const TEMPLATE_META: Record<
  (typeof TEMPLATE_SLOTS)[number],
  {
    title: string;
    blurb: string;
    starterHref: string;
    starterName: string;
    accent: string;
  }
> = {
  "resume-template": {
    title: "Resume template",
    blurb:
      "Shape the model fills for each job. MD with {CURLY} cues, or a PDF layout to match.",
    starterHref: "/starters/Resume-Template.md",
    starterName: "Resume-Template.md",
    accent: "from-[#1b4332]/to-[#2d6a4f]",
  },
  "cover-template": {
    title: "Cover letter template",
    blurb:
      "Paragraph structure and tone cues for tailored cover letters. MD or PDF.",
    starterHref: "/starters/Cover-Letter-Template.md",
    starterName: "Cover-Letter-Template.md",
    accent: "from-[#1e3a5f]/to-[#2563eb]",
  },
};

export default function LibraryPage() {
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/library");
    setData(await res.json());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onUpload(slot: string, fileList: FileList | File[] | null) {
    if (!fileList || (fileList as FileList).length === 0) return;
    const files = Array.from(fileList as FileList);
    setBusySlot(slot);
    setError(null);
    try {
      for (const file of files) {
        const form = new FormData();
        form.set("slot", slot);
        form.set("file", file);
        const res = await fetch("/api/library", { method: "POST", body: form });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Upload failed");
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusySlot(null);
      setDragOver(null);
    }
  }

  async function onDelete(slot: string, id: string) {
    setBusySlot(slot);
    setError(null);
    try {
      const res = await fetch(
        `/api/library?slot=${encodeURIComponent(slot)}&id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Delete failed");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusySlot(null);
    }
  }

  function formatSize(n: number) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  const knowledgeSlots =
    data?.slots.filter((s) =>
      (KNOWLEDGE_SLOTS as readonly string[]).includes(s.slot)
    ) || [];

  return (
    <div className="space-y-8">
      {/* Header */}
      <section className="panel p-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-xl font-semibold">Library</h1>
          <span
            className={`badge ${data?.readiness.ready ? "badge-ok" : "badge-bad"}`}
          >
            {data?.readiness.ready
              ? "Ready to generate"
              : "Missing required files"}
          </span>
        </div>
        <p className="max-w-3xl text-sm text-[var(--muted)]">
          Two different things live here:{" "}
          <strong className="text-[var(--text)]">templates</strong> (output
          shape) and your{" "}
          <strong className="text-[var(--text)]">knowledge files</strong>{" "}
          (Master Profile + experience). Templates are tools — download starters
          anytime, or set the active ones the model uses when generating.
        </p>
        {error && (
          <div className="mt-4 rounded-lg border border-[color-mix(in_srgb,var(--danger)_45%,var(--border))] bg-[#2a1414] px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </div>
        )}
      </section>

      {/* Templates — distinct product-style cards */}
      <section>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Templates</h2>
            <p className="text-sm text-[var(--muted)]">
              Always available. Set an active template for generation, or grab a
              starter to edit offline.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {TEMPLATE_SLOTS.map((slot) => {
            const meta = TEMPLATE_META[slot];
            const file = data?.files[slot]?.[0];
            const ready =
              slot === "resume-template"
                ? data?.readiness.resumeTemplate
                : data?.readiness.coverTemplate;
            const busy = busySlot === slot;
            const isDrag = dragOver === slot;

            return (
              <div
                key={slot}
                className={`relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-[0_0_0_1px_rgba(0,0,0,0.2)] ${
                  isDrag ? "ring-2 ring-[var(--accent)]" : ""
                }`}
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDragOver(slot);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  void onUpload(slot, e.dataTransfer.files);
                }}
              >
                {/* Accent strip */}
                <div
                  className={`h-1.5 w-full bg-gradient-to-r ${meta.accent}`}
                />

                <div className="p-5">
                  <div className="mb-4 flex items-start gap-3">
                    {/* Document glyph — not a file-list icon */}
                    <div
                      className={`flex h-12 w-10 shrink-0 flex-col overflow-hidden rounded-md border border-[var(--border)] bg-[#0c0e13] shadow-sm`}
                      aria-hidden
                    >
                      <div
                        className={`h-2 w-full bg-gradient-to-r ${meta.accent}`}
                      />
                      <div className="flex flex-1 flex-col gap-1 p-1.5">
                        <div className="h-0.5 w-full rounded bg-[var(--border)]" />
                        <div className="h-0.5 w-4/5 rounded bg-[var(--border)]" />
                        <div className="h-0.5 w-3/5 rounded bg-[var(--border)]" />
                        <div className="mt-auto h-0.5 w-2/5 rounded bg-[var(--border)]" />
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold">{meta.title}</h3>
                        <span
                          className={`badge ${ready ? "badge-ok" : "badge-bad"}`}
                        >
                          {ready ? "Active" : "Not set"}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        {meta.blurb}
                      </p>
                    </div>
                  </div>

                  {file ? (
                    <div className="mb-4 rounded-xl border border-[color-mix(in_srgb,var(--accent)_25%,var(--border))] bg-[#0c0e13] px-3 py-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
                        Active for generation
                      </div>
                      <div className="mt-1 truncate text-sm font-medium">
                        {file.originalName}
                      </div>
                      <div className="text-xs text-[var(--muted)]">
                        {file.kind.toUpperCase()} · {formatSize(file.size)} ·{" "}
                        {new Date(file.updatedAt).toLocaleString()}
                      </div>
                    </div>
                  ) : (
                    <div className="mb-4 rounded-xl border border-dashed border-[var(--border)] bg-[#0c0e13]/80 px-3 py-3 text-sm text-[var(--muted)]">
                      No active template yet. Upload one, or download the
                      starter, edit it, and upload.
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {/* Primary: get the template */}
                    {file ? (
                      <a
                        className="btn btn-primary"
                        href={`/api/library/file?slot=${encodeURIComponent(slot)}&id=${encodeURIComponent(file.id)}`}
                        download={file.originalName}
                      >
                        Download active
                      </a>
                    ) : null}
                    <a
                      className={file ? "btn" : "btn btn-primary"}
                      href={meta.starterHref}
                      download={meta.starterName}
                    >
                      {file ? "Starter copy" : "Download starter"}
                    </a>

                    <label className="btn cursor-pointer">
                      {busy
                        ? "Working…"
                        : file
                          ? "Replace active"
                          : "Set active template"}
                      <input
                        type="file"
                        className="hidden"
                        accept=".md,.markdown,.txt,.pdf,text/markdown,text/plain,application/pdf"
                        disabled={busy}
                        onChange={(e) => {
                          void onUpload(slot, e.target.files);
                          e.target.value = "";
                        }}
                      />
                    </label>

                    {file && (
                      <button
                        className="btn"
                        disabled={busy}
                        onClick={() => void onDelete(slot, file.id)}
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  <p className="mt-3 text-xs text-[var(--muted)]">
                    Tip: drop a .md or .pdf on this card to set it as active.
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Knowledge — file browser style */}
      <section>
        <div className="mb-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Knowledge files
          </h2>
          <p className="text-sm text-[var(--muted)]">
            Your career source of truth. Edit in Obsidian, then upload or
            reupload here.
          </p>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {[
            {
              ok: data?.readiness.masterProfile,
              label: "Master Profile",
            },
            {
              ok: (data?.readiness.experienceCount ?? 0) >= 1,
              label: `Experience (${data?.readiness.experienceCount ?? 0})`,
            },
            {
              ok: true,
              label: "System instructions (optional)",
              optional: true,
            },
          ].map((c) => (
            <span
              key={c.label}
              className={`badge ${
                c.optional
                  ? ""
                  : c.ok
                    ? "badge-ok"
                    : "badge-bad"
              }`}
            >
              {!c.optional && (c.ok ? "✓" : "×")} {c.label}
            </span>
          ))}
        </div>

        <div className="grid gap-4">
          {knowledgeSlots.map((slot) => {
            const files = data?.files[slot.slot] || [];
            const isDrag = dragOver === slot.slot;
            return (
              <section key={slot.slot} className="panel p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h3 className="mr-auto text-base font-semibold">
                    {slot.label}
                    {slot.required ? (
                      <span className="ml-2 text-xs font-normal text-[var(--warn)]">
                        required
                      </span>
                    ) : (
                      <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                        optional
                      </span>
                    )}
                  </h3>
                  <label className="btn cursor-pointer">
                    {busySlot === slot.slot
                      ? "Working…"
                      : slot.multi
                        ? "Upload files"
                        : files.length
                          ? "Replace"
                          : "Upload"}
                    <input
                      type="file"
                      className="hidden"
                      accept=".md,.markdown,.txt,.pdf,text/markdown,text/plain,application/pdf"
                      multiple={slot.multi}
                      disabled={busySlot === slot.slot}
                      onChange={(e) => {
                        void onUpload(slot.slot, e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>

                <div
                  className={`mb-3 rounded-lg border border-dashed px-3 py-4 text-center text-xs transition ${
                    isDrag
                      ? "border-[var(--accent)] bg-[#14241c] text-[var(--accent)]"
                      : "border-[var(--border)] text-[var(--muted)]"
                  }`}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setDragOver(slot.slot);
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    void onUpload(slot.slot, e.dataTransfer.files);
                  }}
                >
                  Drop .md / .pdf
                  {slot.multi ? " (multiple OK)" : ""}
                </div>

                {files.length === 0 ? (
                  <p className="text-sm text-[var(--muted)]">
                    No file uploaded yet.
                  </p>
                ) : (
                  <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[#0c0e13]">
                    {files.map((f) => (
                      <li
                        key={f.id}
                        className="flex flex-wrap items-center gap-3 px-3 py-2.5"
                      >
                        <div className="mr-auto min-w-0">
                          <div className="truncate font-mono text-sm">
                            {f.originalName}
                          </div>
                          <div className="text-xs text-[var(--muted)]">
                            {f.kind.toUpperCase()} · {formatSize(f.size)} ·{" "}
                            {new Date(f.updatedAt).toLocaleString()}
                          </div>
                        </div>
                        <a
                          className="btn"
                          href={`/api/library/file?slot=${encodeURIComponent(slot.slot)}&id=${encodeURIComponent(f.id)}`}
                          download={f.originalName}
                        >
                          Download
                        </a>
                        <button
                          className="btn"
                          disabled={busySlot === slot.slot}
                          onClick={() => void onDelete(slot.slot, f.id)}
                        >
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </section>
    </div>
  );
}
