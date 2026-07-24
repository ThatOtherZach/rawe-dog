"use client";

import { useCallback, useEffect, useState } from "react";

type PublicSettings = {
  hasApiKey: boolean;
  apiKeyMasked: string;
  model: string;
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("grok-4.5");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/settings");
    const data = (await res.json()) as PublicSettings;
    setSettings(data);
    setModel(data.model || "grok-4.5");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function save(opts?: { key?: string; modelValue?: string }) {
    const body: { model: string; apiKey?: string } = {
      model: opts?.modelValue ?? model,
    };
    const keyToSend = opts?.key ?? apiKey;
    if (keyToSend.trim()) body.apiKey = keyToSend.trim();

    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Save failed");
    setSettings(data);
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
      // Persist model / new key first without recursive busy flag issues
      if (apiKey.trim() || model !== settings?.model) {
        await save();
      }
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || "Connection test failed");
      }
      setMessage(data.message);
      await refresh();
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
        body: JSON.stringify({ clearApiKey: true, model }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Clear failed");
      setSettings(data);
      setApiKey("");
      setMessage("API key cleared.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function resetEnv() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset-env" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reset failed");
      setSettings(data);
      setModel(data.model || "grok-4.5");
      setMessage("Re-seeded from environment variables (if set).");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="panel max-w-2xl p-5">
        <h1 className="mb-1 text-xl font-semibold">Settings</h1>
        <p className="mb-5 text-sm text-[var(--muted)]">
          API key stays on this machine under{" "}
          <code className="text-[var(--accent)]">web/data/settings.json</code>{" "}
          (gitignored). Never commit secrets. Rotate any key that was pasted
          into chat.
        </p>

        <div className="space-y-4">
          <div>
            <label className="label">xAI API key</label>
            <input
              className="input"
              type="password"
              autoComplete="off"
              placeholder={
                settings?.hasApiKey
                  ? settings.apiKeyMasked || "•••• saved — leave blank to keep"
                  : "xai-..."
              }
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p className="mt-1 text-xs text-[var(--muted)]">
              {settings?.hasApiKey
                ? `Saved key: ${settings.apiKeyMasked}. Leave blank when saving to keep it.`
                : "No key saved yet. Get one at console.x.ai"}
            </p>
          </div>

          <div>
            <label className="label">Model</label>
            <input
              className="input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="grok-4.5"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void onSave()}
            >
              Save
            </button>
            <button className="btn" disabled={busy} onClick={() => void test()}>
              Test connection
            </button>
            <button
              className="btn"
              disabled={busy || !settings?.hasApiKey}
              onClick={() => void clearKey()}
            >
              Clear key
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => void resetEnv()}
            >
              Reset from env
            </button>
          </div>

          {message && (
            <div className="rounded-lg border border-[color-mix(in_srgb,var(--accent)_40%,var(--border))] bg-[#14241c] px-3 py-2 text-sm text-[var(--accent)]">
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

      <section className="panel max-w-2xl p-5 text-sm text-[var(--muted)]">
        <h2 className="mb-2 text-base font-semibold text-[var(--text)]">
          How generation works
        </h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Core RAWE Dog rules are immutable (no fabrication, grounded bullets).</li>
          <li>Library “system instructions” only add preferences.</li>
          <li>
            Pass 1 selects lead experiences (overridable). Pass 2 writes the
            kit from full lead evidence.
          </li>
          <li>Export PDF / DOCX / full kit ZIP from the Generate page.</li>
        </ul>
      </section>
    </div>
  );
}
