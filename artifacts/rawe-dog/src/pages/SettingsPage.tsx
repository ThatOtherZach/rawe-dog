import { useCallback, useEffect, useRef, useState } from "react";

type PublicSettings = {
  hasApiKey: boolean;
  apiKeyMasked: string;
  model: string;
  selectionModel: string;
  verificationModel: string;
  hasTheirstackKey: boolean;
  theirstackKeyMasked: string;
  /** Stored endpoint, or "" if using the default. */
  apiEndpoint: string;
};

const MODELS = [
  "grok-4.5",
  "grok-4.3",
  "grok-4.20-0309-reasoning",
  "grok-4.20-0309-non-reasoning",
  "grok-build-0.1",
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [theirstackKey, setTheirstackKey] = useState("");
  const [model, setModel] = useState("grok-4.5");
  const [selectionModel, setSelectionModel] = useState("");
  const [verificationModel, setVerificationModel] = useState("");
  const [apiEndpoint, setApiEndpoint] = useState("");
  const [showXaiInput, setShowXaiInput] = useState(false);
  const [showTheirstackInput, setShowTheirstackInput] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Danger zone — wipe
  const [wipeConfirmText, setWipeConfirmText] = useState("");
  const [wipeBusy, setWipeBusy] = useState(false);
  const [wipeResult, setWipeResult] = useState<{
    allOk: boolean;
    library: { ok: boolean; skipped?: boolean; error?: string };
    postings: { ok: boolean; skipped?: boolean; error?: string };
    settings: { ok: boolean; skipped?: boolean; error?: string };
  } | null>(null);
  const [wipeError, setWipeError] = useState<string | null>(null);
  const wipeInputRef = useRef<HTMLInputElement>(null);

  const syncFromSettings = useCallback((data: PublicSettings) => {
    setSettings(data);
    setModel(MODELS.includes(data.model) ? data.model : "grok-4.5");
    setSelectionModel(MODELS.includes(data.selectionModel) ? data.selectionModel : "");
    setVerificationModel(MODELS.includes(data.verificationModel) ? data.verificationModel : "");
    setApiEndpoint(data.apiEndpoint ?? "");
  }, []);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/settings");
    const data = (await res.json()) as PublicSettings;
    syncFromSettings(data);
  }, [syncFromSettings]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function save(opts?: { key?: string }) {
    const body: {
      model: string;
      selectionModel: string;
      verificationModel: string;
      apiKey?: string;
      theirstackApiKey?: string;
      apiEndpoint: string;
    } = {
      model,
      selectionModel,
      verificationModel,
      // Always send endpoint (empty string = clear/use default).
      apiEndpoint: apiEndpoint.trim(),
    };
    const keyToSend = opts?.key ?? apiKey;
    if (keyToSend.trim()) body.apiKey = keyToSend.trim();
    if (theirstackKey.trim()) body.theirstackApiKey = theirstackKey.trim();

    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error((data as { error?: string }).error || "Save failed");
    syncFromSettings(data as PublicSettings);
    if (keyToSend.trim()) { setApiKey(""); setShowXaiInput(false); }
    if (theirstackKey.trim()) { setTheirstackKey(""); setShowTheirstackInput(false); }
    return data as PublicSettings;
  }

  async function onSave() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await save();
      setMessage("Settings saved. Existing key kept if you left the field blank.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await save();
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const data = (await res.json()) as { ok: boolean; model?: string; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Connection failed");
      setMessage(`Connected! Model: ${data.model || model}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function clearKey() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clearApiKey: true,
          model,
          selectionModel,
          verificationModel,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error || "Failed");
      setSettings(data as PublicSettings);
      setApiKey("");
      setMessage("API key cleared.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function clearTheirstackKey() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clearTheirstackKey: true,
          model,
          selectionModel,
          verificationModel,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error || "Failed");
      setSettings(data as PublicSettings);
      setTheirstackKey("");
      setMessage("TheirStack key cleared.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function wipeAllData() {
    if (wipeConfirmText !== "delete my data") return;
    setWipeBusy(true);
    setWipeError(null);
    setWipeResult(null);
    try {
      const res = await fetch("/api/wipe", { method: "DELETE" });
      const data = await res.json() as {
        allOk: boolean;
        library: { ok: boolean; skipped?: boolean; error?: string };
        postings: { ok: boolean; skipped?: boolean; error?: string };
        settings: { ok: boolean; skipped?: boolean; error?: string };
      };
      setWipeResult(data);
      setWipeConfirmText("");
      // Refresh settings to reflect clean state
      void refresh();
    } catch (err) {
      setWipeError(err instanceof Error ? err.message : String(err));
    } finally {
      setWipeBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="panel p-5">
        <h2 className="mb-2 text-base font-semibold">About</h2>
        <p className="text-sm text-[var(--muted)]">
          RAWE Dog generates tailored application kits (resume, cover letter,
          alignment notes, STAR prep) from a job posting and your personal
          knowledge library, grounded entirely in your own experience files.
          Every run drafts documents in parallel, then verifies grounding and
          consistency before delivery. No fabrication — core guardrails are
          immutable.
        </p>
        <hr className="my-4 border-[var(--border)]" />
        <h3 className="mb-2 text-sm font-semibold">Support RAWE Dog</h3>
        <div className="flex flex-wrap items-center gap-4">
          <img
            src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&bgcolor=0c0e13&color=ffffff&data=0xC300A97f4ce2f9D4B02106045374c4C5eDb349af"
            alt="QR code for Ethereum address"
            width={120}
            height={120}
            className="shrink-0 rounded-lg border border-[var(--border)]"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-sm text-[var(--muted)]">
              If this framework actually helps you land interviews or makes your job search less
              soul-crushing, and you feel like throwing some crypto my way, here's an Ethereum address:
            </p>
            <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[#0c0e13] px-4 py-3">
              <code className="flex-1 break-all font-mono text-sm text-[var(--accent)]">
                0xC300A97f4ce2f9D4B02106045374c4C5eDb349af
              </code>
              <button
                className="btn shrink-0"
                onClick={() =>
                  void navigator.clipboard.writeText("0xC300A97f4ce2f9D4B02106045374c4C5eDb349af")
                }
              >
                Copy
              </button>
            </div>
            <p className="text-sm text-[var(--muted)]">
              No pressure. This is free and open source. Use it, improve it, share it.
            </p>
          </div>
        </div>
      </section>

      <section className="panel p-5">
        <div className="mb-4 flex items-center gap-2">
          <h1 className="mr-auto text-xl font-semibold">Settings</h1>
          <span className={`badge ${settings?.hasTheirstackKey ? "badge-ok" : "badge-bad"}`}>
            TheirStack key {settings?.hasTheirstackKey ? "set" : "missing"}
          </span>
          <span className={`badge ${settings?.hasApiKey ? "badge-ok" : "badge-bad"}`}>
            API key {settings?.hasApiKey ? "set" : "missing"}
          </span>
        </div>

        <div className="space-y-5">
          <div>
            <label className="label">xAI API key</label>
            {settings?.hasApiKey && !showXaiInput ? (
              <div className="flex items-center gap-3">
                <code className="text-sm text-[var(--accent)]">{settings.apiKeyMasked}</code>
                <button
                  className="btn text-xs"
                  onClick={() => setShowXaiInput(true)}
                  disabled={busy}
                >
                  Replace
                </button>
              </div>
            ) : (
              <>
                <input
                  className="input"
                  type="password"
                  placeholder="xai-…"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  disabled={busy}
                  autoFocus={settings?.hasApiKey}
                />
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Get your key at{" "}
                  <a
                    href="https://console.x.ai"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--accent)] underline"
                  >
                    console.x.ai
                  </a>
                  . Keys are stored locally in your server's data directory.
                </p>
              </>
            )}
          </div>

          <div>
            <label className="label">TheirStack API key</label>
            {settings?.hasTheirstackKey && !showTheirstackInput ? (
              <div className="flex items-center gap-3">
                <code className="text-sm text-[var(--accent)]">{settings.theirstackKeyMasked}</code>
                <button
                  className="btn text-xs"
                  onClick={() => setShowTheirstackInput(true)}
                  disabled={busy}
                >
                  Replace
                </button>
              </div>
            ) : (
              <>
                <input
                  className="input"
                  type="password"
                  placeholder="Paste your TheirStack API key"
                  value={theirstackKey}
                  onChange={(e) => setTheirstackKey(e.target.value)}
                  disabled={busy}
                  autoFocus={settings?.hasTheirstackKey}
                />
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Powers the Postings page (live job search). Get a free key at{" "}
                  <a
                    href="https://theirstack.com"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--accent)] underline"
                  >
                    theirstack.com
                  </a>{" "}
                  — 200 job credits/month free, 1 credit per fetched posting.
                </p>
              </>
            )}
          </div>

          <div>
            <label className="label">API endpoint (base URL)</label>
            <input
              className="input font-mono text-sm"
              type="text"
              placeholder="https://api.x.ai/v1 (default)"
              value={apiEndpoint}
              onChange={(e) => setApiEndpoint(e.target.value)}
              disabled={busy}
              spellCheck={false}
              autoComplete="off"
            />
            <p className="mt-1 text-xs text-[var(--muted)]">
              Any OpenAI-compatible endpoint works — OpenRouter, Together, a local Ollama gateway, etc.
              Leave blank to use the xAI default. The endpoint is stored plainly (not masked).
            </p>
          </div>

          <div>
            <label className="label">Drafting model</label>
            <select
              className="select"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={busy}
            >
              {MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Writes the four kit documents. Use your strongest model here.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Selection model (Pass 1)</label>
              <select
                className="select"
                value={selectionModel}
                onChange={(e) => setSelectionModel(e.target.value)}
                disabled={busy}
              >
                <option value="">Same as drafting model</option>
                {MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Picks lead experiences and keywords. A fast/cheap model works
                well.
              </p>
            </div>
            <div>
              <label className="label">Verification model</label>
              <select
                className="select"
                value={verificationModel}
                onChange={(e) => setVerificationModel(e.target.value)}
                disabled={busy}
              >
                <option value="">Same as drafting model</option>
                {MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Checks drafts for grounding, consistency, form, and keyword
                coverage.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={() => void onSave()} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button className="btn" onClick={() => void test()} disabled={busy}>
              {busy ? "Testing…" : "Test connection"}
            </button>
            {settings?.hasApiKey && (
              <button className="btn" onClick={() => void clearKey()} disabled={busy}>
                Clear xAI key
              </button>
            )}
            {settings?.hasTheirstackKey && (
              <button className="btn" onClick={() => void clearTheirstackKey()} disabled={busy}>
                Clear TheirStack key
              </button>
            )}
          </div>

          {message && (
            <div className="rounded-lg border border-[color-mix(in_srgb,var(--accent)_40%,var(--border))] bg-[#0d1a14] px-3 py-2 text-sm text-[var(--accent)]">
              {message}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-[color-mix(in_srgb,var(--danger)_45%,var(--border))] bg-[#2a1414] px-3 py-2 text-sm text-[var(--danger)]">
              {error}
            </div>
          )}
        </div>
      </section>

      {/* Danger zone */}
      <section className="panel p-5 border-[var(--danger)] border">
        <h2 className="mb-1 text-base font-semibold text-[var(--danger)]">Danger zone</h2>
        <p className="mb-4 text-sm text-[var(--muted)]">
          These actions are permanent and cannot be undone.
        </p>

        {wipeResult ? (
          <div className="space-y-3">
            <div
              className={`rounded-lg border px-4 py-3 text-sm ${
                wipeResult.allOk
                  ? "border-[color-mix(in_srgb,var(--accent)_40%,var(--border))] bg-[#0d1a14] text-[var(--accent)]"
                  : "border-[color-mix(in_srgb,var(--danger)_45%,var(--border))] bg-[#2a1414] text-[var(--danger)]"
              }`}
            >
              <p className="mb-2 font-semibold">
                {wipeResult.allOk ? "All data wiped successfully." : "Wipe completed with errors."}
              </p>
              <ul className="space-y-1 text-xs">
                <li>
                  Library files:{" "}
                  {wipeResult.library.ok
                    ? wipeResult.library.skipped
                      ? "✓ already empty"
                      : "✓ deleted"
                    : `✗ error — ${wipeResult.library.error}`}
                </li>
                <li>
                  Postings cache:{" "}
                  {wipeResult.postings.ok
                    ? wipeResult.postings.skipped
                      ? "✓ already empty"
                      : "✓ deleted"
                    : `✗ error — ${wipeResult.postings.error}`}
                </li>
                <li>
                  Saved settings:{" "}
                  {wipeResult.settings.ok
                    ? wipeResult.settings.skipped
                      ? "✓ already empty"
                      : "✓ deleted"
                    : `✗ error — ${wipeResult.settings.error}`}
                </li>
              </ul>
              {wipeResult.allOk && (
                <p className="mt-2 text-xs text-[var(--muted)]">
                  Your credits and credit tokens were not touched. Navigate to Generate or
                  Postings to see the clean first-run state.
                </p>
              )}
            </div>
            <button
              className="btn text-xs"
              onClick={() => setWipeResult(null)}
            >
              Dismiss
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-[color-mix(in_srgb,var(--danger)_30%,var(--border))] bg-[#1a0f0f] p-4">
              <h3 className="mb-1 text-sm font-semibold text-[var(--danger)]">Delete all my data</h3>
              <p className="mb-3 text-xs text-[var(--muted)]">
                Permanently deletes:
              </p>
              <ul className="mb-3 list-inside list-disc space-y-0.5 text-xs text-[var(--muted)]">
                <li>All library files — Master Profile, experiences, templates</li>
                <li>Postings cache and saved search filters</li>
                <li>Saved settings — API key, models, custom endpoint</li>
              </ul>
              <p className="mb-3 text-xs text-[var(--muted)]">
                <span className="font-semibold text-[var(--fg)]">Not deleted:</span> your credits
                ledger and credit tokens — sales records belong to the operator and paid credits
                must survive. Your credit token in localStorage is also untouched.
              </p>
              <label className="label text-xs">
                Type{" "}
                <code className="rounded bg-[#2a1414] px-1 py-0.5 font-mono text-[var(--danger)]">
                  delete my data
                </code>{" "}
                to confirm
              </label>
              <input
                ref={wipeInputRef}
                className="input mb-3 font-mono text-sm"
                type="text"
                placeholder="delete my data"
                value={wipeConfirmText}
                onChange={(e) => setWipeConfirmText(e.target.value)}
                disabled={wipeBusy}
                autoComplete="off"
                spellCheck={false}
              />
              {wipeError && (
                <div className="mb-3 rounded-lg border border-[color-mix(in_srgb,var(--danger)_45%,var(--border))] bg-[#2a1414] px-3 py-2 text-sm text-[var(--danger)]">
                  {wipeError}
                </div>
              )}
              <button
                className="btn text-sm"
                style={{
                  background: wipeConfirmText === "delete my data" ? "var(--danger)" : undefined,
                  color: wipeConfirmText === "delete my data" ? "#fff" : undefined,
                  opacity: wipeConfirmText === "delete my data" ? 1 : 0.4,
                  cursor: wipeConfirmText === "delete my data" ? "pointer" : "not-allowed",
                }}
                onClick={() => void wipeAllData()}
                disabled={wipeBusy || wipeConfirmText !== "delete my data"}
              >
                {wipeBusy ? "Wiping…" : "Delete all my data"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
