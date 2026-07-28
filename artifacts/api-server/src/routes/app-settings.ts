import { Router, type Request, type Response } from "express";
import {
  publicSettings,
  saveSettings,
  getDefaultSettings,
} from "../lib/settings.js";
import { testConnection } from "../lib/xai.js";

const router = Router();

router.get("/settings", (_req: Request, res: Response) => {
  res.json(publicSettings());
});

router.put("/settings", async (req: Request, res: Response) => {
  const body = req.body as {
    model?: string;
    selectionModel?: string;
    verificationModel?: string;
    runVerification?: boolean;
    generatePdf?: boolean;
    // apiKey / apiEndpoint / clearApiKey are silently ignored — the AI key is
    // per user/session (browser-held, sent as X-AI-Key/X-AI-Endpoint headers)
    // and is never persisted server-side.
    // theirstackApiKey / clearTheirstackKey are silently ignored — TheirStack is operator-only.
  };

  const partial: {
    model?: string;
    selectionModel?: string;
    verificationModel?: string;
    runVerification?: boolean;
    generatePdf?: boolean;
  } = {};

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

  if (typeof body.runVerification === "boolean") {
    partial.runVerification = body.runVerification;
  }

  if (typeof body.generatePdf === "boolean") {
    partial.generatePdf = body.generatePdf;
  }

  saveSettings(partial);
  res.json(publicSettings());
});

router.post("/settings", async (req: Request, res: Response) => {
  const body = (req.body || {}) as { action?: string };

  if (body.action === "test") {
    // Uses the request-scoped AI credentials (X-AI-Key / X-AI-Endpoint
    // headers) with operator-env fallback — same resolution as generation.
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
