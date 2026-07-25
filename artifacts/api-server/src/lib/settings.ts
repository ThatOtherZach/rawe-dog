import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { getSettingsPath, getDataRoot } from "./paths.js";

export type AppSettings = {
  apiKey: string;
  /** Premium model used for document drafting (and any stage without an override). */
  model: string;
  /** Optional fast/cheap model for Pass 1 experience selection. Empty = use `model`. */
  selectionModel: string;
  /** Optional fast/cheap model for verification + JSON repair. Empty = use `model`. */
  verificationModel: string;
  /** TheirStack API key for the Postings page job search. */
  theirstackApiKey: string;
  /**
   * Optional OpenAI-compatible base URL for LLM calls. Empty = use the
   * XAI_BASE_URL env hook, then fall back to https://api.x.ai/v1.
   */
  apiEndpoint: string;
};

const DEFAULT_MODEL = "grok-4.5";

export function getDefaultSettings(): AppSettings {
  return {
    apiKey: process.env["XAI_API_KEY"]?.trim() || "",
    model: process.env["XAI_MODEL"]?.trim() || DEFAULT_MODEL,
    selectionModel: process.env["XAI_SELECTION_MODEL"]?.trim() || "",
    verificationModel: process.env["XAI_VERIFICATION_MODEL"]?.trim() || "",
    theirstackApiKey: process.env["THEIRSTACK_API_KEY"]?.trim() || "",
    // No env default — apiEndpoint is intentionally user-only; env uses XAI_BASE_URL.
    apiEndpoint: "",
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
      selectionModel: (raw.selectionModel ?? defaults.selectionModel).trim(),
      verificationModel: (raw.verificationModel ?? defaults.verificationModel).trim(),
      theirstackApiKey: (raw.theirstackApiKey ?? defaults.theirstackApiKey).trim(),
      apiEndpoint: (raw.apiEndpoint ?? defaults.apiEndpoint).trim(),
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
    selectionModel:
      partial.selectionModel !== undefined
        ? partial.selectionModel.trim()
        : current.selectionModel,
    verificationModel:
      partial.verificationModel !== undefined
        ? partial.verificationModel.trim()
        : current.verificationModel,
    theirstackApiKey:
      partial.theirstackApiKey !== undefined
        ? partial.theirstackApiKey.trim()
        : current.theirstackApiKey,
    apiEndpoint:
      partial.apiEndpoint !== undefined
        ? partial.apiEndpoint.trim()
        : current.apiEndpoint,
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
    selectionModel: s.selectionModel,
    verificationModel: s.verificationModel,
    hasTheirstackKey: Boolean(s.theirstackApiKey),
    theirstackKeyMasked: maskApiKey(s.theirstackApiKey),
    // Shown plainly — not a secret.
    apiEndpoint: s.apiEndpoint,
  };
}

/** Ensure parent dirs exist for any data write. */
export function ensureDataDirs(): void {
  mkdirSync(path.join(getDataRoot(), "library"), { recursive: true });
}
