import { useCallback, useEffect, useState } from "react";

type PublicSettings = {
  hasApiKey: boolean;
  apiKeyMasked: string;
  model: string;
  selectionModel: string;
  verificationModel: string;
};

const MODELS = [
  "grok-4.5",
  "grok-4.5-mini",
  "grok-3",
  "grok-3-mini",
  "grok-3-fast",
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("grok-4.5");
  const [selectionModel, setSelectionModel] = useState("");
  const [verificationModel, setVerificationModel] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/settings");
    const data = (await res.json()) as PublicSettings;
    setSettings(data);
    setModel(data.model || "grok-4.5");
    setSelectionModel(data.selectionModel || "");
    setVerificationModel(data.verificationModel || "");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function save(opts?: { key?: string }) {
    const body: {
      model: string;
      selectionModel: string;
      verificationModel: string;
      apiKey?: string;
    } = {
      model,
      selectionModel,
      verificationModel,
    };
    const keyToSend = opts?.key ?? apiKey;
    if (keyToSend.trim()) body.apiKey = keyToSend.trim();

    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error((data as { error?: string }).error || "Save failed");
    setSettings(data as PublicSettings);
    if (keyToSend.trim()) setApiKey("");
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

  return (
    <div className="space-y-6">
      <section className="panel p-5">
        <div className="mb-4 flex items-center gap-2">
          <h1 className="mr-auto text-xl font-semibold">Settings</h1>
          <span className={`badge ${settings?.hasApiKey ? "badge-ok" : "badge-bad"}`}>
            API key {settings?.hasApiKey ? "set" : "missing"}
          </span>
        </div>

        <div className="space-y-5">
          <div>
            <label className="label">xAI API key</label>
            {settings?.hasApiKey && (
              <p className="mb-2 text-xs text-[var(--muted)]">
                Current: <code className="text-[var(--accent)]">{settings.apiKeyMasked}</code>
              </p>
            )}
            <input
              className="input"
              type="password"
              placeholder={
                settings?.hasApiKey
                  ? "Enter new key to replace, or leave blank to keep current"
                  : "xai-…"
              }
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={busy}
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
                Clear key
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
      </section>
    </div>
  );
}
