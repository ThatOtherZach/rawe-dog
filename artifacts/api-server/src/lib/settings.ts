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
  /**
   * Optional OpenAI-compatible base URL for LLM calls. Empty = use the
   * XAI_BASE_URL env hook, then fall back to https://api.x.ai/v1.
   */
  apiEndpoint: string;
  /**
   * When false, the verification + repair pass is skipped for all kit
   * generations (posting-sourced and paste-sourced alike). Default true.
   */
  runVerification: boolean;
  /**
   * When true, a PDF is generated alongside the kit (and included in the ZIP
   * export). Default false — PDF generation adds latency and most users only
   * need DOCX/MD.
   */
  generatePdf: boolean;
};

const DEFAULT_MODEL = "grok-4.5";

export function getDefaultSettings(): AppSettings {
  return {
    apiKey: process.env["XAI_API_KEY"]?.trim() || "",
    model: process.env["XAI_MODEL"]?.trim() || DEFAULT_MODEL,
    selectionModel: process.env["XAI_SELECTION_MODEL"]?.trim() || "",
    verificationModel: process.env["XAI_VERIFICATION_MODEL"]?.trim() || "",
    // No env default — apiEndpoint is intentionally user-only; env uses XAI_BASE_URL.
    apiEndpoint: "",
    runVerification: true,
    generatePdf: false,
  };
}

export function loadSettings(): AppSettings {
  const defaults = getDefaultSettings();
  const filePath = getSettingsPath();
  if (!existsSync(filePath)) {
    return defaults;
  }
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as Partial<AppSettings & { theirstackApiKey?: unknown }>;
    return {
      apiKey: (raw.apiKey ?? defaults.apiKey).trim(),
      model: (raw.model ?? defaults.model).trim() || DEFAULT_MODEL,
      selectionModel: (raw.selectionModel ?? defaults.selectionModel).trim(),
      verificationModel: (raw.verificationModel ?? defaults.verificationModel).trim(),
      // theirstackApiKey is operator-only (env var); stored values are silently discarded.
      apiEndpoint: (raw.apiEndpoint ?? defaults.apiEndpoint).trim(),
      runVerification: raw.runVerification !== undefined ? Boolean(raw.runVerification) : defaults.runVerification,
      generatePdf: raw.generatePdf !== undefined ? Boolean(raw.generatePdf) : defaults.generatePdf,
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
    // theirstackApiKey is operator-only; any incoming value is silently dropped.
    apiEndpoint:
      partial.apiEndpoint !== undefined
        ? partial.apiEndpoint.trim()
        : current.apiEndpoint,
    runVerification:
      partial.runVerification !== undefined
        ? Boolean(partial.runVerification)
        : current.runVerification,
    generatePdf:
      partial.generatePdf !== undefined
        ? Boolean(partial.generatePdf)
        : current.generatePdf,
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
    // TheirStack is operator-supplied; reflects the env var only.
    hasTheirstackKey: Boolean(process.env["THEIRSTACK_API_KEY"]?.trim()),
    // Shown plainly — not a secret.
    apiEndpoint: s.apiEndpoint,
    runVerification: s.runVerification,
    generatePdf: s.generatePdf,
  };
}

/** Ensure parent dirs exist for any data write. */
export function ensureDataDirs(): void {
  mkdirSync(path.join(getDataRoot(), "library"), { recursive: true });
}
