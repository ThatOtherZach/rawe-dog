import { Router, type Request, type Response } from "express";
import {
  publicSettings,
  saveSettings,
  loadSettings,
  getDefaultSettings,
} from "../lib/settings.js";
import { testConnection } from "../lib/xai.js";

const router = Router();

router.get("/settings", (_req: Request, res: Response) => {
  res.json(publicSettings());
});

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

router.put("/settings", async (req: Request, res: Response) => {
  const body = req.body as {
    apiKey?: string;
    model?: string;
    selectionModel?: string;
    verificationModel?: string;
    clearApiKey?: boolean;
    // theirstackApiKey / clearTheirstackKey are silently ignored — TheirStack is operator-only.
    apiEndpoint?: string;
    runVerification?: boolean;
  };

  const current = loadSettings();
  const partial: {
    apiKey?: string;
    model?: string;
    selectionModel?: string;
    verificationModel?: string;
    apiEndpoint?: string;
    runVerification?: boolean;
  } = {};

  if (body.clearApiKey) {
    partial.apiKey = "";
  } else if (typeof body.apiKey === "string" && body.apiKey.trim()) {
    partial.apiKey = body.apiKey.trim();
  }

  if (typeof body.model === "string") {
    partial.model = body.model.trim();
  }
  // Empty string is meaningful for stage models: "use the drafting model".
  if (typeof body.selectionModel === "string") {
    partial.selectionModel = body.selectionModel.trim();
  }
  if (typeof body.verificationModel === "string") {
    partial.verificationModel = body.verificationModel.trim();
  }

  // apiEndpoint: empty string = clear (use default). Non-empty must be a valid http(s) URL.
  if (typeof body.apiEndpoint === "string") {
    const trimmed = body.apiEndpoint.trim();
    if (trimmed && !isValidHttpUrl(trimmed)) {
      res.status(400).json({ error: "API endpoint must be a valid http or https URL." });
      return;
    }
    partial.apiEndpoint = trimmed;
  }

  if (typeof body.runVerification === "boolean") {
    partial.runVerification = body.runVerification;
  }

  if (partial.apiKey === undefined) {
    partial.apiKey = current.apiKey;
  }

  saveSettings(partial);
  res.json(publicSettings());
});

router.post("/settings", async (req: Request, res: Response) => {
  const body = (req.body || {}) as { action?: string };

  if (body.action === "test") {
    const result = await testConnection();
    res.status(result.ok ? 200 : 400).json(result);
    return;
  }

  if (body.action === "reset-env") {
    const defaults = getDefaultSettings();
    saveSettings(defaults);
    res.json(publicSettings());
    return;
  }

  res.status(400).json({ error: "Unknown action" });
});

export default router;
