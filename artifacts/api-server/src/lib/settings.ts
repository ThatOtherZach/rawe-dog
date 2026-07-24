import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { getSettingsPath, getDataRoot } from "./paths.js";

export type AppSettings = {
  apiKey: string;
  model: string;
};

const DEFAULT_MODEL = "grok-4.5";

export function getDefaultSettings(): AppSettings {
  return {
    apiKey: process.env["XAI_API_KEY"]?.trim() || "",
    model: process.env["XAI_MODEL"]?.trim() || DEFAULT_MODEL,
  };
}

export function loadSettings(): AppSettings {
  const defaults = getDefaultSettings();
  const filePath = getSettingsPath();
  if (!existsSync(filePath)) {
    return defaults;
  }
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as Partial<AppSettings>;
    return {
      apiKey: (raw.apiKey ?? defaults.apiKey).trim(),
      model: (raw.model ?? defaults.model).trim() || DEFAULT_MODEL,
    };
  } catch {
    return defaults;
  }
}

export function saveSettings(partial: Partial<AppSettings>): AppSettings {
  const current = loadSettings();
  const next: AppSettings = {
    apiKey:
      partial.apiKey !== undefined ? partial.apiKey.trim() : current.apiKey,
    model:
      partial.model !== undefined
        ? partial.model.trim() || DEFAULT_MODEL
        : current.model,
  };
  mkdirSync(getDataRoot(), { recursive: true });
  writeFileSync(getSettingsPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 12) return "••••••••";
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

export function publicSettings() {
  const s = loadSettings();
  return {
    hasApiKey: Boolean(s.apiKey),
    apiKeyMasked: maskApiKey(s.apiKey),
    model: s.model,
  };
}

/** Ensure parent dirs exist for any data write. */
export function ensureDataDirs(): void {
  mkdirSync(path.join(getDataRoot(), "library"), { recursive: true });
}
