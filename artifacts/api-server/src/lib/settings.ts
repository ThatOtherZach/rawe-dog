import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { getSettingsPath, getDataRoot } from "./paths.js";
import { aiKeyAvailable, operatorKey } from "./ai-context.js";

/**
 * Operator-owned app settings (models, toggles). The AI API key and custom
 * endpoint are intentionally NOT here — they are per user/session, held in
 * the visitor's browser and sent as request headers (see lib/ai-context.ts).
 * A user-supplied key is never written to disk.
 */
export type AppSettings = {
  /** Premium model used for document drafting (and any stage without an override). */
  model: string;
  /** Optional fast/cheap model for Pass 1 experience selection. Empty = use `model`. */
  selectionModel: string;
  /** Optional fast/cheap model for verification + JSON repair. Empty = use `model`. */
  verificationModel: string;
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
    model: process.env["XAI_MODEL"]?.trim() || DEFAULT_MODEL,
    selectionModel: process.env["XAI_SELECTION_MODEL"]?.trim() || "",
    verificationModel: process.env["XAI_VERIFICATION_MODEL"]?.trim() || "",
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
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as Partial<
      AppSettings & { apiKey?: unknown; apiEndpoint?: unknown; theirstackApiKey?: unknown }
    >;
    return {
      model: (raw.model ?? defaults.model).trim() || DEFAULT_MODEL,
      selectionModel: (raw.selectionModel ?? defaults.selectionModel).trim(),
      verificationModel: (raw.verificationModel ?? defaults.verificationModel).trim(),
      // apiKey / apiEndpoint / theirstackApiKey in the file are legacy and
      // silently ignored — see scrubLegacyAiCredentials().
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

/**
 * One-time migration: earlier versions persisted a user-pasted API key and
 * endpoint into settings.json — shared by every visitor. Rewrite the file
 * without those fields so no user key remains on disk. Called at startup.
 */
export function scrubLegacyAiCredentials(): boolean {
  const filePath = getSettingsPath();
  if (!existsSync(filePath)) return false;
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
    if (!("apiKey" in raw) && !("apiEndpoint" in raw) && !("theirstackApiKey" in raw)) {
      return false;
    }
    saveSettings({}); // rewrites the file with only the AppSettings shape
    return true;
  } catch {
    return false;
  }
}

export function publicSettings() {
  const s = loadSettings();
  return {
    // Request-scoped: true when the caller sent a session key OR the
    // operator env key exists as fallback.
    hasApiKey: aiKeyAvailable(),
    // True when the server has an operator fallback key (free tier possible).
    hasOperatorKey: Boolean(operatorKey()),
    model: s.model,
    selectionModel: s.selectionModel,
    verificationModel: s.verificationModel,
    // TheirStack is operator-supplied; reflects the env var only.
    hasTheirstackKey: Boolean(process.env["THEIRSTACK_API_KEY"]?.trim()),
    runVerification: s.runVerification,
    generatePdf: s.generatePdf,
  };
}

/** Ensure parent dirs exist for any data write. */
export function ensureDataDirs(): void {
  mkdirSync(path.join(getDataRoot(), "library"), { recursive: true });
}
