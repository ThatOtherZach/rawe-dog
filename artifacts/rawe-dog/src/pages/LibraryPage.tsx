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
  }
> = {
  "resume-template": {
    title: "Resume template",
    blurb:
      "Shape the model fills for each job. MD with {CURLY} cues, or a PDF layout to match.",
    starterHref: "/starters/Resume-Template.md",
    starterName: "Resume-Template.md",
  },
  "cover-template": {
    title: "Cover letter template",
    blurb:
      "Paragraph structure and tone cues for tailored cover letters. MD or PDF.",
    starterHref: "/starters/Cover-Letter-Template.md",
    starterName: "Cover-Letter-Template.md",
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
        if (!res.ok) throw new Error((json as { error?: string }).error || "Upload failed");
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
      if (!res.ok) throw new Error((json as { error?: string }).error || "Delete failed");
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
          <span className={`badge ${data?.readiness.ready ? "badge-ok" : "badge-bad"}`}>
            {data?.readiness.ready ? "Ready" : "Incomplete"}
          </span>
          {data?.readiness.masterProfile && <span className="badge badge-ok">Profile ✓</span>}
          <span className="badge">
            Exp {data?.readiness.experienceCount ?? 0}
          </span>
          {data?.readiness.resumeTemplate && data.readiness.coverTemplate && (
            <span className="badge badge-ok">Templates ✓</span>
          )}
        </div>
        <p className="text-sm text-[var(--muted)]">
          Upload your{" "}
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

      {/* Templates */}
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
                <div className="p-5">
                  <div className="mb-3 flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-[var(--text)]">
                          {meta.title}
                        </h3>
                        {ready ? (
                          <span className="badge badge-ok">Active ✓</span>
                        ) : (
                          <span className="badge badge-bad">Not set</span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-[var(--muted)]">{meta.blurb}</p>
                    </div>
                  </div>

                  {file && (
                    <div className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[#0c0e13] px-3 py-2">
                      <div className="mr-auto min-w-0">
                        <div className="truncate font-mono text-sm">{file.originalName}</div>
                        <div className="text-xs text-[var(--muted)]">
                          {file.kind.toUpperCase()} · {formatSize(file.size)} ·{" "}
                          {new Date(file.updatedAt).toLocaleString()}
                        </div>
                      </div>
                      <a
                        className="btn"
                        href={`/api/library/file?slot=${encodeURIComponent(slot)}&id=${encodeURIComponent(file.id)}`}
                        download={file.originalName}
                      >
                        ↓
                      </a>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
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

      {/* Knowledge files */}
      <section>
        <div className="mb-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Knowledge files
          </h2>
          <p className="text-sm text-[var(--muted)]">
            Master Profile, experience files, and optional custom system instructions.
          </p>
        </div>

        <div className="space-y-4">
          {knowledgeSlots.map((slot) => {
            const files = data?.files[slot.slot] || [];
            const busy = busySlot === slot.slot;
            const isDrag = dragOver === slot.slot;

            return (
              <section
                key={slot.slot}
                className={`rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 ${
                  isDrag ? "ring-2 ring-[var(--accent)]" : ""
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
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h3 className="mr-auto font-semibold">
                    {slot.label}
                    {!slot.required && (
                      <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                        (optional)
                      </span>
                    )}
                  </h3>
                  <label className="btn cursor-pointer">
                    {busy ? "Working…" : slot.multi ? "+ Add file" : "Upload"}
                    <input
                      type="file"
                      className="hidden"
                      multiple={slot.multi}
                      accept=".md,.markdown,.txt,.pdf,text/markdown,text/plain,application/pdf"
                      disabled={busy}
                      onChange={(e) => {
                        void onUpload(slot.slot, e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                <p className="mb-3 text-xs text-[var(--muted)]">
                  Drop .md / .pdf
                  {slot.multi ? " (multiple OK)" : ""}
                </p>

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
